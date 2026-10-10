"use strict";

// Engineering deliverables for a station: the commissioning file (what an
// IO-Link port configuration tool such as S7-PCT, the Balluff Engineering Tool
// or ifm moneo configure holds per master port) and the printable station report.
//
// COMMISSIONING FILE, JSON schema "iolinki.commissioning" version 1
// {
//   schema: "iolinki.commissioning", version: 1,
//   generated_at: ISO date, generated_by: "iolinki station studio",
//   station: { title, link },
//   masters: [{
//     uid, part, vendor, vendor_id, fieldbus, port_count,
//     ports: [{
//       port,                         // 1-based, "X<port>" on the master
//       mode: "iolink" | "deactivated",
//       tag, device: null | {         // null on a deactivated port
//         part, vendor, vendor_id, device_id, iodd_file, bitrate,
//         validation: { recommended: "type_compatible", vendor_id, device_id,
//                       alternatives: ["none", "type_compatible", "identical"],
//                       serial_number: null },   // identical needs the serial read at commissioning
//         data_storage: { recommended: "backup_restore" | "disabled", note },
//         cycle_time_ms: { device_min, recommended },   // master cycle must be >= device_min
//         process_data: { in_bits, in_bytes, out_bits, out_bytes,
//                         in_layout: [{ name, bit_offset, bits, gradient, unit }] },
//         parameters: [{
//           key, name, kind: "setting" | "option", unit,
//           value,                    // engineering value as written to the device (after correction)
//           entered, note,            // value on the real target when corrected (inductive)
//           index, subindex,          // ISDU address, null when not filed
//           datatype, bit_length,     // null when not filed
//           raw, raw_hex,             // integer written, null when it cannot be derived
//           clamped,                  // raw was limited to the legal raw range
//           status: "ok" | "assumed_scale" | "unknown_scale" | "no_index" | "no_raw"
//         }]
//       }
//     }]
//   }],
//   warnings: [string]
// }
// Raw = round((value - offset) / gradient), clamped to the raw range of the
// parameter. A setting without a structured `write` object falls back to the
// human `iodd_index` string ("583 (SP_FH1, 10-1000 x 0.1 bar)"). Nothing is
// written to a device by this file; it is what the engineer enters or imports.

const X = typeof module !== "undefined" && module.exports ? require("./engine.js") : {
  byId, checkSensor, checkStation, cables, cableLength, powerBudget, portTable, orderLines, CABLE_STOCK, masterPorts,
};

const EXPORT_SCHEMA = "iolinki.commissioning";
const EXPORT_VERSION = 1;

