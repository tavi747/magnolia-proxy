# Magnolia Proxy (`magnolia_proxy`)

**Magnolia Proxy** is a custom Home Assistant integration that lets you manage virtual proxy devices from a dedicated **Sidebar Panel**, while integrating natively into **Settings → Devices & services** just like Shelly or ESPHome:

1. **Sidebar Setup & Manager Panel (`Magnolia Proxy`):**
   - Create **Virtual Devices** (`POST /api/magnolia_proxy/devices`).
   - Create domain-locked **Proxy Entities** (`switch`, `light`, `fan`, and `sensor` mirroring any source sensor, with delta-accumulating energy) attached to any Virtual Device (`POST /api/magnolia_proxy/proxies`).
   - When the source is an energy sensor, choose where the new counter starts: **from 0**, **at the source's current reading**, or **continuing an old entity's recorded history** (`energy_start`). Continuing history starts at the old entity's last recorded value; if that entity ID is free and its recent statistics still exist (within the recorder's keep period, 10 days by default), the proxy takes over the entity ID so its Energy dashboard statistics continue without a gap.
   - **Take over the source's name and ID:** when creating a proxy, the panel can give it the source's name and entity ID (`entity_id`) while the source is renamed with a suffix such as `_source` (`rename_source`). Both IDs are filled in automatically and stay editable. Dashboards and automations that used the old ID then follow the proxy. The source must be in the entity registry (have a unique ID) to be renamed.
   - Run **Replace Device** directly from the sidebar with automatic matching and a conflict-resolution modal (`POST /api/magnolia_proxy/replace_device`).
2. **Native Home Assistant Discovery (`async_step_integration_discovery`):**
   - Whenever you create a new Virtual Device in the sidebar panel, Magnolia Proxy triggers a native Home Assistant discovery flow (`SOURCE_INTEGRATION_DISCOVERY`).
   - The new Virtual Device immediately appears under **Settings → Devices & services → Discovered** (and on the **Magnolia Proxy** integration card) with a **Configure / Add** button so you can add it as a standard integration config entry—just like discovering a new Shelly device.
3. **Standard Integration & Device View:**
   - Each added Virtual Device has its own config entry under **Magnolia Proxy** in **Settings → Devices & services**, showing its device page, proxy entities, and **Configure** options.

## Requirements
- Home Assistant 2025.8.0 or newer.
- The sidebar panel, REST API, and services are restricted to administrators.

## Installation

### HACS (Custom Repository)
1. Open **HACS → Integrations → ⋮ → Custom repositories**.
2. Add `https://github.com/tavi747/magnolia-proxy` as **Integration**.
3. Install **Magnolia Proxy** and restart Home Assistant.

### Manual Installation
1. Copy `custom_components/magnolia_proxy` into your Home Assistant `config/custom_components/` directory.
2. Restart Home Assistant.
3. Go to **Settings → Devices & services → Add integration** and search for **Magnolia Proxy** to initialize the Magnolia Proxy Manager & Sidebar Panel.
