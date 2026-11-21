# Magnolia Proxy (`v2.1.0`) — Codebase Review

## 1. Architecture & Strengths

- **Clean Hub + Virtual Device Discovery Model**: Using a single Hub config entry ([`custom_components/magnolia_proxy/__init__.py`](custom_components/magnolia_proxy/__init__.py#L145-L165)) alongside `SOURCE_INTEGRATION_DISCOVERY` flows ([`custom_components/magnolia_proxy/storage.py`](custom_components/magnolia_proxy/storage.py#L198-L217), [`custom_components/magnolia_proxy/config_flow.py`](custom_components/magnolia_proxy/config_flow.py#L65-L98)) gives virtual devices first-class config entries and device pages in Home Assistant.
- **Persistent HTTP / Store Lifecycle**: Keeping a single `MagnoliaProxyStore` instance in `hass.data[DOMAIN]["store"]` and registering static paths/views once per Home Assistant runtime ([`custom_components/magnolia_proxy/__init__.py`](custom_components/magnolia_proxy/__init__.py#L42-L84)) avoids `aiohttp` route duplication across config entry reloads.
- **Loop & Domain-Lock Validation**: `validate_source_entity` ([`custom_components/magnolia_proxy/storage.py`](custom_components/magnolia_proxy/storage.py#L31-L55)) prevents proxy-to-proxy recursion and enforces domain immutability.
- **Standalone Dev Simulator**: [`dev/simulator.html`](dev/simulator.html) provides an in-memory mock backend for iterating on the custom panel without a full Home Assistant instance.

---

## 2. High-Priority Bugs & Logic Issues

### 2.1. Auto-mapping sensor proxies to the wrong `device_class` when a target device lacks that class
- **Location**: [`custom_components/magnolia_proxy/device_mapping.py` (lines 91–115)](custom_components/magnolia_proxy/device_mapping.py#L91-L115)
- **Problem**: When `locked_domain == "sensor"` and `source_dc` is known (e.g. `energy`), `class_matched` filters `domain_candidates` by `device_class`. However, line 101 falls back to all `domain_candidates` when `class_matched` is empty:
  ```python
  candidates = class_matched if class_matched else domain_candidates
  if len(candidates) == 1:
      # Auto-mapped with conflict_reason=None!
  ```
  If a virtual device has an **Energy** proxy and the replacement physical device only has a single **Power** (or **Voltage**) sensor, `class_matched` is `[]`, `candidates` falls back to `["sensor.new_plug_power"]` (length 1), and `plan_device_replacement` silently **auto-maps the Energy proxy to the Power sensor** without flagging a conflict.
- **Recommendation**: When `locked_domain == "sensor"` and `source_dc` is not `None`, only auto-resolve (`conflict_reason=None`) if `len(class_matched) == 1`. If `class_matched` is empty, set `conflict_reason = "no_matching_entity"` (or `"device_class_mismatch"`) and `selected_source_entity = None` while still offering `domain_candidates` for manual selection.

### 2.2. `ProxyLight` fallback `supported_color_modes` inference short-circuits after `brightness`
- **Location**: [`custom_components/magnolia_proxy/light.py` (lines 134–191)](custom_components/magnolia_proxy/light.py#L134-L191)
- **Problem**: When a source light does not expose `supported_color_modes` (`parsed_modes` starts empty), lines 142–186 check `if not parsed_modes:` sequentially for each attribute:
  1. Line 145 checks `ATTR_BRIGHTNESS` first and adds `ColorMode.BRIGHTNESS` to `parsed_modes`.
  2. Lines 153 (`HS`), 161 (`XY`), 167 (`RGB`), and 183 (`COLOR_TEMP`) also guard with `if not parsed_modes:`, which is now `False` whenever `brightness` is present.

  As a result, any fallback color/color-temp light that reports brightness is misclassified as brightness-only (`{ColorMode.BRIGHTNESS}`). Additionally, lines 169–170 never infer `ColorMode.RGBW` or `ColorMode.RGBWW` when `parsed_modes` is empty.
- **Recommendation**: Collect inferred color modes across all present color attributes (`HS`, `XY`, `RGB`, `RGBW`, `RGBWW`, `COLOR_TEMP`), and only fall back to `{ColorMode.BRIGHTNESS}` (or `{ColorMode.ONOFF}`) if no color/color-temp modes were inferred (since Home Assistant forbids mixing `ColorMode.BRIGHTNESS` or `ColorMode.ONOFF` with color modes in `supported_color_modes`).

### 2.3. Deleting a proxy leaks orphaned entities in Home Assistant's `EntityRegistry`
- **Location**: [`custom_components/magnolia_proxy/storage.py` (lines 349–360)](custom_components/magnolia_proxy/storage.py#L349-L360)
- **Problem**: `async_delete_proxy` removes the proxy from `MagnoliaProxyStore` and reloads the hosting `ConfigEntry`. In Home Assistant, reloading a config entry unloads the runtime entity from `hass.states`, **but does not remove its entry from the `EntityRegistry`**. The deleted proxy remains permanently in the Entity Registry as an unavailable/restored entity (especially noticeable on the Hub entry for unassigned proxies, which is never removed).
- **Recommendation**: Look up the entity in `er.async_get(self.hass)` via `async_get_entity_id(proxy["domain"], DOMAIN, f"{proxy_id}_{proxy['domain']}")` and call `ent_reg.async_remove(entity_id)` before reloading the entry.

### 2.4. Energy proxy delta tracker treats minor downward float jitter as a full counter reset
- **Location**: [`custom_components/magnolia_proxy/sensor.py` (lines 287–301)](custom_components/magnolia_proxy/sensor.py#L287-L301)
- **Problem**: In `_process_energy_state`:
  ```python
  elif converted_val >= es.baseline_raw:
      ...
  else:
      if converted_val > 0:
          es.accumulated += converted_val
      es.baseline_raw = converted_val
  ```
  If a smart plug or inverter reports a tiny downward floating-point fluctuation or rounding correction (e.g. `500.002 kWh` -> `500.001 kWh`), `converted_val < es.baseline_raw` triggers the `else` branch and adds **`+500.001 kWh`** to `es.accumulated`, instantly doubling the lifetime energy reading.
- **Recommendation**: Only treat a decrease as a counter reset when the value drops significantly (e.g. similar to Home Assistant's `TOTAL_INCREASING` heuristic: `converted_val < es.baseline_raw * 0.9` or near zero), and for small downward jitter either ignore the negative delta or update `baseline_raw` without adding the full cumulative reading.

### 2.5. Non-electrical `sensor` sources are allowed everywhere but partially broken in `ProxySensor`
- **Location**: [`custom_components/magnolia_proxy/storage.py` (lines 37–55)](custom_components/magnolia_proxy/storage.py#L37-L55), [`custom_components/magnolia_proxy/api.py` (lines 87–102)](custom_components/magnolia_proxy/api.py#L87-L102), [`custom_components/magnolia_proxy/sensor.py` (lines 32–38)](custom_components/magnolia_proxy/sensor.py#L32-L38)
- **Problem**:
  - `validate_source_entity`, `MagnoliaStateView`, and `list_real_devices` allow **any** `sensor.*` entity (temperature, humidity, battery, enum/text sensors, etc.) to be chosen as a proxy source.
  - However, `ProxySensor._detect_device_class` ([`custom_components/magnolia_proxy/sensor.py`](custom_components/magnolia_proxy/sensor.py#L170-L206)) restricts `_attr_device_class` to `{POWER, VOLTAGE, CURRENT, FREQUENCY, ENERGY}` and strips `device_class` from all other numeric sensors (e.g. temperature/humidity/battery).
  - If a non-numeric sensor (string/enum/timestamp) is chosen, `_parse_float` returns `None` and the proxy sensor stays permanently `unavailable`.
- **Recommendation**: Either:
  1. Restrict selectable `sensor` source entities in `validate_source_entity`, `api.py`, and `device_mapping.py` to the supported electrical device classes/units, **or**
  2. Allow `ProxySensor` to mirror any valid `SensorDeviceClass` (and `state_class`) for general numeric sensors while keeping the custom accumulation logic for `SensorDeviceClass.ENERGY`.

---

## 3. Medium-Priority Edge Cases & UX Issues

### 3.1. Deleting an unconfigured Virtual Device leaves an active discovery notification in HA
- **Location**: [`custom_components/magnolia_proxy/storage.py` (lines 251–271)](custom_components/magnolia_proxy/storage.py#L251-L271), [`custom_components/magnolia_proxy/config_flow.py` (lines 84–98)](custom_components/magnolia_proxy/config_flow.py#L84-L98)
- **Problem**: If a user creates a virtual device (which starts a `SOURCE_INTEGRATION_DISCOVERY` config flow) and deletes it from the sidebar panel before adding it in Home Assistant, `async_delete_device` does not abort the pending discovery flow. The deleted device remains under **Settings → Devices & services → Discovered**, and confirming it creates a config entry that immediately fails `async_setup_entry` (`return False`).
- **Recommendation**: In `async_delete_device`, abort any in-progress flow for `unique_id == f"{DOMAIN}_{dev_id}"` via `hass.config_entries.flow.async_progress_by_handler(DOMAIN)`, and in `async_step_discovery_confirm`, verify the device still exists in `store` before calling `async_create_entry`.

### 3.2. Frontend 10-second polling can overwrite user input while `callApi` is in flight
- **Location**: [`custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js` (lines 50–69)](custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js#L50-L69)
- **Problem**: `_autoRefresh()` checks `this.shadowRoot.activeElement?.matches?.("input, select")` *before* starting the async `this._fetchState()` request. If the user focuses an input while the network request is in flight (or if `_autoRefresh` runs while a button is focused), `_render()` replaces `this.shadowRoot.innerHTML` when the response arrives, dropping focus.
- **Recommendation**: Re-check `this.shadowRoot.activeElement?.matches?.("input, select")` (and `!this._replaceModal`) right before calling `this._render()` after the `await` in `_autoRefresh()`.

### 3.3. Clearing `source_entity` input on `focus` prevents inline text editing
- **Location**: [`custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js` (lines 894–903, 991–1000)](custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js#L991-L1000)
- **Problem**: To show all `<datalist>` options, focusing the `source_entity` `<input>` unconditionally sets `input.value = ""`. This makes it impossible to click into the field and edit a character (e.g. changing `switch.relay_1` to `switch.relay_2`) without retyping from scratch.

### 3.4. Double reload in `MagnoliaProxyDeviceOptionsFlow`
- **Location**: [`custom_components/magnolia_proxy/config_flow.py` (lines 107–189)](custom_components/magnolia_proxy/config_flow.py#L107-L189)
- **Problem**: `MagnoliaProxyDeviceOptionsFlow` subclasses `OptionsFlowWithReload`, while `apply_proxy_mappings` ([`custom_components/magnolia_proxy/device_mapping.py`](custom_components/magnolia_proxy/device_mapping.py#L180-L186)) already triggers `hass.config_entries.async_reload(entry.entry_id)`. Subclassing plain `OptionsFlow` avoids redundant reload behavior.

---

## 4. Low-Priority / Code Quality & HACS Readiness

- **Leftover test naming in frontend panel**: [`custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js` (line 2)](custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js#L2) defines `const DEVICE_TEST_MODEL = "Magnolia Virtual Device"` and line 722 uses `<table class="device-test">`, whereas the backend and service schemas default `model` to `"Virtual Device"`.
- **Replace Device modal candidate labels**: In [`custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js` (lines 848–853)](custom_components/magnolia_proxy/frontend/magnolia-proxy-panel.js#L848-L853), the candidate `<option>` elements only display the raw `entity_id` (`cand`), unlike [`custom_components/magnolia_proxy/config_flow.py` (lines 196–202)](custom_components/magnolia_proxy/config_flow.py#L196-L202) which shows `{friendly_name} ({entity_id})`. Looking up the friendly name from `this._state.source_entities` in the modal would make conflict resolution easier to read.
- **Config Entry `VERSION = 2` without `async_migrate_entry`**: [`custom_components/magnolia_proxy/config_flow.py` (line 44)](custom_components/magnolia_proxy/config_flow.py#L44) sets `VERSION = 2`, but [`custom_components/magnolia_proxy/__init__.py`](custom_components/magnolia_proxy/__init__.py) does not define `async_migrate_entry`. If any `VERSION = 1` entries exist on upgrade, Home Assistant will fail to set them up.
- **Missing CI validation & unit tests**: Adding `.github/workflows/validate.yml` running `homeassistant/hassfest` and `hacs/action`, along with `pytest-homeassistant-custom-component` tests for `plan_device_replacement` and `ProxySensor._process_energy_state`, would protect the core mapping and energy accumulation logic.
