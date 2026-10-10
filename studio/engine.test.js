"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const engine = require("./engine.js");

const ig6214 = require("./library/sensors/ifm-ig6214.json");
// Test-only master so port logic does not depend on which real master is filed.
const fourPort = { id: "test-master-4", kind: "master", part: "TM4", vendor: "test", ports: 4, port_class: "A" };
const library = {
  sensors: [ig6214],
  masters: [fourPort],
  equipment: require("./library/equipment.json"),
  applications: require("./library/applications.json"),
};

function stationWith(n) {
  const station = engine.newStation();
  for (let i = 0; i < n; i++) {
    engine.addItem(station, library, "ifm-ig6214", [i, 0]);
  }
  return station;
}

test("a sensor gets a master and a port", () => {
  const station = stationWith(1);
  const sensor = station.items.find((item) => item.kind === "sensor");
  const master = station.items.find((item) => item.kind === "master");
  assert.equal(sensor.master, master.uid);
  assert.equal(sensor.port, 1);
});

test("a fifth sensor on a four-port master adds a second master", () => {
  const station = stationWith(5);
  const masters = station.items.filter((item) => item.kind === "master");
  assert.equal(masters.length, 2);
  const slots = station.items.filter((item) => item.kind === "sensor").map((item) => item.master + ":" + item.port);
  assert.equal(new Set(slots).size, 5);
});

test("removing a master moves its sensors to a free port", () => {
  const station = stationWith(5);
  const second = station.items.filter((item) => item.kind === "master")[1];
  engine.removeItem(station, library, second.uid);
  assert.equal(engine.checkStation(station, library).ok, true);
});

test("setting a taken port swaps the two sensors", () => {
  const station = stationWith(2);
  const [a, b] = station.items.filter((item) => item.kind === "sensor");
  engine.setPort(station, library, a.uid, b.master, b.port);
  assert.equal(a.port, 2);
  assert.equal(b.port, 1);
});

test("every cabled sensor has L+, L-, C/Q from its master port to the sensor", () => {
  const station = stationWith(3);
  const cables = engine.cables(station, library);
  assert.equal(cables.length, 3);
  cables.forEach((cable) => {
    const sensor = station.items.find((item) => item.uid === cable.to);
    assert.deepEqual(cable.conductors, ["L+", "L-", "C/Q"]);
    assert.equal(cable.port, sensor.port);
    const end = cable.path[cable.path.length - 1];
    assert.deepEqual([end[0], end[2]], sensor.at);
  });
});

test("steel inside 1.4–7 mm passes and is set as given", () => {
  const station = stationWith(1);
  const sensor = station.items.find((item) => item.kind === "sensor");
  sensor.settings.switch_point = 4;
  const check = engine.checkSensor(ig6214, sensor);
  assert.equal(check.ok, true);
  assert.equal(check.parameters[0].value, "4 mm");
});

test("stainless applies the 0.7 datasheet factor", () => {
  const sensor = { settings: { switch_point: 3.5 }, options: {}, target: "stainless" };
  const check = engine.checkSensor(ig6214, sensor);
  assert.equal(check.ok, true);
  assert.equal(check.parameters[0].value, "5 mm");
});

test("stainless at 6 mm is refused because it needs 8.57 mm steel-equivalent", () => {
  const check = engine.checkSensor(ig6214, { settings: { switch_point: 6 }, options: {}, target: "stainless" });
  assert.equal(check.ok, false);
  assert.match(check.problems[0], /8\.57 mm/);
  assert.match(check.problems[0], /4\.9 mm/);
});

test("an option outside the datasheet values is refused", () => {
  const check = engine.checkSensor(ig6214, { settings: { switch_point: 4 }, options: { output: "toggle" }, target: "steel" });
  assert.equal(check.ok, false);
});

test("the text box opens the filed stop application for a metal job", () => {
  const plan = engine.planFromText("Detect stainless at 3 mm, normally closed, NPN.", library);
  assert.equal(plan.opened, true);
  assert.equal(plan.application_id, "part-presence");
  const sensor = plan.station.items.find((item) => item.kind === "sensor");
  assert.equal(sensor.target, "stainless");
  assert.equal(sensor.settings.switch_point, 3);
  assert.equal(sensor.options.output, "normally closed");
  assert.equal(sensor.options.polarity, "NPN");
  assert.ok(plan.station.items.some((item) => item.ref === "conveyor"));
  assert.equal(plan.written_to_sensor, false);
});

test("the text box refuses jobs outside the filed sensors", () => {
  assert.equal(engine.planFromText("detect plastic caps", library).opened, false);
  assert.equal(engine.planFromText("detect steel at 12 mm", library).opened, false);
  assert.equal(engine.planFromText("", library).opened, false);
  assert.equal(engine.planFromText("measure humidity", library).opened, false);
});

