# Magnolia Proxy (`magnolia_proxy`)

**Magnolia Proxy** is a custom Home Assistant integration that lets you manage virtual proxy devices from a dedicated **Sidebar Panel**, while integrating natively into **Settings → Devices & services** just like Shelly or ESPHome:

1. **Sidebar Setup & Manager Panel (`Magnolia Proxy`):**
   - Create **Virtual Devices** (`POST /api/magnolia_proxy/devices`).
   - Create domain-locked **Proxy Entities** (`switch`, `light`, `fan`, `cover`, `lock`, `siren`, `valve`, `binary_sensor` (on/off and device class, read-only), and `sensor` mirroring any source sensor, with delta-accumulating energy) attached to any Virtual Device (`POST /api/magnolia_proxy/proxies`).
   - When the source is an energy sensor, choose where the new counter starts: **from 0**, **at the source's current reading**, or **continuing an old entity's recorded history** (`energy_start`). Continuing history starts at the old entity's last recorded value; if that entity ID is free and its recent statistics still exist (within the recorder's keep period, 10 days by default), the proxy takes over the entity ID so its Energy dashboard statistics continue without a gap.
   - **Icon:** a new proxy copies the source's current icon (a custom icon on the source, if it has one) when it is created. It is a one-time copy, so you can change the proxy's icon afterwards in Home Assistant.
   - **Take over the source's name and ID:** when creating a proxy, the panel can give it the source's name and entity ID (`entity_id`) while the source is renamed with a suffix such as `_source` (`rename_source`). Both IDs are filled in automatically and stay editable. Dashboards and automations that used the old ID then follow the proxy. The source must be in the entity registry (have a unique ID) to be renamed.
   - **Source renames are followed:** if you change a source's entity ID in Home Assistant (e.g. **Settings → Entities**), every proxy using it switches to the new ID right away, and the change is kept after a restart. Energy proxies keep their totals.
   - **Give the source the deleted proxy's ID:** when deleting a proxy, the panel offers to rename the source entity to the proxy's entity ID (`DELETE /api/magnolia_proxy/proxies/{id}?rename_source=1`), so dashboards and automations that used the proxy follow the source instead of breaking. This undoes a takeover; the option is pre-selected when the source's ID is the proxy's ID plus `_source`. The source must be in the entity registry to be renamed.
   - **Proxy an existing device:** when adding a virtual device, choose **Proxy an existing device** to create a proxy for each of a real device's supported entities in one go (`POST /api/magnolia_proxy/devices` with `copy_from`). Options: take over the device's name (the real device is renamed "<name> Source"), take over the entities' names and IDs (sources are renamed with `_source`), and for energy sensors continue at the source's reading or start from 0. The new device is added to Home Assistant right away.
   - **Move proxies between devices:** add unassigned proxies to a device from its page (**Add unassigned proxies**), drag a proxy onto a device in the sidebar, or use **Move to…** on a proxy (`PATCH /api/magnolia_proxy/proxies/{id}` with `virtual_device_id`, `null` to unassign). The proxy keeps its entity ID, history and energy total; only its Home Assistant device changes.
   - **Delete a device but keep its entities:** deleting a virtual device offers **Keep entities**, which moves its proxies to Unassigned (keeping entity IDs, history and totals) and deletes only the device (`DELETE /api/magnolia_proxy/devices/{id}?keep_proxies=1`). **Delete** removes the device and its proxies.
   - **Area:** choose a Home Assistant area when adding a virtual device (`area_id`); with **Proxy an existing device** it defaults to the real device's area. Afterwards, change it on the device's page in Home Assistant. The sidebar groups virtual devices by area, and the Unassigned page groups its proxies by the area set on each entity. A virtual device's page groups its proxies by the real device their source entity belongs to; each group collapses, and the panel remembers collapsed groups in that browser.
   - **Order proxies and pick the main entity:** a toggle at the top of a virtual device's proxy list switches between **Grouped** (by source device, as above) and **Manual**. In **Manual**, reorder the proxies with the arrow buttons or by dragging them up and down; the top proxy is the device's **main entity** and is highlighted. The order is saved on the device (`PATCH /api/magnolia_proxy/devices/{id}` with `proxy_order`, every proxy of the device once), and `main_proxy_id` in the device data names the main entity. Proxies added to the device later go to the end. The panel remembers the chosen view in that browser.
   - **Rename a virtual device** from its page in the panel (`PATCH /api/magnolia_proxy/devices/{id}`). This also updates its Home Assistant device page and config entry title. Proxy entity IDs stay the same.
   - Run **Replace Device** directly from the sidebar with automatic matching and a conflict-resolution modal (`POST /api/magnolia_proxy/replace_device`).
   - **Keep on/off states:** a replace reloads the device, so a switch, light or fan proxy comes back with the new source's state without an on→off change that automations could react to. When the old and new states differ, the replace offers to turn the new source on/off to match (`match_state`); when the old device no longer reports a state, it offers to turn the new source on.
   - **After a replace**, the panel shows each changed proxy's state before and after, the automations and scripts that use it, and those that still refer to the old device or its entities directly (a replace doesn't redirect those), with links to their editors.
   - When the new device only has a switch (relays, smart plugs), a `light`, `fan`, `cover`, `lock`, `siren` or `valve` proxy can take it: the switch is wrapped in a Home Assistant "Show as" (`switch_as_x`) helper of the proxy's type, which becomes the source.
2. **Native Home Assistant Discovery (`async_step_integration_discovery`):**
   - Whenever you create a new Virtual Device in the sidebar panel, Magnolia Proxy triggers a native Home Assistant discovery flow (`SOURCE_INTEGRATION_DISCOVERY`).
   - The new Virtual Device immediately appears under **Settings → Devices & services → Discovered** (and on the **Magnolia Proxy** integration card) with a **Configure / Add** button so you can add it as a standard integration config entry—just like discovering a new Shelly device.
3. **Standard Integration & Device View:**
   - Each added Virtual Device has its own config entry under **Magnolia Proxy** in **Settings → Devices & services**, showing its device page and proxy entities. Virtual devices are managed, and replaced, from the sidebar panel; there is no **Configure** dialog.

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
