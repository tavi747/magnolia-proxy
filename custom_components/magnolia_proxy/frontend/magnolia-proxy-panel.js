class MagnoliaProxyPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._state = { devices: [], real_devices: [], source_entities: [] };
    this._activeTab = "devices";
    this._loaded = false;
    this._replaceModal = null;
    this._createProxyDeviceId = null;
    this._error = null;
    this._refreshTimer = null;
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

  _autoRefresh() {
    // Skip while a modal is open so in-progress selections are not reset.
    if (this._replaceModal || this._createProxyDeviceId) return;
    // Skip while the user is typing, since re-rendering drops focus.
    if (this.shadowRoot.activeElement?.matches?.("input, select")) return;
    this._fetchState();
  }

  async _fetchState() {
    if (!this._hass) return;
    try {
      const data = await this._hass.callApi("GET", "magnolia_proxy/state");
      this._state = data;
    } catch (err) {
      console.error("Magnolia Proxy fetch error:", err);
      this._error = `Failed to load state: ${this._errorMessage(err)}`;
    }
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
    await this._hass.callApi("POST", "magnolia_proxy/devices", {
      name,
      model: model || "Virtual Device",
    });
    await this._fetchState();
  }

  async _deleteDevice(deviceId) {
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
    this._createProxyDeviceId = null;
    await this._fetchState();
  }

  async _deleteProxy(proxyId) {
    await this._hass.callApi("DELETE", `magnolia_proxy/proxies/${proxyId}`);
    await this._fetchState();
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
    const prevName = this.shadowRoot.getElementById("new-dev-name")?.value ?? "";
    const prevModel =
      this.shadowRoot.getElementById("new-dev-model")?.value ?? "Virtual Device";
    const devices = this._state.devices || [];
    const allProxies = devices.flatMap((d) =>
      (d.proxies || []).map((p) => ({ ...p, device_name: d.name, added_to_ha: d.added_to_ha }))
    );

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
        .tabs {
          display: flex;
          gap: 24px;
        }
        .tab {
          padding: 10px 4px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          color: var(--secondary-text-color, #9e9e9e);
          font-weight: 500;
          font-size: 14px;
          background: none;
          border-top: none;
          border-left: none;
          border-right: none;
        }
        .tab.active {
          color: var(--primary-color, #03a9f4);
          border-bottom-color: var(--primary-color, #03a9f4);
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
        <div class="tabs">
          <button class="tab ${this._activeTab === "devices" ? "active" : ""}" data-tab="devices">
            Devices (${devices.length})
          </button>
          <button class="tab ${this._activeTab === "entities" ? "active" : ""}" data-tab="entities">
            Entities (${allProxies.length})
          </button>
        </div>
      </div>

      <div class="content">
        <div class="banner">
          <span>
            Creating a Virtual Device triggers <strong>Home Assistant Discovery</strong> so you can add it under <strong>Settings → Devices &amp; services</strong> just like Shelly.
          </span>
        </div>

        ${
          this._error
            ? `<div class="banner error"><span>${this._escapeHtml(this._error)}</span><button class="btn secondary" id="btn-dismiss-error">Dismiss</button></div>`
            : ""
        }

        <div class="toolbar">
          <input id="new-dev-name" placeholder="New Virtual Device name (e.g. Desk Plug)" style="min-width: 240px;" value="${this._escapeHtml(prevName)}" />
          <input id="new-dev-model" placeholder="Model (optional)" value="${this._escapeHtml(prevModel)}" />
          <button class="btn" id="btn-create-device">+ Create Device</button>
        </div>

        ${
          this._activeTab === "devices"
            ? this._renderDevicesTab(devices)
            : this._renderEntitiesTab(allProxies)
        }
      </div>

      ${this._renderCreateProxyModal()}
      ${this._renderReplaceModal()}
    `;

    this._bindEvents();
  }

  _renderDevicesTab(devices) {
    if (!devices.length) {
      return `<div class="card">No Virtual Devices yet. Create one above to trigger Home Assistant discovery.</div>`;
    }
    return `
      <div class="grid">
        ${devices
          .map(
            (dev) => `
          <div class="card">
            <div class="card-head">
              <div>
                <div class="card-title">${this._escapeHtml(dev.name)}</div>
                <div class="card-sub">${this._escapeHtml(dev.model)} • <span class="mono">${this._escapeHtml(dev.id)}</span></div>
              </div>
              <span class="badge ${dev.added_to_ha ? "ok" : "warn"}">
                ${dev.added_to_ha ? "Added to HA" : "Discovered / Pending"}
              </span>
            </div>

            <div>
              ${
                (dev.proxies || []).length
                  ? dev.proxies
                      .map(
                        (p) => `
                  <div class="proxy-row">
                    <div>
                      <div><strong>${this._escapeHtml(p.name)}</strong> <span class="badge">${this._escapeHtml(p.domain)}</span></div>
                      <div class="mono">${this._escapeHtml(p.entity_id || "pending")} ← ${this._escapeHtml(p.source_entity)}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <span class="mono">${this._escapeHtml(p.live_state)}</span>
                      <button class="btn danger" data-del-proxy="${this._escapeHtml(p.id)}">✕</button>
                    </div>
                  </div>`
                      )
                      .join("")
                  : `<div class="card-sub">No proxy entities attached yet.</div>`
              }
            </div>

            <div class="actions" style="justify-content:flex-start; flex-wrap:wrap;">
              <button class="btn" data-add-proxy="${this._escapeHtml(dev.id)}">+ Add Proxy Entity</button>
              <button class="btn secondary" data-replace-dev="${this._escapeHtml(dev.id)}">Replace Device</button>
              ${
                !dev.added_to_ha
                  ? `<button class="btn secondary" data-discover-dev="${this._escapeHtml(dev.id)}">Notify Discovery</button>`
                  : ""
              }
              <button class="btn danger" data-del-dev="${this._escapeHtml(dev.id)}">Delete</button>
            </div>
          </div>`
          )
          .join("")}
      </div>
    `;
  }

  _renderEntitiesTab(proxies) {
    if (!proxies.length) {
      return `<div class="card">No proxy entities created yet.</div>`;
    }
    return `
      <table>
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
        </thead>
        <tbody>
          ${proxies
            .map(
              (p) => `
            <tr>
              <td><strong>${this._escapeHtml(p.name)}</strong></td>
              <td><span class="badge">${this._escapeHtml(p.domain)}</span></td>
              <td>${this._escapeHtml(p.device_name)}</td>
              <td class="mono">${this._escapeHtml(p.entity_id || "pending_discovery")}</td>
              <td class="mono">${this._escapeHtml(p.source_entity)}</td>
              <td class="mono">${this._escapeHtml(p.live_state)} ${this._escapeHtml(p.unit_of_measurement || "")}</td>
              <td><button class="btn danger" data-del-proxy="${this._escapeHtml(p.id)}">Delete</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  _modalError() {
    return this._error
      ? `<div class="banner error" style="margin:12px 0 0;">${this._escapeHtml(this._error)}</div>`
      : "";
  }

  _renderCreateProxyModal() {
    if (!this._createProxyDeviceId) return "";
    const dev = this._state.devices.find((d) => d.id === this._createProxyDeviceId);
    const sources = this._state.source_entities || [];

    return `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="card-title" style="margin-bottom:6px;">Add Proxy Entity to ${this._escapeHtml(dev?.name)}</div>
          <div class="card-sub" style="margin-bottom:14px;">
            The domain of the first selected source entity is detected and locked permanently. Energy sensors accumulate deltas from current reading.
          </div>
          <div class="field">
            <label>Proxy Entity Name</label>
            <input id="proxy-name-input" placeholder="e.g. Relay Switch or Energy Total" />
          </div>
          <div class="field">
            <label>Initial Source Entity (switch, light, fan, sensor)</label>
            <select id="proxy-source-select">
              ${sources
                .map(
                  (s) =>
                    `<option value="${this._escapeHtml(s.entity_id)}">${this._escapeHtml(s.name)} (${this._escapeHtml(s.entity_id)}) [${this._escapeHtml(s.domain)}]</option>`
                )
                .join("")}
            </select>
          </div>
          ${this._modalError()}
          <div class="actions">
            <button class="btn secondary" id="btn-cancel-proxy">Cancel</button>
            <button class="btn" id="btn-save-proxy">Create Locked Proxy</button>
          </div>
        </div>
      </div>
    `;
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

  _bindEvents() {
    const dismissError = this.shadowRoot.getElementById("btn-dismiss-error");
    if (dismissError) {
      dismissError.addEventListener("click", () => {
        this._error = null;
        this._render();
      });
    }

    this.shadowRoot.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._activeTab = btn.getAttribute("data-tab");
        this._render();
      });
    });

    const createBtn = this.shadowRoot.getElementById("btn-create-device");
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        const nameInput = this.shadowRoot.getElementById("new-dev-name");
        const name = nameInput.value;
        const model = this.shadowRoot.getElementById("new-dev-model").value;
        nameInput.value = "";
        this._run(() => this._createDevice(name, model));
      });
    }

    this.shadowRoot.querySelectorAll("[data-add-proxy]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._createProxyDeviceId = btn.getAttribute("data-add-proxy");
        this._render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-replace-dev]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._run(() => this._openReplaceModal(btn.getAttribute("data-replace-dev")));
      });
    });

    this.shadowRoot.querySelectorAll("[data-discover-dev]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._run(() => this._rediscoverDevice(btn.getAttribute("data-discover-dev")));
      });
    });

    this.shadowRoot.querySelectorAll("[data-del-dev]").forEach((btn) => {
      btn.addEventListener("click", () => {
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

    const cancelProxy = this.shadowRoot.getElementById("btn-cancel-proxy");
    if (cancelProxy) {
      cancelProxy.addEventListener("click", () => {
        this._createProxyDeviceId = null;
        this._render();
      });
    }

    const saveProxy = this.shadowRoot.getElementById("btn-save-proxy");
    if (saveProxy) {
      saveProxy.addEventListener("click", () => {
        const name = this.shadowRoot.getElementById("proxy-name-input").value;
        const source = this.shadowRoot.getElementById("proxy-source-select").value;
        if (name && source) {
          this._run(() => this._createProxy(this._createProxyDeviceId, name, source));
        }
      });
    }

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
