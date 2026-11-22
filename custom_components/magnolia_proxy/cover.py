"""Cover platform for Magnolia Proxy."""
from __future__ import annotations

from typing import Any

from homeassistant.components.cover import (
    ATTR_CURRENT_POSITION,
    ATTR_CURRENT_TILT_POSITION,
    ATTR_POSITION,
    ATTR_TILT_POSITION,
    CoverDeviceClass,
    CoverEntity,
    CoverEntityFeature,
    CoverState,
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
    """Set up all cover proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    async_add_entities(
        ProxyCover(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
        if proxy_def["domain"] == "cover"
    )


class ProxyCover(BaseProxyEntity, CoverEntity):
    """Proxy entity for the cover domain with position and tilt."""

    _attr_supported_features = CoverEntityFeature(0)

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Mirror the open/closed state, motion, positions and features."""
        super()._apply_source_state(state)
        st = state.state if state and self._attr_available else None
        self._attr_is_opening = st == CoverState.OPENING
        self._attr_is_closing = st == CoverState.CLOSING
        self._attr_is_closed = (
            None if st not in (CoverState.OPEN, CoverState.CLOSED, CoverState.OPENING, CoverState.CLOSING)
            else st == CoverState.CLOSED
        )
        self._attr_current_cover_position = source_position(state, ATTR_CURRENT_POSITION)
        self._attr_current_cover_tilt_position = source_position(
            state, ATTR_CURRENT_TILT_POSITION
        )
        self._attr_supported_features = source_features(state, CoverEntityFeature)
        dc = state.attributes.get("device_class") if state else None
        self._attr_device_class = (
            CoverDeviceClass(dc) if dc in CoverDeviceClass._value2member_map_ else None
        )

    async def async_open_cover(self, **kwargs: Any) -> None:
        """Open the source cover."""
        await self._async_call_source_service("open_cover")

    async def async_close_cover(self, **kwargs: Any) -> None:
        """Close the source cover."""
        await self._async_call_source_service("close_cover")

    async def async_stop_cover(self, **kwargs: Any) -> None:
        """Stop the source cover."""
        await self._async_call_source_service("stop_cover")

    async def async_set_cover_position(self, **kwargs: Any) -> None:
        """Move the source cover to a position."""
        await self._async_call_source_service(
            "set_cover_position", **{ATTR_POSITION: kwargs[ATTR_POSITION]}
        )

    async def async_open_cover_tilt(self, **kwargs: Any) -> None:
        """Open the source cover's tilt."""
        await self._async_call_source_service("open_cover_tilt")

    async def async_close_cover_tilt(self, **kwargs: Any) -> None:
        """Close the source cover's tilt."""
        await self._async_call_source_service("close_cover_tilt")

    async def async_stop_cover_tilt(self, **kwargs: Any) -> None:
        """Stop the source cover's tilt."""
        await self._async_call_source_service("stop_cover_tilt")

    async def async_set_cover_tilt_position(self, **kwargs: Any) -> None:
        """Move the source cover's tilt to a position."""
        await self._async_call_source_service(
            "set_cover_tilt_position",
            **{ATTR_TILT_POSITION: kwargs[ATTR_TILT_POSITION]},
        )
