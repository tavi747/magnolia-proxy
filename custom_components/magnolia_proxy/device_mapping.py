"""Helpers for mapping virtual device proxies onto a replacement real device."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, SUPPORTED_DOMAINS
from .storage import MagnoliaProxyStore, entity_unit, is_energy_entity


@dataclass
class ProxyMappingItem:
    """Represents a proxy entity and its proposed or conflicted target source."""

    proxy_id: str
    proxy_name: str
    proxy_entity_id: str | None
    locked_domain: str
    current_source_entity: str
    candidates: list[str]
    selected_source_entity: str | None
    conflict_reason: str | None

    def to_dict(self) -> dict[str, Any]:
        """Serialize mapping item for REST API and UI."""
        return {
            "proxy_id": self.proxy_id,
            "proxy_name": self.proxy_name,
            "proxy_entity_id": self.proxy_entity_id,
            "locked_domain": self.locked_domain,
            "current_source_entity": self.current_source_entity,
            "candidates": self.candidates,
            "selected_source_entity": self.selected_source_entity,
            "conflict_reason": self.conflict_reason,
        }


def _find_proxy_entity_id(
    ent_reg: er.EntityRegistry, proxy_id: str, domain: str
) -> str | None:
    """Find the entity_id registered for a proxy_id."""
    unique_id = f"{proxy_id}_{domain}"
    return ent_reg.async_get_entity_id(domain, DOMAIN, unique_id)


def _source_device_class(
    hass: HomeAssistant, ent_reg: er.EntityRegistry, entity_id: str | None
) -> str | None:
    """Return device_class for a source entity from registry or live state."""
    if not entity_id:
        return None
    reg_entry = ent_reg.async_get(entity_id)
    if reg_entry and (reg_entry.device_class or reg_entry.original_device_class):
        return reg_entry.device_class or reg_entry.original_device_class
    state = hass.states.get(entity_id)
    if state:
        dc = state.attributes.get("device_class")
        return str(dc) if dc else None
    return None


def plan_device_replacement(
    hass: HomeAssistant,
    store: MagnoliaProxyStore,
    virtual_device_id: str,
    target_device_id: str,
) -> list[ProxyMappingItem]:
    """Build candidate mappings and flag conflicts for proxies under a virtual device."""
    ent_reg = er.async_get(hass)
    target_entities = er.async_entries_for_device(
        ent_reg, target_device_id, include_disabled_entities=False
    )

    items: list[ProxyMappingItem] = []
    for proxy in store.list_proxies(virtual_device_id):
        proxy_id = proxy["id"]
        locked_domain = proxy["domain"]
        current_source = proxy["source_entity"]
        proxy_eid = _find_proxy_entity_id(ent_reg, proxy_id, locked_domain)

        # Hard limits, also enforced when the mapping is applied: the unit must
        # be identical (no unit only matches no unit, VA only VA), and energy
        # proxies only take energy sensors.
        energy_only = store.is_energy_proxy(proxy)
        unit = store.proxy_unit(proxy)

        def _allowed(entity_id: str) -> bool:
            if entity_unit(hass, entity_id) != unit:
                return False
            if energy_only:
                return is_energy_entity(hass, entity_id)
            return True

        # Every allowed entity of the same domain on the new device is offered,
        # so the user can pick when there is more than one. Device class only
        # ranks them and picks a suggestion.
        source_dc = (
            _source_device_class(hass, ent_reg, current_source)
            if locked_domain == "sensor"
            else None
        )
        candidates = [
            e.entity_id
            for e in target_entities
            if e.domain == locked_domain
            and e.platform != DOMAIN
            and _allowed(e.entity_id)
        ]
        same_dc = (
            [c for c in candidates if _source_device_class(hass, ent_reg, c) == source_dc]
            if source_dc
            else []
        )
        candidates = same_dc + [c for c in candidates if c not in same_dc]

        if len(candidates) == 1:
            items.append(
                ProxyMappingItem(
                    proxy_id=proxy_id,
                    proxy_name=proxy["name"],
                    proxy_entity_id=proxy_eid,
                    locked_domain=locked_domain,
                    current_source_entity=current_source,
                    candidates=candidates,
                    selected_source_entity=candidates[0],
                    conflict_reason=None,
                )
            )
        elif len(candidates) > 1:
            if current_source in candidates:
                suggested = current_source
            elif len(same_dc) == 1:
                suggested = same_dc[0]
            else:
                suggested = None
            items.append(
                ProxyMappingItem(
                    proxy_id=proxy_id,
                    proxy_name=proxy["name"],
                    proxy_entity_id=proxy_eid,
                    locked_domain=locked_domain,
                    current_source_entity=current_source,
                    candidates=candidates,
                    selected_source_entity=suggested,
                    conflict_reason="multiple_candidates",
                )
            )
        else:
            # Nothing suitable on the target device: offer every entity of the
            # same type in Home Assistant instead.
            items.append(
                ProxyMappingItem(
                    proxy_id=proxy_id,
                    proxy_name=proxy["name"],
                    proxy_entity_id=proxy_eid,
                    locked_domain=locked_domain,
                    current_source_entity=current_source,
                    candidates=sorted(
                        e.entity_id
                        for e in ent_reg.entities.values()
                        if e.domain == locked_domain
                        and e.platform != DOMAIN
                        and not e.disabled
                        and _allowed(e.entity_id)
                    ),
                    selected_source_entity=None,
                    conflict_reason="no_matching_entity",
                )
            )

    return items


async def apply_proxy_mappings(
    store: MagnoliaProxyStore,
    mappings: dict[str, str],
    energy_modes: dict[str, str] | None = None,
) -> list[str]:
    """Apply proxy_id -> new_source_entity mappings and reload affected device entries.

    energy_modes optionally maps proxy_id -> "continue" | "zero" | "source" for
    energy proxies whose source changes (default "continue").

    Invalid mappings (unknown proxy, wrong domain, proxy-as-source, unknown entity,
    invalid energy mode) are skipped; their proxy_ids are returned.
    """
    energy_modes = energy_modes or {}
    affected_devices: set[str | None] = set()
    rejected: list[str] = []
    seeds: dict[str, dict] = {}
    for proxy_id, new_source in mappings.items():
        if not isinstance(new_source, str) or not new_source:
            continue
        proxy = store.get_proxy(proxy_id)
        if not proxy:
            rejected.append(proxy_id)
            continue
        try:
            store.validate_proxy_source(proxy, new_source)
            seed = (
                store.energy_restart_seed(
                    proxy, new_source, energy_modes.get(proxy_id)
                )
                if new_source != proxy["source_entity"]
                else None
            )
        except ValueError:
            rejected.append(proxy_id)
            continue
        if seed is not None:
            seeds[proxy_id] = seed
        proxy["source_entity"] = new_source
        affected_devices.add(proxy.get("virtual_device_id"))

    if affected_devices:
        for proxy_id, seed in seeds.items():
            store.energy.set_start(proxy_id, seed)
        await store.async_save()
        for dev_id in affected_devices:
            entry = store.find_host_entry(dev_id)
            if entry is not None:
                await store.hass.config_entries.async_reload(entry.entry_id)

    return rejected


def list_real_devices(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return non-Magnolia-Proxy devices and their supported entities."""
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)
    results: list[dict[str, Any]] = []

    for dev in dev_reg.devices.values():
        if any(ident[0] == DOMAIN for ident in dev.identifiers):
            continue
        dev_entities = [
            {
                "entity_id": e.entity_id,
                "domain": e.domain,
                "device_class": e.device_class or e.original_device_class,
                "name": e.name or e.original_name or e.entity_id,
            }
            for e in er.async_entries_for_device(
                ent_reg, dev.id, include_disabled_entities=False
            )
            if e.domain in SUPPORTED_DOMAINS
        ]
        if not dev_entities:
            continue
        results.append(
            {
                "id": dev.id,
                "name": dev.name_by_user or dev.name or dev.id,
                "manufacturer": dev.manufacturer or "",
                "model": dev.model or "",
                "entities": dev_entities,
            }
        )

    results.sort(key=lambda item: item["name"].lower())
    return results
