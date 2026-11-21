"""Sensor platform for Magnolia Proxy."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_DEVICE_CLASS,
    ATTR_UNIT_OF_MEASUREMENT,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
    UnitOfElectricCurrent,
    UnitOfElectricPotential,
    UnitOfEnergy,
    UnitOfFrequency,
    UnitOfPower,
)
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, State, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event

from .const import CONF_VIRTUAL_DEVICE_ID, DOMAIN
from .storage import EnergyStateStore, MagnoliaProxyStore

SUPPORTED_SENSOR_DEVICE_CLASSES: set[SensorDeviceClass] = {
    SensorDeviceClass.POWER,
    SensorDeviceClass.VOLTAGE,
    SensorDeviceClass.CURRENT,
    SensorDeviceClass.FREQUENCY,
    SensorDeviceClass.ENERGY,
}

ENERGY_TO_WH: dict[str, float] = {
    UnitOfEnergy.WATT_HOUR: 1.0,
    UnitOfEnergy.KILO_WATT_HOUR: 1000.0,
    UnitOfEnergy.MEGA_WATT_HOUR: 1_000_000.0,
    UnitOfEnergy.GIGA_WATT_HOUR: 1_000_000_000.0,
}


def _convert_energy_unit(
    value: float, from_unit: str | None, to_unit: str | None
) -> float:
    """Convert an energy value between supported energy units if both are known."""
    if not from_unit or not to_unit or from_unit == to_unit:
        return value
    from_factor = ENERGY_TO_WH.get(from_unit)
    to_factor = ENERGY_TO_WH.get(to_unit)
    if from_factor is None or to_factor is None:
        return value
    return (value * from_factor) / to_factor


def _parse_float(raw: Any) -> float | None:
    """Safely parse a numeric state value into a finite float."""
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val != val or val in (float("inf"), float("-inf")):
        return None
    return val


@dataclass
class _EnergyTrackerState:
    """Persisted accumulation state for an energy proxy."""

    source_entity: str | None = None
    baseline_raw: float | None = None
    accumulated: float = 0.0
    unit: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize for storage."""
        return {
            "source_entity": self.source_entity,
            "baseline_raw": self.baseline_raw,
            "accumulated": self.accumulated,
            "unit": self.unit,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> _EnergyTrackerState:
        """Deserialize from storage."""
        if not data:
            return cls()
        return cls(
            source_entity=data.get("source_entity"),
            baseline_raw=_parse_float(data.get("baseline_raw")),
            accumulated=_parse_float(data.get("accumulated")) or 0.0,
            unit=data.get("unit"),
        )


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up all sensor proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    vdev_id: str = entry.data[CONF_VIRTUAL_DEVICE_ID]

    entities = [
        ProxySensor(
            hass,
            entry,
            proxy_def,
            store.energy,
            _EnergyTrackerState.from_dict(store.energy.get(proxy_def["id"])),
        )
        for proxy_def in store.list_proxies(vdev_id)
        if proxy_def["domain"] == "sensor"
    ]
    async_add_entities(entities)


class ProxySensor(SensorEntity):
    """Proxy sensor supporting power, voltage, current, frequency, and energy."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        proxy_def: dict[str, Any],
        store: EnergyStateStore,
        tracker: _EnergyTrackerState,
    ) -> None:
        """Initialize the proxy sensor."""
        self.hass = hass
        self._entry = entry
        self._proxy_id: str = proxy_def["id"]
        self._store = store
        self._energy_state = tracker
        self._source_entity: str = proxy_def["source_entity"]

        self._attr_name = proxy_def["name"]
        self._attr_unique_id = f"{self._proxy_id}_sensor"

        vdev_id: str = entry.data[CONF_VIRTUAL_DEVICE_ID]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, vdev_id)},
        )

        self._attr_native_value: float | None = None
        self._attr_native_unit_of_measurement: str | None = None
        self._attr_device_class: SensorDeviceClass | None = None
        self._attr_state_class: SensorStateClass | None = None
        self._attr_available: bool = False

    @callback
    def _save_energy_state(self) -> None:
        """Persist energy accumulation state (debounced by the shared store)."""
        self._store.set(self._proxy_id, self._energy_state.to_dict())

    @callback
    def _detect_device_class(self, state: State | None) -> SensorDeviceClass | None:
        """Determine sensor device class from source attributes or unit."""
        if state is None:
            return self._attr_device_class

        raw_dc = state.attributes.get(ATTR_DEVICE_CLASS)
        if raw_dc:
            try:
                dc = SensorDeviceClass(str(raw_dc))
                if dc in SUPPORTED_SENSOR_DEVICE_CLASSES:
                    return dc
            except ValueError:
                pass

        unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
        if unit in (UnitOfPower.WATT, UnitOfPower.KILO_WATT, UnitOfPower.MEGA_WATT):
            return SensorDeviceClass.POWER
        if unit in (
            UnitOfElectricPotential.VOLT,
            UnitOfElectricPotential.MILLIVOLT,
        ):
            return SensorDeviceClass.VOLTAGE
        if unit in (
            UnitOfElectricCurrent.AMPERE,
            UnitOfElectricCurrent.MILLIAMPERE,
        ):
            return SensorDeviceClass.CURRENT
        if unit in (
            UnitOfFrequency.HERTZ,
            UnitOfFrequency.KILOHERTZ,
            UnitOfFrequency.MEGAHERTZ,
        ):
            return SensorDeviceClass.FREQUENCY
        if unit in ENERGY_TO_WH:
            return SensorDeviceClass.ENERGY

        return self._attr_device_class

    @callback
    def _apply_measurement_state(
        self, state: State | None, value: float | None
    ) -> None:
        """Update instantaneous measurement sensors (power, voltage, current, frequency)."""
        if state is not None:
            unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
            if isinstance(unit, str) and unit:
                self._attr_native_unit_of_measurement = unit

        self._attr_state_class = SensorStateClass.MEASUREMENT

        if (
            state is None
            or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN)
            or value is None
        ):
            self._attr_available = False
            self._attr_native_value = None
        else:
            self._attr_available = True
            self._attr_native_value = value

    def _process_energy_state(self, state: State | None) -> bool:
        """Update energy proxy state and return True if persistent state changed."""
        changed = False
        es = self._energy_state

        source_unit = (
            state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
            if state is not None
            else None
        )
        if isinstance(source_unit, str) and source_unit:
            if es.unit is None:
                es.unit = source_unit
                changed = True
            self._attr_native_unit_of_measurement = es.unit
        elif es.unit:
            self._attr_native_unit_of_measurement = es.unit

        if self._source_entity and es.source_entity != self._source_entity:
            es.source_entity = self._source_entity
            current_raw = (
                _parse_float(state.state)
                if state is not None
                and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)
                else None
            )
            es.baseline_raw = (
                _convert_energy_unit(
                    current_raw,
                    source_unit if isinstance(source_unit, str) else None,
                    self._attr_native_unit_of_measurement,
                )
                if current_raw is not None
                else None
            )
            changed = True

        self._attr_state_class = SensorStateClass.TOTAL_INCREASING

        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            self._attr_available = False
            self._attr_native_value = round(es.accumulated, 6)
            return changed

        raw_val = _parse_float(state.state)
        if raw_val is None:
            self._attr_available = False
            self._attr_native_value = round(es.accumulated, 6)
            return changed

        converted_val = _convert_energy_unit(
            raw_val,
            source_unit if isinstance(source_unit, str) else None,
            self._attr_native_unit_of_measurement,
        )

        if es.baseline_raw is None:
            es.baseline_raw = converted_val
            changed = True
        elif converted_val >= es.baseline_raw:
            delta = converted_val - es.baseline_raw
            if delta > 0:
                es.accumulated += delta
                changed = True
            es.baseline_raw = converted_val
        else:
            if converted_val > 0:
                es.accumulated += converted_val
            es.baseline_raw = converted_val
            changed = True

        self._attr_available = True
        self._attr_native_value = round(es.accumulated, 6)
        return changed

    @callback
    def _handle_source_state(self, state: State | None) -> None:
        """Apply state for measurement or energy sensor."""
        dc = self._detect_device_class(state)
        if dc is not None:
            self._attr_device_class = dc

        if self._attr_device_class == SensorDeviceClass.ENERGY:
            if self._process_energy_state(state):
                self._save_energy_state()
        else:
            val = (
                _parse_float(state.state)
                if state is not None
                and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)
                else None
            )
            self._apply_measurement_state(state, val)

        self.async_write_ha_state()

    @callback
    def _async_source_changed(self, event: Event[EventStateChangedData]) -> None:
        """Handle source sensor state updates."""
        self._handle_source_state(event.data["new_state"])

    async def async_added_to_hass(self) -> None:
        """Subscribe to source entity state updates."""
        await super().async_added_to_hass()
        if not self._source_entity:
            self._attr_available = False
            return

        self._handle_source_state(self.hass.states.get(self._source_entity))

        self.async_on_remove(
            async_track_state_change_event(
                self.hass,
                [self._source_entity],
                self._async_source_changed,
            )
        )
