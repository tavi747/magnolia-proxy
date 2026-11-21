"""Persistent storage, virtual device registry, and HA discovery triggers."""
from __future__ import annotations

import asyncio
import math
from typing import Any
from uuid import uuid4

from homeassistant import config_entries
from homeassistant.components.sensor import SensorDeviceClass
from homeassistant.const import (
    ATTR_DEVICE_CLASS,
    ATTR_ICON,
    ATTR_UNIT_OF_MEASUREMENT,
    UnitOfEnergy,
)
from homeassistant.core import HomeAssistant, valid_entity_id
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store

from .const import (
    CONF_DEVICE_MODEL,
    CONF_DEVICE_NAME,
    CONF_ENTRY_TYPE,
    CONF_VIRTUAL_DEVICE_ID,
    DOMAIN,
    ENERGY_STORAGE_KEY,
    ENTRY_TYPE_DEVICE,
    ENTRY_TYPE_HUB,
    STORAGE_KEY,
    STORAGE_VERSION,
    SUPPORTED_DOMAINS,
)
from .energy_history import async_get_energy_history


ENERGY_SAVE_DELAY = 30

ENERGY_UNITS: set[str] = {
    UnitOfEnergy.WATT_HOUR,
    UnitOfEnergy.KILO_WATT_HOUR,
    UnitOfEnergy.MEGA_WATT_HOUR,
    UnitOfEnergy.GIGA_WATT_HOUR,
}


def is_proxy_entity(hass: HomeAssistant, entity_id: str) -> bool:
    """Return True if entity_id belongs to this integration (cannot be a source)."""
    reg_entry = er.async_get(hass).async_get(entity_id)
    return reg_entry is not None and reg_entry.platform == DOMAIN


def validate_source_entity(
    hass: HomeAssistant, entity_id: str, locked_domain: str | None = None
) -> str:
    """Validate a source entity and return its domain, raising ValueError if invalid."""
    domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
    if domain not in SUPPORTED_DOMAINS:
        raise ValueError(f"Unsupported domain: {domain}")
    if locked_domain is not None and domain != locked_domain:
        raise ValueError(
            f"Domain mismatch: proxy is locked to '{locked_domain}', got '{domain}'"
        )
    if is_proxy_entity(hass, entity_id):
        raise ValueError("A Magnolia Proxy entity cannot be used as a source")
    if (
        hass.states.get(entity_id) is None
        and er.async_get(hass).async_get(entity_id) is None
    ):
        raise ValueError(f"Unknown source entity: {entity_id}")
    return domain


def source_icon(hass: HomeAssistant, entity_id: str) -> str | None:
    """Return the icon the source entity currently shows, if it has a custom one."""
    state = hass.states.get(entity_id)
    icon = state.attributes.get(ATTR_ICON) if state is not None else None
    if not (isinstance(icon, str) and icon):
        reg_entry = er.async_get(hass).async_get(entity_id)
        icon = (reg_entry.icon or reg_entry.original_icon) if reg_entry else None
    return icon if isinstance(icon, str) and icon else None


def is_energy_entity(hass: HomeAssistant, entity_id: str | None) -> bool:
    """Return True if entity_id is an energy sensor.

    Mirrors ProxySensor's detection: an explicit device_class decides; without
    one, an energy unit (Wh/kWh/MWh/GWh) marks the sensor as energy.
    """
    if not entity_id or not entity_id.startswith("sensor."):
        return False
    reg_entry = er.async_get(hass).async_get(entity_id)
    state = hass.states.get(entity_id)

    device_class = None
    if reg_entry is not None:
        device_class = reg_entry.device_class or reg_entry.original_device_class
    if not device_class and state is not None:
        device_class = state.attributes.get(ATTR_DEVICE_CLASS)
    if device_class:
        return str(device_class) == SensorDeviceClass.ENERGY

    return entity_unit(hass, entity_id) in ENERGY_UNITS


def _parse_reading(raw: Any) -> float | None:
    """Parse a state value into a finite float, or None."""
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def entity_unit(hass: HomeAssistant, entity_id: str | None) -> str | None:
    """Return an entity's unit of measurement from live state or the registry."""
    if not entity_id:
        return None
    state = hass.states.get(entity_id)
    unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT) if state else None
    if not unit:
        reg_entry = er.async_get(hass).async_get(entity_id)
        unit = reg_entry.unit_of_measurement if reg_entry else None
    return str(unit) if unit else None


