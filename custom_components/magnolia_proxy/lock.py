"""Lock platform for Magnolia Proxy."""
from __future__ import annotations

from typing import Any

from homeassistant.components.lock import (
    ATTR_CHANGED_BY,
    ATTR_CODE,
    ATTR_CODE_FORMAT,
    LockEntity,
    LockEntityFeature,
    LockState,
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
    """Set up all lock proxies attached to this Virtual Device entry."""
    store: MagnoliaProxyStore = hass.data[DOMAIN]["store"]
    async_add_entities(
        ProxyLock(hass, entry, proxy_def)
        for proxy_def in store.proxies_for_entry(entry)
        if proxy_def["domain"] == "lock"
    )


class ProxyLock(BaseProxyEntity, LockEntity):
    """Proxy entity for the lock domain."""

    _attr_supported_features = LockEntityFeature(0)

    @callback
    def _apply_source_state(self, state: State | None) -> None:
        """Mirror the lock state, code format and features."""
        super()._apply_source_state(state)
        st = state.state if state and self._attr_available else None
        self._attr_is_jammed = st == LockState.JAMMED
        self._attr_is_opening = st == LockState.OPENING
        self._attr_is_locking = st == LockState.LOCKING
        self._attr_is_open = st == LockState.OPEN
        self._attr_is_unlocking = st == LockState.UNLOCKING
        self._attr_is_locked = (
            st == LockState.LOCKED
            if st in (LockState.LOCKED, LockState.UNLOCKED)
            else None
        )
        attrs = state.attributes if state else {}
        code_format = attrs.get(ATTR_CODE_FORMAT)
        self._attr_code_format = code_format if isinstance(code_format, str) else None
        changed_by = attrs.get(ATTR_CHANGED_BY)
        self._attr_changed_by = changed_by if isinstance(changed_by, str) else None
        self._attr_supported_features = source_features(state, LockEntityFeature)

    def _code(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        """Return the code to forward, if one was given."""
        return {ATTR_CODE: kwargs[ATTR_CODE]} if kwargs.get(ATTR_CODE) else {}

    async def async_lock(self, **kwargs: Any) -> None:
        """Lock the source lock."""
        await self._async_call_source_service("lock", **self._code(kwargs))

    async def async_unlock(self, **kwargs: Any) -> None:
        """Unlock the source lock."""
        await self._async_call_source_service("unlock", **self._code(kwargs))

    async def async_open(self, **kwargs: Any) -> None:
        """Open (unlatch) the source lock."""
        await self._async_call_source_service("open", **self._code(kwargs))
