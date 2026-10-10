import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { partFromIoddXml, partFromIoddZip } from "../../tools/iodd/iodd-part.mjs";

const dir = fileURLToPath(new URL("./fixtures/station/", import.meta.url));
const read = (name) => readFileSync(dir + name, "utf8");
const bytes = (name) => new Uint8Array(readFileSync(dir + name));
const require = createRequire(import.meta.url);
const filed = (name) => require("../../studio/library/sensors/" + name + ".json");

const files = {
  pn7092: "ifm-000191_V104326821-20140909-IODD1.1.xml",
  ig6214: "ifm-000540-20210210-IODD1.1.xml",
  kg5065: "ifm-000183-20240612-IODD1.1.xml",
  lr2050: "ifm-0001DF-20150720-IODD1.1.xml",
  o5d100: "ifm-000174-20210526-IODD1.1.xml",
  sa5000: "ifm-000215-20161025-IODD1.1.xml",
  ta2105: "ifm-000179-20200114-IODD1.1.xml",
};
const make = (key, productId) => partFromIoddXml(read(files[key]), { vendorId: 310, ioddId: 1, file: files[key], productId });

test("PN7092 matches the filed part", () => {
  const def = make("pn7092", "PN7092");
  const ref = filed("ifm-pn7092");
  assert.equal(def.id, "iodd-310-1");
  assert.equal(def.part, "PN7092");
  assert.equal(def.category, "pressure");
  assert.equal(def.device_id, ref.device_id);
  const sp = def.settings.find((s) => s.iodd_index.startsWith("583"));
  const rp = def.settings.find((s) => s.iodd_index.startsWith("584"));
  assert.deepEqual([sp.unit, sp.min, sp.max, sp.default], ["bar", 1, 100, 25]);
  assert.deepEqual([rp.min, rp.max, rp.default, rp.below], [0.5, 99.5, 23, sp.key]);
  assert.deepEqual(sp.scale, { gradient: 0.1, offset: 0 });
  assert.equal(def.iodd.min_cycle_ms, 2.3);
  assert.equal(def.iodd.bitrate, "COM2");
  assert.equal(def.iodd.pd_in_bits, 16);
  assert.deepEqual(def.iodd.pd_in, ref.iodd.pd_in);
  assert.equal(def.iodd.pd_out_bits, 0);
});

test("other ifm devices agree with the filed parts", () => {
  const cases = [["ig6214", "ifm-ig6214", "inductive"], ["kg5065", "ifm-kg5065", "capacitive"], ["lr2050", "ifm-lr2050", "level"], ["o5d100", "ifm-o5d100", "optical distance"], ["sa5000", "ifm-sa5000", "flow"], ["ta2105", "ifm-ta2105", "temperature"]];
  for (const [key, name, category] of cases) {
    const def = make(key);
    const ref = filed(name);
    assert.equal(def.category, category, key);
    assert.equal(def.device_id, ref.device_id, key);
    assert.equal(def.iodd.min_cycle_ms, ref.iodd.min_cycle_ms, key);
    assert.equal(def.iodd.bitrate, ref.iodd.bitrate, key);
    assert.equal(def.iodd.pd_in_bits, ref.iodd.pd_in_bits, key);
  }
});

test("record items and unscaled values", () => {
  const def = make("ig6214");
  const sp1 = def.settings.find((s) => s.iodd_index.startsWith("60.1"));
  assert.deepEqual([sp1.min, sp1.max, sp1.default, sp1.unit], [400, 3800, 3800, "raw"]);
  const sa = make("sa5000").settings.find((s) => s.iodd_index.startsWith("583"));
  assert.deepEqual([sa.min, sa.max, sa.default, sa.unit], [5, 100, 20, "%"]);
  assert.equal(make("lr2050").settings[0].unit, "mm");
});

test("zip conversion and a non-ifm device", async () => {
  const pn = await partFromIoddZip(bytes("ifm-pn7092-97.zip"), { vendorId: 310, ioddId: 97, productId: "PN7092" });
  assert.equal(pn.id, "iodd-310-97");
  assert.equal(pn.iodd.file, files.pn7092);
  assert.equal(pn.settings[0].max, 100);
  const bos = await partFromIoddZip(bytes("balluff-bos23k-833.zip"), { vendorId: 888, ioddId: 833, productName: "BOS 23K-GI-RR10-S4", vendorName: "Balluff GmbH" });
  assert.equal(bos.vendor, "Balluff GmbH");
  assert.equal(bos.part, "BOS 23K-GI-RR10-S4");
  assert.equal(bos.category, "optical distance");
  assert.ok(bos.options.length > 0);
});