class EnergyStateStore:
    """Single shared, debounced store for energy accumulation state."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the energy state store."""
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, ENERGY_STORAGE_KEY
        )
        self._data: dict[str, dict[str, Any]] = {}
        # Starting states set when a proxy is created or its source replaced.
        # The next ProxySensor setup takes them in preference to _data, which
        # the old entity may still overwrite while its entry is reloading.
        self._pending: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        """Load energy state from disk."""
        self._data = dict(await self._store.async_load() or {})

    def get(self, proxy_id: str) -> dict[str, Any] | None:
        """Return stored energy state for a proxy."""
        return self._data.get(proxy_id)

    def set(self, proxy_id: str, state: dict[str, Any]) -> None:
        """Update energy state for a proxy and schedule a debounced save."""
        self._data[proxy_id] = state
        self._store.async_delay_save(lambda: dict(self._data), ENERGY_SAVE_DELAY)

    def set_start(self, proxy_id: str, state: dict[str, Any]) -> None:
        """Set a new starting state that the next sensor setup must use."""
        self._pending[proxy_id] = state
        self.set(proxy_id, state)

    def take_start(self, proxy_id: str) -> dict[str, Any] | None:
        """Return (and clear) a pending starting state for a proxy."""
        return self._pending.pop(proxy_id, None)

    def remove(self, proxy_id: str) -> None:
        """Drop energy state for a deleted proxy."""
        self._pending.pop(proxy_id, None)
        if self._data.pop(proxy_id, None) is not None:
            self._store.async_delay_save(lambda: dict(self._data), ENERGY_SAVE_DELAY)


