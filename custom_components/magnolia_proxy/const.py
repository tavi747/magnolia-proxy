"""Constants for the Magnolia Proxy integration."""

from homeassistant.const import Platform

DOMAIN = "magnolia_proxy"

ENTRY_TYPE_HUB = "hub"
ENTRY_TYPE_DEVICE = "device"

CONF_ENTRY_TYPE = "entry_type"
CONF_VIRTUAL_DEVICE_ID = "virtual_device_id"
CONF_DEVICE_NAME = "device_name"
CONF_DEVICE_MODEL = "device_model"
CONF_SOURCE_ENTITY = "source_entity"
CONF_PROXY_DOMAIN = "proxy_domain"
CONF_REPLACE_TARGET_DEVICE = "target_device_id"

PANEL_URL_PATH = "magnolia-proxy"
PANEL_TITLE = "Magnolia Proxy"
PANEL_ICON = "mdi:lan-connect"
STATIC_BASE_URL = "/magnolia_proxy_static"

ATTR_NAME = "name"
ATTR_MODEL = "model"
ATTR_VIRTUAL_DEVICE_ID = "virtual_device_id"
ATTR_TARGET_DEVICE_ID = "target_device_id"
ATTR_MAPPINGS = "mappings"

SERVICE_CREATE_DEVICE = "create_device"
SERVICE_REPLACE_DEVICE = "replace_device"

STORAGE_KEY = f"{DOMAIN}_store"
ENERGY_STORAGE_KEY = f"{DOMAIN}_energy_state"
STORAGE_VERSION = 2

PROXY_PLATFORMS: list[Platform] = [
    Platform.SWITCH,
    Platform.LIGHT,
    Platform.FAN,
    Platform.SENSOR,
]
SUPPORTED_PLATFORMS: list[Platform] = [
    Platform.BUTTON,
    *PROXY_PLATFORMS,
]
SUPPORTED_DOMAINS: list[str] = [platform.value for platform in PROXY_PLATFORMS]
