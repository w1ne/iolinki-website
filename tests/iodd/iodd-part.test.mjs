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
