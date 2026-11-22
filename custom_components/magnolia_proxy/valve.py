"""Valve platform for Magnolia Proxy."""
from __future__ import annotations

from typing import Any

from homeassistant.components.valve import (
    ATTR_CURRENT_POSITION,
    ATTR_POSITION,
    ValveDeviceClass,
    ValveEntity,
    ValveEntityFeature,
    ValveState,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity_base import BaseProxyEntity, source_features, source_position
from .storage import MagnoliaProxyStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up all valve proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    async_add_entities(
        ProxyValve(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
        if proxy_def["domain"] == "valve"
    )


class ProxyValve(BaseProxyEntity, ValveEntity):
    """Proxy entity for the valve domain, with position when the source has one."""

    _attr_reports_position = False
    _attr_supported_features = ValveEntityFeature(0)

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Mirror the open/closed state, motion, position and features."""
        super()._apply_source_state(state)
        st = state.state if state and self._attr_available else None
        self._attr_is_opening = st == ValveState.OPENING
        self._attr_is_closing = st == ValveState.CLOSING
        self._attr_is_closed = (
            None if st not in (ValveState.OPEN, ValveState.CLOSED, ValveState.OPENING, ValveState.CLOSING)
            else st == ValveState.CLOSED
        )
        position = source_position(state, ATTR_CURRENT_POSITION)
        # Report a position only while the source does, so the state follows
        # the source's open/closed state otherwise.
        self._attr_reports_position = position is not None
        self._attr_current_valve_position = position
        self._attr_supported_features = source_features(state, ValveEntityFeature)
        dc = state.attributes.get("device_class") if state else None
        self._attr_device_class = (
            ValveDeviceClass(dc) if dc in ValveDeviceClass._value2member_map_ else None
        )

    async def async_open_valve(self) -> None:
        """Open the source valve."""
        await self._async_call_source_service("open_valve")

    async def async_close_valve(self) -> None:
        """Close the source valve."""
        await self._async_call_source_service("close_valve")

    async def async_stop_valve(self) -> None:
        """Stop the source valve."""
        await self._async_call_source_service("stop_valve")

    async def async_set_valve_position(self, position: int) -> None:
        """Move the source valve to a position."""
        await self._async_call_source_service(
            "set_valve_position", **{ATTR_POSITION: position}
        )
