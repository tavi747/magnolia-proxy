"""HTTP REST API endpoints for the Magnolia Proxy sidebar panel."""
from __future__ import annotations

from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, SUPPORTED_DOMAINS
from .device_mapping import (
    apply_proxy_mappings,
    list_real_devices,
    plan_device_replacement,
)
from .storage import MagnoliaProxyStore


def async_register_api(hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
    """Register REST views for the Magnolia Proxy sidebar panel."""
    hass.http.register_view(MagnoliaStateView(hass, store))
    hass.http.register_view(MagnoliaDevicesView(hass, store))
    hass.http.register_view(MagnoliaDeviceDetailView(hass, store))
    hass.http.register_view(MagnoliaProxiesView(hass, store))
    hass.http.register_view(MagnoliaProxyDetailView(hass, store))
    hass.http.register_view(MagnoliaReplacePlanView(hass, store))
    hass.http.register_view(MagnoliaReplaceApplyView(hass, store))


class MagnoliaStateView(HomeAssistantView):
    """Return virtual devices, proxy entities, real devices, and source entities."""

    url = "/api/magnolia_proxy/state"
    name = "api:magnolia_proxy:state"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    async def get(self, request: web.Request) -> web.Response:
        ent_reg = er.async_get(self.hass)
        source_entities: list[dict[str, Any]] = []
        for state in self.hass.states.async_all():
            if state.domain not in SUPPORTED_DOMAINS:
                continue
            reg_entry = ent_reg.async_get(state.entity_id)
            if reg_entry and reg_entry.platform == DOMAIN:
                continue
            source_entities.append(
                {
                    "entity_id": state.entity_id,
                    "domain": state.domain,
                    "name": state.attributes.get("friendly_name", state.entity_id),
                    "state": state.state,
                    "device_class": state.attributes.get("device_class"),
                    "unit_of_measurement": state.attributes.get("unit_of_measurement"),
                }
            )
        source_entities.sort(key=lambda item: item["entity_id"])

        devices = self.store.list_devices()
        for dev in devices:
            for proxy in dev["proxies"]:
                unique_id = f"{proxy['id']}_{proxy['domain']}"
                proxy["entity_id"] = ent_reg.async_get_entity_id(
                    proxy["domain"], DOMAIN, unique_id
                )
                live_state = (
                    self.hass.states.get(proxy["entity_id"])
                    if proxy["entity_id"]
                    else None
                )
                proxy["live_state"] = (
                    live_state.state if live_state else "pending_discovery"
                )
                proxy["unit_of_measurement"] = (
                    live_state.attributes.get("unit_of_measurement")
                    if live_state
                    else None
                )

        return self.json(
            {
                "devices": devices,
                "real_devices": list_real_devices(self.hass),
                "source_entities": source_entities,
            }
        )


class MagnoliaDevicesView(HomeAssistantView):
    """Create a virtual device and trigger HA discovery."""

    url = "/api/magnolia_proxy/devices"
    name = "api:magnolia_proxy:devices"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    async def post(self, request: web.Request) -> web.Response:
        body = await request.json()
        name = body.get("name")
        model = body.get("model", "Virtual Device")
        device = await self.store.async_create_device(
            name=name, model=model, trigger_discovery=True
        )
        return self.json({"device": device})


class MagnoliaDeviceDetailView(HomeAssistantView):
    """Delete or re-trigger discovery for a virtual device."""

    url = "/api/magnolia_proxy/devices/{device_id}"
    name = "api:magnolia_proxy:device_detail"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    async def delete(self, request: web.Request, device_id: str) -> web.Response:
        deleted = await self.store.async_delete_device(device_id)
        if not deleted:
            return self.json_message("Virtual device not found", status_code=404)
        return self.json({"deleted": True})

    async def post(self, request: web.Request, device_id: str) -> web.Response:
        await self.store.async_trigger_device_discovery(device_id)
        return self.json({"discovered": True})


class MagnoliaProxiesView(HomeAssistantView):
    """Create a domain-locked proxy entity on a virtual device."""

    url = "/api/magnolia_proxy/proxies"
    name = "api:magnolia_proxy:proxies"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    async def post(self, request: web.Request) -> web.Response:
        body = await request.json()
        try:
            proxy = await self.store.async_create_proxy(
                name=body.get("name", ""),
                source_entity=body.get("source_entity", ""),
                virtual_device_id=body.get("virtual_device_id", ""),
            )
        except ValueError as err:
            return self.json_message(str(err), status_code=400)
        return self.json({"proxy": proxy})


class MagnoliaProxyDetailView(HomeAssistantView):
    """Update source entity or delete a proxy entity."""

    url = "/api/magnolia_proxy/proxies/{proxy_id}"
    name = "api:magnolia_proxy:proxy_detail"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    async def patch(self, request: web.Request, proxy_id: str) -> web.Response:
        body = await request.json()
        try:
            proxy = await self.store.async_update_proxy_source(
                proxy_id=proxy_id,
                new_source_entity=body.get("source_entity", ""),
            )
        except ValueError as err:
            return self.json_message(str(err), status_code=400)
        return self.json({"proxy": proxy})

    async def delete(self, request: web.Request, proxy_id: str) -> web.Response:
        deleted = await self.store.async_delete_proxy(proxy_id)
        if not deleted:
            return self.json_message("Proxy not found", status_code=404)
        return self.json({"deleted": True})


class MagnoliaReplacePlanView(HomeAssistantView):
    """Compute auto-mappings and conflicts for replacing a virtual device's hardware."""

    url = "/api/magnolia_proxy/replace_plan"
    name = "api:magnolia_proxy:replace_plan"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    async def post(self, request: web.Request) -> web.Response:
        body = await request.json()
        vdev_id = body.get("virtual_device_id", "")
        target_dev_id = body.get("target_device_id", "")
        items = plan_device_replacement(
            self.hass, self.store, vdev_id, target_dev_id
        )
        return self.json({"items": [item.to_dict() for item in items]})


class MagnoliaReplaceApplyView(HomeAssistantView):
    """Apply resolved proxy mappings onto a replacement physical device."""

    url = "/api/magnolia_proxy/replace_apply"
    name = "api:magnolia_proxy:replace_apply"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    async def post(self, request: web.Request) -> web.Response:
        body = await request.json()
        mappings: dict[str, str] = body.get("mappings", {})
        await apply_proxy_mappings(self.store, mappings)
        return self.json({"applied": True})
