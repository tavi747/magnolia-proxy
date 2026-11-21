# Magnolia Proxy (`magnolia_proxy`)

**Magnolia Proxy** is a custom Home Assistant integration that lets you manage virtual proxy devices from a dedicated **Sidebar Panel**, while integrating natively into **Settings → Devices & services** just like Shelly or ESPHome:

1. **Sidebar Setup & Manager Panel (`Magnolia Proxy`):**
   - Create **Virtual Devices** (`POST /api/magnolia_proxy/devices`).
   - Create domain-locked **Proxy Entities** (`switch`, `light`, `fan`, and `sensor` mirroring any source sensor, with delta-accumulating energy) attached to any Virtual Device (`POST /api/magnolia_proxy/proxies`).
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
