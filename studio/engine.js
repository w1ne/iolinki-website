"use strict";

// A station is the unit the studio edits, ChatGPT builds, and the buyer orders:
// equipment on a floor, IO-Link sensors, and the masters they are cabled to.
// Limits come only from the filed datasheets in library/sensors.

const CONDUCTORS = ["L+", "L-", "C/Q"];
const FLOOR = [14, 9];
const SENSOR_HEIGHT = 1.3;
// IEC 61131-9 limits an IO-Link cable between master port and device to 20 m.
const IOLINK_MAX_CABLE_M = 20;

function byId(library, ref) {
  return (library.sensors || []).find((def) => def.id === ref)
    || (library.masters || []).find((def) => def.id === ref)
    || (library.equipment || []).find((def) => def.id === ref)
    || null;
}

function kindOf(library, ref) {
  const def = byId(library, ref);
  if (!def) {
    return null;
  }
  return def.kind || "equipment";
}

function newStation() {
  return { v: 1, floor: FLOOR.slice(), items: [] };
}

function nextUid(station, kind) {
  let n = 1;
  const taken = new Set(station.items.map((item) => item.uid));
  while (taken.has(kind + n)) {
    n++;
  }
  return kind + n;
}

function clampToFloor(station, at) {
  const hx = station.floor[0] / 2 - 0.5;
  const hz = station.floor[1] / 2 - 0.5;
  return [
    Math.round(Math.max(-hx, Math.min(hx, at[0])) * 10) / 10,
    Math.round(Math.max(-hz, Math.min(hz, at[1])) * 10) / 10,
  ];
}

function freeSpot(station) {
  for (let z = -3; z <= 3; z += 2) {
    for (let x = -6; x <= 6; x += 2) {
      const close = station.items.some((item) => Math.abs(item.at[0] - x) < 1.5 && Math.abs(item.at[1] - z) < 1.5);
      if (!close) {
        return [x, z];
      }
    }
  }
  return [0, 0];
}

// Where a new part goes when it is added without a spot: a sensor on the
// machine it measures, a master by the control cabinet.
const MOUNTS = {
  pressure: { pipe: [[0.8, 0.45], [-0.8, 0.45], [1.6, 0.45], [-1.6, 0.45]], pump: [[0.8, 0.6]] },
  flow: { pipe: [[1.2, 0.45], [-1.2, 0.45], [0, 0.45]] },
  level: { tank: [[1.3, 0], [0, 1.3], [-1.3, 0]] },
  temperature: { tank: [[1.3, 0.6], [0.6, 1.3], [-1.3, 0.6]], pipe: [[-0.4, 0.45]] },
  capacitive: { tank: [[-1.1, 0.8]], conveyor: [[-1, 0.9]] },
  inductive: { stop: [[1.6, 0]], conveyor: [[1, 0.9], [-1, 0.9], [2, 0.9]], press: [[1.3, 0.9]] },
  "optical distance": { conveyor: [[0, -1.2], [1.5, -1.2], [-1.5, -1.2]], stop: [[0.6, -1.3]] },
  master: { cabinet: [[1.3, 0.5], [-1.3, 0.5], [1.3, 1.3]] },
};

function mountSpot(station, def) {
  const slots = MOUNTS[def.kind === "master" ? "master" : def.category] || {};
  for (const ref of Object.keys(slots)) {
    for (const machine of station.items.filter((item) => item.ref === ref)) {
      for (const offset of slots[ref]) {
        const at = [machine.at[0] + offset[0], machine.at[1] + offset[1]];
        const taken = station.items.some((item) => item.kind !== "equipment" && Math.hypot(item.at[0] - at[0], item.at[1] - at[1]) < 0.5);
        if (!taken) {
          return at;
        }
      }
    }
  }
  return null;
}

function defaults(def) {
  const settings = {};
  (def.settings || []).forEach((setting) => {
    settings[setting.key] = setting.default;
  });
  const options = {};
  (def.options || []).forEach((option) => {
    options[option.key] = option.default;
  });
  return { settings: settings, options: options };
}

