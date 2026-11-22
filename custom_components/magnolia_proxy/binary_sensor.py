"""Binary sensor platform for Magnolia Proxy."""
from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_DEVICE_CLASS
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
    """Set up all binary sensor proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    async_add_entities(
        ProxyBinarySensor(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
        if proxy_def["domain"] == "binary_sensor"
    )


class ProxyBinarySensor(BaseProxyEntity, BinarySensorEntity):
    """Read-only proxy mirroring a binary sensor's on/off state and device class."""

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Mirror on/off, availability and the source's device class."""
        super()._apply_source_state(state)
        dc = state.attributes.get(ATTR_DEVICE_CLASS) if state else None
        self._attr_device_class = (
            BinarySensorDeviceClass(dc)
            if dc in BinarySensorDeviceClass._value2member_map_
            else None
        )