function round(value, digits) {
  const f = Math.pow(10, digits === undefined ? 0 : digits);
  return Math.round(value * f) / f;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Structured write info for a setting or option, or null when only a
// description exists. Prefers setting.write; falls back to the iodd_index text.
function writeInfo(entry) {
  if (entry.write && numberOrNull(entry.write.index) !== null) {
    const w = entry.write;
    return {
      index: w.index, subindex: numberOrNull(w.subindex) === null ? 0 : w.subindex,
      datatype: w.datatype || null, bit_length: numberOrNull(w.bitLength) !== null ? w.bitLength : numberOrNull(w.bit_length),
      gradient: numberOrNull(w.gradient) === null ? 1 : w.gradient, offset: numberOrNull(w.offset) === null ? 0 : w.offset,
      raw_min: numberOrNull(w.raw_min), raw_max: numberOrNull(w.raw_max), scale: "known",
    };
  }
  const text = String(entry.iodd_index || "");
  const head = text.match(/^\s*(\d+)(?:\.(\d+))?/);
  if (!head) {
    return null;
  }
  const info = { index: Number(head[1]), subindex: head[2] === undefined ? 0 : Number(head[2]), datatype: null, bit_length: null, gradient: 1, offset: 0, raw_min: null, raw_max: null, scale: "assumed" };
  if (/without scaling/i.test(text)) {
    info.scale = "unknown";
    return info;
  }
  const range = text.match(/(-?\d+(?:\.\d+)?)\s*[–—]\s*(-?\d+(?:\.\d+)?)(?:\s*[×x]\s*(-?\d*\.?\d+))?/);
  if (range) {
    info.raw_min = Number(range[1]);
    info.raw_max = Number(range[2]);
    if (range[3] !== undefined) {
      info.gradient = Number(range[3]);
      info.scale = "known";
    }
  }
  return info;
}

function dataRange(info) {
  let lo = info.raw_min;
  let hi = info.raw_max;
  const bits = info.bit_length;
  if (bits && info.datatype) {
    const signed = /^Integer/i.test(info.datatype);
    const dlo = signed ? -Math.pow(2, bits - 1) : 0;
    const dhi = signed ? Math.pow(2, bits - 1) - 1 : Math.pow(2, bits) - 1;
    lo = lo === null ? dlo : Math.max(lo, dlo);
    hi = hi === null ? dhi : Math.min(hi, dhi);
  }
  return [lo, hi];
}

function rawHex(raw, bits) {
  if (!bits || raw === null) {
    return null;
  }
  const bytes = Math.ceil(bits / 8);
  const mod = Math.pow(2, bytes * 8);
  const value = ((raw % mod) + mod) % mod;
  const text = value.toString(16).toUpperCase().padStart(bytes * 2, "0");
  return text.match(/.{2}/g).join(" ");
}

// Engineering value to the integer the device stores.
function toRaw(value, info) {
  if (info.scale === "unknown") {
    return { raw: null, clamped: false };
  }
  let raw = Math.round((value - info.offset) / info.gradient);
  const range = dataRange(info);
  let clamped = false;
  if (range[0] !== null && raw < range[0]) {
    raw = range[0];
    clamped = true;
  }
  if (range[1] !== null && raw > range[1]) {
    raw = range[1];
    clamped = true;
  }
  return { raw: raw, clamped: clamped };
}

// Option raw values: option.raw is either an array parallel to option.values
// or an object keyed by the label.
function optionRaw(option, label) {
  if (Array.isArray(option.raw)) {
    const at = option.values.indexOf(label);
    return at >= 0 && numberOrNull(option.raw[at]) !== null ? option.raw[at] : null;
  }
  if (option.raw && typeof option.raw === "object" && numberOrNull(option.raw[label]) !== null) {
    return option.raw[label];
  }
  return null;
}

function parameterWrites(def, item) {
  const check = X.checkSensor(def, item);
  const rows = [];
  check.parameters.forEach((param) => {
    const entry = (param.kind === "option" ? def.options : def.settings || []).find((candidate) => candidate.key === param.key) || {};
    const info = writeInfo(entry);
    const row = {
      key: param.key, name: param.name, kind: param.kind, unit: param.unit || "",
      value: param.kind === "option" ? param.value : round(param.number, 4),
      entered: null, note: param.note || null,
      index: info ? info.index : null, subindex: info ? info.subindex : null,
      datatype: info ? info.datatype : null, bit_length: info ? info.bit_length : null,
      raw: null, raw_hex: null, clamped: false, status: "no_index",
    };
    if (param.kind === "setting") {
      const given = item.settings ? item.settings[param.key] : undefined;
      const entered = given === undefined ? entry.default : Number(given);
      row.entered = numberOrNull(entered);
      if (info) {
        const out = toRaw(param.number, info);
        row.raw = out.raw;
        row.clamped = out.clamped;
        row.raw_hex = rawHex(out.raw, info.bit_length);
        row.status = info.scale === "unknown" ? "unknown_scale" : info.scale === "assumed" ? "assumed_scale" : "ok";
      }
    } else {
      const raw = optionRaw(entry, param.value);
      if (info && raw !== null) {
        row.raw = raw;
        row.raw_hex = rawHex(raw, info.bit_length);
        row.status = "ok";
      } else if (info) {
        row.status = "no_raw";
      }
    }
    rows.push(row);
  });
  return rows;
}

// IO-Link master cycle time encoding: 0.4-6.3 ms in 0.1 ms steps, 6.4-31.6 ms
// in 0.4 ms steps, 32-132.8 ms in 1.6 ms steps.
function cycleFor(minMs) {
  if (!(minMs > 0)) {
    return null;
  }
  if (minMs <= 6.3) {
    return round(Math.max(0.4, Math.ceil(minMs * 10 - 1e-9) / 10), 1);
  }
  if (minMs <= 31.6) {
    return round(6.4 + Math.ceil((minMs - 6.4) / 0.4 - 1e-9) * 0.4, 1);
  }
  return Math.min(132.8, round(32 + Math.ceil((minMs - 32) / 1.6 - 1e-9) * 1.6, 1));
}

function commissioning(station, library, opts) {
  const options = opts || {};
  const warnings = [];
  const masters = station.items.filter((item) => item.kind === "master").map((master) => {
    const def = X.byId(library, master.ref) || {};
    const count = X.masterPorts(library, master);
    const ports = [];
    for (let port = 1; port <= count; port++) {
      const sensor = station.items.find((item) => item.kind === "sensor" && item.master === master.uid && item.port === port);
      if (!sensor) {
        ports.push({ port: port, mode: "deactivated", tag: null, device: null });
        continue;
      }
      const sdef = X.byId(library, sensor.ref) || {};
      const iodd = sdef.iodd || {};
      const parameters = parameterWrites(sdef, sensor);
      const inBits = iodd.pd_in_bits || 0;
      const outBits = iodd.pd_out_bits || 0;
      if (!iodd.file) {
        warnings.push(sensor.uid + " (" + sdef.part + "): no IODD filed, process data layout and cycle time are not known.");
      }
      parameters.forEach((p) => {
        if (p.status === "no_index") {
          warnings.push(sensor.uid + " " + p.name + ": ISDU index not filed, set it in the parameterisation tool.");
        } else if (p.status === "unknown_scale" || p.status === "no_raw") {
          warnings.push(sensor.uid + " " + p.name + ": raw value cannot be derived from the filed data, enter " + p.value + (p.unit ? " " + p.unit : "") + " in the tool.");
        } else if (p.status === "assumed_scale") {
          warnings.push(sensor.uid + " " + p.name + ": scale assumed 1:1 from the filed range, check against the IODD.");
        }
        if (p.clamped) {
          warnings.push(sensor.uid + " " + p.name + ": raw value limited to the legal range.");
        }
      });
      ports.push({
        port: port, mode: "iolink", tag: sensor.uid,
        device: {
          part: sdef.part, vendor: sdef.vendor || null, vendor_id: sdef.vendor_id, device_id: sdef.device_id,
          iodd_file: iodd.file || null, bitrate: iodd.bitrate || null,
          validation: { recommended: "type_compatible", vendor_id: sdef.vendor_id, device_id: sdef.device_id, alternatives: ["none", "type_compatible", "identical"], serial_number: null },
          data_storage: parameters.length
            ? { recommended: "backup_restore", note: "Parameters are kept in the master so a replacement device is loaded automatically. Needs a device that supports data storage; check the IODD." }
            : { recommended: "disabled", note: "No parameters are written to this device." },
          cycle_time_ms: { device_min: numberOrNull(iodd.min_cycle_ms), recommended: cycleFor(iodd.min_cycle_ms) },
          process_data: {
            in_bits: inBits, in_bytes: Math.ceil(inBits / 8), out_bits: outBits, out_bytes: Math.ceil(outBits / 8),
            in_layout: (iodd.pd_in || []).map((field) => ({ name: field.name, bit_offset: field.bit_offset, bits: field.bits, gradient: field.gradient === undefined ? null : field.gradient, unit: field.unit || null })),
          },
          parameters: parameters,
        },
      });
    }
    return { uid: master.uid, part: def.part, vendor: def.vendor || null, vendor_id: def.vendor_id === undefined ? null : def.vendor_id, fieldbus: def.fieldbus || null, port_count: count, ports: ports };
  });
  return {
    schema: EXPORT_SCHEMA, version: EXPORT_VERSION,
    generated_at: options.date || new Date().toISOString(), generated_by: "iolinki station studio",
    station: { title: options.title || "IO-Link station", link: options.link || null },
    masters: masters, warnings: warnings,
  };
}

function commissioningJson(station, library, opts) {
  return JSON.stringify(commissioning(station, library, opts), null, 2) + "\n";
}

function csvCell(cell) {
  const text = cell === undefined || cell === null ? "" : String(cell);
  return /[",\n]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
}

const COMMISSIONING_COLUMNS = ["master", "port", "mode", "tag", "part", "vendor_id", "device_id", "validation", "data_storage", "cycle_min_ms", "cycle_recommended_ms", "pd_in_bytes", "pd_out_bytes", "parameter", "kind", "value", "unit", "isdu_index", "isdu_subindex", "datatype", "raw", "raw_hex", "status"];

function commissioningCsv(station, library, opts) {
  const file = commissioning(station, library, opts);
  const lines = [COMMISSIONING_COLUMNS.join(",")];
  file.masters.forEach((master) => {
    master.ports.forEach((port) => {
      const base = [master.uid, "X" + port.port, port.mode, port.tag];
      if (!port.device) {
        lines.push(base.concat(new Array(COMMISSIONING_COLUMNS.length - base.length).fill("")).map(csvCell).join(","));
        return;
      }
      const d = port.device;
      const head = base.concat([d.part, d.vendor_id, d.device_id, d.validation.recommended, d.data_storage.recommended, d.cycle_time_ms.device_min, d.cycle_time_ms.recommended, d.process_data.in_bytes, d.process_data.out_bytes]);
      if (!d.parameters.length) {
        lines.push(head.concat(new Array(COMMISSIONING_COLUMNS.length - head.length).fill("")).map(csvCell).join(","));
      }
      d.parameters.forEach((p) => lines.push(head.concat([p.name, p.kind, p.value, p.unit, p.index, p.subindex, p.datatype, p.raw, p.raw_hex, p.status]).map(csvCell).join(",")));
    });
  });
  return lines.join("\n") + "\n";
}

// ---- Station report -------------------------------------------------------

function esc(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

const REPORT_CSS = `
@page { size: A4; margin: 18mm 14mm 16mm; @top-left { content: "IO-Link station report"; font: 9pt Helvetica, Arial, sans-serif; color: #66707d; } @bottom-left { content: "iolinki station studio"; font: 9pt Helvetica, Arial, sans-serif; color: #66707d; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt Helvetica, Arial, sans-serif; color: #66707d; } }
* { box-sizing: border-box; }
html { background: #e9ecf0; }
body { margin: 0 auto; overflow-wrap: break-word; max-width: 210mm; padding: 14mm; background: #fff; color: #14171c; font: 10pt/1.4 "Source Sans Pro", Helvetica, Arial, sans-serif; }
h1 { font-size: 22pt; margin: 0 0 2pt; letter-spacing: -.01em; }
h2 { font-size: 13pt; margin: 0 0 8pt; padding-bottom: 4pt; border-bottom: 2px solid #14171c; }
h2 span { color: #66707d; font-weight: 400; margin-right: 6pt; }
h3 { font-size: 10pt; margin: 12pt 0 4pt; text-transform: uppercase; letter-spacing: .04em; color: #3b4450; }
p { margin: 4pt 0; }
.small, .muted { color: #66707d; font-size: 8.5pt; }
section { padding-top: 6pt; padding-right: 1px; }
section + section { margin-top: 16pt; }
.title-block { display: grid; min-width: 0; grid-template-columns: 2fr 1fr 1fr; border: 1.5px solid #14171c; margin: 10pt 0 14pt; }
.title-block div { padding: 5pt 8pt; border-right: 1px solid #14171c; border-bottom: 1px solid #14171c; }
.title-block div:nth-child(3n) { border-right: 0; }
.title-block div:nth-last-child(-n+3) { border-bottom: 0; }
.title-block small { display: block; color: #66707d; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; }
.title-block b { font-size: 10.5pt; }
.snapshot { width: 100%; max-height: 105mm; object-fit: cover; border: 1px solid #c9cfd8; display: block; margin: 8pt 0; }
.link { word-break: break-all; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; font-size: 8.8pt; margin: 4pt 0 8pt; }
th, td { text-align: left; vertical-align: top; padding: 3.5pt 6pt; border: 1px solid #c9cfd8; }
th { background: #eef1f5; font-size: 7.8pt; text-transform: uppercase; letter-spacing: .03em; color: #3b4450; }
tr { break-inside: avoid; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
code, .mono { font: 8.5pt ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
.tag { display: inline-block; border: 1px solid #c9cfd8; border-radius: 3px; padding: 0 4pt; font-size: 7.8pt; color: #3b4450; background: #f6f7f9; }
.tag.warn { border-color: #e0b84a; background: #fff4d6; color: #8a5a00; }
.tag.ok { border-color: #9ccfae; background: #ecf8f0; color: #1d7a3a; }
.notes { border-left: 4px solid #e0a000; background: #fff8e5; padding: 6pt 10pt; margin: 6pt 0; }
.notes ul, .checks ul { margin: 3pt 0 3pt 14pt; padding: 0; }
.checks li { list-style: none; margin-left: -14pt; }
.checks li::before { content: "\\2610\\00a0"; }
.wiring-box { border: 1px solid #c9cfd8; padding: 8pt; overflow: hidden; }
svg.wiring { font-family: inherit; max-width: 100%; height: auto; }
.w-master { fill: #eaf1fd; stroke: #8db4f5; } .w-sensor { fill: #fff3ea; stroke: #ffb27a; } .w-sensor.warn { fill: #fff6e0; stroke: #ffb020; }
.w-title { font-size: 13px; font-weight: 650; fill: #14171c; } .w-sub { font-size: 11px; font-weight: 400; fill: #66707d; }
.w-portname { font-size: 12px; font-weight: 600; fill: #3b4450; } .w-port { fill: #fff; stroke: #9aa3b2; stroke-width: 1.5; } .w-port.used { fill: #23262b; stroke: #23262b; }
.w-free { font-size: 11px; fill: #9aa3b2; } .w-cable { fill: none; stroke: #23262b; stroke-width: 3; } .w-wires { font-size: 10px; fill: #66707d; }
.bar { height: 7pt; background: #eef1f5; border: 1px solid #c9cfd8; width: 90pt; display: inline-block; vertical-align: middle; margin-right: 4pt; }
.bar i { display: block; height: 100%; background: #2d6cdf; }
.bar.over i { background: #c0392b; }
.toolbar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: flex-end; margin: -14mm -14mm 10mm; padding: 8px 14mm; background: #14171c; }
.toolbar button { font: 600 10pt Helvetica, Arial, sans-serif; border: 0; border-radius: 6px; padding: 6px 14px; background: #fff; color: #14171c; cursor: pointer; }
@media print {
  html { background: #fff; }
  body { padding: 0; max-width: none; }
  .toolbar { display: none; }
  section.page { break-before: page; margin-top: 0; }
  .wiring-box, .snapshot { break-inside: avoid; }
}
`;

function fmtCycle(value) {
  return value === null || value === undefined ? "auto" : value + " ms";
}

function reportHtml(station, library, opts) {
  const options = opts || {};
  const file = commissioning(station, library, options);
  const title = options.title || "IO-Link station";
  const date = String(file.generated_at).slice(0, 10);
  const issues = X.checkStation(station, library).issues;
  const power = X.powerBudget(station, library).masters;
  const cableRows = X.cables(station, library).map((cable) => {
    const length = X.cableLength(cable);
    const need = length * 1.2;
    const stock = X.CABLE_STOCK.find((size) => size >= need) || X.CABLE_STOCK[X.CABLE_STOCK.length - 1];
    return { from: cable.from, port: cable.port, to: cable.to, part: cable.part, length: length, stock: stock, over: length > 20 };
  });
  const wiring = typeof options.wiringSvg === "function" ? options.wiringSvg(station, library) : (typeof wiringSvg === "function" ? wiringSvg(station, library) : "");
  const sensors = station.items.filter((item) => item.kind === "sensor").length;
  const masters = file.masters.length;
  const used = file.masters.reduce((sum, m) => sum + m.ports.filter((p) => p.mode === "iolink").length, 0);
  const portRows = [];
  const writeRows = [];
  file.masters.forEach((master) => master.ports.forEach((port) => {
    const at = master.uid + " X" + port.port;
    if (!port.device) {
      portRows.push("<tr><td>" + esc(at) + "</td><td colspan=\"6\"><span class=\"muted\">Deactivated, no device wired</span></td></tr>");
      return;
    }
    const d = port.device;
    const layout = d.process_data.in_layout.length
      ? d.process_data.in_layout.map((f) => esc(f.name) + " <span class=\"small\">bit " + f.bit_offset + (f.bits > 1 ? "-" + (f.bit_offset + f.bits - 1) : "") + (f.gradient ? ", x" + f.gradient + " " + esc(f.unit || "") : "") + "</span>").join("<br>")
      : "<span class=\"muted\">no IODD filed</span>";
    portRows.push("<tr><td><b>" + esc(at) + "</b><br><span class=\"small\">IO-Link</span></td><td><b>" + esc(d.part) + "</b><br><span class=\"small\">" + esc(port.tag) + " &middot; " + esc(d.vendor || "") + "</span></td>" +
      "<td class=\"mono\">" + esc(d.vendor_id) + " / " + esc(d.device_id) + "<br><span class=\"small\">type compatible</span></td>" +
      "<td>" + esc(fmtCycle(d.cycle_time_ms.recommended)) + "<br><span class=\"small\">min " + esc(fmtCycle(d.cycle_time_ms.device_min)) + (d.bitrate ? " &middot; " + esc(d.bitrate) : "") + "</span></td>" +
      "<td class=\"num\">" + d.process_data.in_bytes + " B in<br>" + d.process_data.out_bytes + " B out<br><span class=\"small\">" + d.process_data.in_bits + " / " + d.process_data.out_bits + " bit</span></td>" +
      "<td>" + layout + "</td><td>" + (d.data_storage.recommended === "backup_restore" ? "Backup + restore" : "Off") + "</td></tr>");
    d.parameters.forEach((p) => {
      const good = p.status === "ok";
      const status = good ? "<span class=\"tag ok\">ok</span>" : "<span class=\"tag warn\">" + esc(p.status.replace(/_/g, " ")) + "</span>";
      writeRows.push("<tr><td>" + esc(at) + "<br><span class=\"small\">" + esc(port.tag) + "</span></td><td>" + esc(p.name) + (p.note ? "<br><span class=\"small\">" + esc(p.note) + "</span>" : "") + "</td>" +
        "<td class=\"num\"><b>" + esc(p.value) + "</b> " + esc(p.unit) + "</td><td class=\"mono\">" + (p.index === null ? "-" : p.index + "." + p.subindex) + "</td>" +
        "<td class=\"num mono\">" + (p.raw === null ? "-" : p.raw) + "</td><td class=\"mono\">" + esc(p.raw_hex || "-") + "</td><td>" + esc(p.datatype || "-") + "</td><td>" + status + (p.clamped ? " <span class=\"tag warn\">clamped</span>" : "") + "</td></tr>");
    });
  }));
  const powerRows = power.map((m) => {
    const pct = m.total_limit_ma ? Math.min(100, Math.round(m.total_ma / m.total_limit_ma * 100)) : 0;
    return "<tr><td><b>" + esc(m.uid) + "</b> " + esc(m.part) + "</td><td class=\"num\">" + m.total_ma + " mA</td><td>" +
      (m.total_limit_ma ? "<span class=\"bar" + (m.total_ma > m.total_limit_ma ? " over" : "") + "\"><i style=\"width:" + pct + "%\"></i></span>" + m.total_limit_ma + " mA" : "<span class=\"muted\">limit not filed</span>") + "</td><td>" +
      m.ports.map((p) => "X" + p.port + " " + esc(p.part) + " " + p.ma + " mA").join("<br>") + (m.unknown.length ? "<br><span class=\"small\">No filed current: " + m.unknown.map(esc).join(", ") + "</span>" : "") + "</td><td>" +
      (m.problems.length ? m.problems.map((t) => "<span class=\"tag warn\">" + esc(t) + "</span>").join("<br>") : "<span class=\"tag ok\">within limits</span>") + "</td></tr>";
  });
  const bom = new Map();
  X.orderLines(station, library).forEach((line) => {
    const key = line.kind + "|" + line.part;
    const row = bom.get(key) || { qty: 0, kind: line.kind, vendor: line.vendor || "", part: line.part, ids: line.vendor_id !== undefined && line.device_id !== undefined ? line.vendor_id + " / " + line.device_id : (line.vendor_id !== undefined ? "vendor " + line.vendor_id : "") };
    row.qty += 1;
    bom.set(key, row);
  });
  const notes = issues.map((i) => i.problem);
  const installer = [
    "Use M12 A-coded cable, straight-through, with L+ (pin 1), L- (pin 3) and C/Q (pin 4) connected. IO-Link allows 20 m per port.",
    "Set each master port to IO-Link and validate vendor ID and device ID before writing parameters.",
    "Switch data storage to backup and restore where listed, then write the parameters once and read them back.",
    "Do not change the master cycle time below the device minimum.",
  ];
  const snapshot = options.snapshot ? "<img class=\"snapshot\" alt=\"3D view of the station\" src=\"" + esc(options.snapshot) + "\" />" : "<p class=\"muted\">No 3D view captured.</p>";
  const toolbar = options.print === false ? "" : "<div class=\"toolbar\"><button type=\"button\" onclick=\"window.print()\">Print or save as PDF</button></div>";
  const cell = (label, value) => "<div><small>" + label + "</small><b>" + value + "</b></div>";

  return "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>" + esc(title) + " - station report</title><style>" + REPORT_CSS + "</style></head><body>" + toolbar +
    "<section><h1>" + esc(title) + "</h1><p class=\"muted\">IO-Link station report: commissioning data, wiring and bill of materials</p>" +
    "<div class=\"title-block\">" + cell("Station", esc(title)) + cell("Date", esc(date)) + cell("Document", "Station report, rev. 1") +
      cell("Masters", masters) + cell("Sensors", sensors) + cell("Ports used", used + " of " + file.masters.reduce((s, m) => s + m.port_count, 0)) + "</div>" +
    (options.link ? "<p class=\"small\">Open this station in the studio: <a href=\"" + esc(options.link) + "\">iolinki.com/studio</a></p>" : "") +
    "<h3>3D layout</h3>" + snapshot +
    "<h3>Notes for the installer</h3>" + (notes.length ? "<div class=\"notes\"><ul>" + notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul></div>" : "<p>No open points. Every sensor is inside its datasheet and wired to a master port.</p>") + "</section>" +
    "<section class=\"page\"><h2><span>1</span>Wiring</h2><div class=\"wiring-box\">" + wiring + "</div>" +
    "<h2 style=\"margin-top:16pt\"><span>2</span>Cables</h2>" + (cableRows.length ? "<table><thead><tr><th>From</th><th>To</th><th>Device</th><th class=\"num\">Route, m</th><th class=\"num\">Order length</th><th>Check</th></tr></thead><tbody>" +
      cableRows.map((c) => "<tr><td>" + esc(c.from) + " X" + c.port + "</td><td>" + esc(c.to) + "</td><td>" + esc(c.part) + "</td><td class=\"num\">" + c.length.toFixed(1) + "</td><td class=\"num\">" + c.stock + " m</td><td>" + (c.over ? "<span class=\"tag warn\">over the 20 m IO-Link limit</span>" : "<span class=\"tag ok\">&le; 20 m</span>") + "</td></tr>").join("") + "</tbody></table><p class=\"small\">Route is the laid path in the 3D model; order length adds 20 % slack and rounds up to a stock length.</p>" : "<p class=\"muted\">No cables yet.</p>") + "</section>" +
    "<section class=\"page\"><h2><span>3</span>Ports and process data</h2>" + (portRows.length ? "<table><thead><tr><th>Port</th><th>Device</th><th>Vendor / device ID</th><th>Cycle time</th><th class=\"num\">Process data</th><th>Input layout</th><th>Data storage</th></tr></thead><tbody>" + portRows.join("") + "</tbody></table>" : "<p class=\"muted\">No port is configured.</p>") +
    "<p class=\"small\">Validation is set to type compatible (vendor ID and device ID must match). Use identical only when the device serial number is read at commissioning. Bit offsets count from the least significant bit of the input process data.</p>" +
    "<h2 style=\"margin-top:16pt\"><span>4</span>Power budget</h2>" + (powerRows.length ? "<table><thead><tr><th>Master</th><th class=\"num\">Sensors draw</th><th>Master supplies</th><th>Per port</th><th>Result</th></tr></thead><tbody>" + powerRows.join("") + "</tbody></table>" : "<p class=\"muted\">No master.</p>") + "</section>" +
    "<section class=\"page\"><h2><span>5</span>Parameter writes</h2>" + (writeRows.length ? "<table><thead><tr><th>Port</th><th>Parameter</th><th class=\"num\">Value</th><th>ISDU index.sub</th><th class=\"num\">Raw</th><th>Hex</th><th>Type</th><th>Status</th></tr></thead><tbody>" + writeRows.join("") + "</tbody></table>" : "<p class=\"muted\">No parameters.</p>") +
    (file.warnings.length ? "<h3>Data gaps</h3><div class=\"notes\"><ul>" + file.warnings.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul></div>" : "") + "<p class=\"small\">Raw = round((value - offset) / gradient). Write with the master's ISDU function block or import the commissioning file. Values for inductive sensors are already converted to the steel-equivalent switching distance.</p></section>" +
    "<section class=\"page\"><h2><span>6</span>Bill of materials</h2><table><thead><tr><th class=\"num\">Qty</th><th>Kind</th><th>Vendor</th><th>Part</th><th>Vendor / device ID</th></tr></thead><tbody>" +
      Array.from(bom.values()).map((r) => "<tr><td class=\"num\">" + r.qty + "</td><td>" + esc(r.kind) + "</td><td>" + esc(r.vendor) + "</td><td>" + esc(r.part) + "</td><td class=\"mono\">" + esc(r.ids) + "</td></tr>").join("") + "</tbody></table>" +
    "<h2 style=\"margin-top:16pt\"><span>7</span>Installer checklist</h2><div class=\"checks\"><ul>" + installer.map((t) => "<li>" + esc(t) + "</li>").join("") + "</ul></div>" +
    "<table style=\"margin-top:14pt\"><tbody><tr><th style=\"width:25%\">Commissioned by</th><td style=\"height:26pt\"></td><th style=\"width:15%\">Date</th><td style=\"width:20%\"></td></tr></tbody></table></section></body></html>\n";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { commissioning, commissioningJson, commissioningCsv, reportHtml, writeInfo, toRaw, rawHex, cycleFor, EXPORT_SCHEMA, EXPORT_VERSION, COMMISSIONING_COLUMNS };
}
