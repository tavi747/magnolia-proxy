"""Persistent storage, virtual device registry, and HA discovery triggers."""
from __future__ import annotations

from typing import Any
from uuid import uuid4

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
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


ENERGY_SAVE_DELAY = 30


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


class EnergyStateStore:
    """Single shared, debounced store for energy accumulation state."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the energy state store."""
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, ENERGY_STORAGE_KEY
        )
        self._data: dict[str, dict[str, Any]] = {}

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

    def remove(self, proxy_id: str) -> None:
        """Drop energy state for a deleted proxy."""
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

        return True

    async def async_create_proxy(
        self,
        name: str,
        source_entity: str,
        virtual_device_id: str | None,
    ) -> dict[str, Any]:
        """Create a domain-locked proxy, optionally attached to a virtual device."""
        virtual_device_id = virtual_device_id or None
        if virtual_device_id is not None and virtual_device_id not in self._devices:
            raise ValueError("Unknown virtual_device_id")

        source_domain = validate_source_entity(self.hass, source_entity)

        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Proxy name is required")

        proxy_id = f"prx_{uuid4().hex[:12]}"
        record = {
            "id": proxy_id,
            "name": clean_name,
            "domain": source_domain,
            "source_entity": source_entity,
            "virtual_device_id": virtual_device_id,
        }
        self._proxies[proxy_id] = record
        await self.async_save()

        entry = self.find_host_entry(virtual_device_id)
        if entry is not None:
            await self.hass.config_entries.async_reload(entry.entry_id)

        return record

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
    ) -> dict[str, Any]:
        """Rename a proxy and/or change its source (within its locked domain)."""
        proxy = self._proxies.get(proxy_id)
        if not proxy:
            raise ValueError("Unknown proxy_id")

        clean_name = name.strip() if name is not None else None
        if clean_name is not None and not clean_name:
            raise ValueError("Proxy name is required")
        if source_entity is not None:
            validate_source_entity(self.hass, source_entity, proxy["domain"])

        changed = False
        if clean_name is not None and clean_name != proxy["name"]:
            proxy["name"] = clean_name
            changed = True
        if source_entity is not None and source_entity != proxy["source_entity"]:
            proxy["source_entity"] = source_entity
            changed = True
        if not changed:
            return proxy

        await self.async_save()

        entry = self.find_host_entry(proxy.get("virtual_device_id"))
        if entry is not None:
            await self.hass.config_entries.async_reload(entry.entry_id)

        return proxy

    async def async_delete_proxy(self, proxy_id: str) -> bool:
        """Remove a proxy definition and reload its virtual device entry."""
        proxy = self._proxies.pop(proxy_id, None)
        if not proxy:
            return False
        self.energy.remove(proxy_id)
        await self.async_save()

        entry = self.find_host_entry(proxy.get("virtual_device_id"))
        if entry is not None:
            await self.hass.config_entries.async_reload(entry.entry_id)
        return True

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