function addItem(station, library, ref, at, deferPorts) {
  const def = byId(library, ref);
  if (!def) {
    return null;
  }
  const kind = def.kind || "equipment";
  const item = { uid: nextUid(station, kind === "equipment" ? "eq" : kind), kind: kind, ref: ref, at: clampToFloor(station, at || (kind !== "equipment" && mountSpot(station, def)) || freeSpot(station)) };
  if (kind === "sensor") {
    const values = defaults(def);
    item.settings = values.settings;
    item.options = values.options;
    if (def.correction) {
      item.target = "steel";
    }
  }
  station.items.push(item);
  if (kind === "sensor" && !deferPorts) {
    assignPorts(station, library);
  }
  return item;
}

function removeItem(station, library, uid) {
  const gone = station.items.find((item) => item.uid === uid);
  station.items = station.items.filter((item) => item.uid !== uid);
  if (gone && gone.kind === "master") {
    station.items.forEach((item) => {
      if (item.master === uid) {
        delete item.master;
        delete item.port;
      }
    });
  }
  assignPorts(station, library);
}

function masterPorts(library, master) {
  const def = byId(library, master.ref);
  return def && def.ports ? def.ports : 0;
}

// Every sensor gets a port. Keep a valid existing assignment; otherwise take
// the first free port, adding a master only when every port is used.
function assignPorts(station, library) {
  const masters = station.items.filter((item) => item.kind === "master");
  const used = new Map(masters.map((master) => [master.uid, new Set()]));
  const sensors = station.items.filter((item) => item.kind === "sensor");
  sensors.forEach((sensor) => {
    const master = masters.find((item) => item.uid === sensor.master);
    const ports = used.get(sensor.master);
    if (master && ports && sensor.port >= 1 && sensor.port <= masterPorts(library, master) && !ports.has(sensor.port)) {
      ports.add(sensor.port);
    } else {
      delete sensor.master;
      delete sensor.port;
    }
  });
  sensors.forEach((sensor) => {
    if (sensor.master) {
      return;
    }
    let slot = null;
    station.items.filter((item) => item.kind === "master").some((master) => {
      const ports = used.get(master.uid);
      for (let port = 1; port <= masterPorts(library, master); port++) {
        if (!ports.has(port)) {
          slot = { master: master, port: port };
          return true;
        }
      }
      return false;
    });
    if (!slot) {
      const masterDef = (library.masters || [])[0];
      if (!masterDef) {
        return;
      }
      const count = station.items.filter((item) => item.kind === "master").length;
      const master = { uid: nextUid(station, "master"), kind: "master", ref: masterDef.id, at: clampToFloor(station, [-4 + count * 1.8, -3.4]) };
      station.items.push(master);
      used.set(master.uid, new Set());
      slot = { master: master, port: 1 };
    }
    used.get(slot.master.uid).add(slot.port);
    sensor.master = slot.master.uid;
    sensor.port = slot.port;
  });
  return station;
}

function setPort(station, library, uid, masterUid, port) {
  const sensor = station.items.find((item) => item.uid === uid);
  if (!sensor) {
    return;
  }
  const other = station.items.find((item) => item.kind === "sensor" && item.uid !== uid && item.master === masterUid && item.port === port);
  if (other) {
    other.master = sensor.master;
    other.port = sensor.port;
  }
  sensor.master = masterUid;
  sensor.port = port;
  assignPorts(station, library);
}

function formatValue(value, unit) {
  const rounded = Math.round(value * 100) / 100;
  return rounded + (unit ? " " + unit : "");
}