test("a word inside another word does not match an option", () => {
  const plan = engine.planFromText("detect steel at 4 mm on the sync conveyor", library);
  const sensor = plan.station.items.find((item) => item.kind === "sensor");
  assert.equal(sensor.options.output, "normally open");
});

test("a ChatGPT spec is checked part by part", () => {
  const built = engine.fromSpec({
    items: [
      { ref: "press", at: [0, 0] },
      { part: "IG6214", at: [2, 0], settings: { switch_point: 5 }, target: "brass" },
      { part: "XYZ999", at: [3, 0] },
    ],
  }, library);
  assert.equal(built.check.ok, false);
  const problems = built.check.issues.map((issue) => issue.problem).join(" ");
  assert.match(problems, /brass/);
  assert.match(problems, /XYZ999 is not in the library/);
});

test("a station survives the share link", () => {
  const station = stationWith(2);
  engine.addItem(station, library, "tank", [3, 3]);
  const link = engine.encodeStation(station);
  assert.match(link, /^https:\/\/iolinki\.com\/studio\/#s=/);
  const back = engine.decodeStation(link.split("#")[1], library);
  const shape = (items) => items.map((item) => [item.uid, item.ref, item.at, item.master, item.port]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(shape(back.items), shape(station.items));
  assert.equal(engine.decodeStation("#s=garbage!", library), null);
});

test("buying needs a sensor, an email, and a plant; datasheet notes travel with the order", () => {
  const station = stationWith(2);
  assert.equal(engine.buyStation(station, library, { email: "a@b.co", plant: "Line 2" }).ok, true);
  assert.equal(engine.buyStation(station, library, { email: "nope", plant: "Line 2" }).ok, false);
  assert.equal(engine.buyStation(engine.newStation(), library, { email: "a@b.co", plant: "Line 2" }).ok, false);
  station.items.find((item) => item.kind === "sensor").settings.switch_point = 20;
  const order = engine.buyStation(station, library, { email: "a@b.co", plant: "Line 2" });
  assert.equal(order.ok, true);
  assert.equal(order.paid, false);
  assert.match(order.notes.join(" "), /1\.4–7/);
  assert.match(engine.orderText(order), /Notes to check before install/);
});
test("the order lists sensors, the master, and one sized cable per sensor", () => {
  const station = stationWith(3);
  const order = engine.buyStation(station, library, { email: "a@b.co", plant: "Line 2" });
  assert.equal(order.paid, false);
  assert.equal(order.lines.filter((line) => line.kind === "sensor").length, 3);
  assert.equal(order.lines.filter((line) => line.kind === "master").length, 1);
  assert.equal(order.lines.filter((line) => line.kind === "cable").length, 3);
  const mail = decodeURIComponent(engine.orderMail(order));
  assert.match(mail, /^mailto:andrii@shylenko.com/);
  assert.match(mail, /Line 2/);
  assert.match(mail, /IG6214/);
  assert.match(mail, /#s=/);
});

test("an order line for a master without a device ID does not print undefined", () => {
  const station = engine.newStation();
  engine.addItem(station, filed, "ifm-ig6214", [0, 0]);
  const order = engine.buyStation(station, filed, { email: "a@b.co", plant: "Line 2" });
  assert.equal(engine.orderText(order).includes("undefined"), false);
});

test("the browser bundle loads the filed library without fetch", () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "library/browser_data.js"), "utf8"), context);
  const lib = context.window.IOLINKI_LIBRARY;
  assert.ok(lib.sensors.some((def) => def.id === "ifm-ig6214"));
  assert.ok(lib.masters.some((def) => def.id === "ifm-al1301"));
  assert.equal(lib.applications[0].id, "part-presence");
});

test("live catalog rows are deduplicated and filed parts come first", () => {
  const rows = [
    { vendorName: "ifm electronic gmbh", vendorId: 310, deviceId: 307, productName: "PN7000", ioLinkRev: "1.1" },
    { vendorName: "ifm electronic gmbh", vendorId: 310, deviceId: 307, productName: "PN7000", ioLinkRev: "1.0" },
    { vendorName: "ifm electronic gmbh", vendorId: 310, deviceId: 401, productName: "PN7092", ioLinkRev: "1.1" },
  ];
  const hits = engine.markFiled(filed, rows);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].filed, "ifm-pn7092");
  assert.equal(hits[1].filed, null);
});