test("converted parts work with the station engine", () => {
  const engine = require("../../studio/engine.js");
  const def = make("pn7092", "PN7092");
  const library = { sensors: [def], masters: [{ id: "m", kind: "master", part: "M", vendor: "t", ports: 4, port_class: "A" }], equipment: [], applications: [] };
  const station = engine.newStation();
  const item = engine.addItem(station, library, def.id, [0, 0]);
  assert.equal(engine.checkSensor(def, item).ok, true);
  item.settings[def.settings[0].key] = 500;
  assert.equal(engine.checkSensor(def, item).ok, false);
  assert.equal(engine.portTable(station, library)[0].pd_in_bits, 16);
  assert.ok(engine.orderLines(station, library).some((l) => l.part === "PN7092"));
});

test("rejects non-IODD input", () => {
  assert.throws(() => partFromIoddXml("<a/>", { vendorId: 1, ioddId: 2 }));
  assert.throws(() => partFromIoddXml("<IODevice/>", {}));
});

// --- Official unit table, Smart Sensor Profile, write objects, layering ------

import UNITS_MODULE from "../../tools/iodd/iodd-units.mjs";
import { unitInfo, CONVERTER_VERSION } from "../../tools/iodd/iodd-part.mjs";
import { SCHEMA_SOURCE } from "../../tools/iodd/schema.mjs";
import { existsSync } from "node:fs";

const studio = { skip: !existsSync(fileURLToPath(new URL("../../studio/ingest.js", import.meta.url))) && "studio sources are not in this bundle" };

test("unit codes come from the official IO-Link table", () => {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL("../../tools/iodd/iodd-units.json", import.meta.url)), "utf8"));
  assert.deepEqual(UNITS_MODULE, json, "iodd-units.mjs is generated from iodd-units.json");
  assert.equal(json.provenance.archive_sha256, SCHEMA_SOURCE.sha256);
  assert.equal(json.provenance.source_url, SCHEMA_SOURCE.url);
  assert.ok(Object.keys(json.units).length > 600);
  assert.deepEqual([unitInfo(1013).abbr, unitInfo(1013).kind], ["mm", "length"]);
  assert.deepEqual([unitInfo(1137).abbr, unitInfo(1137).kind], ["bar", "pressure"]);
  assert.deepEqual([unitInfo(1352).abbr, unitInfo(1352).kind], ["L/min", "flow"]);
  assert.equal(unitInfo(1001).kind, "temperature");
  // The old hand table called 1131 kPa; the official table says GPa (kPa is 1133).
  assert.equal(unitInfo(1131).abbr, "GPa");
  assert.equal(unitInfo(1133).abbr, "kPa");
  assert.equal(unitInfo(1997), null, "1997 'none' is dimensionless");
  assert.equal(typeof CONVERTER_VERSION, "string");
});

test("Smart Sensor Profile: MDC scale and limits reach the switch points", () => {
  const def = partFromIoddXml(read("ssp-mdc-synthetic.xml"), { vendorId: 65000, ioddId: 7 });
  assert.equal(def.category, "optical distance");
  const [sp1, sp2, hyst, ssc2] = def.settings;
  assert.deepEqual([sp1.unit, sp1.min, sp1.max, sp1.default, sp1.unit_source, sp1.range_source], ["mm", 0, 500, 250, "mdc", "MDC descriptor limits"]);
  // Two-point mode (config 61.2 = 3): SP2 is shown and sits below SP1.
  assert.deepEqual([sp2.iodd_index.split(" ")[0], sp2.default, sp2.below], ["60.2", 240, sp1.key]);
  assert.deepEqual([hyst.name, hyst.unit, hyst.max], ["SSC1 hysteresis", "mm", 50]);
  // SSC2 is single point: only its SP1.
  assert.equal(ssc2.iodd_index.split(" ")[0], "62.1");
  assert.ok(!def.settings.some((s) => s.iodd_index.startsWith("62.2")));
  assert.deepEqual(sp1.write, { index: 60, subindex: 1, datatype: "IntegerT", bitLength: 16, gradient: 0.1, offset: 0, raw_min: 0, raw_max: 5000, bit_offset: 16, subindex_access: false, record_bit_length: 32 });
  const logic = def.options.find((o) => o.iodd_index.startsWith("61.1"));
  assert.deepEqual([logic.values, logic.default, logic.raw], [["High active", "Low active"], "Low active", [0, 1]]);
  // The MDC unit item carries a non-IO-Link code (49) and names the unit; the name wins.
  assert.deepEqual(def.iodd.profile.mdc[0], { index: 16512, lower: 0, upper: 5000, unit: "mm", scale: -1 });
  assert.deepEqual(def.iodd.profile.ids.map((p) => p.id), ["0x0001", "0x4000", "0x8001"]);
  assert.deepEqual(def.iodd.pd_in[0], { name: "Distance", bit_offset: 16, bits: 16, gradient: 0.1, unit: "mm" });
});