// Check one sensor against its datasheet. Values the user enters are what
// happens at the machine. For an inductive sensor the material factor turns
// the real distance into the steel-equivalent value the sensor is set to.
function checkSensor(def, item) {
  const problems = [];
  const parameters = [];
  const factor = def.correction ? def.correction[item.target || "steel"] : 1;
  if (def.correction && !factor) {
    problems.push({ text: def.part + " has no filed correction factor for " + item.target + "." });
  }
  const values = {};
  (def.settings || []).forEach((setting) => {
    const given = item.settings ? item.settings[setting.key] : undefined;
    const raw = given === undefined ? setting.default : given;
    if (raw === null || raw === undefined || raw === "") {
      problems.push({ unset: true, text: "Set " + setting.name + " (" + setting.min + "–" + setting.max + " " + setting.unit + "). The " + (def.source_kind === "iodd" ? "IODD" : "datasheet") + " gives no default." });
      return;
    }
    const real = Number(raw);
    if (!Number.isFinite(real)) {
      problems.push({ text: setting.name + " is not a number." });
      return;
    }
    const scaled = setting.corrected && factor ? real / factor : real;
    if (scaled < setting.min || scaled > setting.max) {
      if (setting.corrected && factor && factor !== 1) {
        problems.push({ text: setting.name + " " + formatValue(real, setting.unit) + " on " + item.target + " needs " + formatValue(scaled, setting.unit) + " steel-equivalent. " + def.part + " allows " + setting.min + "–" + setting.max + " " + setting.unit + ", so " + item.target + " is reachable at " + formatValue(setting.min * factor, "") + "–" + formatValue(setting.max * factor, setting.unit) + "." });
      } else {
        problems.push({ text: setting.name + " must be " + setting.min + "–" + setting.max + " " + setting.unit + " on " + def.part + ". " + formatValue(real, setting.unit) + " is outside." });
      }
      return;
    }
    values[setting.key] = scaled;
    const entry = { name: setting.name, value: formatValue(scaled, setting.unit) };
    if (setting.corrected && factor && factor !== 1) {
      entry.note = formatValue(real, setting.unit) + " on " + item.target + " × 1/" + factor;
    }
    parameters.push(entry);
  });
  (def.settings || []).forEach((setting) => {
    const upper = setting.below && (def.settings || []).find((other) => other.key === setting.below);
    if (upper && values[setting.key] !== undefined && values[upper.key] !== undefined && values[setting.key] >= values[upper.key]) {
      problems.push({ text: setting.name + " must be below " + upper.name + "." });
    }
  });
  (def.options || []).forEach((option) => {
    const given = item.options ? item.options[option.key] : undefined;
    const value = given === undefined ? option.default : given;
    if (value === null || value === undefined || value === "") {
      problems.push({ unset: true, text: "Choose " + option.name + ": " + option.values.join(" or ") + "." });
      return;
    }
    if (option.values.indexOf(value) === -1) {
      problems.push({ text: option.name + " must be one of: " + option.values.join(", ") + "." });
      return;
    }
    parameters.push({ name: option.name, value: value });
  });
  const texts = problems.map((problem) => problem.text);
  return { ok: problems.length === 0, problems: texts, unset: problems.filter((problem) => problem.unset).map((problem) => problem.text), limits: problems.filter((problem) => !problem.unset).map((problem) => problem.text), parameters: parameters };
}

function checkStation(station, library) {
  const issues = [];
  station.items.forEach((item) => {
    const def = byId(library, item.ref);
    if (!def) {
      issues.push({ uid: item.uid, problem: item.ref + " is not in the library." });
      return;
    }
    if (item.kind !== "sensor") {
      return;
    }
    const check = checkSensor(def, item);
    check.limits.forEach((problem) => issues.push({ uid: item.uid, problem: problem }));
    check.unset.forEach((problem) => issues.push({ uid: item.uid, problem: problem, unset: true }));
    if (!item.master) {
      issues.push({ uid: item.uid, problem: def.part + " has no master port." });
    } else {
      const master = station.items.find((other) => other.uid === item.master);
      const masterDef = master && byId(library, master.ref);
      if (masterDef && def.port_class && masterDef.port_class && def.port_class !== masterDef.port_class && masterDef.port_class !== "A/B") {
        issues.push({ uid: item.uid, problem: def.part + " needs a port class " + def.port_class + " port." });
      }
    }
  });
  powerBudget(station, library).masters.forEach((master) => {
    master.problems.forEach((problem) => issues.push({ uid: master.uid, problem: problem }));
  });
  cables(station, library).forEach((cable) => {
    const master = station.items.find((item) => item.uid === cable.from);
    const def = master && byId(library, master.ref);
    const limit = (def && def.power && def.power.max_cable_m) || IOLINK_MAX_CABLE_M;
    if (cableLength(cable) > limit) {
      issues.push({ uid: cable.to, problem: "The cable from " + cable.from + " X" + cable.port + " to " + cable.to + " runs " + Math.round(cableLength(cable)) + " m. IO-Link allows " + limit + " m. Move the sensor or add a master closer to it." });
    }
  });
  return { ok: issues.length === 0, issues: issues };
}

