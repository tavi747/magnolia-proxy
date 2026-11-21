"""Switch platform for Magnolia Proxy."""
from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_VIRTUAL_DEVICE_ID, DOMAIN
from .entity_base import BaseProxyEntity
from .storage import MagnoliaProxyStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up all switch proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    vdev_id: str = entry.data[CONF_VIRTUAL_DEVICE_ID]
    entities = [
        ProxySwitch(hass, entry, proxy_def)
        for proxy_def in store.list_proxies(vdev_id)
        if proxy_def["domain"] == "switch"
    ]
    async_add_entities(entities)


class ProxySwitch(BaseProxyEntity, SwitchEntity):
    """Proxy entity for the switch domain."""