test("a diagram round-trips through the station", () => {
  const diagram = {
    parts: [
      { id: "m1", type: "ifm-al1301", x: -4, z: -3 },
      { id: "s1", type: "IG6214", x: 2, z: 0, settings: { switch_point: 3 }, target: "stainless" },
    ],
    wires: [{ from: { part: "m1", pin: "X4" }, to: { part: "s1", pin: "C/Q" } }],
  };
  const built = engine.fromDiagram(diagram, filed);
  assert.equal(built.check.ok, true, JSON.stringify(built.check.issues));
  const back = engine.toDiagram(built.station, filed);
  assert.deepEqual(back.wires, diagram.wires);
});
test("every filed sensor has a source and sane setting ranges", () => {
  const dir = path.join(__dirname, "library/sensors");
  fs.readdirSync(dir).filter((name) => name.endsWith(".json")).forEach((name) => {
    const def = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    assert.ok(def.source_url && def.source, name + " has a source");
    if (def.kind === "master") {
      assert.ok(def.ports > 0 && def.port_class, name + " ports");
      return;
    }
    (def.settings || []).forEach((setting) => {
      assert.ok(setting.min < setting.max, name + " " + setting.key);
      assert.ok(setting.default === null || (setting.default >= setting.min && setting.default <= setting.max), name + " " + setting.key + " default");
    });
  });
});

const filed = {
  sensors: fs.readdirSync(path.join(__dirname, "library/sensors")).map((name) => require("./library/sensors/" + name)).filter((def) => def.kind === "sensor"),
  masters: [require("./library/sensors/ifm-al1301.json")],
  equipment: library.equipment,
  applications: library.applications,
};

test("every filed sensor has a filed application", () => {
  filed.sensors.forEach((def) => {
    assert.ok(filed.applications.some((app) => app.sensor === def.id), def.part);
  });
});

test("the text box picks the sensor whose unit and range fit", () => {
  const cases = [
    ["watch pump pressure, switch at 40 bar", "PN7092"],
    ["tank temperature up to 90 °C", "TA2105"],
    ["coolant flow, switch at 30 %", "SA5000"],
    ["tank level, full at 800 mm", "LR2050"],
    ["detect a box on the conveyor at 500 mm", "O5D100"],
    ["detect steel at 4 mm", "IG6214"],
    ["detect plastic granulate fill through the hopper wall", "KG5065"],
  ];
  cases.forEach(([text, part]) => {
    const plan = engine.planFromText(text, filed);
    assert.equal(plan.opened, true, text + ": " + plan.reason);
    const sensor = plan.station.items.find((item) => item.kind === "sensor");
    assert.equal(engine.byId(filed, sensor.ref).part, part, text);
  });
});

test("IODD factory defaults fill what the job does not say", () => {
  const plan = engine.planFromText("watch pump pressure, switch at 40 bar", filed);
  assert.deepEqual(plan.todo, []);
  const sensor = plan.station.items.find((item) => item.kind === "sensor");
  assert.equal(sensor.settings.sp1, 40);
  assert.equal(sensor.settings.rp1, 23);
  assert.equal(sensor.options.output, "normally open");
  const order = engine.buyStation(plan.station, filed, { email: "a@b.co", plant: "Line 2" });
  assert.equal(order.ok, true);
  assert.deepEqual(order.notes, []);
});
test("a reset point above its set point is refused", () => {
  const def = filed.sensors.find((item) => item.part === "PN7092");
  const check = engine.checkSensor(def, { settings: { sp1: 40, rp1: 50 }, options: { output: "normally open" } });
  assert.equal(check.ok, false);
  assert.match(check.problems.join(" "), /below/);
});

test("a filed four-port AL1301 takes four sensors, then a second is added", () => {
  const station = engine.newStation();
  for (let i = 0; i < 5; i++) {
    engine.addItem(station, filed, "ifm-pn7092", [i, 0]);
  }
  assert.equal(station.items.filter((item) => item.ref === "ifm-al1301").length, 2);
});

test("the port table carries IODD process data for every wired sensor", () => {
  const plan = engine.planFromText("watch pump pressure, switch at 40 bar", filed);
  const rows = engine.portTable(plan.station, filed);
  const pn = rows.find((row) => row.part === "PN7092");
  assert.equal(pn.pd_in_bits, 16);
  assert.ok(pn.pd_in.some((item) => item.name === "Pressure" && item.bits === 14));
  assert.equal(pn.min_cycle_ms, 2.3);
  assert.match(engine.portCsv(plan.station, filed), /^master,port,tag,part/);
});

test("the order CSV totals parts by quantity", () => {
  const station = engine.newStation();
  engine.addItem(station, filed, "ifm-pn7092", [0, 0]);
  engine.addItem(station, filed, "ifm-pn7092", [1, 0]);
  const csv = engine.orderCsv(station, filed);
  assert.match(csv, /\n2,sensor,ifm electronic,PN7092,310,401\n/);
  assert.match(csv, /\n1,master,ifm electronic,AL1301/);
});