// Sensor supply current per master port and per master, from the filed
// datasheet figures. Parts without a filed figure are listed, not guessed.
function powerBudget(station, library) {
  const masters = station.items.filter((item) => item.kind === "master").map((master) => {
    const def = byId(library, master.ref) || {};
    const limits = def.power || {};
    const ports = [];
    const unknown = [];
    const voltage = [];
    let total = 0;
    station.items.filter((item) => item.kind === "sensor" && item.master === master.uid).forEach((sensor) => {
      const sensorDef = byId(library, sensor.ref) || {};
      const ma = sensorDef.power && sensorDef.power.current_ma;
      if (typeof ma !== "number") {
        unknown.push(sensorDef.part || sensor.ref);
        return;
      }
      total += ma;
      ports.push({ port: sensor.port, uid: sensor.uid, part: sensorDef.part, ma: ma });
      const need = sensorDef.power.supply_v;
      const give = limits.supply_v;
      if (need && give && (give[0] < need[0] || give[1] > need[1])) {
        voltage.push(sensorDef.part + " runs on " + need[0] + "–" + need[1] + " V; " + def.part + " supplies " + give[0] + "–" + give[1] + " V.");
      }
    });
    const problems = voltage.slice();
    ports.forEach((row) => {
      if (limits.port_supply_a && row.ma > limits.port_supply_a * 1000) {
        problems.push(row.part + " on " + master.uid + " X" + row.port + " draws " + row.ma + " mA; the port supplies " + limits.port_supply_a * 1000 + " mA.");
      }
    });
    if (limits.total_supply_a && total > limits.total_supply_a * 1000) {
      problems.push(master.uid + " sensors draw " + total + " mA; " + def.part + " supplies " + limits.total_supply_a * 1000 + " mA in total.");
    }
    return { uid: master.uid, part: def.part, total_ma: total, port_limit_ma: limits.port_supply_a ? limits.port_supply_a * 1000 : null, total_limit_ma: limits.total_supply_a ? limits.total_supply_a * 1000 : null, ports: ports, unknown: unknown, problems: problems };
  });
  return { masters: masters };
}

// What a PLC engineer needs per port, read from the device's IODD.
function portTable(station, library) {
  return station.items.filter((item) => item.kind === "sensor" && item.master).sort((a, b) => (a.master + a.port).localeCompare(b.master + b.port, undefined, { numeric: true })).map((sensor) => {
    const def = byId(library, sensor.ref) || {};
    const iodd = def.iodd || {};
    return {
      master: sensor.master,
      port: sensor.port,
      uid: sensor.uid,
      part: def.part,
      vendor_id: def.vendor_id,
      device_id: def.device_id,
      min_cycle_ms: iodd.min_cycle_ms,
      bitrate: iodd.bitrate,
      pd_in_bits: iodd.pd_in_bits,
      pd_out_bits: iodd.pd_out_bits,
      pd_in: iodd.pd_in || [],
      iodd: iodd.file,
      parameters: checkSensor(def, sensor).parameters,
    };
  });
}