class MagnoliaProxyStore:
    """Persist virtual devices and their proxy entity definitions."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize persistent storage."""
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY
        )
        self._devices: dict[str, dict[str, Any]] = {}
        self._proxies: dict[str, dict[str, Any]] = {}
        self.energy = EnergyStateStore(hass)

    async def async_load(self) -> None:
        """Load virtual devices and proxy definitions from disk."""
        await self.energy.async_load()
        data = await self._store.async_load() or {}
        self._devices = dict(data.get("devices", {}))
        self._proxies = dict(data.get("proxies", {}))

    async def async_save(self) -> None:
        """Write current virtual devices and proxy definitions to disk."""
        await self._store.async_save(
            {
                "devices": self._devices,
                "proxies": self._proxies,
            }
        )

    def list_devices(self) -> list[dict[str, Any]]:
        """Return all virtual device records with attached proxy definitions."""
        result: list[dict[str, Any]] = []
        for dev in self._devices.values():
            dev_id = dev["id"]
            attached = [
                p for p in self._proxies.values() if p.get("virtual_device_id") == dev_id
            ]
            configured_entry = self.find_device_config_entry(dev_id)
            result.append(
                {
                    **dev,
                    "proxies": attached,
                    "added_to_ha": configured_entry is not None,
                    "config_entry_id": (
                        configured_entry.entry_id if configured_entry else None
                    ),
                }
            )
        return result

    def get_device(self, dev_id: str | None) -> dict[str, Any] | None:
        """Return a virtual device record by ID."""
        if not dev_id:
            return None
        return self._devices.get(dev_id)

    def list_proxies(self, virtual_device_id: str | None = None) -> list[dict[str, Any]]:
        """Return all proxy definitions or those belonging to a specific virtual device."""
        proxies = list(self._proxies.values())
        if virtual_device_id is not None:
            return [
                p for p in proxies if p.get("virtual_device_id") == virtual_device_id
            ]
        return proxies

    def get_proxy(self, proxy_id: str | None) -> dict[str, Any] | None:
        """Return a proxy definition by ID."""
        if not proxy_id:
            return None
        return self._proxies.get(proxy_id)

    def is_energy_proxy(self, proxy: dict[str, Any]) -> bool:
        """Return True if the proxy is an energy sensor (locked to energy sources)."""
        if proxy.get("domain") != "sensor":
            return False
        # Accumulated energy state exists once the proxy has tracked energy.
        if self.energy.get(proxy["id"]) is not None:
            return True
        entity_id = er.async_get(self.hass).async_get_entity_id(
            "sensor", DOMAIN, f"{proxy['id']}_sensor"
        )
        state = self.hass.states.get(entity_id) if entity_id else None
        if state and state.attributes.get(ATTR_DEVICE_CLASS) == SensorDeviceClass.ENERGY:
            return True
        return is_energy_entity(self.hass, proxy.get("source_entity"))

    def proxy_unit(self, proxy: dict[str, Any]) -> str | None:
        """Return the unit a proxy reports, which a new source must match.

        Prefers the proxy entity's own unit (what its history is recorded in),
        then the unit stored for energy accumulation, then the current source.
        """
        entity_id = er.async_get(self.hass).async_get_entity_id(
            proxy["domain"], DOMAIN, f"{proxy['id']}_{proxy['domain']}"
        )
        unit = entity_unit(self.hass, entity_id)
        if not unit:
            unit = (self.energy.get(proxy["id"]) or {}).get("unit")
        if not unit:
            unit = entity_unit(self.hass, proxy.get("source_entity"))
        return unit or None

    def validate_proxy_source(self, proxy: dict[str, Any], entity_id: str) -> None:
        """Validate a new source for an existing proxy, raising ValueError if invalid."""
        validate_source_entity(self.hass, entity_id, proxy["domain"])
        if self.is_energy_proxy(proxy) and not is_energy_entity(self.hass, entity_id):
            raise ValueError(
                "An energy proxy can only use an energy sensor as its source"
            )
        unit = self.proxy_unit(proxy)
        new_unit = entity_unit(self.hass, entity_id)
        if unit and new_unit != unit:
            raise ValueError(
                f"Unit mismatch: proxy uses '{unit}', "
                f"{entity_id} uses '{new_unit or 'no unit'}'"
            )

    def proxies_for_entry(
        self, entry: config_entries.ConfigEntry
    ) -> list[dict[str, Any]]:
        """Return proxies hosted by a config entry.

        Device entries host their device's proxies; the hub entry hosts proxies
        that are not attached to any virtual device.
        """
        if entry.data.get(CONF_ENTRY_TYPE, ENTRY_TYPE_HUB) == ENTRY_TYPE_HUB:
            return [p for p in self._proxies.values() if not p.get("virtual_device_id")]
        vdev_id = entry.data.get(CONF_VIRTUAL_DEVICE_ID)
        return [p for p in self._proxies.values() if p.get("virtual_device_id") == vdev_id]

    def list_unassigned_proxies(self) -> list[dict[str, Any]]:
        """Return proxies not attached to any virtual device."""
        return [p for p in self._proxies.values() if not p.get("virtual_device_id")]

    def find_host_entry(
        self, virtual_device_id: str | None
    ) -> config_entries.ConfigEntry | None:
        """Return the entry hosting proxies of a device, or the hub for unassigned."""
        if virtual_device_id:
            return self.find_device_config_entry(virtual_device_id)
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if entry.data.get(CONF_ENTRY_TYPE, ENTRY_TYPE_HUB) == ENTRY_TYPE_HUB:
                return entry
        return None

    def find_device_config_entry(
        self, virtual_device_id: str
    ) -> config_entries.ConfigEntry | None:
        """Find the Home Assistant ConfigEntry representing this virtual device."""
        for entry in self.hass.config_entries.async_entries(DOMAIN):
            if (
                entry.data.get(CONF_ENTRY_TYPE) == ENTRY_TYPE_DEVICE
                and entry.data.get(CONF_VIRTUAL_DEVICE_ID) == virtual_device_id
            ):
                return entry
        return None

    async def async_trigger_device_discovery(self, dev_id: str) -> None:
        """Trigger Home Assistant integration discovery for a virtual device."""
        dev = self._devices.get(dev_id)
        if not dev:
            return
        if self.find_device_config_entry(dev_id) is not None:
            return

        self.hass.async_create_task(
            self.hass.config_entries.flow.async_init(
                DOMAIN,
                context={"source": config_entries.SOURCE_INTEGRATION_DISCOVERY},
                data={
                    CONF_ENTRY_TYPE: ENTRY_TYPE_DEVICE,
                    CONF_VIRTUAL_DEVICE_ID: dev_id,
                    CONF_DEVICE_NAME: dev["name"],
                    CONF_DEVICE_MODEL: dev.get("model", "Virtual Device"),
                },
            )
        )

    async def async_discover_unadded_devices(self) -> None:
        """Ensure any saved virtual devices not yet added as config entries are discovered."""
        for dev_id in self._devices:
            await self.async_trigger_device_discovery(dev_id)

    async def async_create_device(
        self,
        name: str | None = None,
        model: str = "Virtual Device",
        *,
        trigger_discovery: bool = True,
    ) -> dict[str, Any]:
        """Create a new virtual device and notify Home Assistant discovery."""
        dev_id = f"vdev_{uuid4().hex[:12]}"
        resolved_name = (
            name.strip()
            if name and name.strip()
            else f"Virtual Device {len(self._devices) + 1}"
        )
        record = {
            "id": dev_id,
            "name": resolved_name,
            "model": model.strip() if model else "Virtual Device",
        }
        self._devices[dev_id] = record
        await self.async_save()

        if trigger_discovery:
            await self.async_trigger_device_discovery(dev_id)

        return record

    async def async_rename_device(self, dev_id: str, name: str) -> dict[str, Any] | None:
        """Rename a virtual device in the panel, its HA entry title and device page."""
        dev = self._devices.get(dev_id)
        if dev is None:
            return None
        clean = (name or "").strip()
        if not clean:
            raise ValueError("Device name is required")
        if clean == dev["name"]:
            return dev
        dev["name"] = clean
        await self.async_save()

        entry = self.find_host_entry(dev_id)
        if entry is not None:
            if entry.title != clean:
                self.hass.config_entries.async_update_entry(entry, title=clean)
            await self.hass.config_entries.async_reload(entry.entry_id)
        return dev

    async def async_delete_device(self, dev_id: str) -> bool:
        """Delete a virtual device, its proxies, and its config entry if added."""
        if dev_id not in self._devices:
            return False

        self._devices.pop(dev_id, None)
        to_remove = [
            pid
            for pid, proxy in self._proxies.items()
            if proxy.get("virtual_device_id") == dev_id
        ]
        for pid in to_remove:
            self._proxies.pop(pid, None)
            self.energy.remove(pid)
        await self.async_save()

        entry = self.find_device_config_entry(dev_id)
        if entry is not None:
            await self.hass.config_entries.async_remove(entry.entry_id)

        # Drop the pending "Discovered" prompt if the device was never added.
        unique_id = f"{DOMAIN}_{dev_id}"
        for flow in self.hass.config_entries.flow.async_progress_by_handler(DOMAIN):
            if flow["context"].get("unique_id") == unique_id:
                self.hass.config_entries.flow.async_abort(flow["flow_id"])

        return True

    async def async_create_proxy(
        self,
        name: str,
        source_entity: str,
        virtual_device_id: str | None,
        energy_start: dict[str, Any] | None = None,
        entity_id: str | None = None,
        rename_source_to: str | None = None,
    ) -> dict[str, Any]:
        """Create a domain-locked proxy, optionally attached to a virtual device.

        energy_start chooses where a new energy proxy's counter starts:
        {"mode": "zero"} (default), {"mode": "source"} for the source's current
        reading, or {"mode": "history", "entity_id": ...} to continue the last
        recorded value of an old entity.

        entity_id sets the proxy's entity ID (default: derived from its name).
        rename_source_to renames the source entity first, which frees its ID
        so the proxy can take it over (dashboards and automations that use
        the old ID then follow the proxy).
        """
        virtual_device_id = virtual_device_id or None
        if virtual_device_id is not None and virtual_device_id not in self._devices:
            raise ValueError("Unknown virtual_device_id")

        source_domain = validate_source_entity(self.hass, source_entity)

        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Proxy name is required")

        seed, takeover_object_id = await self._async_energy_seed(
            source_entity, energy_start
        )

        desired_id = (entity_id or "").strip().lower() or None
        new_source_id = (rename_source_to or "").strip().lower() or None
        self._validate_entity_ids(
            source_entity, source_domain, desired_id, new_source_id, takeover_object_id
        )

        # Copied to the new proxy once it is registered (read before any rename).
        icon_from_source = source_icon(self.hass, source_entity)

        moved_entries: set[str] = set()
        if new_source_id is not None:
            old_source = source_entity
            er.async_get(self.hass).async_update_entity(
                old_source, new_entity_id=new_source_id
            )
            source_entity = new_source_id
            if seed is not None:
                seed["source_entity"] = new_source_id
            moved_entries = self._follow_source_rename(old_source, new_source_id)
            # The old state is removed asynchronously; wait so the proxy can
            # take the freed entity ID.
            await self._async_wait_state_removed(old_source)

        proxy_id = f"prx_{uuid4().hex[:12]}"
        record = {
            "id": proxy_id,
            "name": clean_name,
            "domain": source_domain,
            "source_entity": source_entity,
            "virtual_device_id": virtual_device_id,
        }
        self._proxies[proxy_id] = record
        if seed is not None:
            self.energy.set_start(proxy_id, seed)
        await self.async_save()

        entry = self.find_host_entry(virtual_device_id)
        claim_object_id = takeover_object_id or (
            desired_id.split(".", 1)[1] if desired_id else None
        )
        if claim_object_id:
            # Claim the entity_id before the entity is added: either an old
            # entity's ID (so its recorded statistics continue) or the ID
            # the user chose (e.g. one freed by renaming the source).
            ent_reg = er.async_get(self.hass)
            reg_entry = ent_reg.async_get_or_create(
                source_domain,
                DOMAIN,
                f"{proxy_id}_{source_domain}",
                suggested_object_id=claim_object_id,
                **({"config_entry": entry} if entry is not None else {}),
            )
            if desired_id and reg_entry.entity_id != desired_id:
                # A leftover state made HA pick a suffixed ID; move it.
                ent_reg.async_update_entity(
                    reg_entry.entity_id, new_entity_id=desired_id
                )
        if entry is not None:
            moved_entries.discard(entry.entry_id)
            await self.hass.config_entries.async_reload(entry.entry_id)
        for entry_id in moved_entries:
            await self.hass.config_entries.async_reload(entry_id)

        if icon_from_source:
            # One-time copy: the user can still change the proxy's icon later.
            ent_reg = er.async_get(self.hass)
            new_entity_id = ent_reg.async_get_entity_id(
                source_domain, DOMAIN, f"{proxy_id}_{source_domain}"
            )
            reg_entry = ent_reg.async_get(new_entity_id) if new_entity_id else None
            if reg_entry is not None and not reg_entry.icon:
                ent_reg.async_update_entity(new_entity_id, icon=icon_from_source)

        return record

    def _validate_entity_ids(
        self,
        source_entity: str,
        source_domain: str,
        desired_id: str | None,
        new_source_id: str | None,
        takeover_object_id: str | None,
    ) -> None:
        """Check proxy/source entity ID choices before anything is changed."""
        ent_reg = er.async_get(self.hass)

        def in_use(candidate: str) -> bool:
            return (
                ent_reg.async_get(candidate) is not None
                or self.hass.states.get(candidate) is not None
            )

        def check_format(candidate: str, what: str) -> None:
            if not valid_entity_id(candidate) or (
                candidate.split(".", 1)[0] != source_domain
            ):
                raise ValueError(
                    f"{what} must be a valid '{source_domain}.object_id' entity ID"
                )

        if desired_id is not None and takeover_object_id is not None:
            raise ValueError(
                "Choose either an old entity to take over or an explicit entity_id"
            )
        if new_source_id is not None:
            check_format(new_source_id, "The source's new ID")
            if new_source_id == source_entity:
                raise ValueError("The source's new ID must differ from its current ID")
            if ent_reg.async_get(source_entity) is None:
                raise ValueError(
                    f"{source_entity} cannot be renamed: it has no unique ID, "
                    "so it is not in the entity registry"
                )
            if in_use(new_source_id):
                raise ValueError(f"{new_source_id} is already in use")
        if desired_id is not None:
            check_format(desired_id, "The proxy's entity ID")
            freed = new_source_id is not None and desired_id == source_entity
            if not freed and in_use(desired_id):
                raise ValueError(f"{desired_id} is already in use")

    async def _async_wait_state_removed(
        self, entity_id: str, timeout: float = 3.0
    ) -> None:
        """Wait until entity_id has no state (a renamed entity re-registers)."""
        waited = 0.0
        while self.hass.states.get(entity_id) is not None and waited < timeout:
            await asyncio.sleep(0.1)
            waited += 0.1

    def energy_restart_seed(
        self, proxy: dict[str, Any], new_source: str, mode: str | None
    ) -> dict[str, Any] | None:
        """Return the energy starting state for switching an energy proxy's source.

        - "continue" (default): keep the proxy's total and only add increases
          from the new source, measured from its reading at the switch. The
          sensor already does this when it sees a new source, so no seed.
        - "zero": restart the total at 0 (HA statistics see a meter reset).
        - "source": restart at the new source's current reading (the jump is
          recorded as consumption in HA statistics).
        """
        mode = mode or "continue"
        if mode not in ("continue", "zero", "source"):
            raise ValueError(f"Unknown energy mode: {mode}")
        if mode == "continue":
            return None
        if not self.is_energy_proxy(proxy):
            raise ValueError("Energy modes only apply to energy proxies")

        state = self.hass.states.get(new_source)
        current = _parse_reading(state.state) if state is not None else None
        unit = (self.energy.get(proxy["id"]) or {}).get("unit") or entity_unit(
            self.hass, new_source
        )
        if mode == "source" and current is None:
            raise ValueError(f"{new_source} has no current reading to start from")
        return {
            "source_entity": new_source,
            # None: the first reading after the switch becomes the baseline.
            "baseline_raw": current,
            "accumulated": current if mode == "source" else 0.0,
            "unit": unit,
        }

    async def _async_energy_seed(
        self, source_entity: str, energy_start: dict[str, Any] | None
    ) -> tuple[dict[str, Any] | None, str | None]:
        """Return (initial energy state, object_id to take over) for a new proxy."""
        mode = (energy_start or {}).get("mode") or "zero"
        if mode == "zero":
            return None, None
        if not is_energy_entity(self.hass, source_entity):
            raise ValueError("Starting options are only available for energy sources")

        unit = entity_unit(self.hass, source_entity)
        state = self.hass.states.get(source_entity)
        current = _parse_reading(state.state) if state is not None else None

        if mode == "source":
            if current is None:
                raise ValueError(
                    f"{source_entity} has no current reading to start from"
                )
            return {
                "source_entity": source_entity,
                "baseline_raw": current,
                "accumulated": current,
                "unit": unit,
            }, None

        if mode == "history":
            old_entity = (energy_start or {}).get("entity_id")
            if not isinstance(old_entity, str) or not old_entity.startswith("sensor."):
                raise ValueError("Choose the old energy entity to continue from")
            if not unit:
                raise ValueError(f"{source_entity} has no unit of measurement")
            history = await async_get_energy_history(self.hass, old_entity, unit)
            if history is None:
                raise ValueError(f"No recorded {unit} energy history for {old_entity}")
            # A missing current reading is fine: the first reading becomes
            # the baseline and only increases after it are added.
            return {
                "source_entity": source_entity,
                "baseline_raw": current,
                "accumulated": history.last_value,
                "unit": unit,
            }, (old_entity.split(".", 1)[1] if history.seamless else None)

        raise ValueError(f"Unknown energy start mode: {mode}")

    async def async_update_proxy_source(
        self, proxy_id: str, new_source_entity: str
    ) -> dict[str, Any]:
        """Update the source entity of an existing proxy within its locked domain."""
        return await self.async_update_proxy(proxy_id, source_entity=new_source_entity)

    async def async_update_proxy(
        self,
        proxy_id: str,
        *,
        name: str | None = None,
        source_entity: str | None = None,
        energy_mode: str | None = None,
    ) -> dict[str, Any]:
        """Rename a proxy and/or change its source (within its locked domain).

        energy_mode applies when an energy proxy's source changes; see
        energy_restart_seed.
        """
        proxy = self._proxies.get(proxy_id)
        if not proxy:
            raise ValueError("Unknown proxy_id")

        clean_name = name.strip() if name is not None else None
        if clean_name is not None and not clean_name:
            raise ValueError("Proxy name is required")
        seed = None
        source_changed = (
            source_entity is not None and source_entity != proxy["source_entity"]
        )
        if source_changed:
            self.validate_proxy_source(proxy, source_entity)
            seed = self.energy_restart_seed(proxy, source_entity, energy_mode)

        changed = False
        if clean_name is not None and clean_name != proxy["name"]:
            proxy["name"] = clean_name
            changed = True
        if source_changed:
            proxy["source_entity"] = source_entity
            changed = True
        if not changed:
            return proxy

        if seed is not None:
            self.energy.set_start(proxy_id, seed)
        await self.async_save()

        entry = self.find_host_entry(proxy.get("virtual_device_id"))
        if entry is not None:
            await self.hass.config_entries.async_reload(entry.entry_id)

        return proxy

    def _follow_source_rename(self, old_source: str, new_source: str) -> set[str]:
        """Point proxies that mirror old_source at new_source.

        Returns the entry IDs hosting those proxies (they need a reload).
        """
        moved_entries: set[str] = set()
        for other in self._proxies.values():
            if other["source_entity"] != old_source:
                continue
            other["source_entity"] = new_source
            other_energy = self.energy.get(other["id"])
            if other_energy is not None:
                other_energy["source_entity"] = new_source
                self.energy.set(other["id"], other_energy)
            other_entry = self.find_host_entry(other.get("virtual_device_id"))
            if other_entry is not None:
                moved_entries.add(other_entry.entry_id)
        return moved_entries

    async def async_delete_proxy(
        self, proxy_id: str, rename_source: bool = False
    ) -> dict[str, Any] | None:
        """Remove a proxy definition and reload its virtual device entry.

        rename_source gives the source entity the deleted proxy's entity ID,
        so dashboards and automations that used the proxy follow the source
        (the reverse of taking over the source's ID when creating a proxy).

        Returns None if the proxy does not exist, else
        {"deleted": True, "source_entity": <the source's ID afterwards>}.
        """
        proxy = self._proxies.get(proxy_id)
        if not proxy:
            return None

        ent_reg = er.async_get(self.hass)
        entity_id = ent_reg.async_get_entity_id(
            proxy["domain"], DOMAIN, f"{proxy_id}_{proxy['domain']}"
        )
        source_entity = proxy["source_entity"]
        if rename_source:
            # Check before anything is removed.
            if entity_id is None:
                raise ValueError("The proxy has no entity ID for the source to take")
            if ent_reg.async_get(source_entity) is None:
                raise ValueError(
                    f"{source_entity} cannot be renamed: it has no unique ID, "
                    "so it is not in the entity registry"
                )
            if entity_id.split(".", 1)[0] != source_entity.split(".", 1)[0]:
                raise ValueError("The source and the proxy have different domains")

        del self._proxies[proxy_id]
        self.energy.remove(proxy_id)
        await self.async_save()

        # Reloading the entry does not remove the entity registry entry.
        if entity_id is not None:
            ent_reg.async_remove(entity_id)

        entry = self.find_host_entry(proxy.get("virtual_device_id"))
        if entry is not None:
            await self.hass.config_entries.async_reload(entry.entry_id)

        if rename_source and entity_id is not None:
            # The proxy's state is removed asynchronously; wait so the source
            # can take the freed entity ID.
            await self._async_wait_state_removed(entity_id)
            ent_reg.async_update_entity(source_entity, new_entity_id=entity_id)
            moved_entries = self._follow_source_rename(source_entity, entity_id)
            await self.async_save()
            for entry_id in moved_entries:
                await self.hass.config_entries.async_reload(entry_id)
            source_entity = entity_id

        return {"deleted": True, "source_entity": source_entity}

    def ensure_device_in_registry(
        self, entry: config_entries.ConfigEntry, dev_id: str
    ) -> None:
        """Register the virtual device in Home Assistant's Device Registry."""
        dev = self._devices.get(dev_id)
        if not dev:
            return
        dev_reg = dr.async_get(self.hass)
        dev_reg.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, dev_id)},
            name=dev["name"],
            manufacturer="Magnolia Proxy",
            model=dev.get("model", "Virtual Device"),
        )
