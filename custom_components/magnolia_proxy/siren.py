"""Siren platform for Magnolia Proxy."""
from __future__ import annotations

from typing import Any

from homeassistant.components.siren import (
    ATTR_AVAILABLE_TONES,
    ATTR_DURATION,
    ATTR_TONE,
    ATTR_VOLUME_LEVEL,
    SirenEntity,
    SirenEntityFeature,
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
    """Set up all siren proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    async_add_entities(
        ProxySiren(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
        if proxy_def["domain"] == "siren"
    )


class ProxySiren(BaseProxyEntity, SirenEntity):
    """Proxy entity for the siren domain with tones, volume and duration."""

    _attr_supported_features = SirenEntityFeature(0)
    _attr_available_tones = None

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Mirror on/off, available tones and features."""
        super()._apply_source_state(state)
        features = source_features(state, SirenEntityFeature)
        tones = state.attributes.get(ATTR_AVAILABLE_TONES) if state else None
        if isinstance(tones, (list, dict)) and tones:
            self._attr_available_tones = tones
        else:
            self._attr_available_tones = None
            # Home Assistant requires tones whenever TONES is supported.
            features &= ~SirenEntityFeature.TONES
        self._attr_supported_features = features

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn the source siren on, forwarding tone, volume and duration."""
        data = {
            key: kwargs[key]
            for key in (ATTR_TONE, ATTR_VOLUME_LEVEL, ATTR_DURATION)
            if kwargs.get(key) is not None
        }
        await self._async_call_source_service("turn_on", **data)