function csvRow(cells) {
  return cells.map((cell) => {
    const text = cell === undefined || cell === null ? "" : String(cell);
    return /[",\n]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
  }).join(",");
}

function orderCsv(station, library) {
  const rows = new Map();
  orderLines(station, library).forEach((line) => {
    const key = line.kind + "|" + line.part;
    const row = rows.get(key) || { qty: 0, kind: line.kind, vendor: line.vendor || "", part: line.part, vendor_id: line.vendor_id, device_id: line.device_id };
    row.qty += 1;
    rows.set(key, row);
  });
  return [csvRow(["qty", "kind", "vendor", "part", "vendor_id", "device_id"])].concat(Array.from(rows.values()).map((row) => csvRow([row.qty, row.kind, row.vendor, row.part, row.vendor_id, row.device_id]))).join("\n") + "\n";
}

function portCsv(station, library) {
  return [csvRow(["master", "port", "tag", "part", "vendor_id", "device_id", "min_cycle_ms", "pd_in_bits", "pd_in_layout", "settings", "iodd"])].concat(portTable(station, library).map((row) => csvRow([
    row.master, "X" + row.port, row.uid, row.part, row.vendor_id, row.device_id, row.min_cycle_ms, row.pd_in_bits,
    row.pd_in.map((item) => item.name + "@" + item.bit_offset + ":" + item.bits).join("; "),
    row.parameters.map((p) => p.name + "=" + p.value).join("; "),
    row.iodd,
  ]))).join("\n") + "\n";
}

function portPoint(master, port, ports) {
  const spread = 1.0;
  const offset = ports > 1 ? ((port - 1) / (ports - 1) - 0.5) * spread : 0;
  return [master.at[0] + offset, 0.5, master.at[1] + 0.4];
}

function cables(station, library) {
  const floor = 0.02;
  return station.items.filter((item) => item.kind === "sensor" && item.master).map((sensor) => {
    const master = station.items.find((item) => item.uid === sensor.master);
    if (!master) {
      return null;
    }
    const def = byId(library, sensor.ref);
    const start = portPoint(master, sensor.port, masterPorts(library, master));
    const lane = (sensor.port - 1) * 0.12;
    return {
      id: sensor.master + "-port-" + sensor.port,
      from: master.uid,
      to: sensor.uid,
      part: def ? def.part : sensor.ref,
      port: sensor.port,
      conductors: CONDUCTORS.slice(),
      path: [
        start,
        [start[0], floor, start[2] + lane],
        [sensor.at[0], floor, start[2] + lane],
        [sensor.at[0], floor, sensor.at[1]],
        [sensor.at[0], SENSOR_HEIGHT, sensor.at[1]],
      ],
    };
  }).filter(Boolean);
}

function cableLength(cable) {
  let total = 0;
  for (let i = 1; i < cable.path.length; i++) {
    const a = cable.path[i - 1];
    const b = cable.path[i];
    total += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }
  return total;
}

// Standard M12 cable lengths an installer stocks, in metres, up to the IO-Link limit.
const CABLE_STOCK = [1, 2, 5, 10, 15, 20];

function orderLines(station, library) {
  const lines = [];
  station.items.forEach((item) => {
    if (item.kind === "equipment") {
      return;
    }
    const def = byId(library, item.ref);
    if (!def) {
      return;
    }
    const line = { uid: item.uid, kind: item.kind, part: def.part, vendor: def.vendor, vendor_id: def.vendor_id, device_id: def.device_id };
    if (item.kind === "sensor") {
      line.port = item.port;
      line.master = item.master;
      line.parameters = checkSensor(def, item).parameters;
    }
    lines.push(line);
  });
  cables(station, library).forEach((cable) => {
    const need = cableLength(cable) * 1.2;
    const length = CABLE_STOCK.find((size) => size >= need) || CABLE_STOCK[CABLE_STOCK.length - 1];
    lines.push({ kind: "cable", part: "M12 A-coded 3/4-pole cable, " + length + " m", conductors: cable.conductors, from: cable.from, port: cable.port, to: cable.to });
  });
  return lines;
}

function buyStation(station, library, buyer) {
  const check = checkStation(station, library);
  const lines = orderLines(station, library);
  if (!lines.some((line) => line.kind === "sensor")) {
    return { ok: false, paid: false, reason: "Add a sensor. There is nothing to buy." };
  }
  const email = String(buyer && buyer.email || "").trim();
  const plant = String(buyer && buyer.plant || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, paid: false, reason: "Enter the email for this order." };
  }
  if (plant.length < 2) {
    return { ok: false, paid: false, reason: "Enter the plant where iolinki will install the station." };
  }
  return {
    ok: true,
    paid: false,
    bought: false,
    installed: false,
    action: "iolinki buys these parts and installs the station",
    email: email,
    plant: plant,
    lines: lines,
    notes: check.issues.map((issue) => issue.problem),
    link: encodeStation(station),
  };
}

function orderText(order) {
  const rows = order.lines.map((line) => {
    if (line.kind === "cable") {
      return "- " + line.part + ": " + line.from + " port " + line.port + " to " + line.to;
    }
    let row = "- " + line.vendor + " " + line.part + (line.device_id ? " (vendor " + line.vendor_id + ", device " + line.device_id + ")" : "");
    if (line.kind === "sensor") {
      row += " on " + line.master + " port " + line.port + ": " + line.parameters.map((p) => p.name + " " + p.value).join(", ");
    }
    return row;
  });
  return [
    "iolinki buys these parts and installs the station.",
    "Plant: " + order.plant,
    "Email: " + order.email,
    "",
    rows.join("\n"),
    "",
    order.notes && order.notes.length ? "Notes to check before install:\n" + order.notes.map((note) => "- " + note).join("\n") + "\n" : "",
    "Station: " + order.link,
    "Payment is not taken on the studio page. Settings have not been written to a sensor.",
  ].join("\n");
}

