"""Config flow supporting Hub setup, HA Integration Discovery, and Device Options."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import (
    CONF_DEVICE_MODEL,
    CONF_DEVICE_NAME,
    CONF_ENTRY_TYPE,
    CONF_REPLACE_TARGET_DEVICE,
    CONF_VIRTUAL_DEVICE_ID,
    DOMAIN,
    ENTRY_TYPE_DEVICE,
    ENTRY_TYPE_HUB,
)
from .device_mapping import (
    ProxyMappingItem,
    apply_proxy_mappings,
    list_real_devices,
    plan_device_replacement,
)
from .storage import MagnoliaProxyStore


class MagnoliaProxyConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle manual Hub setup and automatic Virtual Device discovery."""

    VERSION = 2

    def __init__(self) -> None:
        """Initialize discovery state."""
        self._discovered_device: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Set up the Magnolia Proxy Hub & Sidebar Panel."""
        await self.async_set_unique_id(f"{DOMAIN}_hub")
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="Magnolia Proxy Hub",
                data={CONF_ENTRY_TYPE: ENTRY_TYPE_HUB},
            )

        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    async def async_step_integration_discovery(
        self, discovery_info: dict[str, Any]
    ) -> ConfigFlowResult:
        """Handle a newly created Virtual Device discovered by Home Assistant."""
        vdev_id = discovery_info[CONF_VIRTUAL_DEVICE_ID]
        dev_name = discovery_info.get(CONF_DEVICE_NAME, vdev_id)

        await self.async_set_unique_id(f"{DOMAIN}_{vdev_id}")
        self._abort_if_unique_id_configured()

        self._discovered_device = {
            CONF_ENTRY_TYPE: ENTRY_TYPE_DEVICE,
            CONF_VIRTUAL_DEVICE_ID: vdev_id,
            CONF_DEVICE_NAME: dev_name,
            CONF_DEVICE_MODEL: discovery_info.get(CONF_DEVICE_MODEL, "Virtual Device"),
        }
        self.context["title_placeholders"] = {"name": dev_name}
        return await self.async_step_discovery_confirm()

    async def async_step_discovery_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm adding the discovered Virtual Device to Home Assistant."""
        dev_name = self._discovered_device.get(CONF_DEVICE_NAME, "Virtual Device")
        if user_input is not None:
            store: MagnoliaProxyStore | None = self.hass.data.get(DOMAIN, {}).get(
                "store"
            )
            vdev_id = self._discovered_device.get(CONF_VIRTUAL_DEVICE_ID)
            if store is None or store.get_device(vdev_id) is None:
                return self.async_abort(reason="device_not_found")
            return self.async_create_entry(
                title=dev_name,
                data=self._discovered_device,
            )

        return self.async_show_form(
            step_id="discovery_confirm",
            description_placeholders={"name": dev_name},
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlowWithReload:
        """Create the options flow for a Virtual Device config entry."""
        return MagnoliaProxyDeviceOptionsFlow()


class MagnoliaProxyDeviceOptionsFlow(OptionsFlowWithReload):
    """Options flow on each Virtual Device entry to run Replace Device & conflict mapping."""

    def __init__(self) -> None:
        """Initialize flow state."""
        self._pending_items: list[ProxyMappingItem] = []
        self._auto_resolved: dict[str, str] = {}

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Select a replacement physical device for this Virtual Device."""
        if self.config_entry.data.get(CONF_ENTRY_TYPE) != ENTRY_TYPE_DEVICE:
            return self.async_abort(reason="hub_uses_sidebar")

        vdev_id: str = self.config_entry.data[CONF_VIRTUAL_DEVICE_ID]
        store: MagnoliaProxyStore | None = self.hass.data.get(DOMAIN, {}).get("store")
        real_devices = list_real_devices(self.hass)
        errors: dict[str, str] = {}

        if user_input is not None:
            target_dev_id = user_input.get(CONF_REPLACE_TARGET_DEVICE, "")
            if not target_dev_id:
                errors[CONF_REPLACE_TARGET_DEVICE] = "required"
            elif store is not None:
                planned = plan_device_replacement(
                    self.hass, store, vdev_id, target_dev_id
                )
                self._pending_items = planned
                self._auto_resolved = {
                    item.proxy_id: item.selected_source_entity
                    for item in planned
                    if item.conflict_reason is None and item.selected_source_entity
                }

                conflicts = [
                    item for item in planned if item.conflict_reason is not None
                ]
                if conflicts:
                    return await self.async_step_resolve_conflicts()

                await apply_proxy_mappings(store, self._auto_resolved)
                return self.async_create_entry(title="", data={})

        real_opts = [
            SelectOptionDict(value=dev["id"], label=f"{dev['name']} ({dev['id'][:8]})")
            for dev in real_devices
        ]

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_REPLACE_TARGET_DEVICE): SelectSelector(
                        SelectSelectorConfig(
                            options=real_opts, mode=SelectSelectorMode.DROPDOWN
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_resolve_conflicts(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manually map proxy entities that had multiple or missing matches."""
        store: MagnoliaProxyStore | None = self.hass.data.get(DOMAIN, {}).get("store")
        conflicts = [
            item for item in self._pending_items if item.conflict_reason is not None
        ]

        if user_input is not None:
            final_mappings = dict(self._auto_resolved)
            for item in conflicts:
                chosen = user_input.get(item.proxy_id)
                if chosen and chosen != "_skip_":
                    final_mappings[item.proxy_id] = chosen

            if store is not None:
                await apply_proxy_mappings(
                    store, final_mappings, allow_switch_as_x=True
                )
            return self.async_create_entry(title="", data={})

        schema_fields: dict[Any, Any] = {}
        for item in conflicts:
            choices: list[SelectOptionDict] = [
                SelectOptionDict(value="_skip_", label="Keep current / Do not remap")
            ]
            for cand in item.candidates:
                state = self.hass.states.get(cand)
                friendly = (
                    state.attributes.get("friendly_name", cand) if state else cand
                )
                suffix = (
                    f" — as {item.locked_domain}, creates a helper"
                    if cand in item.switch_as_x
                    else ""
                )
                choices.append(
                    SelectOptionDict(
                        value=cand, label=f"{friendly} ({cand}){suffix}"
                    )
                )

            field_key = vol.Optional(
                item.proxy_id,
                default=item.selected_source_entity or "_skip_",
            )
            schema_fields[field_key] = SelectSelector(
                SelectSelectorConfig(
                    options=choices, mode=SelectSelectorMode.DROPDOWN
                )
            )

        return self.async_show_form(
            step_id="resolve_conflicts",
            data_schema=vol.Schema(schema_fields),
            description_placeholders={"conflict_count": str(len(conflicts))},
        )
