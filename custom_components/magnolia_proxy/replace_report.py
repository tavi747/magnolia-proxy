"""After a device replace: keep on/off states and report affected automations.

A replace reloads the virtual device, so its proxies are briefly removed and
come back with the new source's state. Automations triggered by a change
(e.g. "turned off") never see one, so a light that was on can come back off
with nothing reacting. This module turns new sources on/off to match their
previous state when asked, and lists the automations and scripts to check.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import voluptuous as vol

from homeassistant.const import STATE_OFF, STATE_ON
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN
from .storage import MagnoliaProxyStore

_LOGGER = logging.getLogger(__name__)

# Domains whose on/off state can be carried over by turning the source on/off.
MATCHABLE_DOMAINS = {"switch", "light", "fan"}
_MATCH_WAIT_S = 3.0


def proxy_entity_id(hass: HomeAssistant, proxy: dict[str, Any]) -> str | None:
    """Return the entity_id registered for a proxy."""
    return er.async_get(hass).async_get_entity_id(
        proxy["domain"], DOMAIN, f"{proxy['id']}_{proxy['domain']}"
    )


def snapshot(
    hass: HomeAssistant, store: MagnoliaProxyStore, proxy_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Record each proxy's state and source before a replace."""
    out: dict[str, dict[str, Any]] = {}
    for proxy_id in proxy_ids:
        proxy = store.get_proxy(proxy_id)
        if not proxy:
            continue
        entity_id = proxy_entity_id(hass, proxy)
        state = hass.states.get(entity_id) if entity_id else None
        out[proxy_id] = {
            "state": state.state if state else None,
            "source": proxy["source_entity"],
        }
    return out


async def async_match_states(
    hass: HomeAssistant, store: MagnoliaProxyStore, wanted: dict[str, str]
) -> dict[str, bool]:
    """Turn each proxy's (new) source on or off as requested.

    wanted maps proxy_id -> "on" | "off". Returns proxy_id -> whether the source
    reached that state. Waits briefly for devices that report state late.
    """
    targets: dict[str, tuple[str, str]] = {}
    result: dict[str, bool] = {}
    for proxy_id, want in wanted.items():
        proxy = store.get_proxy(proxy_id)
        if want not in (STATE_ON, STATE_OFF) or not proxy:
            continue
        source = proxy["source_entity"]
        domain = source.split(".", 1)[0]
        if proxy["domain"] not in MATCHABLE_DOMAINS or domain not in MATCHABLE_DOMAINS:
            continue
        targets[proxy_id] = (source, want)
        state = hass.states.get(source)
        if state and state.state == want:
            continue
        try:
            await hass.services.async_call(
                domain, f"turn_{want}", {"entity_id": source}, blocking=True
            )
        except (HomeAssistantError, vol.Invalid) as exc:
            _LOGGER.warning("Could not turn %s %s after replace: %s", source, want, exc)
            result[proxy_id] = False

    def _pending() -> list[str]:
        return [
            pid
            for pid, (source, want) in targets.items()
            if pid not in result
            and getattr(hass.states.get(source), "state", None) != want
        ]

    loop = asyncio.get_running_loop()
    deadline = loop.time() + _MATCH_WAIT_S
    while _pending() and loop.time() < deadline:
        await asyncio.sleep(0.1)
    for pid, (source, want) in targets.items():
        result.setdefault(
            pid, getattr(hass.states.get(source), "state", None) == want
        )
    return result


def _users_of_entity(hass: HomeAssistant, entity_id: str) -> list[str]:
    """Automation and script entity_ids that reference an entity."""
    from homeassistant.components import automation, script  # noqa: PLC0415

    try:
        return automation.automations_with_entity(
            hass, entity_id
        ) + script.scripts_with_entity(hass, entity_id)
    except (KeyError, AttributeError):
        return []


def _users_of_device(hass: HomeAssistant, device_id: str) -> list[str]:
    """Automation and script entity_ids that reference a device."""
    from homeassistant.components import automation, script  # noqa: PLC0415

    try:
        return automation.automations_with_device(
            hass, device_id
        ) + script.scripts_with_device(hass, device_id)
    except (KeyError, AttributeError):
        return []


def _ref(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    """Describe an automation or script for the UI, with a link to its editor."""
    state = hass.states.get(entity_id)
    kind = entity_id.split(".", 1)[0]
    edit_path = None
    if kind == "automation" and state and state.attributes.get("id"):
        edit_path = f"/config/automation/edit/{state.attributes['id']}"
    elif kind == "script":
        edit_path = f"/config/script/edit/{entity_id.split('.', 1)[1]}"
    return {
        "entity_id": entity_id,
        "kind": kind,
        "name": state.name if state else entity_id,
        "state": state.state if state else None,
        "edit_path": edit_path,
    }


def build_report(
    hass: HomeAssistant,
    store: MagnoliaProxyStore,
    before: dict[str, dict[str, Any]],
    applied: list[str],
    matched: dict[str, bool],
    wanted: dict[str, str],
) -> dict[str, Any]:
    """Describe what changed for each applied proxy and who uses it.

    "proxies" lists each changed proxy with its state before and after and the
    automations/scripts that use it. "old_device" lists automations/scripts that
    still reference the old sources or their devices directly, which a replace
    does not redirect.
    """
    ent_reg = er.async_get(hass)
    proxies: list[dict[str, Any]] = []
    old_refs: dict[str, dict[str, Any]] = {}
    for proxy_id in applied:
        proxy = store.get_proxy(proxy_id)
        if not proxy:
            continue
        entity_id = proxy_entity_id(hass, proxy)
        after = hass.states.get(entity_id) if entity_id else None
        users = sorted(set(_users_of_entity(hass, entity_id))) if entity_id else []
        proxies.append(
            {
                "proxy_id": proxy_id,
                "name": proxy["name"],
                "entity_id": entity_id,
                "before": before.get(proxy_id, {}).get("state"),
                "after": after.state if after else None,
                "match": wanted.get(proxy_id),
                "matched": matched.get(proxy_id),
                "used_by": [_ref(hass, u) for u in users],
            }
        )

        old_source = before.get(proxy_id, {}).get("source")
        if not old_source or old_source == proxy["source_entity"]:
            continue
        found = {u: f"uses {old_source}" for u in _users_of_entity(hass, old_source)}
        reg = ent_reg.async_get(old_source)
        if reg and reg.device_id:
            for u in _users_of_device(hass, reg.device_id):
                found.setdefault(u, "uses the old device")
        for u, why in found.items():
            if u not in old_refs:
                old_refs[u] = {**_ref(hass, u), "reasons": []}
            if why not in old_refs[u]["reasons"]:
                old_refs[u]["reasons"].append(why)

    return {
        "proxies": proxies,
        "old_device": sorted(old_refs.values(), key=lambda r: r["name"].lower()),
    }
