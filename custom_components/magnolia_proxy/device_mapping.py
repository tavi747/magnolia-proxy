"""Helpers for mapping virtual device proxies onto a replacement real device."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, SUPPORTED_DOMAINS
from .storage import MagnoliaProxyStore, validate_source_entity


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

        domain_candidates = [
            e.entity_id
            for e in target_entities
            if e.domain == locked_domain and e.platform != DOMAIN
        ]

        source_dc = _source_device_class(hass, ent_reg, current_source)
        if locked_domain == "sensor" and source_dc:
            class_matched = [
                eid
                for eid in domain_candidates
                if _source_device_class(hass, ent_reg, eid) == source_dc
            ]
        else:
            class_matched = domain_candidates

        candidates = class_matched if class_matched else domain_candidates

        if len(candidates) == 1:
            items.append(
                ProxyMappingItem(
                    proxy_id=proxy_id,
                    proxy_name=proxy["name"],
                    proxy_entity_id=proxy_eid,
                    locked_domain=locked_domain,
                    current_source_entity=current_source,
                    candidates=domain_candidates or candidates,
                    selected_source_entity=candidates[0],
                    conflict_reason=None,
                )
            )
        elif len(candidates) > 1:
            items.append(
                ProxyMappingItem(
                    proxy_id=proxy_id,
                    proxy_name=proxy["name"],
                    proxy_entity_id=proxy_eid,
                    locked_domain=locked_domain,
                    current_source_entity=current_source,
                    candidates=domain_candidates or candidates,
                    selected_source_entity=(
                        current_source if current_source in candidates else None
                    ),
                    conflict_reason="multiple_candidates",
                )
            )
        else:
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
                    ),
                    selected_source_entity=None,
                    conflict_reason="no_matching_entity",
                )
            )

    return items


async def apply_proxy_mappings(
    store: MagnoliaProxyStore,
    mappings: dict[str, str],
) -> list[str]:
    """Apply proxy_id -> new_source_entity mappings and reload affected device entries.

    Invalid mappings (unknown proxy, wrong domain, proxy-as-source, unknown entity)
    are skipped; their proxy_ids are returned.
    """
    affected_devices: set[str] = set()
    rejected: list[str] = []
    for proxy_id, new_source in mappings.items():
        if not isinstance(new_source, str) or not new_source:
            continue
        proxy = store.get_proxy(proxy_id)
        if not proxy:
            rejected.append(proxy_id)
            continue
        try:
            validate_source_entity(store.hass, new_source, proxy["domain"])
        except ValueError:
            rejected.append(proxy_id)
            continue
        proxy["source_entity"] = new_source
        affected_devices.add(proxy["virtual_device_id"])

    if affected_devices:
        await store.async_save()
        for dev_id in affected_devices:
            entry = store.find_device_config_entry(dev_id)
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
