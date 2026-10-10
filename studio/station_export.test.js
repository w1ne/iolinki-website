"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const engine = require("./engine.js");
const exp = require("./station_export.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
const pn7092 = clone(require("./library/sensors/ifm-pn7092.json"));
const ig6214 = clone(require("./library/sensors/ifm-ig6214.json"));
// The tests below exercise the iodd_index text fallback, so the fixtures carry
// the pre-ingest text and no structured write objects.
pn7092.settings[0].iodd_index = "583 (SP_FH1, 10–1000 × 0.1 bar)";
pn7092.settings[1].iodd_index = "584 (RP_FL1, 5–995 × 0.1 bar)";
ig6214.settings[0].iodd_index = "60.1 (SSC1 SP1; IODD gives raw 400–3800 without scaling, so the mm limits are from the datasheet)";
[pn7092, ig6214].forEach((def) => {
  (def.settings || []).forEach((s) => delete s.write);
  (def.options || []).forEach((o) => {
    delete o.write;
    delete o.raw;
    delete o.iodd_index;
  });
});
const master = { id: "test-master-4", kind: "master", part: "TM4", vendor: "test", ports: 4, port_class: "A", fieldbus: "PROFINET" };
const library = { sensors: [pn7092, ig6214], masters: [master], equipment: require("./library/equipment.json"), applications: [] };

function build(refs, settings) {
  const station = engine.newStation();
  refs.forEach((ref, i) => {
    const item = engine.addItem(station, library, ref, [i * 2, 0]);
    Object.assign(item.settings, (settings && settings[i]) || {});
  });
  return station;
}

const DATE = "2026-10-10T00:00:00.000Z";
const param = (file, port, key) => file.masters[0].ports[port - 1].device.parameters.find((p) => p.key === key);

test("raw value: 40 bar on PN7092 is 400 at index 583 via the iodd_index fallback", () => {
  const station = build(["ifm-pn7092"], [{ sp1: 40, rp1: 35 }]);
  const file = exp.commissioning(station, library, { date: DATE });
  const sp = param(file, 1, "sp1");
  assert.equal(sp.index, 583);
  assert.equal(sp.subindex, 0);
  assert.equal(sp.raw, 400);
  assert.equal(sp.value, 40);
  assert.equal(sp.status, "ok");
  assert.equal(param(file, 1, "rp1").raw, 350);
});

test("a structured write object wins over the text and sets datatype, hex and offset", () => {
  pn7092.settings[0].write = { index: 583, subindex: 0, datatype: "UIntegerT", bitLength: 16, gradient: 0.1, offset: 0, raw_min: 10, raw_max: 1000 };
  pn7092.settings[1].write = { index: 584, subindex: 0, datatype: "UIntegerT", bitLength: 16, gradient: 0.1, offset: 0, raw_min: 5, raw_max: 995 };
  const sp = param(exp.commissioning(build(["ifm-pn7092"], [{ sp1: 40, rp1: 35 }]), library, { date: DATE }), 1, "sp1");
  assert.equal(sp.raw, 400);
  assert.equal(sp.datatype, "UIntegerT");
  assert.equal(sp.bit_length, 16);
  assert.equal(sp.raw_hex, "01 90");
  const shifted = exp.toRaw(25, { gradient: 0.5, offset: -10, raw_min: null, raw_max: null, datatype: null, bit_length: null, scale: "known" });
  assert.equal(shifted.raw, 70);
  delete pn7092.settings[0].write;
  delete pn7092.settings[1].write;
});

test("raw values are clamped to the raw range and flagged", () => {
  const info = { gradient: 0.1, offset: 0, raw_min: 10, raw_max: 1000, datatype: "UIntegerT", bit_length: 16, scale: "known" };
  assert.deepEqual(exp.toRaw(150, info), { raw: 1000, clamped: true });
  assert.deepEqual(exp.toRaw(0.5, info), { raw: 10, clamped: true });
  assert.deepEqual(exp.toRaw(40, info), { raw: 400, clamped: false });
  // datatype range limits an unbounded raw range
  assert.equal(exp.toRaw(99999, { gradient: 1, offset: 0, raw_min: null, raw_max: null, datatype: "UIntegerT", bit_length: 8, scale: "known" }).raw, 255);
  assert.equal(exp.toRaw(-500, { gradient: 1, offset: 0, raw_min: null, raw_max: null, datatype: "IntegerT", bit_length: 8, scale: "known" }).raw, -128);
});

test("negative raw values are written as two's complement hex", () => {
  const station = build(["ifm-pn7092"]);
  const info = exp.writeInfo({ iodd_index: "630 (ASP2, -500–1450 × 0.1 °C)" });
  assert.equal(info.raw_min, -500);
  assert.equal(info.gradient, 0.1);
  assert.ok(station);
});

test("options carry the raw value from option.raw and say so when it is missing", () => {
  pn7092.options[0].write = { index: 585, subindex: 0, datatype: "UIntegerT", bitLength: 8 };
  pn7092.options[0].raw = [1, 2];
  const station = build(["ifm-pn7092"], [{ sp1: 40, rp1: 35 }]);
  station.items.find((i) => i.kind === "sensor").options.output = "normally closed";
  const out = param(exp.commissioning(station, library, { date: DATE }), 1, "output");
  assert.equal(out.kind, "option");
  assert.equal(out.value, "normally closed");
  assert.equal(out.index, 585);
  assert.equal(out.raw, 2);
  delete pn7092.options[0].write;
  delete pn7092.options[0].raw;
  const bare = param(exp.commissioning(station, library, { date: DATE }), 1, "output");
  assert.equal(bare.status, "no_index");
  assert.equal(bare.raw, null);
});

test("inductive target: stainless at 3 mm is written as the steel-equivalent distance", () => {
  const station = build(["ifm-ig6214"], [{ switch_point: 3 }]);
  station.items.find((i) => i.kind === "sensor").target = "stainless";
  ig6214.settings[0].write = { index: 60, subindex: 1, datatype: "UIntegerT", bitLength: 16, gradient: 0.01, offset: 0, raw_min: 400, raw_max: 3800 };
  const sp = param(exp.commissioning(station, library, { date: DATE }), 1, "switch_point");
  assert.equal(sp.entered, 3);
  assert.equal(sp.value, 4.2857);
  assert.equal(sp.raw, 429);
  assert.match(sp.note, /stainless/);
  delete ig6214.settings[0].write;
  const unscaled = param(exp.commissioning(station, library, { date: DATE }), 1, "switch_point");
  assert.equal(unscaled.index, 60);
  assert.equal(unscaled.subindex, 1);
  assert.equal(unscaled.status, "unknown_scale");
  assert.equal(unscaled.raw, null);
});

test("port configuration: mode, ids, validation, cycle, process data lengths", () => {
  const station = build(["ifm-pn7092"], [{ sp1: 40, rp1: 35 }]);
  const file = exp.commissioning(station, library, { date: DATE });
  const m = file.masters[0];
  assert.equal(m.ports.length, 4);
  assert.deepEqual(m.ports.slice(1).map((p) => p.mode), ["deactivated", "deactivated", "deactivated"]);
  const d = m.ports[0].device;
  assert.equal(m.ports[0].mode, "iolink");
  assert.equal(d.vendor_id, 310);
  assert.equal(d.device_id, 401);
  assert.equal(d.validation.recommended, "type_compatible");
  assert.equal(d.data_storage.recommended, "backup_restore");
  assert.equal(d.cycle_time_ms.device_min, 2.3);
  assert.equal(d.cycle_time_ms.recommended, 2.3);
  assert.equal(d.process_data.in_bits, 16);
  assert.equal(d.process_data.in_bytes, 2);
  assert.equal(d.process_data.out_bytes, 0);
  assert.equal(d.process_data.in_layout[0].name, "Pressure");
  assert.equal(exp.cycleFor(7.01), 7.2);
  assert.equal(exp.cycleFor(2.31), 2.4);
  assert.equal(exp.cycleFor(40), 40);
});

test("JSON schema keys are stable", () => {
  const file = JSON.parse(exp.commissioningJson(build(["ifm-pn7092"], [{ sp1: 40, rp1: 35 }]), library, { date: DATE, title: "T", link: "L" }));
  assert.deepEqual(Object.keys(file), ["schema", "version", "generated_at", "generated_by", "station", "masters", "warnings"]);
  assert.equal(file.schema, "iolinki.commissioning");
  assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file.masters[0]), ["uid", "part", "vendor", "vendor_id", "fieldbus", "port_count", "ports"]);
  assert.deepEqual(Object.keys(file.masters[0].ports[0]), ["port", "mode", "tag", "device"]);
  assert.deepEqual(Object.keys(file.masters[0].ports[0].device), ["part", "vendor", "vendor_id", "device_id", "iodd_file", "bitrate", "validation", "data_storage", "cycle_time_ms", "process_data", "parameters"]);
  assert.deepEqual(Object.keys(file.masters[0].ports[0].device.parameters[0]), ["key", "name", "kind", "unit", "value", "entered", "note", "index", "subindex", "datatype", "bit_length", "raw", "raw_hex", "clamped", "status"]);
});

