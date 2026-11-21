"""Light platform for Magnolia Proxy."""
from __future__ import annotations

from typing import Any

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_MODE,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_EFFECT,
    ATTR_EFFECT_LIST,
    ATTR_FLASH,
    ATTR_HS_COLOR,
    ATTR_MAX_COLOR_TEMP_KELVIN,
    ATTR_MIN_COLOR_TEMP_KELVIN,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
    ATTR_SUPPORTED_COLOR_MODES,
    ATTR_TRANSITION,
    ATTR_WHITE,
    ATTR_XY_COLOR,
    ColorMode,
    LightEntity,
    LightEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_SUPPORTED_FEATURES,
    STATE_ON,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity_base import BaseProxyEntity
from .storage import MagnoliaProxyStore

FORWARDED_LIGHT_ATTRS: tuple[str, ...] = (
    ATTR_BRIGHTNESS,
    ATTR_HS_COLOR,
    ATTR_XY_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
    ATTR_WHITE,
    ATTR_COLOR_TEMP_KELVIN,
    ATTR_EFFECT,
    ATTR_FLASH,
    ATTR_TRANSITION,
)

MIRRORED_LIGHT_FEATURES = (
    LightEntityFeature.EFFECT | LightEntityFeature.FLASH | LightEntityFeature.TRANSITION
)


def _clamp_color(raw: object, length: int) -> tuple[int, ...] | None:
    """Return a clamped 0-255 integer color tuple of the given length, or None."""
    if not isinstance(raw, (list, tuple)) or len(raw) != length:
        return None
    try:
        return tuple(max(0, min(255, int(v))) for v in raw)
    except (TypeError, ValueError):
        return None


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up all light proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    entities = [
        ProxyLight(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
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
        self._attr_rgbw_color: tuple[int, int, int, int] | None = None
        self._attr_rgbww_color: tuple[int, int, int, int, int] | None = None
        self._attr_xy_color: tuple[float, float] | None = None
        self._attr_effect: str | None = None
        self._attr_effect_list: list[str] | None = None
        self._attr_supported_features = LightEntityFeature(0)
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
        self._attr_rgbw_color = None
        self._attr_rgbww_color = None
        self._attr_xy_color = None
        self._attr_color_temp_kelvin = None
        self._attr_effect = None

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
        else:
            self._attr_brightness = None

        # Color modes inferred from attributes, used only when the source does
        # not report supported_color_modes itself.
        inferred: set[ColorMode] = set()

        hs = attrs.get(ATTR_HS_COLOR)
        if isinstance(hs, (list, tuple)) and len(hs) == 2:
            self._attr_hs_color = (float(hs[0]), float(hs[1]))
            inferred.add(ColorMode.HS)
        else:
            self._attr_hs_color = None

        xy = attrs.get(ATTR_XY_COLOR)
        if isinstance(xy, (list, tuple)) and len(xy) == 2:
            self._attr_xy_color = (float(xy[0]), float(xy[1]))
            inferred.add(ColorMode.XY)
        else:
            self._attr_xy_color = None

        self._attr_rgb_color = _clamp_color(attrs.get(ATTR_RGB_COLOR), 3)
        if self._attr_rgb_color is not None:
            inferred.add(ColorMode.RGB)
        self._attr_rgbw_color = _clamp_color(attrs.get(ATTR_RGBW_COLOR), 4)
        if self._attr_rgbw_color is not None:
            inferred.add(ColorMode.RGBW)
        self._attr_rgbww_color = _clamp_color(attrs.get(ATTR_RGBWW_COLOR), 5)
        if self._attr_rgbww_color is not None:
            inferred.add(ColorMode.RGBWW)

        min_kelvin = attrs.get(ATTR_MIN_COLOR_TEMP_KELVIN)
        if isinstance(min_kelvin, (int, float)):
            self._attr_min_color_temp_kelvin = int(min_kelvin)

        max_kelvin = attrs.get(ATTR_MAX_COLOR_TEMP_KELVIN)
        if isinstance(max_kelvin, (int, float)):
            self._attr_max_color_temp_kelvin = int(max_kelvin)

        kelvin = attrs.get(ATTR_COLOR_TEMP_KELVIN)
        if isinstance(kelvin, (int, float)):
            self._attr_color_temp_kelvin = int(kelvin)
            inferred.add(ColorMode.COLOR_TEMP)
        else:
            self._attr_color_temp_kelvin = None

        if not parsed_modes:
            if state.state != STATE_ON and self._attr_supported_color_modes:
                # Color/brightness attributes are absent while off; keep the
                # modes inferred while on instead of collapsing to ONOFF.
                parsed_modes = set(self._attr_supported_color_modes)
            elif inferred:
                # BRIGHTNESS/ONOFF must not be mixed with color modes.
                parsed_modes = inferred
            elif self._attr_brightness is not None:
                parsed_modes = {ColorMode.BRIGHTNESS}
            else:
                parsed_modes = {ColorMode.ONOFF}

        self._attr_supported_color_modes = parsed_modes

        raw_features = attrs.get(ATTR_SUPPORTED_FEATURES)
        features = (
            LightEntityFeature(int(raw_features)) & MIRRORED_LIGHT_FEATURES
            if isinstance(raw_features, int)
            else LightEntityFeature(0)
        )
        effect_list = attrs.get(ATTR_EFFECT_LIST)
        if isinstance(effect_list, (list, tuple)) and effect_list:
            self._attr_effect_list = [str(e) for e in effect_list if e is not None]
            features |= LightEntityFeature.EFFECT
        else:
            self._attr_effect_list = None
            features &= ~LightEntityFeature.EFFECT
        effect = attrs.get(ATTR_EFFECT)
        self._attr_effect = effect if isinstance(effect, str) else None
        self._attr_supported_features = features

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
                ColorMode.XY,
                ColorMode.RGBWW,
                ColorMode.RGBW,
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