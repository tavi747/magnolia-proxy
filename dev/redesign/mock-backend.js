/* Shared mock backend for the redesign simulators (mirrors api.py; extracted from dev/simulator.html).
 * Usage: <script src="../mock-backend.js"></script>, then use window.MagnoliaMock.
 *   MagnoliaMock.callApi(method, path, body)  -> Promise (same contract as hass.callApi)
 *   MagnoliaMock.reset()                       -> reseed in-memory data
 *   MagnoliaMock.toggleSource(entity_id?)      -> flip a light/switch source state (default desk lamp)
 *   MagnoliaMock.tickEnergy()                  -> bump energy/power sources so live values move
 *   MagnoliaMock.failNext(bool)                -> next write call returns HTTP 500
 *   MagnoliaMock.onLog = fn(msg), MagnoliaMock.onFailChange = fn(bool)
 */
(function () {
const MagnoliaMock = (window.MagnoliaMock = {});
// ---------- Mock backend (mirrors api.py behaviour) ----------
const SUPPORTED = ["switch", "light", "fan", "sensor", "binary_sensor", "cover", "lock", "siren", "valve"];
// Proxy types a switch can be shown as (switch_as_x).
const SWITCH_AS_X = ["cover", "fan", "light", "lock", "siren", "valve"];
const seed = () => ({
  devices: {
    vdev_a1b2c3d4e5f6: { id: "vdev_a1b2c3d4e5f6", name: "Veioza Birou", model: "Virtual Device" },
    vdev_0f9e8d7c6b5a: { id: "vdev_0f9e8d7c6b5a", name: "Desk Plug", model: "Shelly Plus 1PM" },
  },
  proxies: {
    prx_111111111111: { id: "prx_111111111111", name: "Desk Lamp", domain: "light",
      source_entity: "light.livingroom_desk_lamp", virtual_device_id: "vdev_a1b2c3d4e5f6" },
    prx_555555555555: { id: "prx_555555555555", name: "Garage Door", domain: "cover",
      source_entity: "cover.garage_door", virtual_device_id: "vdev_a1b2c3d4e5f6" },
    prx_222222222222: { id: "prx_222222222222", name: "Relay", domain: "switch",
      source_entity: "switch.shelly_relay_0", virtual_device_id: "vdev_0f9e8d7c6b5a" },
    prx_333333333333: { id: "prx_333333333333", name: "Power", domain: "sensor",
      source_entity: "sensor.shelly_power", virtual_device_id: "vdev_0f9e8d7c6b5a" },
    prx_444444444444: { id: "prx_444444444444", name: "Energy", domain: "sensor",
      source_entity: "sensor.shelly_energy", virtual_device_id: "vdev_0f9e8d7c6b5a",
      energy: { baseline: 12.31, accumulated: 250.5 } },
  },
  sources: [
    ["light.livingroom_desk_lamp", "Living Room Desk Lamp", "on"],
    ["light.kitchen_ceiling", "Kitchen Ceiling", "off"],
    ["light.hue_go", "Hue Go", "on"],
    ["switch.shelly_relay_0", "Shelly Relay 0", "on"],
    ["switch.shelly_relay_1", "Shelly Relay 1", "off"],
    ["fan.bedroom", "Bedroom Fan", "off"],
    ["cover.garage_door", "Garage Door", "closed", "garage"],
    ["lock.front_door", "Front Door", "locked"],
    ["siren.hallway", "Hallway Siren", "off"],
    ["valve.garden", "Garden Valve", "closed", "water"],
    ["binary_sensor.hallway_motion", "Hallway Motion", "off", "motion"],
    ["binary_sensor.front_door", "Front Door", "on", "door"],
    ["binary_sensor.pro4_input_0", "Pro 4PM Input 0", "off", "power"],
    ["binary_sensor.pro4_overheating", "Pro 4PM Overheating", "off", "heat"],
    ["sensor.shelly_power", "Shelly Power", "42.5", "power", "W"],
    ["sensor.shelly_energy", "Shelly Energy", "12.31", "energy", "kWh"],
    ["sensor.mains_voltage", "Mains Voltage", "231.2", "voltage", "V"],
    ["sensor.plug_power", "Plug Power", "18.0", "power", "W"],
    ["sensor.plug_power_kw", "Plug Power (kW)", "0.018", "power", "kW"],
    ["sensor.desk_energy", "Desk Energy", "3.42", "energy", "kWh"],
    ["sensor.desk_energy_wh", "Desk Energy (Wh)", "3420", "energy", "Wh"],
    ["sensor.outdoor_temperature", "Outdoor Temperature", "7.5", "temperature", "°C"],
    ["switch.pro4_relay_0", "Pro 4PM Relay 0", "on"],
    ["switch.pro4_relay_1", "Pro 4PM Relay 1", "off"],
    ["sensor.pro4_power_0", "Pro 4PM Power 0", "12.0", "power", "W"],
    ["sensor.pro4_power_1", "Pro 4PM Power 1", "0.0", "power", "W"],
    ["sensor.pro4_apparent_power", "Pro 4PM Apparent Power", "14.1", "apparent_power", "VA"],
    ["sensor.pro4_energy", "Pro 4PM Energy", "88.40", "energy", "kWh"],
  ].map(([entity_id, name, state, device_class = null, unit = null]) => ({
    entity_id, name, state, device_class, unit_of_measurement: unit,
    domain: entity_id.split(".")[0],
    is_energy: device_class === "energy",
    renamable: entity_id !== "sensor.mains_voltage", // one source without a unique ID
  })),
  switchHelpers: {}, // "domain:switch" -> its switch_as_x helper
});
// Recorded energy statistics the recorder still has (old/deleted meters).
// seamless = entity_id is free and short-term statistics still exist.
const now = Date.now() / 1000;
const HISTORY = [
  { entity_id: "sensor.old_desk_meter_energy", name: "Old Desk Meter Energy", unit: "kWh",
    last_value: 1523.418, last_time: now - 2 * 86400, exists: false, seamless: true },
  { entity_id: "sensor.garage_energy_2023", name: "Garage Energy (2023)", unit: "kWh",
    last_value: 804.2, last_time: now - 400 * 86400, exists: false, seamless: false },
  { entity_id: "sensor.desk_energy", name: "Desk Energy", unit: "kWh",
    last_value: 3.42, last_time: now - 300, exists: true, seamless: false },
  { entity_id: "sensor.desk_energy_wh", name: "Desk Energy (Wh)", unit: "Wh",
    last_value: 3420, last_time: now - 300, exists: true, seamless: false },
];

// Automations/scripts the mock reports as using entities or devices after a replace.
const MOCK_AUTOMATIONS = [
  { entity_id: "automation.keep_desk_light_on", id: "1700000000001", name: "Keep desk light on", state: "on", entities: ["switch.relay_desk_plug"] },
  { entity_id: "automation.high_power_alert", id: "1700000000002", name: "High power alert", state: "on", entities: ["sensor.shelly_power"] },
  { entity_id: "automation.desk_power_log", id: "1700000000003", name: "Desk power log", state: "off", entities: ["sensor.power_desk_plug"] },
  { entity_id: "automation.relay_button", id: "1700000000004", name: "Relay button double press", state: "on", devices: ["realdev0001"] },
  { entity_id: "script.desk_reset", name: "Desk reset", state: "off", entities: ["switch.relay_desk_plug"] },
];

let db = seed();
let failNext = false;
const rid = (p) => p + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const log = (m) => { MagnoliaMock.onLog && MagnoliaMock.onLog(m); };
const err = (status, message) => { const e = new Error(message); e.body = { message }; e.status = status; return e; };

function validateSource(entityId, locked) {
  const domain = entityId.includes(".") ? entityId.split(".")[0] : "";
  if (!SUPPORTED.includes(domain)) throw err(400, `Unsupported domain: ${domain}`);
  if (locked && domain !== locked) throw err(400, `Domain mismatch: proxy is locked to '${locked}', got '${domain}'`);
  if (!db.sources.some((s) => s.entity_id === entityId)) throw err(400, `Unknown source entity: ${entityId}`);
  return domain;
}

const sourceOf = (entityId) => db.sources.find((s) => s.entity_id === entityId);
const proxyIsEnergy = (p) => !!sourceOf(p.source_entity)?.is_energy;
const proxyUnit = (p) => sourceOf(p.source_entity)?.unit_of_measurement ?? null;

// Same checks as the backend for changing an existing proxy's source.
function validateProxySource(p, entityId) {
  validateSource(entityId, p.domain);
  const src = sourceOf(entityId);
  if (proxyIsEnergy(p) && !src.is_energy) throw err(400, "An energy proxy can only use an energy sensor as its source");
  const unit = proxyUnit(p);
  if ((src.unit_of_measurement || null) !== (unit || null))
    throw err(400, `Unit mismatch: proxy uses '${unit || "no unit"}', ${entityId} uses '${src.unit_of_measurement || "no unit"}'`);
}
// Mirrors device_mapping.plan_device_replacement: unit and energy are hard limits.
const allowedFor = (p, s) => {
  if (s.domain !== p.domain) return false;
  if ((s.unit_of_measurement || null) !== (proxyUnit(p) || null)) return false;
  if (proxyIsEnergy(p)) return s.is_energy;
  return true;
};
const REAL_DEVICES = [
  { id: "realdev0001", name: "Shelly Plus 2PM", manufacturer: "Shelly", model: "2PM", area: "Office", prefix: "shelly_" },
  { id: "realdev0002", name: "Shelly Pro 4PM", manufacturer: "Shelly", model: "Pro 4PM", area: "Garage", prefix: "pro4_" },
  { id: "realdev0003", name: "Smart Plug", manufacturer: "TP-Link", model: "P110", area: "Living Room", prefix: "plug_" },
  { id: "realdev0004", name: "Desk Meter", manufacturer: "Sonoff", model: "POWR3", area: "Office", prefix: "desk_" },
  { id: "realdev0005", name: "Mains Monitor", manufacturer: "Shelly", model: "EM", area: "", prefix: "mains_" },
  { id: "realdev0006", name: "Kitchen Light", manufacturer: "Signify", model: "Hue", area: "Kitchen", prefix: "kitchen_" },
];
const deviceSources = (d) => db.sources.filter((s) => s.entity_id.split(".")[1].startsWith(d.prefix));

// Current total of an energy proxy: accumulated + increase since baseline.
function energyValue(p) {
  const src = sourceOf(p.source_entity);
  const cur = Number(src?.state);
  return p.energy.accumulated + Math.max(0, cur - (p.energy.baseline ?? cur));
}

// Same as MagnoliaProxyStore.energy_restart_seed + the sensor's re-baseline.
function switchEnergySource(p, newSource, mode = "continue") {
  if (!p.energy) return;
  const reading = Number(sourceOf(newSource).state);
  if (mode === "source" && !Number.isFinite(reading)) throw err(400, `${newSource} has no current reading to start from`);
  const accumulated = mode === "zero" ? 0 : mode === "source" ? reading : energyValue(p);
  if (!["continue", "zero", "source"].includes(mode)) throw err(400, `Unknown energy mode: ${mode}`);
  p.energy = { baseline: reading, accumulated };
}

function proxyView(p, devName) {
  const src = db.sources.find((s) => s.entity_id === p.source_entity);
  let live = src ? src.state : "unavailable";
  if (p.energy && src) {
    const delta = Math.max(0, Number(src.state) - (p.energy.baseline ?? Number(src.state)));
    live = String(+(p.energy.accumulated + delta).toFixed(3));
  }
  const { energy, entity_id_override, ...rest } = p;
  return { ...rest,
    entity_id: entity_id_override || `${p.domain}.${slug(p.name)}${devName ? "_" + slug(devName) : ""}`,
    live_state: live, unit_of_measurement: src?.unit_of_measurement ?? null,
    is_energy: proxyIsEnergy(p), unit: proxyUnit(p) };
}

function stateResponse() {
  return {
    unassigned_proxies: Object.values(db.proxies).filter((p) => !p.virtual_device_id).map((p) => proxyView(p, null)),
    devices: Object.values(db.devices).map((d) => ({
      ...d, added_to_ha: true, config_entry_id: "entry_" + d.id,
      proxies: Object.values(db.proxies).filter((p) => p.virtual_device_id === d.id).map((p) => proxyView(p, d.name)),
    })),
    real_devices: REAL_DEVICES.map(({ prefix, ...d }) => ({ ...d, entities: deviceSources({ prefix }) })),
    source_entities: db.sources,
  };
}

async function callApi(method, path, body) {
  await new Promise((r) => setTimeout(r, 150)); // network latency
  log(`${method} /api/${path}${body ? " " + JSON.stringify(body) : ""}`);
  if (failNext && method !== "GET") { failNext = false; MagnoliaMock.onFailChange && MagnoliaMock.onFailChange(false); throw err(500, "Simulated server error"); }
  let m;
  if (method === "GET" && path === "magnolia_proxy/state") return stateResponse();
  if (method === "POST" && path === "magnolia_proxy/devices") {
    const id = rid("vdev_");
    db.devices[id] = { id, name: (body.name || "").trim() || `Virtual Device ${Object.keys(db.devices).length + 1}`, model: body.model || "Virtual Device" };
    return { device: db.devices[id] };
  }
  if ((m = path.match(/^magnolia_proxy\/devices\/(.+)$/))) {
    if (!db.devices[m[1]]) throw err(404, "Virtual device not found");
    if (method === "PATCH") {
      const clean = String(body.name || "").trim();
      if (!clean) throw err(400, "Device name is required");
      db.devices[m[1]].name = clean;
      return { device: db.devices[m[1]] };
    }
    if (method === "DELETE") {
      delete db.devices[m[1]];
      for (const [k, p] of Object.entries(db.proxies)) if (p.virtual_device_id === m[1]) delete db.proxies[k];
      return { deleted: true };
    }
    return { discovered: true };
  }
  if (method === "GET" && path.startsWith("magnolia_proxy/energy_history")) {
    const unit = new URLSearchParams(path.split("?")[1] || "").get("unit");
    if (!unit) throw err(400, "'unit' is required");
    return { recorder: true, items: HISTORY.filter((h) => h.unit === unit) };
  }
  if (method === "POST" && path === "magnolia_proxy/proxies") {
    const vdev = body.virtual_device_id || null;
    if (vdev && !db.devices[vdev]) throw err(400, "Unknown virtual_device_id");
    const domain = validateSource(body.source_entity || "");
    if (!(body.name || "").trim()) throw err(400, "Proxy name is required");
    const src = sourceOf(body.source_entity);
    const start = body.energy_start || { mode: "zero" };
    const current = Number(src.state);
    let energy = src.is_energy ? { baseline: current, accumulated: 0 } : null;
    let entity_id_override = null;
    if (start.mode && start.mode !== "zero") {
      if (!src.is_energy) throw err(400, "Starting options are only available for energy sources");
      if (start.mode === "source") energy = { baseline: current, accumulated: current };
      else if (start.mode === "history") {
        const h = HISTORY.find((x) => x.entity_id === start.entity_id && x.unit === src.unit_of_measurement);
        if (!h) throw err(400, `No recorded ${src.unit_of_measurement} energy history for ${start.entity_id}`);
        energy = { baseline: current, accumulated: h.last_value };
        if (h.seamless) { entity_id_override = h.entity_id; h.exists = true; h.seamless = false; }
      } else throw err(400, `Unknown energy start mode: ${start.mode}`);
    }
    // Optional explicit proxy entity ID, and renaming the source to free its ID (mirrors storage.py).
    const wantId = String(body.entity_id || "").trim().toLowerCase() || null;
    const newSrc = String(body.rename_source || "").trim().toLowerCase() || null;
    const validId = (v) => /^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$/.test(v);
    const used = new Set([...db.sources.map((s) => s.entity_id),
      ...Object.values(db.proxies).map((p) => proxyView(p, db.devices[p.virtual_device_id]?.name).entity_id)]);
    if (wantId && entity_id_override) throw err(400, "Choose either an old entity to take over or an explicit entity_id");
    if (newSrc) {
      if (!validId(newSrc) || newSrc.split(".")[0] !== domain) throw err(400, `The source's new ID must be a valid '${domain}.object_id' entity ID`);
      if (newSrc === body.source_entity) throw err(400, "The source's new ID must differ from its current ID");
      if (used.has(newSrc)) throw err(400, `${newSrc} is already in use`);
    }
    if (wantId) {
      if (!validId(wantId) || wantId.split(".")[0] !== domain) throw err(400, `The proxy's entity ID must be a valid '${domain}.object_id' entity ID`);
      if (!(newSrc && wantId === body.source_entity) && used.has(wantId)) throw err(400, `${wantId} is already in use`);
    }
    let sourceEntity = body.source_entity;
    if (newSrc) {
      const old = sourceEntity;
      src.entity_id = newSrc;
      for (const p of Object.values(db.proxies)) if (p.source_entity === old) p.source_entity = newSrc;
      sourceEntity = newSrc;
    }
    if (wantId) entity_id_override = wantId;
    const id = rid("prx_");
    db.proxies[id] = { id, name: body.name.trim(), domain, source_entity: sourceEntity, virtual_device_id: vdev,
      ...(energy ? { energy } : {}), ...(entity_id_override ? { entity_id_override } : {}) };
    return { proxy: db.proxies[id] };
  }
  if ((m = path.match(/^magnolia_proxy\/proxies\/([^?]+)(?:\?(.*))?$/))) {
    const p = db.proxies[m[1]];
    if (!p) throw err(404, "Proxy not found");
    if (method === "DELETE") {
      // ?rename_source=1 gives the source the deleted proxy's entity ID (mirrors storage.py).
      const rename = ["1", "true", "yes"].includes((new URLSearchParams(m[2] || "").get("rename_source") || "").toLowerCase());
      const src = sourceOf(p.source_entity);
      const freed = proxyView(p, db.devices[p.virtual_device_id]?.name).entity_id;
      if (rename && (!src || !src.renamable)) throw err(400, `${p.source_entity} cannot be renamed: it has no unique ID, so it is not in the entity registry`);
      delete db.proxies[m[1]];
      if (!rename) return { deleted: true, source_entity: p.source_entity };
      const old = src.entity_id; src.entity_id = freed;
      for (const o of Object.values(db.proxies)) if (o.source_entity === old) o.source_entity = freed;
      return { deleted: true, source_entity: freed };
    }
    if (method === "PATCH") {
      if (!("name" in body) && !("source_entity" in body)) throw err(400, "Provide 'name' and/or 'source_entity'");
      if ("name" in body && !String(body.name).trim()) throw err(400, "Proxy name is required");
      if ("source_entity" in body && body.source_entity !== p.source_entity) {
        validateProxySource(p, body.source_entity || "");
        switchEnergySource(p, body.source_entity, body.energy_mode);
      }
      if ("name" in body) p.name = body.name.trim();
      if ("source_entity" in body) p.source_entity = body.source_entity;
      return { proxy: p };
    }
  }
  if (method === "POST" && path === "magnolia_proxy/replace_plan") {
    return { items: Object.values(db.proxies).filter((p) => p.virtual_device_id === body.virtual_device_id).map((p) => {
      const dev = REAL_DEVICES.find((d) => d.id === body.target_device_id) || REAL_DEVICES[0];
      const dc = ["sensor", "binary_sensor"].includes(p.domain) ? sourceOf(p.source_entity)?.device_class : null;
      const all = deviceSources(dev).filter((s) => allowedFor(p, s));
      const same = dc ? all.filter((s) => s.device_class === dc) : [];
      let c = [...same, ...all.filter((s) => !same.includes(s))].map((s) => s.entity_id);
      // "Show as" proxy types can also take a switch, wrapped in a switch_as_x helper.
      const asX = SWITCH_AS_X.includes(p.domain) ? deviceSources(dev).filter((s) => s.domain === "switch" && !db.switchHelpers[p.domain + ":" + s.entity_id]).map((s) => s.entity_id) : [];
      let reason = c.length === 1 ? null : c.length ? "multiple_candidates" : asX.length ? "switch_as_x" : "no_matching_entity";
      const sel = c.length === 1 ? c[0] : c.includes(p.source_entity) ? p.source_entity : same.length === 1 ? same[0].entity_id : null;
      if (!c.length && !asX.length) c = db.sources.filter((s) => allowedFor(p, s)).map((s) => s.entity_id).sort();
      return { proxy_id: p.id, proxy_name: p.name, locked_domain: p.domain, current_source_entity: p.source_entity,
        candidates: [...c, ...asX], selected_source_entity: reason === "no_matching_entity" || reason === "switch_as_x" ? null : sel,
        conflict_reason: reason, switch_as_x: asX };
    }) };
  }
  if (method === "POST" && path === "magnolia_proxy/replace_apply") {
    const rejected = [], viewOf = (pid) => proxyView(db.proxies[pid], db.devices[db.proxies[pid]?.virtual_device_id]?.name);
    const before = Object.fromEntries(Object.keys(body.mappings || {}).filter((pid) => db.proxies[pid])
      .map((pid) => [pid, { state: viewOf(pid).live_state, source: db.proxies[pid].source_entity }]));
    for (let [pid, src] of Object.entries(body.mappings || {})) {
      try {
        const p = db.proxies[pid];
        if (SWITCH_AS_X.includes(p.domain) && src.startsWith("switch.")) {
          const sw = sourceOf(src), key = p.domain + ":" + src; if (!sw) throw err(400, "Unknown switch");
          if (!db.switchHelpers[key]) {
            const helper = p.domain + "." + src.split(".")[1];
            const state = { cover: { on: "open", off: "closed" }, valve: { on: "open", off: "closed" }, lock: { on: "unlocked", off: "locked" } }[p.domain]?.[sw.state] ?? sw.state;
            db.sources.push({ ...sw, entity_id: helper, domain: p.domain, state });
            db.switchHelpers[key] = helper;
          }
          src = db.switchHelpers[key];
        }
        validateProxySource(p, src);
        if (src !== p.source_entity) switchEnergySource(p, src, (body.energy_modes || {})[pid]);
        p.source_entity = src;
      } catch { rejected.push(pid); }
    }
    // Mirrors replace_report.py: carry on/off over, then list who uses what.
    const applied = Object.keys(before).filter((pid) => !rejected.includes(pid) && db.proxies[pid].source_entity !== before[pid].source);
    const matched = {};
    for (const [pid, want] of Object.entries(body.match_state || {})) {
      if (!applied.includes(pid)) continue;
      const src = sourceOf(db.proxies[pid].source_entity);
      if (src) src.state = want;
      matched[pid] = !!src;
    }
    const ref = (a, reasons) => ({ entity_id: a.entity_id, kind: a.entity_id.split(".")[0], name: a.name, state: a.state,
      edit_path: a.entity_id.startsWith("script.") ? "/config/script/edit/" + a.entity_id.split(".")[1] : "/config/automation/edit/" + a.id, ...(reasons ? { reasons } : {}) });
    const old = new Map();
    const proxies = applied.map((pid) => {
      const v = viewOf(pid), old_src = before[pid].source;
      const oldDev = REAL_DEVICES.find((d) => old_src.split(".")[1].startsWith(d.prefix))?.id;
      for (const a of MOCK_AUTOMATIONS) {
        const why = (a.entities || []).includes(old_src) ? `uses ${old_src}` : (a.devices || []).includes(oldDev) ? "uses the old device" : null;
        if (!why) continue;
        const r = old.get(a.entity_id) || ref(a, []); if (!r.reasons.includes(why)) r.reasons.push(why); old.set(a.entity_id, r);
      }
      return { proxy_id: pid, name: v.name, entity_id: v.entity_id, before: before[pid].state, after: v.live_state,
        match: (body.match_state || {})[pid] || null, matched: matched[pid] ?? null,
        used_by: MOCK_AUTOMATIONS.filter((a) => (a.entities || []).includes(v.entity_id)).map((a) => ref(a)) };
    });
    return { applied: true, rejected, report: { proxies, old_device: [...old.values()] } };
  }
  throw err(404, `No mock for ${method} ${path}`);
}


MagnoliaMock.callApi = callApi;
MagnoliaMock.reset = () => { db = seed(); };
MagnoliaMock.failNext = (v = true) => { failNext = !!v; MagnoliaMock.onFailChange && MagnoliaMock.onFailChange(failNext); };
MagnoliaMock.isFailNext = () => failNext;
MagnoliaMock.toggleSource = (id = "light.livingroom_desk_lamp") => {
  const s = db.sources.find((x) => x.entity_id === id);
  if (s && (s.state === "on" || s.state === "off")) s.state = s.state === "on" ? "off" : "on";
  log(`${id} -> ${s && s.state}`);
};
MagnoliaMock.tickEnergy = () => {
  for (const s of db.sources) {
    if (s.device_class === "energy") s.state = String(+(Number(s.state) + (s.unit_of_measurement === "Wh" ? 5 : 0.01)).toFixed(3));
    if (s.device_class === "power" && s.unit_of_measurement === "W") s.state = String(+(Number(s.state) + (Math.random() * 6 - 3)).toFixed(1));
  }
};
})();
