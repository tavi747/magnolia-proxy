// Model label given to every device created from the panel.
const DEVICE_TEST_MODEL = "Magnolia Virtual Device";
// Expand/draft key for the group of proxies without a virtual device.
const NO_DEVICE_KEY = "__no_device__";

class MagnoliaProxyPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._state = { devices: [], real_devices: [], source_entities: [] };
    this._loaded = false;
    this._replaceModal = null;
    this._error = null;
    this._refreshTimer = null;
    // proxy_id -> edited (unsaved) source entity in the Entities tab.
    this._pendingSources = {};
    // proxy_id -> energy counter mode for a pending source change of an
    // energy proxy: "continue" (default) | "zero" | "source".
    this._pendingEnergyModes = {};
    // proxy_id -> edited (unsaved) proxy name in the Entities tab.
    this._pendingNames = {};
    // Drafts for inline "new proxy" rows, keyed by table:
    // "dev:<virtual_device_id>" or NO_DEVICE_KEY.
    this._newProxies = {};
    // Virtual device ids (and NO_DEVICE_KEY) currently expanded.
    this._expandedDevices = new Set();
    // Draft for the inline "new device" row.
    this._newDevice = { name: "" };
    // unit -> { loading, recorder, items, error }: recorded energy history a
    // new energy proxy can continue (loaded on demand).
    this._energyHistory = {};
  }

  connectedCallback() {
    if (!this._refreshTimer) {
      this._refreshTimer = setInterval(() => this._autoRefresh(), 10000);
    }
  }

  disconnectedCallback() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded) {
      this._loaded = true;
      this._fetchState();
    }
  }

  _isUserBusy() {
    // A modal holds in-progress selections, and re-rendering drops input focus.
    return (
      !!this._replaceModal ||
      !!this.shadowRoot.activeElement?.matches?.("input, select")
    );
  }

  _autoRefresh() {
    if (this._isUserBusy()) return;
    this._fetchState({ background: true });
  }

  async _fetchState({ background = false } = {}) {
    if (!this._hass) return;
    try {
      const data = await this._hass.callApi("GET", "magnolia_proxy/state");
      this._state = data;
      this._prunePendingSources();
    } catch (err) {
      console.error("Magnolia Proxy fetch error:", err);
      this._error = `Failed to load state: ${this._errorMessage(err)}`;
    }
    // The user may have started typing or opened a modal while the request was
    // in flight; keep the new state and let the next render pick it up.
    if (background && this._isUserBusy()) return;
    this._render();
  }

  _errorMessage(err) {
    return err?.body?.message || err?.message || String(err);
  }

  async _run(action) {
    try {
      this._error = null;
      await action();
    } catch (err) {
      console.error("Magnolia Proxy error:", err);
      this._error = this._errorMessage(err);
      this._render();
    }
  }

  async _createDevice(name, model) {
    const res = await this._hass.callApi("POST", "magnolia_proxy/devices", {
      name,
      model: model || "Virtual Device",
    });
    await this._fetchState();
    return res?.device;
  }

  async _createDeviceInline() {
    const nd = this._newDevice;
    const device = await this._createDevice(nd.name.trim(), DEVICE_TEST_MODEL);
    this._newDevice = { name: "" };
    // Open the new device so its first entity can be added right away.
    if (device?.id) this._expandedDevices.add(device.id);
    this._render();
  }

  async _deleteDevice(deviceId) {
    this._expandedDevices.delete(deviceId);
    delete this._newProxies[`dev:${deviceId}`];
    await this._hass.callApi("DELETE", `magnolia_proxy/devices/${deviceId}`);
    await this._fetchState();
  }

  async _rediscoverDevice(deviceId) {
    await this._hass.callApi("POST", `magnolia_proxy/devices/${deviceId}`);
    await this._fetchState();
  }

  async _createProxy(virtualDeviceId, name, sourceEntity, energyStart = null) {
    const body = {
      virtual_device_id: virtualDeviceId,
      name,
      source_entity: sourceEntity,
    };
    if (energyStart) body.energy_start = energyStart;
    await this._hass.callApi("POST", "magnolia_proxy/proxies", body);
    await this._fetchState();
  }

  async _deleteProxy(proxyId) {
    await this._hass.callApi("DELETE", `magnolia_proxy/proxies/${proxyId}`);
    delete this._pendingSources[proxyId];
    delete this._pendingNames[proxyId];
    await this._fetchState();
  }

  async _updateProxy(proxyId, changes) {
    const proxy = this._findProxy(proxyId);
    const body = { ...changes };
    if (changes.source_entity && proxy?.is_energy) {
      body.energy_mode = this._pendingEnergyModes[proxyId] || "continue";
    }
    await this._hass.callApi("PATCH", `magnolia_proxy/proxies/${proxyId}`, body);
    delete this._pendingSources[proxyId];
    delete this._pendingNames[proxyId];
    delete this._pendingEnergyModes[proxyId];
    await this._fetchState();
  }

  // What each energy mode does when an energy proxy's source is replaced.
  _energyModeHint(mode) {
    if (mode === "zero") {
      return "The total restarts at 0. Energy statistics treat this as a meter reset, so there is no spike.";
    }
    if (mode === "source") {
      return "The total jumps to the new source's reading. The Energy dashboard records that jump as consumption.";
    }
    return "Keeps the proxy's total and adds increases from the new source, measured from its reading at the switch. Energy statistics continue without a gap.";
  }

  _energyModeOptions({ proxyValue, newReading }) {
    return [
      {
        value: "continue",
        label: `Continue from proxy value${proxyValue ? ` (${proxyValue})` : ""}`,
      },
      { value: "zero", label: "Start fresh from 0" },
      {
        value: "source",
        label:
          newReading === null
            ? "Take the new source's reading (no reading now)"
            : `Take the new source's reading${newReading ? ` (${newReading})` : ""}`,
        disabled: newReading === null,
      },
    ];
  }

  // A radio group; groupAttr (e.g. 'data-x="id"') marks the wrapper so its
  // "change" events and checked value can be found.
  _renderRadioGroup(name, groupAttr, current, options) {
    const esc = (v) => this._escapeHtml(v);
    return `
                <div class="radio-group" ${groupAttr} role="radiogroup">
                  ${options
                    .map(
                      (o) => `
                  <label class="radio ${o.disabled ? "disabled" : ""}">
                    <input type="radio" name="${esc(name)}" value="${esc(o.value)}"
                      ${o.value === current ? "checked" : ""} ${o.disabled ? "disabled" : ""} />
                    <span>${esc(o.label)}</span>
                  </label>`
                    )
                    .join("")}
                </div>`;
  }

  _checkedRadio(group) {
    return group?.querySelector("input[type=radio]:checked")?.value || null;
  }

  // Energy mode chooser shown under an energy proxy's source while a new,
  // valid source is pending.
  _renderEnergyReplace(p) {
    const value = (this._pendingSources[p.id] ?? p.source_entity).trim();
    if (!p.is_energy || value === p.source_entity || !this._isValidSource(p, value)) {
      return "";
    }
    const src = this._sourceEntity(value);
    const unit = p.unit || src?.unit_of_measurement || "";
    const hasReading = Number.isFinite(Number.parseFloat(src?.state));
    let mode = this._pendingEnergyModes[p.id] || "continue";
    if (mode === "source" && !hasReading) mode = "continue";
    const proxyValue = Number.isFinite(Number.parseFloat(p.live_state))
      ? `${p.live_state} ${unit}`
      : "";
    return `
                ${this._renderRadioGroup(
                  `energy-replace-${p.id}`,
                  `data-energy-mode-proxy="${this._escapeHtml(p.id)}"`,
                  mode,
                  this._energyModeOptions({
                    proxyValue,
                    newReading: hasReading ? `${src.state} ${unit}` : null,
                  })
                )}
                <div class="hint">${this._escapeHtml(this._energyModeHint(mode))}</div>`;
  }

  _findProxy(proxyId) {
    for (const dev of this._state.devices || []) {
      const proxy = (dev.proxies || []).find((p) => p.id === proxyId);
      if (proxy) return proxy;
    }
    return (this._state.unassigned_proxies || []).find((p) => p.id === proxyId) || null;
  }

  _prunePendingSources() {
    // Drop edits for proxies that no longer exist or now match the saved value.
    for (const proxyId of Object.keys(this._pendingSources)) {
      const proxy = this._findProxy(proxyId);
      if (!proxy || proxy.source_entity === this._pendingSources[proxyId]) {
        delete this._pendingSources[proxyId];
      }
    }
    for (const proxyId of Object.keys(this._pendingNames)) {
      const proxy = this._findProxy(proxyId);
      if (!proxy || proxy.name === this._pendingNames[proxyId]) {
        delete this._pendingNames[proxyId];
      }
    }
    for (const proxyId of Object.keys(this._pendingEnergyModes)) {
      if (!(proxyId in this._pendingSources)) delete this._pendingEnergyModes[proxyId];
    }
  }

  _sourceOptionsForDomain(domain) {
    return (this._state.source_entities || []).filter((s) => s.domain === domain);
  }

  // Valid sources for an existing proxy: same locked domain, energy proxies
  // only energy sensors, and a proxy with a unit only sources with that unit.
  _sourceOptionsForProxy(proxy) {
    return this._sourceOptionsForDomain(proxy.domain).filter(
      (s) =>
        (!proxy.is_energy || s.is_energy) &&
        (!proxy.unit || s.unit_of_measurement === proxy.unit)
    );
  }

  _sourceListId(proxy) {
    return JSON.stringify([proxy.domain, !!proxy.is_energy, proxy.unit || null]);
  }

  _isValidSource(proxy, entityId) {
    return this._sourceOptionsForProxy(proxy).some((s) => s.entity_id === entityId);
  }

  _sourceDomain(entityId) {
    const src = this._sourceEntity(entityId);
    return src ? src.domain : null;
  }

  _sourceEntity(entityId) {
    return (this._state.source_entities || []).find((s) => s.entity_id === entityId) || null;
  }

  _historyItem(unit, entityId) {
    return (this._energyHistory[unit]?.items || []).find((i) => i.entity_id === entityId) || null;
  }

  // The energy_start payload for a new-proxy draft, or null when the source
  // is not an energy sensor.
  _energyStartFor(np) {
    if (!this._sourceEntity(np.source)?.is_energy) return null;
    if (np.energyMode === "history") return { mode: "history", entity_id: np.historyEntity };
    return { mode: np.energyMode || "zero" };
  }

  _energyStartValid(np) {
    const src = this._sourceEntity(np.source);
    if (!src?.is_energy) return true;
    if (np.energyMode === "source") return Number.isFinite(Number.parseFloat(src.state));
    if (np.energyMode === "history") {
      return !!this._historyItem(src.unit_of_measurement || "", np.historyEntity);
    }
    return true;
  }

  async _loadEnergyHistory(unit) {
    const cached = this._energyHistory[unit];
    if (cached && !cached.error) return;
    this._energyHistory[unit] = { loading: true, recorder: true, items: [] };
    try {
      const data = await this._hass.callApi(
        "GET",
        `magnolia_proxy/energy_history?unit=${encodeURIComponent(unit)}`
      );
      this._energyHistory[unit] = {
        loading: false,
        recorder: !!data.recorder,
        items: data.items || [],
      };
    } catch (err) {
      this._energyHistory[unit] = {
        loading: false,
        recorder: true,
        items: [],
        error: this._errorMessage(err),
      };
    }
    this._setHistoryList(unit);
  }

  _setHistoryList(unit) {
    const h = this._energyHistory[unit];
    if (!this._sourceLists || !h || h.loading) return;
    this._sourceLists.set(
      `history:${unit}`,
      h.items.map((i) => ({
        entity_id: i.entity_id,
        name: `${i.name ? i.name + " · " : ""}${i.last_value} ${unit}${
          i.last_time ? " · " + new Date(i.last_time * 1000).toLocaleString() : ""
        }`,
      }))
    );
  }

  _historyHint(item, unit) {
    const start = `Starts at ${item.last_value} ${unit}.`;
    if (item.seamless) {
      return `${start} Takes over ${item.entity_id}, so its Energy statistics continue.`;
    }
    if (item.exists) {
      return `${start} ${item.entity_id} still exists, so the proxy gets a new entity ID and new statistics.`;
    }
    return `${start} Its recent statistics were purged, so the proxy gets a new entity ID and new statistics.`;
  }

  _renderEnergyStart(key) {
    const np = this._draft(key);
    const src = this._sourceEntity(np.source);
    if (!src?.is_energy) return "";
    const esc = (v) => this._escapeHtml(v);
    const k = esc(key);
    const unit = src.unit_of_measurement || "";
    const hasReading = Number.isFinite(Number.parseFloat(src.state));
    if (np.energyMode === "source" && !hasReading) np.energyMode = "zero";
    let html = this._renderRadioGroup(
      `energy-start-${key}`,
      `data-np-energy-mode="${k}"`,
      np.energyMode,
      [
        { value: "zero", label: "Start from 0" },
        {
          value: "source",
          label: hasReading
            ? `Start at source reading (${src.state} ${unit})`
            : "Start at source reading (no reading now)",
          disabled: !hasReading,
        },
        { value: "history", label: "Continue an old entity's history" },
      ]
    );
    if (np.energyMode === "history") {
      const h = this._energyHistory[unit];
      if (!h || h.loading) {
        html += `<div class="hint">Loading recorded ${esc(unit)} history…</div>`;
      } else if (h.error) {
        html += `<div class="hint">Could not load history: ${esc(h.error)}</div>`;
      } else if (!h.recorder) {
        html += `<div class="hint">The recorder is not running, so there is no history to continue.</div>`;
      } else if (!h.items.length) {
        html += `<div class="hint">No recorded ${esc(unit)} energy history found.</div>`;
      } else {
        const item = this._historyItem(unit, np.historyEntity);
        html += `
                <input class="source-input mono" data-np-history="${k}"
                  data-src-list="${esc(`history:${unit}`)}"
                  placeholder="Old entity with ${esc(unit)} history"
                  value="${esc(np.historyEntity)}" autocomplete="off" spellcheck="false" />
                <div class="hint" data-np-history-hint="${k}">${item ? esc(this._historyHint(item, unit)) : ""}</div>`;
      }
    }
    return html;
  }

  // key -> { name, deviceId, source, fixedDevice }; fixed-device rows cannot change device.
  _draft(key) {
    if (!this._newProxies[key]) {
      const fixed = key.startsWith("dev:") ? key.slice(4) : null;
      this._newProxies[key] = {
        name: "",
        deviceId: fixed || "",
        source: "",
        fixedDevice: !!fixed || key === NO_DEVICE_KEY,
        // Where a new energy proxy's counter starts: "zero" | "source" | "history".
        energyMode: "zero",
        historyEntity: "",
      };
    }
    return this._newProxies[key];
  }

  _canCreateNewProxy(key) {
    const np = this._draft(key);
    return (
      !!np.name.trim() &&
      (!np.deviceId || (this._state.devices || []).some((d) => d.id === np.deviceId)) &&
      !!this._sourceDomain(np.source) &&
      this._energyStartValid(np)
    );
  }

  async _createProxyInline(key) {
    const np = this._draft(key);
    await this._createProxy(np.deviceId, np.name.trim(), np.source, this._energyStartFor(np));
    // Keep the selected device so several proxies can be added in a row.
    this._newProxies[key] = { ...np, name: "", source: "", energyMode: "zero", historyEntity: "" };
    // The used history entity may now belong to the new proxy.
    this._energyHistory = {};
    this._render();
  }

  // Changed fields of an existing row ({} when nothing changed), or null if invalid.
  _rowChanges(proxy) {
    const name = (this._pendingNames[proxy.id] ?? proxy.name).trim();
    const source = (this._pendingSources[proxy.id] ?? proxy.source_entity).trim();
    if (!name || !source) return null;
    const changes = {};
    if (name !== proxy.name) changes.name = name;
    if (source !== proxy.source_entity) {
      if (!this._isValidSource(proxy, source)) return null;
      changes.source_entity = source;
    }
    return changes;
  }

  _canSaveRow(proxy) {
    const changes = this._rowChanges(proxy);
    return !!changes && Object.keys(changes).length > 0;
  }

  async _openReplaceModal(virtualDeviceId) {
    const firstReal = this._state.real_devices[0]?.id || "";
    this._replaceModal = {
      virtualDeviceId,
      targetDeviceId: firstReal,
      items: [],
    };
    if (firstReal) {
      await this._loadReplacePlan(virtualDeviceId, firstReal);
    } else {
      this._render();
    }
  }

  async _loadReplacePlan(virtualDeviceId, targetDeviceId) {
    const res = await this._hass.callApi("POST", "magnolia_proxy/replace_plan", {
      virtual_device_id: virtualDeviceId,
      target_device_id: targetDeviceId,
    });
    this._replaceModal = {
      virtualDeviceId,
      targetDeviceId,
      items: res.items || [],
    };
    this._render();
  }

  async _applyReplacePlan() {
    if (!this._replaceModal) return;
    const mappings = {};
    this.shadowRoot.querySelectorAll("[data-map-proxy]").forEach((sel) => {
      const proxyId = sel.getAttribute("data-map-proxy");
      if (sel.value && sel.value !== "_skip_") {
        mappings[proxyId] = sel.value;
      }
    });
    const energyModes = {};
    this.shadowRoot.querySelectorAll("[data-map-energy]").forEach((group) => {
      const proxyId = group.getAttribute("data-map-energy");
      const mode = this._checkedRadio(group);
      if (mappings[proxyId] && mode) energyModes[proxyId] = mode;
    });
    const res = await this._hass.callApi("POST", "magnolia_proxy/replace_apply", {
      mappings,
      energy_modes: energyModes,
    });
    this._replaceModal = null;
    if (res?.rejected?.length) {
      this._error = `Some mappings were rejected: ${res.rejected.join(", ")}`;
    }
    await this._fetchState();
  }

  // Energy mode chooser for an energy proxy in the Replace Device modal.
  _renderModalEnergyMode(item) {
    const proxy = this._findProxy(item.proxy_id);
    if (!proxy?.is_energy) return "";
    const unit = proxy.unit || "";
    const proxyValue = Number.isFinite(Number.parseFloat(proxy.live_state))
      ? `${proxy.live_state} ${unit}`
      : "";
    return `
              <div class="energy-start">
                <label>Energy total when the source changes</label>
                ${this._renderRadioGroup(
                  `map-energy-${item.proxy_id}`,
                  `data-map-energy="${this._escapeHtml(item.proxy_id)}"`,
                  "continue",
                  this._energyModeOptions({ proxyValue, newReading: "" })
                )}
                <div class="hint" data-map-energy-hint="${this._escapeHtml(item.proxy_id)}">${this._escapeHtml(this._energyModeHint("continue"))}</div>
              </div>`;
  }

  _escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _render() {
    const devices = this._state.devices || [];

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          color: var(--primary-text-color, #e1e1e1);
          background: var(--primary-background-color, #111111);
          min-height: 100vh;
          box-sizing: border-box;
        }
        .header {
          background: var(--app-header-background-color, #1c1c1c);
          border-bottom: 1px solid var(--divider-color, #2c2c2c);
          padding: 16px 24px 0;
        }
        .header-top {
          padding-bottom: 2px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .title {
          font-size: 20px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .badge {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(3, 169, 244, 0.16);
          color: var(--primary-color, #03a9f4);
          font-weight: 600;
        }
        .badge.warn {
          background: rgba(255, 152, 0, 0.18);
          color: #ffb74d;
        }
        .badge.ok {
          background: rgba(76, 175, 80, 0.18);
          color: #81c784;
        }
        .content {
          max-width: 1180px;
          margin: 0 auto;
          padding: 24px;
        }
        .toolbar {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 20px;
          align-items: center;
        }
        input, select {
          background: var(--card-background-color, #1e1e1e);
          color: var(--primary-text-color, #e1e1e1);
          border: 1px solid var(--divider-color, #333);
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 14px;
        }
        button.btn {
          background: var(--primary-color, #03a9f4);
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 9px 14px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
        }
        button.btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .row-actions {
          display: flex;
          gap: 6px;
          justify-content: flex-end;
        }
        tr.device-row {
          cursor: pointer;
          user-select: none;
        }
        tr.device-row td {
          background: rgba(255, 255, 255, 0.04);
        }
        tr.device-row:hover td {
          background: rgba(255, 255, 255, 0.07);
        }
        .device-summary {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .device-actions {
          margin-left: auto;
          display: flex;
          gap: 6px;
        }
        .chevron {
          width: 12px;
          color: var(--secondary-text-color, #9e9e9e);
        }
        tbody.device-group.open tr:not(.device-row) td:first-child {
          padding-left: 34px;
        }
        tr.new-row td {
          background: rgba(3, 169, 244, 0.05);
        }
        .cell-input {
          width: 100%;
          min-width: 140px;
          box-sizing: border-box;
          padding: 6px 10px;
        }
        input.source-input {
          width: 100%;
          min-width: 220px;
          box-sizing: border-box;
          padding: 6px 10px;
        }
        input.name-input {
          font-weight: 600;
        }
        input.cell-input.dirty,
        input.source-input.dirty {
          border-color: var(--primary-color, #03a9f4);
        }
        input.cell-input.invalid,
        input.source-input.invalid {
          border-color: #ef5350;
        }
        button.btn.secondary {
          background: rgba(255, 255, 255, 0.08);
          color: var(--primary-text-color, #e1e1e1);
        }
        button.btn.danger {
          background: rgba(244, 67, 54, 0.18);
          color: #ef9a9a;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
          gap: 16px;
        }
        .card {
          background: var(--card-background-color, #1c1c1c);
          border: 1px solid var(--divider-color, #2c2c2c);
          border-radius: 12px;
          padding: 16px;
        }
        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 12px;
        }
        .card-title {
          font-size: 16px;
          font-weight: 500;
        }
        .card-sub {
          font-size: 12px;
          color: var(--secondary-text-color, #9e9e9e);
          margin-top: 2px;
        }
        .proxy-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.03);
          margin-top: 8px;
          font-size: 13px;
          gap: 8px;
        }
        .mono {
          font-family: monospace;
          font-size: 12px;
          color: var(--secondary-text-color, #aaa);
        }
        table {
          width: 100%;
          border-collapse: collapse;
          background: var(--card-background-color, #1c1c1c);
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid var(--divider-color, #2c2c2c);
        }
        th, td {
          text-align: left;
          padding: 12px 14px;
          border-bottom: 1px solid var(--divider-color, #2c2c2c);
          font-size: 13px;
        }
        th {
          color: var(--secondary-text-color, #9e9e9e);
          font-weight: 500;
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99;
          padding: 16px;
        }
        .modal {
          background: var(--card-background-color, #1e1e1e);
          border: 1px solid var(--divider-color, #333);
          border-radius: 12px;
          padding: 20px;
          width: 100%;
          max-width: 560px;
          max-height: 85vh;
          overflow-y: auto;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 14px;
        }
        .field label {
          font-size: 12px;
          color: var(--secondary-text-color, #aaa);
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }
        .banner.error {
          background: rgba(244, 67, 54, 0.12);
          border-color: rgba(244, 67, 54, 0.4);
          color: #ef9a9a;
        }
        .banner {
          background: rgba(3, 169, 244, 0.1);
          border: 1px solid rgba(3, 169, 244, 0.3);
          border-radius: 10px;
          padding: 12px 16px;
          margin-bottom: 20px;
          font-size: 13px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .suggest {
          position: fixed;
          z-index: 1000;
          max-height: 300px;
          max-width: 560px;
          overflow-y: auto;
          padding: 4px 0;
          background: var(--card-background-color, #1e1e1e);
          border: 1px solid var(--divider-color, #333);
          border-radius: 8px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
        }
        .suggest-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px 10px;
          cursor: pointer;
        }
        .suggest-item.active,
        .suggest-item:hover {
          background: var(--secondary-background-color, rgba(255, 255, 255, 0.08));
        }
        .suggest-name,
        .suggest-empty {
          font-size: 12px;
          color: var(--secondary-text-color, #9e9e9e);
        }
        .suggest-empty {
          padding: 8px 10px;
        }
        .energy-start {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 6px;
        }
        .energy-start:empty {
          display: none;
        }
        .radio-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .radio {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          cursor: pointer;
        }
        .radio input {
          margin: 0;
          accent-color: var(--primary-color, #03a9f4);
          cursor: pointer;
        }
        .radio.disabled {
          opacity: 0.5;
          cursor: default;
        }
        .radio.disabled input {
          cursor: default;
        }
        .hint {
          font-size: 12px;
          color: var(--secondary-text-color, #9e9e9e);
          max-width: 340px;
        }
      </style>

      <div class="header">
        <div class="header-top">
          <div class="title">
            <span>Magnolia Proxy</span>
            <span class="badge">Setup &amp; Virtual Device Manager</span>
          </div>
          <a href="/config/integrations/integration/magnolia_proxy" style="color: var(--primary-color, #03a9f4); font-size: 13px; text-decoration: none;">
            Open in Settings → Devices &amp; services ↗
          </a>
        </div>
      </div>

      <div class="content">
        ${
          this._error
            ? `<div class="banner error"><span>${this._escapeHtml(this._error)}</span><button class="btn secondary" id="btn-dismiss-error">Dismiss</button></div>`
            : ""
        }

        ${this._renderDeviceList(devices)}
      </div>

      ${this._renderReplaceModal()}
    `;

    this._bindEvents();
  }

  _renderNewProxyRow(key) {
    const devices = this._state.devices || [];
    const np = this._draft(key);
    // "" = no virtual device (the proxy is hosted by the Magnolia Proxy Hub).
    if (!np.fixedDevice && np.deviceId && !devices.some((d) => d.id === np.deviceId)) {
      np.deviceId = "";
    }
    const k = this._escapeHtml(key);
    const domain = this._sourceDomain(np.source);
    const invalid = !!np.source && !domain;
    const fixedDev = np.fixedDevice ? devices.find((d) => d.id === np.deviceId) : null;
    const deviceCell = np.fixedDevice
      ? np.deviceId
        ? this._escapeHtml(fixedDev?.name || np.deviceId)
        : `<span class="card-sub">No device</span>`
      : `<select data-np-device="${k}" class="cell-input">
                  <option value="" ${np.deviceId ? "" : "selected"}>No device</option>
                  ${devices
                    .map(
                      (d) =>
                        `<option value="${this._escapeHtml(d.id)}" ${d.id === np.deviceId ? "selected" : ""}>${this._escapeHtml(d.name)}</option>`
                    )
                    .join("")}
                </select>`;
    return `
            <tr class="new-row">
              <td>
                <input data-np-name="${k}" class="cell-input" placeholder="New proxy name"
                  value="${this._escapeHtml(np.name)}" autocomplete="off" />
              </td>
              <td data-np-domain="${k}">${this._renderDomainBadge(domain)}</td>
              <td>${deviceCell}</td>
              <td class="mono">—</td>
              <td>
                <input data-np-source="${k}"
                  class="source-input mono ${invalid ? "invalid" : ""}"
                  data-src-list="all"
                  placeholder="Pick a source entity"
                  value="${this._escapeHtml(np.source)}"
                  autocomplete="off" spellcheck="false" />
                <div class="energy-start" data-np-energy="${k}">${this._renderEnergyStart(key)}</div>
              </td>
              <td></td>
              <td>
                <div class="row-actions">
                  <button class="btn" data-np-create="${k}" ${this._canCreateNewProxy(key) ? "" : "disabled"}>+ Create</button>
                </div>
              </td>
            </tr>`;
  }

  _renderDomainBadge(domain) {
    return domain
      ? `<span class="badge">${this._escapeHtml(domain)}</span>`
      : `<span class="card-sub">auto</span>`;
  }

  _buildSourceLists(proxies) {
    // Suggestion lists for source inputs: one per locked domain (energy
    // proxies get an energy-only list) plus "all" for new-proxy rows, whose
    // domain is not locked yet.
    this._sourceLists = new Map([["all", this._state.source_entities || []]]);
    for (const p of proxies) {
      const id = this._sourceListId(p);
      if (!this._sourceLists.has(id)) this._sourceLists.set(id, this._sourceOptionsForProxy(p));
    }
    for (const unit of Object.keys(this._energyHistory)) this._setHistoryList(unit);
  }

  // Suggestion dropdown for source inputs. Native <datalist> is unreliable
  // inside shadow DOM and each browser filters/caps it differently.
  _attachSourceCombobox(input) {
    const options = this._sourceLists?.get(input.dataset.srcList) || [];
    const MAX_ITEMS = 200;
    let box = null;
    let items = [];
    let active = -1;
    let picking = false;

    const close = () => {
      if (!box) return;
      box.remove();
      box = null;
      items = [];
      active = -1;
      window.removeEventListener("scroll", onPageScroll, true);
      window.removeEventListener("resize", close);
    };
    // The dropdown is fixed-positioned, so close it when the page scrolls,
    // but not when the dropdown's own list is scrolled.
    const onPageScroll = (ev) => {
      if (box && !ev.composedPath().includes(box)) close();
    };
    const pick = (entityId) => {
      input.value = entityId;
      close();
      picking = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      picking = false;
    };
    const highlight = (i) => {
      if (!box || !items.length) return;
      active = (i + items.length) % items.length;
      [...box.children].forEach((el, idx) => el.classList.toggle("active", idx === active));
      box.children[active]?.scrollIntoView({ block: "nearest" });
    };
    const open = (showAll) => {
      const q = showAll ? "" : input.value.trim().toLowerCase();
      // Match on entity_id only; the friendly name is shown but not searched.
      items = options
        .filter((s) => !q || s.entity_id.toLowerCase().includes(q))
        .slice(0, MAX_ITEMS);
      if (!box) {
        box = document.createElement("div");
        box.className = "suggest";
        // Keep focus in the input so blur does not close before the click.
        box.addEventListener("mousedown", (ev) => ev.preventDefault());
        box.addEventListener("click", (ev) => {
          const el = ev.target.closest("[data-i]");
          if (el) pick(items[Number(el.dataset.i)].entity_id);
        });
        this.shadowRoot.appendChild(box);
        window.addEventListener("scroll", onPageScroll, true);
        window.addEventListener("resize", close);
      }
      const r = input.getBoundingClientRect();
      box.style.left = `${r.left}px`;
      box.style.top = `${r.bottom + 2}px`;
      box.style.minWidth = `${r.width}px`;
      box.innerHTML = items.length
        ? items
            .map(
              (s, i) =>
                `<div class="suggest-item" data-i="${i}"><span class="mono">${this._escapeHtml(s.entity_id)}</span><span class="suggest-name">${this._escapeHtml(s.name)}</span></div>`
            )
            .join("")
        : `<div class="suggest-empty">No matching entities</div>`;
      active = -1;
    };

    // Focus lists everything (the current value stays editable); typing filters.
    input.addEventListener("focus", () => open(true));
    input.addEventListener("input", () => {
      if (!picking) open(false);
    });
    input.addEventListener("blur", close);
    // Registered before the row's own keydown handlers so Enter/Escape on an
    // open dropdown do not also save or reset the row.
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!box) open(true);
        highlight(active + (ev.key === "ArrowDown" ? 1 : -1));
        ev.preventDefault();
      } else if (ev.key === "Enter" && box && active >= 0) {
        pick(items[active].entity_id);
        ev.preventDefault();
        ev.stopImmediatePropagation();
      } else if (ev.key === "Escape" && box) {
        close();
        ev.stopImmediatePropagation();
      }
    });
  }

  _renderProxyTableHead() {
    return `
        <thead>
          <tr>
            <th>Proxy Name</th>
            <th>Locked Domain</th>
            <th>Virtual Device</th>
            <th>Proxy Entity ID</th>
            <th>Source Entity</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>`;
  }

  _renderProxyRow(p) {
              const value = this._pendingSources[p.id] ?? p.source_entity;
              const dirty = value !== p.source_entity;
              const invalid = dirty && !!value && !this._isValidSource(p, value);
              const canSave = this._canSaveRow(p);
              const nameValue = this._pendingNames[p.id] ?? p.name;
              const nameDirty = nameValue.trim() !== p.name;
              return `
            <tr>
              <td>
                <input
                  class="cell-input name-input ${nameDirty ? "dirty" : ""} ${nameDirty && !nameValue.trim() ? "invalid" : ""}"
                  data-name-proxy="${this._escapeHtml(p.id)}"
                  value="${this._escapeHtml(nameValue)}"
                  title="Current: ${this._escapeHtml(p.name)}"
                  autocomplete="off"
                />
              </td>
              <td><span class="badge">${this._escapeHtml(p.domain)}</span></td>
              <td>${p.device_name ? this._escapeHtml(p.device_name) : `<span class="card-sub">No device</span>`}</td>
              <td class="mono">${this._escapeHtml(p.entity_id || "pending_discovery")}</td>
              <td>
                <input
                  class="source-input mono ${dirty ? "dirty" : ""} ${invalid ? "invalid" : ""}"
                  data-src-list="${this._escapeHtml(this._sourceListId(p))}"
                  data-src-proxy="${this._escapeHtml(p.id)}"
                  value="${this._escapeHtml(value)}"
                  title="Current: ${this._escapeHtml(p.source_entity)}"
                  autocomplete="off"
                  spellcheck="false"
                />
                <div class="energy-start" data-energy-cell="${this._escapeHtml(p.id)}">${this._renderEnergyReplace(p)}</div>
              </td>
              <td class="mono">${this._escapeHtml(p.live_state)} ${this._escapeHtml(p.unit_of_measurement || "")}</td>
              <td>
                <div class="row-actions">
                  <button class="btn" data-save-proxy="${this._escapeHtml(p.id)}" ${canSave ? "" : "disabled"}>Save</button>
                  <button class="btn danger" data-del-proxy="${this._escapeHtml(p.id)}">Delete</button>
                </div>
              </td>
            </tr>`;
  }

  _renderDeviceList(devices) {
    const unassigned = (this._state.unassigned_proxies || []).map((p) => ({
      ...p,
      device_name: null,
    }));
    const allProxies = [...devices.flatMap((d) => d.proxies || []), ...unassigned];
    this._buildSourceLists(allProxies);
    return `
      <table class="device-test">
        ${this._renderProxyTableHead()}
        <tbody class="new-device">
          <tr class="new-row">
            <td colspan="7">
              <div class="device-summary">
                <span class="chevron">+</span>
                <input data-nd-name class="cell-input" placeholder="New Virtual Device name"
                  value="${this._escapeHtml(this._newDevice.name)}" autocomplete="off" style="max-width:280px;" />
                <button class="btn" data-nd-create ${this._newDevice.name.trim() ? "" : "disabled"}>+ Create Device</button>
                ${devices.length ? "" : `<span class="card-sub">No Virtual Devices yet.</span>`}
              </div>
            </td>
          </tr>
        </tbody>
        ${devices
          .map((dev) => {
            const open = this._expandedDevices.has(dev.id);
            const proxies = (dev.proxies || []).map((p) => ({ ...p, device_name: dev.name }));
            const id = this._escapeHtml(dev.id);
            return `
        <tbody class="device-group ${open ? "open" : ""}">
          <tr class="device-row" data-toggle-dev="${id}" aria-expanded="${open}">
            <td colspan="7">
              <div class="device-summary">
                <span class="chevron">${open ? "▾" : "▸"}</span>
                <strong>${this._escapeHtml(dev.name)}</strong>
                <span class="card-sub">${this._escapeHtml(dev.model)}</span>
                <span class="mono">${id}</span>
                <span class="badge ${dev.added_to_ha ? "ok" : "warn"}">${dev.added_to_ha ? "Added to HA" : "Discovered / Pending"}</span>
                <span class="badge">${proxies.length} ${proxies.length === 1 ? "entity" : "entities"}</span>
                <span class="device-actions">
                  ${
                    !dev.added_to_ha
                      ? `<button class="btn secondary" data-discover-dev="${id}" title="Re-send Home Assistant discovery">Notify Discovery</button>`
                      : ""
                  }
                  <button class="btn secondary" data-replace-dev="${id}">Replace Device</button>
                  <button class="btn danger" data-del-dev="${id}">Delete</button>
                </span>
              </div>
            </td>
          </tr>
          ${
            open
              ? proxies.map((p) => this._renderProxyRow(p)).join("") +
                this._renderNewProxyRow(`dev:${dev.id}`)
              : ""
          }
        </tbody>`;
          })
          .join("")}
        ${this._renderNoDeviceGroup(unassigned)}
      </table>
    `;
  }

  // Proxies hosted by the hub entry (not attached to any virtual device).
  _renderNoDeviceGroup(proxies) {
    const open = this._expandedDevices.has(NO_DEVICE_KEY);
    return `
        <tbody class="device-group no-device ${open ? "open" : ""}">
          <tr class="device-row" data-toggle-dev="${NO_DEVICE_KEY}" aria-expanded="${open}">
            <td colspan="7">
              <div class="device-summary">
                <span class="chevron">${open ? "▾" : "▸"}</span>
                <strong>No device</strong>
                <span class="card-sub">Proxies hosted by the Magnolia Proxy Hub</span>
                <span class="badge">${proxies.length} ${proxies.length === 1 ? "entity" : "entities"}</span>
              </div>
            </td>
          </tr>
          ${
            open
              ? proxies.map((p) => this._renderProxyRow(p)).join("") +
                this._renderNewProxyRow(NO_DEVICE_KEY)
              : ""
          }
        </tbody>`;
  }

  _modalError() {
    return this._error
      ? `<div class="banner error" style="margin:12px 0 0;">${this._escapeHtml(this._error)}</div>`
      : "";
  }

  _renderReplaceModal() {
    if (!this._replaceModal) return "";
    const { virtualDeviceId, targetDeviceId, items } = this._replaceModal;
    const vdev = this._state.devices.find((d) => d.id === virtualDeviceId);
    const realDevices = this._state.real_devices || [];

    return `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="card-title" style="margin-bottom:6px;">Replace Device — ${this._escapeHtml(vdev?.name)}</div>
          <div class="card-sub" style="margin-bottom:14px;">
            Select the new real-life device. Unambiguous entities auto-map; conflicts can be resolved manually below.
          </div>
          <div class="field">
            <label>Replacement Real Device</label>
            <select id="replace-target-select">
              ${realDevices
                .map(
                  (rd) =>
                    `<option value="${this._escapeHtml(rd.id)}" ${rd.id === targetDeviceId ? "selected" : ""}>${this._escapeHtml(rd.name)} (${this._escapeHtml(rd.manufacturer || rd.id.slice(0, 8))})</option>`
                )
                .join("")}
            </select>
          </div>

          ${items
            .map(
              (item) => `
            <div class="field" style="padding:10px;border:1px solid var(--divider-color,#333);border-radius:8px;">
              <label>
                <strong>${this._escapeHtml(item.proxy_name)}</strong> (${this._escapeHtml(item.locked_domain)})
                ${
                  item.conflict_reason
                    ? `<span class="badge warn">Conflict: ${this._escapeHtml(item.conflict_reason)}</span>`
                    : `<span class="badge ok">Auto-mapped</span>`
                }
              </label>
              <select data-map-proxy="${this._escapeHtml(item.proxy_id)}">
                <option value="_skip_">Keep current (${this._escapeHtml(item.current_source_entity)})</option>
                ${(item.candidates || [])
                  .map(
                    (cand) =>
                      `<option value="${this._escapeHtml(cand)}" ${cand === item.selected_source_entity ? "selected" : ""}>${this._escapeHtml(cand)}</option>`
                  )
                  .join("")}
              </select>
              ${this._renderModalEnergyMode(item)}
            </div>`
            )
            .join("")}

          ${this._modalError()}
          <div class="actions">
            <button class="btn secondary" id="btn-cancel-replace">Cancel</button>
            <button class="btn" id="btn-apply-replace">Apply Replacement Mapping</button>
          </div>
        </div>
      </div>
    `;
  }

  _bindNewProxyRows() {
    this.shadowRoot.querySelectorAll("[data-np-create]").forEach((createBtn) => {
      const key = createBtn.getAttribute("data-np-create");
      const sel = (attr) => this.shadowRoot.querySelector(`[${attr}="${CSS.escape(key)}"]`);
      const nameInput = sel("data-np-name");
      const deviceSelect = sel("data-np-device"); // absent on fixed-device rows
      const sourceInput = sel("data-np-source");
      const domainCell = sel("data-np-domain");
      const energyCell = sel("data-np-energy");
      if (!nameInput || !sourceInput) return;
      this._attachSourceCombobox(sourceInput);
      const draft = this._draft(key);

      // Energy start controls depend on the chosen source, so they are
      // re-rendered (outside the focused source input) when it changes.
      const bindEnergy = () => {
        if (!energyCell) return;
        const modeGroup = energyCell.querySelector("[data-np-energy-mode]");
        modeGroup?.addEventListener("change", () => {
          draft.energyMode = this._checkedRadio(modeGroup) || "zero";
          const unit = this._sourceEntity(draft.source)?.unit_of_measurement || "";
          if (draft.energyMode === "history") {
            this._loadEnergyHistory(unit).then(refreshEnergy);
          }
          refreshEnergy();
        });
        const histInput = energyCell.querySelector("[data-np-history]");
        if (histInput) {
          this._attachSourceCombobox(histInput);
          const hint = energyCell.querySelector("[data-np-history-hint]");
          const syncHistory = () => {
            draft.historyEntity = histInput.value.trim();
            const unit = this._sourceEntity(draft.source)?.unit_of_measurement || "";
            const item = this._historyItem(unit, draft.historyEntity);
            histInput.classList.toggle("invalid", !!draft.historyEntity && !item);
            if (hint) hint.textContent = item ? this._historyHint(item, unit) : "";
            createBtn.disabled = !this._canCreateNewProxy(key);
          };
          histInput.addEventListener("input", syncHistory);
          histInput.addEventListener("change", syncHistory);
          histInput.addEventListener("blur", syncHistory);
        }
      };
      const refreshEnergy = () => {
        if (!energyCell) return;
        energyCell.innerHTML = this._renderEnergyStart(key);
        bindEnergy();
        createBtn.disabled = !this._canCreateNewProxy(key);
      };
      bindEnergy();
      let energySource = draft.source;

      const sync = () => {
        draft.name = nameInput.value;
        if (deviceSelect) draft.deviceId = deviceSelect.value;
        draft.source = sourceInput.value.trim();
        const domain = this._sourceDomain(draft.source);
        if (domainCell) domainCell.innerHTML = this._renderDomainBadge(domain);
        sourceInput.classList.toggle("invalid", !!draft.source && !domain);
        if (draft.source !== energySource) {
          energySource = draft.source;
          draft.historyEntity = "";
          refreshEnergy();
        }
        createBtn.disabled = !this._canCreateNewProxy(key);
      };

      nameInput.addEventListener("input", sync);
      if (deviceSelect) deviceSelect.addEventListener("change", sync);

      sourceInput.addEventListener("blur", sync);
      sourceInput.addEventListener("input", sync);
      sourceInput.addEventListener("change", sync);

      const submitOnEnter = (ev) => {
        if (ev.key === "Enter" && !createBtn.disabled) createBtn.click();
      };
      nameInput.addEventListener("keydown", submitOnEnter);
      sourceInput.addEventListener("keydown", submitOnEnter);

      // Keep the source input's value in place (its blur would otherwise run first).
      createBtn.addEventListener("mousedown", (ev) => ev.preventDefault());
      createBtn.addEventListener("click", () => {
        if (sourceInput.value.trim()) sync();
        if (!this._canCreateNewProxy(key)) return;
        createBtn.disabled = true;
        this._run(() => this._createProxyInline(key));
      });
    });
  }

  _bindEvents() {
    const dismissError = this.shadowRoot.getElementById("btn-dismiss-error");
    if (dismissError) {
      dismissError.addEventListener("click", () => {
        this._error = null;
        this._render();
      });
    }


    this.shadowRoot.querySelectorAll("[data-replace-dev]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation(); // the button sits inside the expandable device row
        this._run(() => this._openReplaceModal(btn.getAttribute("data-replace-dev")));
      });
    });

    this.shadowRoot.querySelectorAll("[data-discover-dev]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation(); // the button sits inside the expandable device row
        this._run(() => this._rediscoverDevice(btn.getAttribute("data-discover-dev")));
      });
    });

    this.shadowRoot.querySelectorAll("[data-del-dev]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation(); // the button sits inside the expandable device row
        const id = btn.getAttribute("data-del-dev");
        const dev = (this._state.devices || []).find((d) => d.id === id);
        if (!confirm(`Delete virtual device "${dev?.name || id}" and all its proxy entities?`)) return;
        this._run(() => this._deleteDevice(id));
      });
    });

    this.shadowRoot.querySelectorAll("[data-del-proxy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!confirm("Delete this proxy entity?")) return;
        this._run(() => this._deleteProxy(btn.getAttribute("data-del-proxy")));
      });
    });

    this.shadowRoot.querySelectorAll("[data-src-proxy]").forEach((input) => {
      const proxyId = input.getAttribute("data-src-proxy");
      const proxy = this._findProxy(proxyId);
      if (!proxy) return;
      const saveBtn = this.shadowRoot.querySelector(
        `[data-save-proxy="${CSS.escape(proxyId)}"]`
      );
      const energyCell = this.shadowRoot.querySelector(
        `[data-energy-cell="${CSS.escape(proxyId)}"]`
      );
      const bindEnergy = () => {
        const modeGroup = energyCell?.querySelector("[data-energy-mode-proxy]");
        modeGroup?.addEventListener("change", () => {
          this._pendingEnergyModes[proxyId] = this._checkedRadio(modeGroup) || "continue";
          refreshEnergy();
        });
      };
      const refreshEnergy = () => {
        if (!energyCell) return;
        energyCell.innerHTML = this._renderEnergyReplace(proxy);
        bindEnergy();
      };
      bindEnergy();
      let energyValue = (this._pendingSources[proxyId] ?? proxy.source_entity).trim();

      const sync = () => {
        const value = input.value.trim();
        if (value && value !== proxy.source_entity) {
          this._pendingSources[proxyId] = value;
        } else {
          delete this._pendingSources[proxyId];
        }
        const dirty = !!value && value !== proxy.source_entity;
        input.classList.toggle("dirty", dirty);
        input.classList.toggle(
          "invalid",
          dirty && !this._isValidSource(proxy, value)
        );
        const pending = (this._pendingSources[proxyId] ?? proxy.source_entity).trim();
        if (pending !== energyValue) {
          energyValue = pending;
          refreshEnergy();
        }
        if (saveBtn) saveBtn.disabled = !this._canSaveRow(proxy);
      };

      this._attachSourceCombobox(input);
      input.addEventListener("blur", () => {
        // Leaving the field empty keeps the current source.
        if (!input.value.trim()) input.value = proxy.source_entity;
        sync();
      });
      input.addEventListener("input", sync);
      input.addEventListener("change", sync);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && saveBtn && !saveBtn.disabled) saveBtn.click();
        if (ev.key === "Escape") {
          input.value = proxy.source_entity;
          sync();
          input.blur();
        }
      });
    });

    this.shadowRoot.querySelectorAll("[data-name-proxy]").forEach((input) => {
      const proxyId = input.getAttribute("data-name-proxy");
      const proxy = this._findProxy(proxyId);
      if (!proxy) return;
      const saveBtn = this.shadowRoot.querySelector(
        `[data-save-proxy="${CSS.escape(proxyId)}"]`
      );
      const sync = () => {
        if (input.value.trim() !== proxy.name) {
          this._pendingNames[proxyId] = input.value;
        } else {
          delete this._pendingNames[proxyId];
        }
        const dirty = input.value.trim() !== proxy.name;
        input.classList.toggle("dirty", dirty);
        input.classList.toggle("invalid", dirty && !input.value.trim());
        if (saveBtn) saveBtn.disabled = !this._canSaveRow(proxy);
      };
      input.addEventListener("input", sync);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && saveBtn && !saveBtn.disabled) saveBtn.click();
        if (ev.key === "Escape") {
          input.value = proxy.name;
          sync();
          input.blur();
        }
      });
    });

    this._bindNewProxyRows();

    const ndName = this.shadowRoot.querySelector("[data-nd-name]");
    const ndCreate = this.shadowRoot.querySelector("[data-nd-create]");
    if (ndName && ndCreate) {
      const sync = () => {
        this._newDevice.name = ndName.value;
        ndCreate.disabled = !ndName.value.trim();
      };
      ndName.addEventListener("input", sync);
      const submitOnEnter = (ev) => {
        if (ev.key === "Enter" && !ndCreate.disabled) ndCreate.click();
      };
      ndName.addEventListener("keydown", submitOnEnter);
      ndCreate.addEventListener("click", () => {
        sync();
        if (ndCreate.disabled) return;
        ndCreate.disabled = true;
        this._run(() => this._createDeviceInline());
      });
    }

    this.shadowRoot.querySelectorAll("[data-toggle-dev]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-toggle-dev");
        if (this._expandedDevices.has(id)) this._expandedDevices.delete(id);
        else this._expandedDevices.add(id);
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-save-proxy]").forEach((btn) => {
      // mousedown fires before the input's blur; prevent it so the edited
      // value is still in place when the click handler runs.
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => {
        const proxyId = btn.getAttribute("data-save-proxy");
        const proxy = this._findProxy(proxyId);
        if (!proxy) return;
        const changes = this._rowChanges(proxy);
        if (!changes || !Object.keys(changes).length) return;
        btn.disabled = true;
        this._run(() => this._updateProxy(proxyId, changes));
      });
    });

    this.shadowRoot.querySelectorAll("[data-map-energy]").forEach((group) => {
      const proxyId = group.getAttribute("data-map-energy");
      const hint = this.shadowRoot.querySelector(
        `[data-map-energy-hint="${CSS.escape(proxyId)}"]`
      );
      group.addEventListener("change", () => {
        if (hint) hint.textContent = this._energyModeHint(this._checkedRadio(group));
      });
    });

    const targetSelect = this.shadowRoot.getElementById("replace-target-select");
    if (targetSelect) {
      targetSelect.addEventListener("change", () => {
        this._run(() =>
          this._loadReplacePlan(this._replaceModal.virtualDeviceId, targetSelect.value)
        );
      });
    }

    const cancelReplace = this.shadowRoot.getElementById("btn-cancel-replace");
    if (cancelReplace) {
      cancelReplace.addEventListener("click", () => {
        this._replaceModal = null;
        this._render();
      });
    }

    const applyReplace = this.shadowRoot.getElementById("btn-apply-replace");
    if (applyReplace) {
      applyReplace.addEventListener("click", () => {
        this._run(() => this._applyReplacePlan());
      });
    }
  }
}

customElements.define("magnolia-proxy-panel", MagnoliaProxyPanel);