function orderMail(order) {
  return "mailto:andrii@shylenko.com?subject=" + encodeURIComponent("iolinki station install, " + order.plant) + "&body=" + encodeURIComponent(orderText(order));
}

function toBase64Url(text) {
  const bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text) : Buffer.from(text, "utf8");
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const base = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return base.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const base = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = typeof atob !== "undefined" ? atob(base) : Buffer.from(base, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return typeof TextDecoder !== "undefined" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("utf8");
}

const STUDIO_URL = "https://iolinki.com/studio/";

function encodeStation(station) {
  return STUDIO_URL + "#s=" + toBase64Url(JSON.stringify(station));
}

function decodeStation(hash, library) {
  const match = String(hash || "").match(/s=([A-Za-z0-9_-]+)/);
  if (!match) {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(fromBase64Url(match[1]));
  } catch (error) {
    return null;
  }
  return fromSpec(raw, library).station;
}

// Build a station from a structured spec. This is the ChatGPT entry point:
// ChatGPT does the planning and names parts, settings, and equipment; this
// function checks every part against the library and returns what is wrong.
function fromSpec(spec, library) {
  const station = newStation();
  const unknown = [];
  const rank = { master: 0, equipment: 1, sensor: 2 };
  const entries = ((spec && spec.items) || []).map((entry) => {
    const ref = resolveRef(library, entry.ref || entry.part);
    if (!ref) {
      unknown.push(String(entry.ref || entry.part));
    }
    return { entry: entry, ref: ref };
  }).filter((pair) => pair.ref);
  entries.sort((a, b) => rank[kindOf(library, a.ref)] - rank[kindOf(library, b.ref)]);
  entries.forEach((pair) => {
    const entry = pair.entry;
    const at = Array.isArray(entry.at) ? [Number(entry.at[0]) || 0, Number(entry.at[1]) || 0] : null;
    const item = addItem(station, library, pair.ref, at, true);
    if (entry.uid && !station.items.some((other) => other !== item && other.uid === String(entry.uid))) {
      item.uid = String(entry.uid);
    }
    if (item.kind === "sensor") {
      Object.keys(entry.settings || {}).forEach((key) => {
        const value = entry.settings[key];
        item.settings[key] = value === null || value === "" ? null : Number(value);
      });
      Object.keys(entry.options || {}).forEach((key) => {
        item.options[key] = entry.options[key];
      });
      if (entry.target) {
        item.target = String(entry.target).toLowerCase();
      }
      if (entry.master) {
        item.master = String(entry.master);
        item.port = Number(entry.port);
      }
    }
  });
  assignPorts(station, library);
  const check = checkStation(station, library);
  unknown.forEach((ref) => check.issues.push({ uid: null, problem: ref + " is not in the library. Search the catalog; only parts with a filed datasheet can be placed." }));
  check.ok = check.issues.length === 0;
  return { station: station, check: check };
}

function resolveRef(library, name) {
  const wanted = String(name || "").toLowerCase();
  if (!wanted) {
    return null;
  }
  const all = (library.sensors || []).concat(library.masters || [], library.equipment || []);
  const hit = all.find((def) => def.id.toLowerCase() === wanted) || all.find((def) => String(def.part || "").toLowerCase() === wanted);
  return hit ? hit.id : null;
}

function describeLibrary(library) {
  return {
    sensors: (library.sensors || []).map((def) => ({
      ref: def.id,
      part: def.part,
      vendor: def.vendor,
      category: def.category,
      measures: def.measures,
      settings: def.settings,
      options: def.options,
      materials: def.correction ? Object.keys(def.correction) : undefined,
      source_url: def.source_url,
    })),
    masters: (library.masters || []).map((def) => ({ ref: def.id, part: def.part, vendor: def.vendor, ports: def.ports, port_class: def.port_class })),
    equipment: (library.equipment || []).map((def) => ({ ref: def.id, name: def.name })),
    floor_m: FLOOR,
  };
}

