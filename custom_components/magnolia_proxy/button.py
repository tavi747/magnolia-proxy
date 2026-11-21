"""Button platform for Magnolia Proxy Hub."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_ENTRY_TYPE, DOMAIN, ENTRY_TYPE_HUB
from .storage import MagnoliaProxyStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Create Device button on the Hub config entry."""
    if entry.data.get(CONF_ENTRY_TYPE) != ENTRY_TYPE_HUB:
        return

    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    async_add_entities([CreateVirtualDeviceButton(entry, store)])


class CreateVirtualDeviceButton(ButtonEntity):
    """Button that creates a new virtual device and triggers HA discovery."""

    _attr_has_entity_name = True
    _attr_name = "Create Device"
    _attr_icon = "mdi:devices"

    def __init__(self, entry: ConfigEntry, store: MagnoliaProxyStore) -> None:
        """Initialize the button."""
        self._entry = entry
        self._store = store
        self._attr_unique_id = f"{entry.entry_id}_create_device_button"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"hub_{entry.entry_id}")},
            name="Magnolia Proxy Hub",
            manufacturer="Magnolia Proxy",
            model="Proxy Hub",
        )

    async def async_press(self) -> None:
        """Create a new virtual device and trigger discovery."""
        await self._store.async_create_device(trigger_discovery=True)
