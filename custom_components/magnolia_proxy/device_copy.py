"""Create a virtual device that proxies an existing (real) device."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import SOURCE_INTEGRATION_DISCOVERY
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import (
    CONF_DEVICE_MODEL,
    CONF_DEVICE_NAME,
    CONF_ENTRY_TYPE,
    CONF_VIRTUAL_DEVICE_ID,
    DOMAIN,
    ENTRY_TYPE_DEVICE,
    SUPPORTED_DOMAINS,
)
from .storage import MagnoliaProxyStore, is_energy_entity

_LOGGER = logging.getLogger(__name__)

SOURCE_DEVICE_SUFFIX = "Source"
SOURCE_ENTITY_SUFFIX = "_source"


def device_display_name(device: dr.DeviceEntry) -> str:
    """Return the name Home Assistant shows for a device."""
    return device.name_by_user or device.name or device.id


def entity_label(hass: HomeAssistant, entity_id: str, device_name: str) -> str:
    """Return an entity's own name, without its device's name in front.

    Entities named after their device (a plug's main switch) get their
    domain as name, e.g. "Switch", since a proxy needs a name of its own.
    """
    state = hass.states.get(entity_id)
    reg = er.async_get(hass).async_get(entity_id)
    full = (
        state.name
        if state is not None
        else (reg.name or reg.original_name if reg else None)
    ) or ""
    if full.lower().startswith(device_name.lower() + " "):
        full = full[len(device_name) + 1 :]
    elif full.lower() == device_name.lower():
        full = ""
    return full.strip() or entity_id.split(".", 1)[0].replace("_", " ").capitalize()


def copyable_entities(
    hass: HomeAssistant, device_id: str
) -> list[er.RegistryEntry]:
    """Enabled entities of a device that a proxy can mirror."""
    return [
        e
        for e in er.async_entries_for_device(
            er.async_get(hass), device_id, include_disabled_entities=False
        )
        if e.domain in SUPPORTED_DOMAINS and e.platform != DOMAIN
    ]


def _has_reading(hass: HomeAssistant, entity_id: str) -> bool:
    """Return True if the entity's state is a finite number."""
    state = hass.states.get(entity_id)
    try:
        value = float(state.state) if state is not None else None
    except (TypeError, ValueError):
        return False
    return value is not None and value == value and abs(value) != float("inf")


async def _async_add_device_now(store: MagnoliaProxyStore, device: dict[str, Any]) -> bool:
    """Add a new virtual device to Home Assistant without a discovery prompt."""
    hass = store.hass
    try:
        result = await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": SOURCE_INTEGRATION_DISCOVERY},
            data={
                CONF_ENTRY_TYPE: ENTRY_TYPE_DEVICE,
                CONF_VIRTUAL_DEVICE_ID: device["id"],
                CONF_DEVICE_NAME: device["name"],
                CONF_DEVICE_MODEL: device.get("model", "Virtual Device"),
            },
        )
        if result["type"] == FlowResultType.FORM:
            result = await hass.config_entries.flow.async_configure(
                result["flow_id"], {}
            )
    except Exception:  # noqa: BLE001 - fall back to the normal discovery prompt
        _LOGGER.exception("Could not add virtual device %s directly", device["id"])
        return False
    return result["type"] == FlowResultType.CREATE_ENTRY


async def async_copy_device(
    store: MagnoliaProxyStore,
    real_device_id: str,
    *,
    name: str | None,
    take_over_name: bool,
    entities: list[str],
    take_over_ids: bool,
    energy_mode: str,
    area_id: str | None = None,
) -> dict[str, Any]:
    """Create a virtual device with a proxy for each chosen entity of a real device.

    take_over_name gives the virtual device the real device's name and renames
    the real device "<name> Source". take_over_ids gives each proxy its source's
    entity ID, renaming the source "<id>_source", so dashboards and automations
    follow the proxies. energy_mode ("source" or "zero") sets where energy
    proxies start; "source" falls back to zero for a source without a reading.
    area_id puts the new device in that Home Assistant area.

    Entities that fail are skipped and reported in "failed".
    """
    hass = store.hass
    dev_reg = dr.async_get(hass)
    real = dev_reg.async_get(real_device_id)
    if real is None:
        raise ValueError("Unknown device")
    if any(ident[0] == DOMAIN for ident in real.identifiers):
        raise ValueError("Pick a real device, not a virtual one")
    if energy_mode not in ("source", "zero"):
        raise ValueError("energy_mode must be 'source' or 'zero'")

    real_name = device_display_name(real)
    allowed = {e.entity_id: e for e in copyable_entities(hass, real_device_id)}
    unknown = [eid for eid in entities if eid not in allowed]
    if unknown:
        raise ValueError(f"Not entities of this device: {', '.join(unknown)}")
    if not entities:
        raise ValueError("Pick at least one entity to proxy")

    v_name = real_name if take_over_name else (name or "").strip() or f"{real_name} Proxy"
    # Read entity names before the real device is renamed.
    labels = {eid: entity_label(hass, eid, real_name) for eid in entities}

    device = await store.async_create_device(
        name=v_name,
        model=real.model or "Virtual Device",
        trigger_discovery=False,
        area_id=area_id,
    )
    added = await _async_add_device_now(store, device)
    if not added:
        await store.async_trigger_device_discovery(device["id"])

    if take_over_name:
        dev_reg.async_update_device(
            real_device_id, name_by_user=f"{real_name} {SOURCE_DEVICE_SUFFIX}"
        )

    created: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for eid in entities:
        energy_start = None
        note = None
        if is_energy_entity(hass, eid):
            mode = energy_mode
            if mode == "source" and not _has_reading(hass, eid):
                mode, note = "zero", "no current reading; total starts at 0"
            energy_start = {"mode": mode}
        try:
            proxy = await store.async_create_proxy(
                name=labels[eid],
                source_entity=eid,
                virtual_device_id=device["id"],
                energy_start=energy_start,
                entity_id=eid if take_over_ids else None,
                rename_source_to=f"{eid}{SOURCE_ENTITY_SUFFIX}" if take_over_ids else None,
            )
        except ValueError as exc:
            failed.append({"entity_id": eid, "error": str(exc)})
            continue
        created.append({**proxy, **({"note": note} if note else {})})

    return {
        "device": device,
        "added_to_ha": added,
        "renamed_source_device": (
            f"{real_name} {SOURCE_DEVICE_SUFFIX}" if take_over_name else None
        ),
        "created": created,
        "failed": failed,
    }
