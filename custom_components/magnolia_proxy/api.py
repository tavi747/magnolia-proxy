"""HTTP REST API endpoints for the Magnolia Proxy sidebar panel."""
from __future__ import annotations

from http import HTTPStatus
import json
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


class _BadRequest(Exception):
    """Raised when a request body is malformed."""


class _MagnoliaView(HomeAssistantView):
    """Base view: admin-only, with JSON body helpers."""

    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
        self.hass = hass
        self.store = store

    def _admin_error(self, request: web.Request) -> web.Response | None:
        """Return a 403 response if the requesting user is not an admin."""
        user = request.get("hass_user")
        if user is None or not user.is_admin:
            return self.json_message("Admin access required", HTTPStatus.FORBIDDEN)
        return None

    @staticmethod
    async def _read_body(request: web.Request) -> dict[str, Any]:
        """Parse the request body as a JSON object."""
        try:
            body = await request.json()
        except (ValueError, json.JSONDecodeError) as err:
            raise _BadRequest("Invalid JSON body") from err
        if not isinstance(body, dict):
            raise _BadRequest("JSON body must be an object")
        return body

    @staticmethod
    def _str_field(body: dict[str, Any], key: str, default: str = "") -> str:
        """Return a string field from the body, rejecting non-string values."""
        value = body.get(key, default)
        if value is None:
            return default
        if not isinstance(value, str):
            raise _BadRequest(f"'{key}' must be a string")
        return value


class MagnoliaStateView(_MagnoliaView):
    """Return virtual devices, proxy entities, real devices, and source entities."""

    url = "/api/magnolia_proxy/state"
    name = "api:magnolia_proxy:state"

    async def get(self, request: web.Request) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
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
            proxies = []
            for proxy in dev["proxies"]:
                proxy = dict(proxy)
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
                proxies.append(proxy)
            dev["proxies"] = proxies

        return self.json(
            {
                "devices": devices,
                "real_devices": list_real_devices(self.hass),
                "source_entities": source_entities,
            }
        )


class MagnoliaDevicesView(_MagnoliaView):
    """Create a virtual device and trigger HA discovery."""

    url = "/api/magnolia_proxy/devices"
    name = "api:magnolia_proxy:devices"

    async def post(self, request: web.Request) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        try:
            body = await self._read_body(request)
            name = self._str_field(body, "name")
            model = self._str_field(body, "model", "Virtual Device")
        except _BadRequest as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        device = await self.store.async_create_device(
            name=name, model=model, trigger_discovery=True
        )
        return self.json({"device": device})


class MagnoliaDeviceDetailView(_MagnoliaView):
    """Delete or re-trigger discovery for a virtual device."""

    url = "/api/magnolia_proxy/devices/{device_id}"
    name = "api:magnolia_proxy:device_detail"

    async def delete(self, request: web.Request, device_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        deleted = await self.store.async_delete_device(device_id)
        if not deleted:
            return self.json_message("Virtual device not found", HTTPStatus.NOT_FOUND)
        return self.json({"deleted": True})

    async def post(self, request: web.Request, device_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        if self.store.get_device(device_id) is None:
            return self.json_message("Virtual device not found", HTTPStatus.NOT_FOUND)
        await self.store.async_trigger_device_discovery(device_id)
        return self.json({"discovered": True})


class MagnoliaProxiesView(_MagnoliaView):
    """Create a domain-locked proxy entity on a virtual device."""

    url = "/api/magnolia_proxy/proxies"
    name = "api:magnolia_proxy:proxies"

    async def post(self, request: web.Request) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        try:
            body = await self._read_body(request)
            proxy = await self.store.async_create_proxy(
                name=self._str_field(body, "name"),
                source_entity=self._str_field(body, "source_entity"),
                virtual_device_id=self._str_field(body, "virtual_device_id"),
            )
        except (_BadRequest, ValueError) as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        return self.json({"proxy": proxy})


class MagnoliaProxyDetailView(_MagnoliaView):
    """Update source entity or delete a proxy entity."""

    url = "/api/magnolia_proxy/proxies/{proxy_id}"
    name = "api:magnolia_proxy:proxy_detail"

    async def patch(self, request: web.Request, proxy_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        try:
            body = await self._read_body(request)
            proxy = await self.store.async_update_proxy_source(
                proxy_id=proxy_id,
                new_source_entity=self._str_field(body, "source_entity"),
            )
        except (_BadRequest, ValueError) as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        return self.json({"proxy": proxy})

    async def delete(self, request: web.Request, proxy_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        deleted = await self.store.async_delete_proxy(proxy_id)
        if not deleted:
            return self.json_message("Proxy not found", HTTPStatus.NOT_FOUND)
        return self.json({"deleted": True})


class MagnoliaReplacePlanView(_MagnoliaView):
    """Compute auto-mappings and conflicts for replacing a virtual device's hardware."""

    url = "/api/magnolia_proxy/replace_plan"
    name = "api:magnolia_proxy:replace_plan"

    async def post(self, request: web.Request) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        try:
            body = await self._read_body(request)
            vdev_id = self._str_field(body, "virtual_device_id")
            target_dev_id = self._str_field(body, "target_device_id")
        except _BadRequest as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        if self.store.get_device(vdev_id) is None:
            return self.json_message("Virtual device not found", HTTPStatus.NOT_FOUND)
        items = plan_device_replacement(
            self.hass, self.store, vdev_id, target_dev_id
        )
        return self.json({"items": [item.to_dict() for item in items]})


class MagnoliaReplaceApplyView(_MagnoliaView):
    """Apply resolved proxy mappings onto a replacement physical device."""

    url = "/api/magnolia_proxy/replace_apply"
    name = "api:magnolia_proxy:replace_apply"

    async def post(self, request: web.Request) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        try:
            body = await self._read_body(request)
        except _BadRequest as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        mappings = body.get("mappings", {})
        if not isinstance(mappings, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in mappings.items()
        ):
            return self.json_message(
                "'mappings' must be an object of strings", HTTPStatus.BAD_REQUEST
            )
        rejected = await apply_proxy_mappings(self.store, mappings)
        return self.json({"applied": True, "rejected": rejected})
