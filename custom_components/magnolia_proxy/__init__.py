"""The Magnolia Proxy integration."""
from __future__ import annotations

from pathlib import Path
import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .api import async_register_api
from .const import (
    ATTR_MAPPINGS,
    ATTR_MODEL,
    ATTR_NAME,
    ATTR_TARGET_DEVICE_ID,
    ATTR_VIRTUAL_DEVICE_ID,
    CONF_ENTRY_TYPE,
    CONF_VIRTUAL_DEVICE_ID,
    DOMAIN,
    ENTRY_TYPE_DEVICE,
    ENTRY_TYPE_HUB,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PROXY_PLATFORMS,
    SERVICE_CREATE_DEVICE,
    SERVICE_REPLACE_DEVICE,
    STATIC_BASE_URL,
)
from .device_mapping import apply_proxy_mappings, plan_device_replacement
from .storage import MagnoliaProxyStore


async def _async_ensure_runtime(hass: HomeAssistant) -> MagnoliaProxyStore:
    """Initialize shared store, HTTP static assets, REST API, and sidebar panel once."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    store: MagnoliaProxyStore | None = domain_data.get("store")
    if store is None:
        store = MagnoliaProxyStore(hass)
        await store.async_load()
        domain_data["store"] = store

    if not domain_data.get("panel_registered"):
        frontend_path = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    STATIC_BASE_URL,
                    str(frontend_path),
                    cache_headers=False,
                )
            ]
        )
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="magnolia-proxy-panel",
            frontend_url_path=PANEL_URL_PATH,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{STATIC_BASE_URL}/magnolia-proxy-panel.js",
            require_admin=False,
        )
        async_register_api(hass, store)
        domain_data["panel_registered"] = True

    if not hass.services.has_service(DOMAIN, SERVICE_CREATE_DEVICE):
        async def _handle_create_device(call: ServiceCall) -> None:
            await store.async_create_device(
                name=call.data.get(ATTR_NAME),
                model=call.data.get(ATTR_MODEL, "Virtual Device"),
                trigger_discovery=True,
            )

        hass.services.async_register(
            DOMAIN,
            SERVICE_CREATE_DEVICE,
            _handle_create_device,
            schema=vol.Schema(
                {
                    vol.Optional(ATTR_NAME): cv.string,
                    vol.Optional(ATTR_MODEL, default="Virtual Device"): cv.string,
                }
            ),
        )

    if not hass.services.has_service(DOMAIN, SERVICE_REPLACE_DEVICE):
        async def _handle_replace_device(call: ServiceCall) -> None:
            vdev_id: str = call.data[ATTR_VIRTUAL_DEVICE_ID]
            target_dev_id: str = call.data[ATTR_TARGET_DEVICE_ID]
            explicit_mappings: dict[str, str] = call.data.get(ATTR_MAPPINGS, {})

            planned = plan_device_replacement(hass, store, vdev_id, target_dev_id)
            resolved: dict[str, str] = {}
            for item in planned:
                if item.proxy_id in explicit_mappings:
                    resolved[item.proxy_id] = explicit_mappings[item.proxy_id]
                elif item.proxy_entity_id and item.proxy_entity_id in explicit_mappings:
                    resolved[item.proxy_id] = explicit_mappings[item.proxy_entity_id]
                elif item.conflict_reason is None and item.selected_source_entity:
                    resolved[item.proxy_id] = item.selected_source_entity

            await apply_proxy_mappings(store, resolved)

        hass.services.async_register(
            DOMAIN,
            SERVICE_REPLACE_DEVICE,
            _handle_replace_device,
            schema=vol.Schema(
                {
                    vol.Required(ATTR_VIRTUAL_DEVICE_ID): cv.string,
                    vol.Required(ATTR_TARGET_DEVICE_ID): cv.string,
                    vol.Optional(ATTR_MAPPINGS, default={}): {cv.string: cv.entity_id},
                }
            ),
        )

    return store


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up either the Magnolia Proxy Hub (sidebar) or a discovered Virtual Device."""
    store = await _async_ensure_runtime(hass)
    entry_type = entry.data.get(CONF_ENTRY_TYPE, ENTRY_TYPE_HUB)

    if entry_type == ENTRY_TYPE_HUB:
        await hass.config_entries.async_forward_entry_setups(entry, [Platform.BUTTON])
        await store.async_discover_unadded_devices()
        return True

    vdev_id: str | None = entry.data.get(CONF_VIRTUAL_DEVICE_ID)
    if not vdev_id or store.get_device(vdev_id) is None:
        return False

    store.ensure_device_in_registry(entry, vdev_id)
    await hass.config_entries.async_forward_entry_setups(entry, PROXY_PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Magnolia Proxy config entry."""
    entry_type = entry.data.get(CONF_ENTRY_TYPE, ENTRY_TYPE_HUB)
    platforms: list[Platform] = (
        [Platform.BUTTON] if entry_type == ENTRY_TYPE_HUB else PROXY_PLATFORMS
    )
    unload_ok = await hass.config_entries.async_unload_platforms(entry, platforms)

    if unload_ok and not hass.config_entries.async_loaded_entries(DOMAIN):
        domain_data = hass.data.get(DOMAIN, {})
        if domain_data.get("panel_registered"):
            frontend.async_remove_panel(hass, PANEL_URL_PATH)
        for service_name in (SERVICE_CREATE_DEVICE, SERVICE_REPLACE_DEVICE):
            if hass.services.has_service(DOMAIN, service_name):
                hass.services.async_remove(DOMAIN, service_name)
        hass.data.pop(DOMAIN, None)

    return unload_ok
