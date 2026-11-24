"""HTTP REST API endpoints for the Magnolia Proxy sidebar panel."""
from __future__ import annotations

from http import HTTPStatus
import json
from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, SUPPORTED_DOMAINS
from .device_mapping import (
    apply_proxy_mappings,
    list_real_devices,
    plan_device_replacement,
)
from . import replace_report
from .device_copy import async_copy_device
from .energy_history import async_list_energy_history, recorder_available
from .storage import MagnoliaProxyStore, is_energy_entity


def async_register_api(hass: HomeAssistant, store: MagnoliaProxyStore) -> None:
    """Register REST views for the Magnolia Proxy sidebar panel."""
    hass.http.register_view(MagnoliaStateView(hass, store))
    hass.http.register_view(MagnoliaDevicesView(hass, store))
    hass.http.register_view(MagnoliaDeviceDetailView(hass, store))
    hass.http.register_view(MagnoliaProxiesView(hass, store))
    hass.http.register_view(MagnoliaEnergyHistoryView(hass, store))
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
                    "is_energy": is_energy_entity(self.hass, state.entity_id),
                    # Only registry entities (with a unique ID) can be renamed.
                    "renamable": reg_entry is not None,
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
                proxy["is_energy"] = self.store.is_energy_proxy(proxy)
                proxy["unit"] = self.store.proxy_unit(proxy)
                proxies.append(proxy)
            dev["proxies"] = proxies

        area_reg = ar.async_get(self.hass)
        unassigned = []
        for proxy in self.store.list_unassigned_proxies():
            proxy = dict(proxy)
            unique_id = f"{proxy['id']}_{proxy['domain']}"
            proxy["entity_id"] = ent_reg.async_get_entity_id(
                proxy["domain"], DOMAIN, unique_id
            )
            # Without a device, the area is the one set on the entity itself.
            reg_entry = ent_reg.async_get(proxy["entity_id"]) if proxy["entity_id"] else None
            area = (
                area_reg.async_get_area(reg_entry.area_id)
                if reg_entry is not None and reg_entry.area_id
                else None
            )
            proxy["area_id"] = area.id if area else None
            proxy["area"] = area.name if area else ""
            live_state = (
                self.hass.states.get(proxy["entity_id"]) if proxy["entity_id"] else None
            )
            proxy["live_state"] = live_state.state if live_state else "pending_discovery"
            proxy["unit_of_measurement"] = (
                live_state.attributes.get("unit_of_measurement") if live_state else None
            )
            proxy["is_energy"] = self.store.is_energy_proxy(proxy)
            proxy["unit"] = self.store.proxy_unit(proxy)
            unassigned.append(proxy)

        return self.json(
            {
                "devices": devices,
                "unassigned_proxies": unassigned,
                "real_devices": list_real_devices(self.hass),
                "areas": sorted(
                    ({"id": a.id, "name": a.name} for a in area_reg.async_list_areas()),
                    key=lambda a: a["name"].lower(),
                ),
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
            copy_from = self._str_field(body, "copy_from")
            area_id = self._str_field(body, "area_id") or None
            entities = body.get("entities", [])
            if not isinstance(entities, list) or not all(
                isinstance(e, str) for e in entities
            ):
                raise _BadRequest("'entities' must be a list of entity IDs")
        except _BadRequest as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        if copy_from:
            # Proxy an existing device: one proxy per chosen entity.
            try:
                result = await async_copy_device(
                    self.store,
                    copy_from,
                    name=name,
                    take_over_name=body.get("take_over_name") is True,
                    entities=entities,
                    take_over_ids=body.get("take_over_ids") is True,
                    energy_mode=self._str_field(body, "energy_mode", "source"),
                    area_id=area_id,
                )
            except (_BadRequest, ValueError) as exc:
                return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
            return self.json(result)
        try:
            device = await self.store.async_create_device(
                name=name, model=model, trigger_discovery=True, area_id=area_id
            )
        except ValueError as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        return self.json({"device": device})


class MagnoliaDeviceDetailView(_MagnoliaView):
    """Rename, reorder, delete or re-trigger discovery for a virtual device."""

    url = "/api/magnolia_proxy/devices/{device_id}"
    name = "api:magnolia_proxy:device_detail"

    async def delete(self, request: web.Request, device_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        keep = request.query.get("keep_proxies", "").lower() in ("1", "true", "yes")
        deleted = await self.store.async_delete_device(device_id, keep_proxies=keep)
        if not deleted:
            return self.json_message("Virtual device not found", HTTPStatus.NOT_FOUND)
        return self.json({"deleted": True})

    async def patch(self, request: web.Request, device_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        try:
            body = await self._read_body(request)
            if "name" not in body and "proxy_order" not in body:
                raise _BadRequest("Provide 'name' or 'proxy_order'")
            order = body.get("proxy_order")
            if "proxy_order" in body and (
                not isinstance(order, list)
                or not all(isinstance(pid, str) for pid in order)
            ):
                raise _BadRequest("'proxy_order' must be a list of proxy IDs")
            device = self.store.get_device(device_id)
            if device is not None and "proxy_order" in body:
                device = await self.store.async_set_proxy_order(device_id, order)
            if device is not None and "name" in body:
                device = await self.store.async_rename_device(
                    device_id, self._str_field(body, "name")
                )
        except (_BadRequest, ValueError) as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        if device is None:
            return self.json_message("Virtual device not found", HTTPStatus.NOT_FOUND)
        return self.json({"device": device})

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
            energy_start = body.get("energy_start")
            if energy_start is not None and not isinstance(energy_start, dict):
                raise _BadRequest("'energy_start' must be an object")
            proxy = await self.store.async_create_proxy(
                name=self._str_field(body, "name"),
                source_entity=self._str_field(body, "source_entity"),
                virtual_device_id=self._str_field(body, "virtual_device_id"),
                energy_start=energy_start,
                entity_id=self._str_field(body, "entity_id") or None,
                rename_source_to=self._str_field(body, "rename_source") or None,
            )
        except (_BadRequest, ValueError) as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        return self.json({"proxy": proxy})


class MagnoliaEnergyHistoryView(_MagnoliaView):
    """List entities with recorded energy statistics a new proxy can continue."""

    url = "/api/magnolia_proxy/energy_history"
    name = "api:magnolia_proxy:energy_history"

    async def get(self, request: web.Request) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        unit = request.query.get("unit", "")
        if not unit:
            return self.json_message("'unit' is required", HTTPStatus.BAD_REQUEST)
        items = await async_list_energy_history(self.hass, unit)
        return self.json(
            {
                "recorder": recorder_available(self.hass),
                "items": [item.as_dict() for item in items],
            }
        )


class MagnoliaProxyDetailView(_MagnoliaView):
    """Update source entity or delete a proxy entity."""

    url = "/api/magnolia_proxy/proxies/{proxy_id}"
    name = "api:magnolia_proxy:proxy_detail"

    async def patch(self, request: web.Request, proxy_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        try:
            body = await self._read_body(request)
            if (
                "name" not in body
                and "source_entity" not in body
                and "virtual_device_id" not in body
            ):
                raise _BadRequest(
                    "Provide 'name', 'source_entity' and/or 'virtual_device_id'"
                )
            if "virtual_device_id" in body:
                # null or "" unassigns the proxy.
                await self.store.async_move_proxy(
                    proxy_id, self._str_field(body, "virtual_device_id") or None
                )
                if "name" not in body and "source_entity" not in body:
                    return self.json({"proxy": self.store.get_proxy(proxy_id)})
            proxy = await self.store.async_update_proxy(
                proxy_id,
                name=self._str_field(body, "name") if "name" in body else None,
                source_entity=(
                    self._str_field(body, "source_entity")
                    if "source_entity" in body
                    else None
                ),
                energy_mode=self._str_field(body, "energy_mode") or None,
            )
        except (_BadRequest, ValueError) as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        return self.json({"proxy": proxy})

    async def delete(self, request: web.Request, proxy_id: str) -> web.Response:
        if (err := self._admin_error(request)) is not None:
            return err
        rename = request.query.get("rename_source", "").lower() in ("1", "true", "yes")
        try:
            result = await self.store.async_delete_proxy(
                proxy_id, rename_source=rename
            )
        except ValueError as exc:
            return self.json_message(str(exc), HTTPStatus.BAD_REQUEST)
        if result is None:
            return self.json_message("Proxy not found", HTTPStatus.NOT_FOUND)
        return self.json(result)


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
        energy_modes = body.get("energy_modes", {})
        if not isinstance(energy_modes, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in energy_modes.items()
        ):
            return self.json_message(
                "'energy_modes' must be an object of strings", HTTPStatus.BAD_REQUEST
            )
        match_state = body.get("match_state", {})
        if not isinstance(match_state, dict) or not all(
            isinstance(k, str) and v in ("on", "off") for k, v in match_state.items()
        ):
            return self.json_message(
                "'match_state' must map proxy ids to 'on' or 'off'",
                HTTPStatus.BAD_REQUEST,
            )
        before = replace_report.snapshot(self.hass, self.store, list(mappings))
        rejected = await apply_proxy_mappings(
            self.store, mappings, energy_modes, allow_switch_as_x=True
        )
        applied = [
            pid
            for pid in mappings
            if pid not in rejected
            and pid in before
            and (proxy := self.store.get_proxy(pid))
            and proxy["source_entity"] != before[pid]["source"]
        ]
        wanted = {pid: v for pid, v in match_state.items() if pid in applied}
        matched = await replace_report.async_match_states(
            self.hass, self.store, wanted
        )
        report = replace_report.build_report(
            self.hass, self.store, before, applied, matched, wanted
        )
        return self.json({"applied": True, "rejected": rejected, "report": report})