test("power budget refuses a master that cannot supply its sensors", () => {
  const lib = JSON.parse(JSON.stringify(filed));
  lib.masters[0].power = { port_supply_a: 0.2, total_supply_a: 0.3 };
  lib.sensors.forEach((def) => { def.power = { current_ma: 120 }; });
  const station = engine.newStation();
  engine.addItem(station, lib, "ifm-pn7092", [0, 0]);
  engine.addItem(station, lib, "ifm-pn7092", [1, 0]);
  engine.addItem(station, lib, "ifm-pn7092", [2, 0]);
  const budget = engine.powerBudget(station, lib).masters[0];
  assert.equal(budget.total_ma, 360);
  assert.match(engine.checkStation(station, lib).issues.map((i) => i.problem).join(" "), /draw 360 mA; AL1301 supplies 300 mA/);
});

test("a cable past the IO-Link length limit is refused", () => {
  const lib = JSON.parse(JSON.stringify(filed));
  lib.masters[0].power = { max_cable_m: 5 };
  const station = engine.newStation();
  engine.addItem(station, lib, "ifm-pn7092", [6, 4]);
  assert.match(engine.checkStation(station, lib).issues.map((i) => i.problem).join(" "), /IO-Link allows 5 m/);
});

test("a sensor whose supply range does not cover the master supply is refused", () => {
  const lib = JSON.parse(JSON.stringify(filed));
  lib.masters[0].power = { supply_v: [20, 28] };
  lib.sensors.forEach((def) => { def.power = { current_ma: 10, supply_v: [10, 24] }; });
  const station = engine.newStation();
  engine.addItem(station, lib, "ifm-pn7092", [0, 0]);
  assert.match(engine.checkStation(station, lib).issues.map((i) => i.problem).join(" "), /runs on 10–24 V; AL1301 supplies 20–28 V/);
});

// Run mode ------------------------------------------------------------------

const sim = require("./station_sim.js");
const pn7092 = require("./library/sensors/ifm-pn7092.json");
const simLibrary = Object.assign({}, library, { sensors: [ig6214, pn7092] });

function pressureStation(settings, options) {
  const station = engine.newStation();
  engine.addItem(station, simLibrary, "test-master-4", [-4, -3]);
  const sensor = engine.addItem(station, simLibrary, "ifm-pn7092", [0, 0]);
  Object.assign(sensor.settings, settings);
  Object.assign(sensor.options, options || {});
  return { station: station, uid: sensor.uid };
}

test("run mode switches at SP and holds until rP", () => {
  const { station, uid } = pressureStation({ sp1: 40, rp1: 30 });
  const state = sim.simCreate();
  const at = (value) => {
    state.hold[uid] = value;
    return sim.simStep(station, simLibrary, state, 0.1).readings[uid];
  };
  assert.equal(at(20).on, false);
  assert.equal(at(39).on, false);
  assert.equal(at(41).on, true);
  assert.equal(at(35).on, true, "between rP and SP the output keeps its state");
  assert.equal(at(29).on, false);
  assert.equal(at(35).on, false);
});

test("run mode inverts the pin for normally closed", () => {
  const { station, uid } = pressureStation({ sp1: 40, rp1: 30 }, { output: "normally closed" });
  const state = sim.simCreate();
  state.hold[uid] = 50;
  const reading = sim.simStep(station, simLibrary, state, 0.1).readings[uid];
  assert.equal(reading.on, true);
  assert.equal(reading.pin, false);
});

test("run mode packs process data with the IODD layout", () => {
  const { station, uid } = pressureStation({ sp1: 40, rp1: 30 });
  const state = sim.simCreate();
  state.hold[uid] = 33.9;
  let reading = sim.simStep(station, simLibrary, state, 0.1).readings[uid];
  // Pressure 339 (x 0.1 bar) at bit 2, OUT1 at bit 0 off: 339 * 4 = 0x054C.
  assert.equal(reading.pd.hex, "05 4C");
  state.hold[uid] = 45;
  reading = sim.simStep(station, simLibrary, state, 0.1).readings[uid];
  assert.equal(reading.pd.hex, "07 09");
});

test("run mode: a part on the belt reaches a sensor mounted on the conveyor", () => {
  const station = engine.newStation();
  engine.addItem(station, simLibrary, "conveyor", [0, 0]);
  engine.addItem(station, simLibrary, "test-master-4", [-4, -3]);
  const sensor = engine.addItem(station, simLibrary, "ifm-ig6214");
  assert.deepEqual(sensor.at, [1, 0.9], "added without a spot, the sensor mounts on the conveyor");
  const state = sim.simCreate();
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    seen.add(sim.simStep(station, simLibrary, state, 0.1).readings[sensor.uid].on);
  }
  assert.deepEqual(Array.from(seen).sort(), [false, true]);
});
