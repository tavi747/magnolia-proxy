"""Look up recorded energy history so a new energy proxy can continue it.

Home Assistant keys statistics by entity_id and keeps long-term statistics
after an entity is removed. When an entity_id is reused, the recorder
continues the statistics "sum" from the latest *short-term* statistics row,
which is purged together with state history (purge_keep_days, default 10).
So taking over an old entity_id only keeps the Energy dashboard continuous
while that row still exists; otherwise the recorder restarts the sum at 0.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er


@dataclass
class EnergyHistory:
    """Last recorded value of an energy statistic."""

    entity_id: str
    name: str | None
    unit: str
    last_value: float
    last_time: float | None
    # entity_id is currently registered or has a state (cannot be taken over).
    exists: bool
    # A new proxy can take over the entity_id with continuous statistics.
    seamless: bool

    def as_dict(self) -> dict[str, Any]:
        """Serialize for the API."""
        return asdict(self)


def recorder_available(hass: HomeAssistant) -> bool:
    """Return True if the recorder integration is loaded."""
    return "recorder" in hass.config.components


def _entity_exists(hass: HomeAssistant, entity_id: str) -> bool:
    return (
        er.async_get(hass).async_is_registered(entity_id)
        or hass.states.get(entity_id) is not None
    )


def _friendly_name(hass: HomeAssistant, entity_id: str, meta_name: str | None) -> str | None:
    reg_entry = er.async_get(hass).async_get(entity_id)
    if reg_entry and (reg_entry.name or reg_entry.original_name):
        return reg_entry.name or reg_entry.original_name
    state = hass.states.get(entity_id)
    if state and state.attributes.get("friendly_name"):
        return str(state.attributes["friendly_name"])
    return meta_name


def _fetch_last_rows(
    hass: HomeAssistant, statistic_ids: list[str]
) -> dict[str, tuple[dict | None, dict | None]]:
    """Return (latest short-term row, latest long-term row) per id.

    Runs in the recorder's executor.
    """
    # pylint: disable-next=import-outside-toplevel
    from homeassistant.components.recorder.statistics import (
        get_last_short_term_statistics,
        get_last_statistics,
    )

    result: dict[str, tuple[dict | None, dict | None]] = {}
    for sid in statistic_ids:
        short = get_last_short_term_statistics(hass, 1, sid, False, {"state"}).get(sid)
        long = get_last_statistics(hass, 1, sid, False, {"state"}).get(sid)
        result[sid] = (dict(short[0]) if short else None, dict(long[0]) if long else None)
    return result


async def _async_lookup(
    hass: HomeAssistant, unit: str, statistic_ids: set[str] | None
) -> list[EnergyHistory]:
    if not recorder_available(hass):
        return []
    # pylint: disable-next=import-outside-toplevel
    from homeassistant.components.recorder import get_instance
    # pylint: disable-next=import-outside-toplevel
    from homeassistant.components.recorder.statistics import async_list_statistic_ids

    metas = await async_list_statistic_ids(
        hass, statistic_ids=statistic_ids, statistic_type="sum"
    )
    wanted = {
        meta["statistic_id"]: meta
        for meta in metas
        if meta["statistic_id"].startswith("sensor.")
        and meta.get("source") == "recorder"
        and meta.get("statistics_unit_of_measurement") == unit
    }
    if not wanted:
        return []

    rows = await get_instance(hass).async_add_executor_job(
        _fetch_last_rows, hass, list(wanted)
    )

    items: list[EnergyHistory] = []
    for sid, (short, long) in rows.items():
        # The short-term row is the most recent (5-minute) value when present.
        row = short or long
        value = row.get("state") if row else None
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        exists = _entity_exists(hass, sid)
        items.append(
            EnergyHistory(
                entity_id=sid,
                name=_friendly_name(hass, sid, wanted[sid].get("name")),
                unit=unit,
                last_value=float(value),
                last_time=row.get("end") or row.get("start"),
                exists=exists,
                seamless=not exists and short is not None,
            )
        )
    items.sort(key=lambda item: item.last_time or 0, reverse=True)
    return items


async def async_list_energy_history(hass: HomeAssistant, unit: str) -> list[EnergyHistory]:
    """List sensors with recorded energy statistics in the given unit."""
    return await _async_lookup(hass, unit, None)


async def async_get_energy_history(
    hass: HomeAssistant, entity_id: str, unit: str
) -> EnergyHistory | None:
    """Return the last recorded energy value of one entity in the given unit."""
    items = await _async_lookup(hass, unit, {entity_id})
    return items[0] if items else None
