"""Switch platform for Magnolia Proxy."""
from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity_base import BaseProxyEntity
from .storage import MagnoliaProxyStore


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up all switch proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    entities = [
        ProxySwitch(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
        if proxy_def["domain"] == "switch"
    ]
    async_add_entities(entities)


class ProxySwitch(BaseProxyEntity, SwitchEntity):
    """Proxy entity for the switch domain."""