// The page's text box. This is keyword matching, not ChatGPT: it picks the one
// filed sensor whose job words match, reads one number in that sensor's unit,
// and opens the filed application around it. Anything else stays closed.
function planFromText(text, library) {
  const job = String(text || "").toLowerCase();
  if (job.trim() === "") {
    return { opened: false, reason: "Describe the job: what to detect or measure, and the value." };
  }
  const sensors = library.sensors || [];
  const candidates = sensors.filter((def) => (def.job_words || []).some((word) => hasWord(job, word)));
  const usable = candidates.filter((def) => !(def.refused || []).some((word) => hasWord(job, word)));
  if (usable.length === 0) {
    const refusal = candidates.map((def) => {
      const word = (def.refused || []).find((refused) => hasWord(job, refused));
      return def.part + " measures " + def.measures + ". It cannot do this job: " + word + ".";
    })[0];
    return { opened: false, reason: refusal || "No filed sensor covers this job. Filed: " + sensors.map((def) => def.part + " (" + def.category + ")").join(", ") + "." };
  }
  const ranked = usable.map((def) => {
    const setting = (def.settings || [])[0];
    const value = setting ? readValue(job, setting.unit) : null;
    const fits = value !== null && value >= setting.min * minFactor(def) && value <= setting.max;
    const words = (def.job_words || []).filter((word) => hasWord(job, word)).length;
    return { def: def, score: (fits ? 10 : value !== null ? 5 : 0) + words };
  }).sort((a, b) => b.score - a.score);
  const def = ranked[0].def;
  const application = (library.applications || []).find((app) => app.sensor === def.id);
  if (!application) {
    return { opened: false, reason: "No application is filed for " + def.part + "." };
  }
  const spec = { items: application.items.map((entry) => Object.assign({}, entry)) };
  const mount = spec.items.find((entry) => entry.ref === def.id);
  mount.settings = {};
  mount.options = {};
  const setting = (def.settings || [])[0];
  if (setting) {
    const value = readValue(job, setting.unit);
    if (value !== null) {
      mount.settings[setting.key] = value;
    }
  }
  (def.options || []).forEach((option) => {
    const picked = option.values.find((value) => hasWord(job, value.toLowerCase()) || (option.aliases && (option.aliases[value] || []).some((alias) => hasWord(job, alias))));
    if (picked) {
      mount.options[option.key] = picked;
    }
  });
  if (def.correction) {
    mount.target = Object.keys(def.correction).find((material) => hasWord(job, material)) || "steel";
  }
  const built = fromSpec(spec, library);
  const limits = built.check.issues.filter((issue) => !issue.unset);
  if (limits.length > 0) {
    return { opened: false, reason: limits[0].problem };
  }
  return {
    opened: true,
    application_id: application.id,
    title: application.title,
    station: built.station,
    todo: built.check.issues.map((issue) => issue.problem),
    written_to_sensor: false,
  };
}

// The smallest real value a corrected setting can reach on any filed material.
function minFactor(def) {
  return def.correction ? Math.min.apply(null, Object.values(def.correction)) : 1;
}

function hasWord(text, word) {
  const escaped = String(word).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])" + escaped + "($|[^a-z0-9])").test(text);
}

const UNIT_WORDS = { "°c": ["°c", "degc", "deg c", "c", "degrees"], "m/s": ["m/s"], "bar": ["bar"], "mm": ["mm"], "%": ["%", "percent"] };

