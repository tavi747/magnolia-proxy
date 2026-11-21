"""Shared base class for Magnolia Proxy entities."""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.event import async_track_state_change_event

from .const import CONF_VIRTUAL_DEVICE_ID, DOMAIN


class BaseProxyEntity(Entity):
    """Base entity that mirrors state and forwards commands to a source entity."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        proxy_def: dict[str, Any],
    ) -> None:
        """Initialize the proxy entity."""
        self.hass = hass
        self._entry = entry
        self._proxy_id: str = proxy_def["id"]
        self._domain: str = proxy_def["domain"]
        self._source_entity: str = proxy_def["source_entity"]
        self._attr_name = proxy_def["name"]
        self._attr_unique_id = f"{self._proxy_id}_{self._domain}"

        vdev_id: str = entry.data[CONF_VIRTUAL_DEVICE_ID]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, vdev_id)},
        )

        self._attr_is_on: bool | None = None
        self._attr_available: bool = False

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Update cached state from the source entity state object."""
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._attr_available = False
            self._attr_is_on = None
        else:
            self._attr_available = True
            self._attr_is_on = state.state == STATE_ON

    @callback
    def _async_source_changed(self, event: Event[EventStateChangedData]) -> None:
        """Handle state changes of the source entity."""
        self._apply_source_state(event.data["new_state"])
        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        """Subscribe to source entity updates when added."""
        await super().async_added_to_hass()
        if not self._source_entity:
            self._attr_available = False
            return

        self._apply_source_state(self.hass.states.get(self._source_entity))
        self.async_on_remove(
            async_track_state_change_event(
                self.hass,
                [self._source_entity],
                self._async_source_changed,
            )
        )

    async def _async_call_source_service(
        self, service: str, **service_data: Any
    ) -> None:
        """Forward a service call to the connected source entity."""
        if not self._source_entity:
            return
        data: dict[str, Any] = {"entity_id": self._source_entity, **service_data}
        await self.hass.services.async_call(
            self._domain,
            service,
            data,
            blocking=True,
            context=self._context,
        )

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn the connected source entity on."""
        await self._async_call_source_service("turn_on", **kwargs)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Turn the connected source entity off."""
        await self._async_call_source_service("turn_off", **kwargs)
