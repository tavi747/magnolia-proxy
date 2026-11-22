"""Config flow supporting Hub setup and HA Integration Discovery.

There is no options flow: virtual devices are managed (and replaced) from the
Magnolia Proxy sidebar panel.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import (
    CONF_DEVICE_MODEL,
    CONF_DEVICE_NAME,
    CONF_ENTRY_TYPE,
    CONF_VIRTUAL_DEVICE_ID,
    DOMAIN,
    ENTRY_TYPE_DEVICE,
    ENTRY_TYPE_HUB,
)
from .storage import MagnoliaProxyStore


class MagnoliaProxyConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle manual Hub setup and automatic Virtual Device discovery."""

    VERSION = 2

    def __init__(self) -> None:
        """Initialize discovery state."""
        self._discovered_device: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Set up the Magnolia Proxy Hub & Sidebar Panel."""
        await self.async_set_unique_id(f"{DOMAIN}_hub")
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="Magnolia Proxy Hub",
                data={CONF_ENTRY_TYPE: ENTRY_TYPE_HUB},
            )

        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    async def async_step_integration_discovery(
        self, discovery_info: dict[str, Any]
    ) -> ConfigFlowResult:
        """Handle a newly created Virtual Device discovered by Home Assistant."""
        vdev_id = discovery_info[CONF_VIRTUAL_DEVICE_ID]
        dev_name = discovery_info.get(CONF_DEVICE_NAME, vdev_id)

        await self.async_set_unique_id(f"{DOMAIN}_{vdev_id}")
        self._abort_if_unique_id_configured()

        self._discovered_device = {
            CONF_ENTRY_TYPE: ENTRY_TYPE_DEVICE,
            CONF_VIRTUAL_DEVICE_ID: vdev_id,
            CONF_DEVICE_NAME: dev_name,
            CONF_DEVICE_MODEL: discovery_info.get(CONF_DEVICE_MODEL, "Virtual Device"),
        }
        self.context["title_placeholders"] = {"name": dev_name}
        return await self.async_step_discovery_confirm()

    async def async_step_discovery_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm adding the discovered Virtual Device to Home Assistant."""
        dev_name = self._discovered_device.get(CONF_DEVICE_NAME, "Virtual Device")
        if user_input is not None:
            store: MagnoliaProxyStore | None = self.hass.data.get(DOMAIN, {}).get(
                "store"
            )
            vdev_id = self._discovered_device.get(CONF_VIRTUAL_DEVICE_ID)
            if store is None or store.get_device(vdev_id) is None:
                return self.async_abort(reason="device_not_found")
            return self.async_create_entry(
                title=dev_name,
                data=self._discovered_device,
            )

        return self.async_show_form(
            step_id="discovery_confirm",
            description_placeholders={"name": dev_name},
        )
