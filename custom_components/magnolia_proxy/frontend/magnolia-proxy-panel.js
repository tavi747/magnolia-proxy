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
    // proxy_id -> edited (unsaved) proxy name in the Entities tab.
    this._pendingNames = {};
    // Drafts for inline "new proxy" rows, keyed by table:
    // "dev:<virtual_device_id>" or NO_DEVICE_KEY.
    this._newProxies = {};
    // Virtual device ids (and NO_DEVICE_KEY) currently expanded.
    this._expandedDevices = new Set();
    // Draft for the inline "new device" row.
    this._newDevice = { name: "" };
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

  async _createProxy(virtualDeviceId, name, sourceEntity) {
    await this._hass.callApi("POST", "magnolia_proxy/proxies", {
      virtual_device_id: virtualDeviceId,
      name,
      source_entity: sourceEntity,
    });
    await this._fetchState();
  }

  async _deleteProxy(proxyId) {
    await this._hass.callApi("DELETE", `magnolia_proxy/proxies/${proxyId}`);
    delete this._pendingSources[proxyId];
    delete this._pendingNames[proxyId];
    await this._fetchState();
  }

  async _updateProxy(proxyId, changes) {
    await this._hass.callApi("PATCH", `magnolia_proxy/proxies/${proxyId}`, changes);
    delete this._pendingSources[proxyId];
    delete this._pendingNames[proxyId];
    await this._fetchState();
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
  }

  _sourceOptionsForDomain(domain) {
    return (this._state.source_entities || []).filter((s) => s.domain === domain);
  }

  // Valid sources for an existing proxy: same locked domain, and energy
  // proxies may only use energy sensors.
  _sourceOptionsForProxy(proxy) {
    const options = this._sourceOptionsForDomain(proxy.domain);
    return proxy.is_energy ? options.filter((s) => s.is_energy) : options;
  }

  _sourceListId(proxy) {
    return proxy.is_energy ? "src-list-energy" : `src-list-${proxy.domain}`;
  }

  _isValidSource(proxy, entityId) {
    return this._sourceOptionsForProxy(proxy).some((s) => s.entity_id === entityId);
  }

  _sourceDomain(entityId) {
    const src = (this._state.source_entities || []).find((s) => s.entity_id === entityId);
    return src ? src.domain : null;
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
      };
    }
    return this._newProxies[key];
  }

  _canCreateNewProxy(key) {
    const np = this._draft(key);
    return (
      !!np.name.trim() &&
      (!np.deviceId || (this._state.devices || []).some((d) => d.id === np.deviceId)) &&
      !!this._sourceDomain(np.source)
    );
  }

  async _createProxyInline(key) {
    const np = this._draft(key);
    await this._createProxy(np.deviceId, np.name.trim(), np.source);
    // Keep the selected device so several proxies can be added in a row.
    this._newProxies[key] = { ...np, name: "", source: "" };
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
    const res = await this._hass.callApi("POST", "magnolia_proxy/replace_apply", {
      mappings,
    });
    this._replaceModal = null;
    if (res?.rejected?.length) {
      this._error = `Some mappings were rejected: ${res.rejected.join(", ")}`;
    }
    await this._fetchState();
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

  _renderDatalist(id, sources) {
    return `
      <datalist id="${this._escapeHtml(id)}">
        ${sources
          .map(
            (s) =>
              `<option value="${this._escapeHtml(s.entity_id)}">${this._escapeHtml(s.name)} [${this._escapeHtml(s.domain)}]</option>`
          )
          .join("")}
      </datalist>`;
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
                  list="src-list-all"
                  placeholder="Pick a source entity"
                  value="${this._escapeHtml(np.source)}"
                  autocomplete="off" spellcheck="false" />
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

  _renderSourceDatalists(proxies) {
    // One datalist per locked domain (energy proxies get an energy-only list)
    // for existing rows, plus one with every source entity for new-proxy rows
    // (their domain is not locked yet).
    const lists = new Map();
    for (const p of proxies) {
      const id = this._sourceListId(p);
      if (!lists.has(id)) lists.set(id, this._sourceOptionsForProxy(p));
    }
    return (
      [...lists]
        .map(([id, options]) => this._renderDatalist(id, options))
        .join("") + this._renderDatalist("src-list-all", this._state.source_entities || [])
    );
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
                  list="${this._escapeHtml(this._sourceListId(p))}"
                  data-src-proxy="${this._escapeHtml(p.id)}"
                  value="${this._escapeHtml(value)}"
                  title="Current: ${this._escapeHtml(p.source_entity)}"
                  autocomplete="off"
                  spellcheck="false"
                />
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
    return `
      ${this._renderSourceDatalists(allProxies)}
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
      if (!nameInput || !sourceInput) return;
      const draft = this._draft(key);

      const sync = () => {
        draft.name = nameInput.value;
        if (deviceSelect) draft.deviceId = deviceSelect.value;
        draft.source = sourceInput.value.trim();
        const domain = this._sourceDomain(draft.source);
        if (domainCell) domainCell.innerHTML = this._renderDomainBadge(domain);
        sourceInput.classList.toggle("invalid", !!draft.source && !domain);
        createBtn.disabled = !this._canCreateNewProxy(key);
      };

      nameInput.addEventListener("input", sync);
      if (deviceSelect) deviceSelect.addEventListener("change", sync);

      // Same datalist trick as the existing rows: clear on focus to list everything.
      sourceInput.addEventListener("focus", () => {
        sourceInput.dataset.prev = sourceInput.value;
        if (sourceInput.value) sourceInput.placeholder = sourceInput.value;
        sourceInput.value = "";
      });
      sourceInput.addEventListener("blur", () => {
        if (!sourceInput.value.trim()) sourceInput.value = sourceInput.dataset.prev ?? "";
        sourceInput.placeholder = "Pick a source entity";
        sync();
      });
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
        if (saveBtn) saveBtn.disabled = !this._canSaveRow(proxy);
      };

      // Browsers filter datalist suggestions by the current text, so clear it on
      // focus to show every entity of the locked domain; restore it if left empty.
      input.addEventListener("focus", () => {
        input.dataset.prev = input.value;
        input.placeholder = input.value;
        input.value = "";
      });
      input.addEventListener("blur", () => {
        if (!input.value.trim()) input.value = input.dataset.prev ?? proxy.source_entity;
        input.placeholder = "";
        sync();
      });
      input.addEventListener("input", sync);
      input.addEventListener("change", sync);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && saveBtn && !saveBtn.disabled) saveBtn.click();
        if (ev.key === "Escape") {
          input.value = proxy.source_entity;
          input.dataset.prev = proxy.source_entity;
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