test("CSV has one row per parameter plus rows for ports without one", () => {
  const csv = exp.commissioningCsv(build(["ifm-pn7092"], [{ sp1: 40, rp1: 35 }]), library, { date: DATE });
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], exp.COMMISSIONING_COLUMNS.join(","));
  assert.equal(lines.length, 1 + 3 + 3);
  assert.match(lines[1], /^master1,X1,iolink,sensor1,PN7092,310,401,type_compatible,backup_restore,2.3,2.3,2,0,Set point SP1,setting,40,bar,583,0,,400,,ok$/);
});

test("report is a self-contained A4 document with every section", () => {
  const station = build(["ifm-pn7092"], [{ sp1: 40, rp1: 35 }]);
  const html = exp.reportHtml(station, library, { date: DATE, title: "Pump <skid>", link: "https://x/#s=1", snapshot: "data:image/png;base64,AAAA", wiringSvg: () => "<svg id=\"w\"></svg>" });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /Pump &lt;skid&gt;/);
  ["Wiring", "Cables", "Ports and process data", "Power budget", "Parameter writes", "Bill of materials", "Installer checklist"].forEach((h) => assert.ok(html.includes(h), h));
  assert.ok(html.includes("src=\"data:image/png;base64,AAAA\""));
  assert.ok(html.includes("<svg id=\"w\">"));
  assert.ok(html.includes("583.0"));
  assert.ok(!/<script/i.test(html));
});

test("ingested library parts write raw values from their IODD write objects", () => {
  const real = clone(require("./library/sensors/ifm-pn7092.json"));
  const lib = { sensors: [real], masters: [master], equipment: [], applications: [] };
  const station = engine.newStation();
  const item = engine.addItem(station, lib, "ifm-pn7092", [0, 0]);
  Object.assign(item.settings, { sp1: 40, rp1: 35 });
  item.options.output = "normally closed";
  const file = exp.commissioning(station, lib, { date: DATE });
  const sp = param(file, 1, "sp1");
  assert.equal(sp.index, 583);
  assert.equal(sp.raw, 400);
  assert.equal(sp.status, "ok");
  const out = param(file, 1, "output");
  assert.equal(out.index, 580);
  assert.equal(out.raw, 4);
});