function readValue(job, unit) {
  const key = String(unit || "").toLowerCase();
  const words = (UNIT_WORDS[key] || [key]).map((word) => word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
  const match = job.match(new RegExp("(-?\\d+(?:[.,]\\d+)?)\\s*(?:" + words + ")(?![a-z])"));
  return match ? Number(match[1].replace(",", ".")) : null;
}

// Live IODD Finder search goes through the iolinki catalog Worker. Rows are
// identity only; a row is placeable only when its limits are filed here.
const CATALOG_SEARCH = "https://iolinki-iodd-catalog.shylenkoa.workers.dev/search";

function markFiled(library, rows) {
  const seen = new Set();
  const hits = [];
  (rows || []).forEach((row) => {
    const hit = { vendor: row.vendorName, vendor_id: row.vendorId, device_id: row.deviceId, iodd_id: row.ioddId, part: row.productName, revision: row.ioLinkRev };
    const key = hit.vendor_id + ":" + hit.device_id + ":" + String(hit.part).toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const filed = (library.sensors || []).find((def) => !def.source_kind && def.vendor_id === hit.vendor_id && def.device_id === hit.device_id && def.part.toLowerCase() === String(hit.part).toLowerCase());
    hit.filed = filed ? filed.id : null;
    hits.push(hit);
  });
  hits.sort((a, b) => (b.filed ? 1 : 0) - (a.filed ? 1 : 0));
  return hits;
}

// LabWired-style diagram: parts placed on the floor, wires from a master port
// (pin "X1".."Xn") to a sensor (pin "C/Q"). ChatGPT sends this; the result
// says what is wrong with it, part by part and wire by wire.
function fromDiagram(diagram, library) {
  const parts = (diagram && diagram.parts) || [];
  const wires = (diagram && diagram.wires) || [];
  const wireIssues = [];
  const byPart = new Map(parts.map((part) => [String(part.id), part]));
  const items = parts.map((part) => ({
    uid: String(part.id),
    ref: part.type,
    at: [Number(part.x) || 0, Number(part.z !== undefined ? part.z : part.y) || 0],
    settings: part.settings,
    options: part.options,
    target: part.target,
  }));
  const wired = new Set();
  wires.forEach((wire) => {
    const ends = [wire.from, wire.to].filter(Boolean);
    const portEnd = ends.find((end) => /^X\d+$/i.test(String(end.pin)));
    const sensorEnd = ends.find((end) => end !== portEnd);
    if (!portEnd || !sensorEnd) {
      wireIssues.push({ uid: null, problem: "A wire must run from a master port pin (X1, X2, ...) to a sensor pin C/Q." });
      return;
    }
    const master = byPart.get(String(portEnd.part));
    const sensor = byPart.get(String(sensorEnd.part));
    const masterKind = master && kindOf(library, resolveRef(library, master.type));
    const sensorKind = sensor && kindOf(library, resolveRef(library, sensor.type));
    if (masterKind !== "master" || sensorKind !== "sensor") {
      wireIssues.push({ uid: sensorEnd.part, problem: "Wire " + portEnd.part + "." + portEnd.pin + " → " + sensorEnd.part + "." + sensorEnd.pin + " must join a master port to a sensor." });
      return;
    }
    if (wired.has(String(sensor.id))) {
      wireIssues.push({ uid: sensor.id, problem: sensor.id + " is wired twice. One sensor takes one master port." });
      return;
    }
    wired.add(String(sensor.id));
    const item = items.find((entry) => entry.uid === String(sensor.id));
    item.master = String(master.id);
    item.port = Number(String(portEnd.pin).slice(1));
  });
  const built = fromSpec({ items: items }, library);
  // Ports ChatGPT asked for that do not exist or collide are reassigned by
  // assignPorts; say so rather than silently rewiring.
  items.forEach((entry) => {
    if (!entry.master) {
      return;
    }
    const placed = built.station.items.find((item) => item.uid === entry.uid);
    if (placed && (placed.master !== entry.master || placed.port !== entry.port)) {
      wireIssues.push({ uid: entry.uid, problem: entry.uid + " asked for " + entry.master + " X" + entry.port + ", which is missing or taken. It was moved to " + placed.master + " X" + placed.port + "." });
    }
  });
  built.check.issues = built.check.issues.concat(wireIssues);
  built.check.ok = built.check.issues.length === 0;
  return built;
}

function toDiagram(station, library) {
  return {
    parts: station.items.map((item) => {
      const part = { id: item.uid, type: item.ref, x: item.at[0], z: item.at[1] };
      if (item.kind === "sensor") {
        part.settings = item.settings;
        part.options = item.options;
        if (item.target) {
          part.target = item.target;
        }
      }
      return part;
    }),
    wires: station.items.filter((item) => item.kind === "sensor" && item.master).map((item) => ({
      from: { part: item.master, pin: "X" + item.port },
      to: { part: item.uid, pin: "C/Q" },
    })),
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    newStation, addItem, removeItem, assignPorts, setPort, checkSensor, checkStation, cables, orderLines,
    buyStation, orderText, orderMail, encodeStation, decodeStation, fromSpec, describeLibrary, planFromText,
    markFiled, fromDiagram, toDiagram, byId, FLOOR, SENSOR_HEIGHT, CATALOG_SEARCH,
    powerBudget, portTable, orderCsv, portCsv, cableLength,
  };
}
