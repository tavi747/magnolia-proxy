"""Fan platform for Magnolia Proxy."""
from __future__ import annotations

from typing import Any

from homeassistant.components.fan import (
    ATTR_OSCILLATING,
    ATTR_PERCENTAGE,
    ATTR_PERCENTAGE_STEP,
    ATTR_PRESET_MODE,
    ATTR_PRESET_MODES,
    FanEntity,
    FanEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity_base import BaseProxyEntity
from .storage import MagnoliaProxyStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up all fan proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    entities = [
        ProxyFan(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
        if proxy_def["domain"] == "fan"
    ]
    async_add_entities(entities)


class ProxyFan(BaseProxyEntity, FanEntity):
    """Proxy entity for the fan domain with speed, presets, and oscillation."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        proxy_def: dict[str, Any],
    ) -> None:
        """Initialize the proxy fan."""
        super().__init__(hass, entry, proxy_def)
        self._attr_percentage: int | None = None
        self._attr_speed_count: int = 100
        self._attr_preset_mode: str | None = None
        self._attr_preset_modes: list[str] | None = None
        self._attr_oscillating: bool | None = None
        self._attr_supported_features = (
            FanEntityFeature.TURN_ON | FanEntityFeature.TURN_OFF
        )

    @property
    def is_on(self) -> bool | None:
        """Mirror the source on/off state.

        FanEntity derives is_on from percentage/preset, which reports on/off-only
        fans as permanently off; use the source state instead.
        """
        return self._attr_is_on

    @callback
    def _clear_dynamic_attributes(self) -> None:
        """Reset transient fan state when source is unavailable."""
        self._attr_percentage = None
        self._attr_preset_mode = None
        self._attr_oscillating = None

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Mirror availability, on/off state, features, speed, presets, and oscillation."""
        super()._apply_source_state(state)

        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._clear_dynamic_attributes()
            return

        attrs = state.attributes
        features = FanEntityFeature.TURN_ON | FanEntityFeature.TURN_OFF

        step = attrs.get(ATTR_PERCENTAGE_STEP)
        if isinstance(step, (int, float)) and 0 < step <= 100:
            self._attr_speed_count = max(1, round(100 / step))
            features |= FanEntityFeature.SET_SPEED
        else:
            self._attr_speed_count = 100

        percentage = attrs.get(ATTR_PERCENTAGE)
        if isinstance(percentage, (int, float)):
            self._attr_percentage = max(0, min(100, int(percentage)))
            features |= FanEntityFeature.SET_SPEED
        else:
            self._attr_percentage = None

        raw_preset_modes = attrs.get(ATTR_PRESET_MODES)
        if isinstance(raw_preset_modes, (list, tuple)):
            modes = [str(mode) for mode in raw_preset_modes if mode is not None]
            self._attr_preset_modes = modes if modes else None
            if modes:
                features |= FanEntityFeature.PRESET_MODE

        preset_mode = attrs.get(ATTR_PRESET_MODE)
        if isinstance(preset_mode, str) and preset_mode:
            self._attr_preset_mode = preset_mode
            features |= FanEntityFeature.PRESET_MODE
            if not self._attr_preset_modes:
                self._attr_preset_modes = [preset_mode]
        else:
            self._attr_preset_mode = None

        oscillating = attrs.get(ATTR_OSCILLATING)
        if isinstance(oscillating, bool):
            self._attr_oscillating = oscillating
            features |= FanEntityFeature.OSCILLATE
        else:
            self._attr_oscillating = None

        self._attr_supported_features = features

    async def async_turn_on(
        self,
        percentage: int | None = None,
        preset_mode: str | None = None,
        **kwargs: Any,
    ) -> None:
        """Turn the connected source fan on, forwarding optional parameters."""
        service_data: dict[str, Any] = {}
        if percentage is not None:
            service_data[ATTR_PERCENTAGE] = percentage
        if preset_mode is not None:
            service_data[ATTR_PRESET_MODE] = preset_mode
        if ATTR_OSCILLATING in kwargs and isinstance(kwargs[ATTR_OSCILLATING], bool):
            service_data[ATTR_OSCILLATING] = kwargs[ATTR_OSCILLATING]
        await self._async_call_source_service("turn_on", **service_data)

    async def async_set_percentage(self, percentage: int) -> None:
        """Set the speed percentage on the connected source fan."""
        await self._async_call_source_service(
            "set_percentage", **{ATTR_PERCENTAGE: percentage}
        )

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set the preset mode on the connected source fan."""
        await self._async_call_source_service(
            "set_preset_mode", **{ATTR_PRESET_MODE: preset_mode}
        )

    async def async_oscillate(self, oscillating: bool) -> None:
        """Toggle oscillation on the connected source fan."""
        await self._async_call_source_service(
            "oscillate", **{ATTR_OSCILLATING: oscillating}
        )
