import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createIoddMcpServer } from "../../tools/iodd/mcp-factory.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
// The published IODD tool bundle ships without the studio sources.
const studio = { skip: !existsSync(root + "studio/build.js") && "studio sources are not in this bundle" };

async function connect() {
  const server = createIoddMcpServer();
  const client = new Client({ name: "station-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const station = {
  title: "Pump skid",
  parts: [
    { id: "m1", type: "ifm-al1301", x: -4, z: -3.4 },
    { id: "pump", type: "pump", x: -2, z: 1 },
    { id: "pipe", type: "pipe", x: 1, z: 1 },
    { id: "p1", type: "PN7092", x: 0, z: 1.6, settings: { sp1: 40, rp1: 35 }, options: { output: "normally open" } },
    { id: "f1", type: "SA5000", x: 2, z: 1.6, settings: { flow_sp: 1.5 } },
  ],
  wires: [
    { from: { part: "m1", pin: "X2" }, to: { part: "p1", pin: "C/Q" } },
    { from: { part: "m1", pin: "X3" }, to: { part: "f1", pin: "C/Q" } },
  ],
};

test("generated station module is up to date with studio sources", studio, () => {
  const run = spawnSync(process.execPath, ["studio/build.js", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});

test("studio engine tests pass", studio, () => {
  const run = spawnSync(process.execPath, ["--test", "studio/engine.test.js", "studio/station_export.test.js"], { cwd: root, encoding: "utf8", env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")) });
  assert.equal(run.status, 0, run.stdout.slice(-2000));
});

test("station tools and the widget are listed next to the IODD tools", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("iodd_create"));
  assert.ok(names.includes("iolink_station"));
  assert.ok(names.includes("iolink_station_parts"));
  const tool = tools.find((t) => t.name === "iolink_station");
  assert.equal(tool._meta["openai/outputTemplate"], "ui://widget/iolink-station.html");
  assert.equal(tool.annotations.readOnlyHint, true);
  const { contents } = await client.readResource({ uri: "ui://widget/iolink-station.html" });
  assert.equal(contents[0].mimeType, "text/html+skybridge");
  assert.match(contents[0].text, /openai:set_globals/);
});

test("parts lists filed sensors with their setting ranges", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "iolink_station_parts", arguments: {} });
  const pn = result.structuredContent.sensors.find((s) => s.part === "PN7092");
  assert.equal(pn.settings.find((s) => s.key === "sp1").max, 100);
  assert.ok(result.structuredContent.masters.some((m) => m.part === "AL1301" && m.ports === 4));
});

test("ChatGPT places and wires a station; ports are kept as wired", async () => {
  const client = await connect();
  const result = await client.callTool({ name: "iolink_station", arguments: station });
  const data = result.structuredContent;
  assert.equal(data.ok, true, JSON.stringify(data.issues));
  assert.deepEqual(data.diagram.wires.map((w) => [w.from.pin, w.to.part]).sort(), [["X2", "p1"], ["X3", "f1"]]);
  assert.equal(data.order.filter((l) => l.kind === "cable").length, 2);
  assert.match(data.studio_link, /^https:\/\/iolinki\.com\/studio\/#s=/);
  assert.equal(data.written_to_sensor, false);
});

test("datasheet and wiring problems come back part by part", async () => {
  const client = await connect();
  const bad = structuredClone(station);
  bad.parts[3].settings = { sp1: 140, rp1: 35 };
  bad.parts.push({ id: "s3", type: "IG6214", x: 4, z: 0, settings: { switch_point: 4 }, target: "brass" });
  bad.wires.push({ from: { part: "m1", pin: "X2" }, to: { part: "s3", pin: "C/Q" } });
  bad.wires.push({ from: { part: "pump", pin: "X1" }, to: { part: "f1", pin: "C/Q" } });
  const data = (await client.callTool({ name: "iolink_station", arguments: bad })).structuredContent;
  assert.equal(data.ok, false);
  const text = data.issues.map((i) => i.problem).join(" | ");
  assert.match(text, /SP1 must be 1–100 bar/);
  assert.match(text, /brass/);
  assert.match(text, /must join a master port to a sensor|wired twice/);
  assert.match(text, /taken\. It was moved to m1 X/);
});
