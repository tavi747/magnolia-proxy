"""Light platform for Magnolia Proxy."""
from __future__ import annotations

from typing import Any

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_MODE,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_HS_COLOR,
    ATTR_MAX_COLOR_TEMP_KELVIN,
    ATTR_MIN_COLOR_TEMP_KELVIN,
    ATTR_RGB_COLOR,
    ATTR_SUPPORTED_COLOR_MODES,
    ATTR_TRANSITION,
    ColorMode,
    LightEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_VIRTUAL_DEVICE_ID, DOMAIN
from .entity_base import BaseProxyEntity
from .storage import MagnoliaProxyStore

FORWARDED_LIGHT_ATTRS: tuple[str, ...] = (
    ATTR_BRIGHTNESS,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_TRANSITION,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up all light proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    vdev_id: str = entry.data[CONF_VIRTUAL_DEVICE_ID]
    entities = [
        ProxyLight(hass, entry, proxy_def)
        for proxy_def in store.list_proxies(vdev_id)
        if proxy_def["domain"] == "light"
    ]
    async_add_entities(entities)


class ProxyLight(BaseProxyEntity, LightEntity):
    """Proxy entity for the light domain with brightness, temp, and color support."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        proxy_def: dict[str, Any],
    ) -> None:
        """Initialize the proxy light."""
        super().__init__(hass, entry, proxy_def)
        self._attr_brightness: int | None = None
        self._attr_hs_color: tuple[float, float] | None = None
        self._attr_rgb_color: tuple[int, int, int] | None = None
        self._attr_color_temp_kelvin: int | None = None
        self._attr_min_color_temp_kelvin: int | None = None
        self._attr_max_color_temp_kelvin: int | None = None
        self._attr_supported_color_modes: set[ColorMode] = {ColorMode.ONOFF}
        self._attr_color_mode: ColorMode | None = ColorMode.ONOFF

    @callback
    def _clear_dynamic_attributes(self) -> None:
        """Reset transient color and brightness state when unavailable."""
        self._attr_brightness = None
        self._attr_hs_color = None
        self._attr_rgb_color = None
        self._attr_color_temp_kelvin = None

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Mirror availability, on/off state, color modes, and color/brightness values."""
        super()._apply_source_state(state)

        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._clear_dynamic_attributes()
            return

        attrs = state.attributes

        raw_modes = attrs.get(ATTR_SUPPORTED_COLOR_MODES) or []
        parsed_modes: set[ColorMode] = set()
        for mode in raw_modes:
            try:
                parsed_modes.add(ColorMode(mode))
            except ValueError:
                continue

        brightness = attrs.get(ATTR_BRIGHTNESS)
        if isinstance(brightness, (int, float)):
            self._attr_brightness = max(0, min(255, int(brightness)))
            if not parsed_modes:
                parsed_modes.add(ColorMode.BRIGHTNESS)
        else:
            self._attr_brightness = None

        hs = attrs.get(ATTR_HS_COLOR)
        if isinstance(hs, (list, tuple)) and len(hs) == 2:
            self._attr_hs_color = (float(hs[0]), float(hs[1]))
            if not parsed_modes:
                parsed_modes.add(ColorMode.HS)
        else:
            self._attr_hs_color = None

        rgb = attrs.get(ATTR_RGB_COLOR)
        if isinstance(rgb, (list, tuple)) and len(rgb) == 3:
            self._attr_rgb_color = (
                max(0, min(255, int(rgb[0]))),
                max(0, min(255, int(rgb[1]))),
                max(0, min(255, int(rgb[2]))),
            )
            if not parsed_modes:
                parsed_modes.add(ColorMode.RGB)
        else:
            self._attr_rgb_color = None

        min_kelvin = attrs.get(ATTR_MIN_COLOR_TEMP_KELVIN)
        if isinstance(min_kelvin, (int, float)):
            self._attr_min_color_temp_kelvin = int(min_kelvin)

        max_kelvin = attrs.get(ATTR_MAX_COLOR_TEMP_KELVIN)
        if isinstance(max_kelvin, (int, float)):
            self._attr_max_color_temp_kelvin = int(max_kelvin)

        kelvin = attrs.get(ATTR_COLOR_TEMP_KELVIN)
        if isinstance(kelvin, (int, float)):
            self._attr_color_temp_kelvin = int(kelvin)
            if not parsed_modes:
                parsed_modes.add(ColorMode.COLOR_TEMP)
        else:
            self._attr_color_temp_kelvin = None

        if not parsed_modes:
            parsed_modes.add(ColorMode.ONOFF)

        self._attr_supported_color_modes = parsed_modes

        raw_color_mode = attrs.get(ATTR_COLOR_MODE)
        if raw_color_mode:
            try:
                candidate = ColorMode(raw_color_mode)
                self._attr_color_mode = (
                    candidate if candidate in parsed_modes else next(iter(parsed_modes))
                )
            except ValueError:
                self._attr_color_mode = next(iter(parsed_modes))
        elif state.state == STATE_ON:
            for preferred in (
                ColorMode.HS,
                ColorMode.RGB,
                ColorMode.COLOR_TEMP,
                ColorMode.BRIGHTNESS,
            ):
                if preferred in parsed_modes:
                    self._attr_color_mode = preferred
                    break
            else:
                self._attr_color_mode = next(iter(parsed_modes))
        else:
            self._attr_color_mode = next(iter(parsed_modes))

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn the connected source light on, forwarding brightness, temp, and color."""
        service_data: dict[str, Any] = {}
        for attr in FORWARDED_LIGHT_ATTRS:
            if attr in kwargs and kwargs[attr] is not None:
                service_data[attr] = kwargs[attr]
        await self._async_call_source_service("turn_on", **service_data)