test("write objects carry the raw ISDU coordinates", () => {
  const sp = make("pn7092", "PN7092").settings.find((s) => s.iodd_index.startsWith("583"));
  assert.deepEqual(sp.write, { index: 583, subindex: 0, datatype: "IntegerT", bitLength: 16, gradient: 0.1, offset: 0, raw_min: 10, raw_max: 1000 });
  for (const key of Object.keys(files)) {
    for (const s of make(key).settings) {
      assert.ok(Number.isInteger(s.write.index) && Number.isInteger(s.write.subindex), key + " " + s.key);
      // Real value = raw * gradient + offset at both ends of the range.
      const ends = [s.write.raw_min * s.write.gradient + s.write.offset, s.write.raw_max * s.write.gradient + s.write.offset].sort((a, b) => a - b);
      assert.ok(Math.abs(ends[0] - s.min) < 1e-6 && Math.abs(ends[1] - s.max) < 1e-6, key + " " + s.key);
    }
  }
});

test("IG6214: the IODD has no scale for SSC1 SP1, the override maps it to the datasheet mm", studio, () => {
  const { applyOverrides, selectionOf } = require("../../studio/ingest.js");
  const override = require("../../studio/library/ingest/ifm-ig6214.json");
  const part = partFromIoddXml(read(files.ig6214), { vendorId: 0, ioddId: 12781, productId: "IG6214", select: selectionOf(override) });
  assert.equal(part.settings[0].unit, "raw", "nothing in this IODD gives SP1 a unit");
  const { def } = applyOverrides(part, override);
  const sp = def.settings[0];
  assert.deepEqual([sp.key, sp.unit, sp.min, sp.max, sp.default, sp.corrected, sp.unit_source], ["switch_point", "mm", 1.4, 7, 7, true, "override"]);
  assert.deepEqual([sp.write.index, sp.write.subindex, sp.write.raw_min, sp.write.raw_max], [60, 1, 400, 3800]);
  // Cross-check stated in the override: the same line puts the process value
  // range 0..4095 on the datasheet measuring range 0.75..7.5 mm (within 0.02 mm).
  const at = (raw) => raw * sp.write.gradient + sp.write.offset;
  assert.ok(Math.abs(at(0) - 0.75) < 0.02 && Math.abs(at(4095) - 7.5) < 0.02);
  assert.equal(def.iodd.pd_in.find((f) => f.name === "PDV1").unit, "mm");
  assert.deepEqual(def.options.map((o) => [o.key, o.values, o.raw]), [["output", ["normally open", "normally closed"], [0, 1]], ["polarity", ["PNP", "NPN"], [0, 1]]]);
});

test("overrides never widen an IODD range and mark their own defaults", studio, () => {
  const { applyOverrides } = require("../../studio/ingest.js");
  const part = make("pn7092", "PN7092");
  const base = { id: "t", iodd: { file: "x" }, datasheet: { part: "PN7092" } };
  const one = (spec) => applyOverrides(part, Object.assign({}, base, { settings: [Object.assign({ iodd: "583", key: "sp1" }, spec)] })).def.settings[0];
  assert.deepEqual([one({}).min, one({}).max], [1, 100]);
  assert.throws(() => one({ max: 120, limit_source: "datasheet" }), /wider than the IODD range/);
  assert.throws(() => one({ max: 80 }), /limit_source/);
  assert.deepEqual([one({ max: 80, limit_source: "datasheet 1...80 bar" }).max, one({ max: 80, limit_source: "d" }).limit_source], [80, "d"]);
  assert.throws(() => one({ default: 50 }), /studio default/);
  assert.equal(one({ default: 50, default_source: "studio default, not a factory setting" }).default, 50);
  assert.throws(() => one({ scale: { unit: "mm", raw: [0, 1], real: [0, 1], source: "x" } }), /already scales/);
  // rP keeps its IODD relation under the studio key.
  const both = applyOverrides(part, Object.assign({}, base, { settings: [{ iodd: "583", key: "a" }, { iodd: "584", key: "b" }] })).def.settings;
  assert.equal(both[1].below, "a");
});
