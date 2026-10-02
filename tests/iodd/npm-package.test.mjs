import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildNpmPackage, output } from "../../scripts/package-iodd-npm.mjs";
const exec = promisify(execFile);
test("standalone npm package has complete allowlisted runtime and a reproducible public tarball", async () => {
  const first = await buildNpmPackage(), second = await buildNpmPackage();
  assert.deepEqual(first.bytes, second.bytes);
  assert.deepEqual(first.bytes, await readFile(output));
  const names = first.manifest.files.map(file => file.path);
  for (const name of ["bin/iodd-mcp.mjs", "tools/iodd/mcp.mjs", "tools/iodd/mcp-factory.mjs", "tools/iodd/checker.mjs", "tools/iodd/project-vault.mjs", "tools/iodd/firmware-kit.mjs", "assets/iodd/firmware-kit/switching_sensor.c", "assets/js/iodd/project.js", "assets/js/iodd/vendor/checker/LICENSE", "assets/iodd/counter.xml", "assets/iodd/switching-sensor.xml", "assets/iodd/LICENSE.GPL-3.0", "LICENSE"])
    assert.ok(names.includes(name), name);
  assert.ok(!names.some(name => /editor|finder|node_modules|package-lock|catalog-worker/.test(name)));
  assert.equal(first.manifest.name, "iolinki-iodd-mcp");
});
test("clean npx tarball launch initializes real MCP and creates/exports XML and optional CLI", {skip: !process.env.IODD_NPM_INTEGRATION, timeout: 240000}, async () => {
  const work = await mkdtemp(join(tmpdir(), "iodd-npx-proof-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"));
  env.PATH = dirname(process.execPath) + ":" + env.PATH;
  env.npm_config_cache = join(work, "cache");
  const client = new Client({name: "iodd-npm-proof", version: "1.0.0"});
  const transport = new StdioClientTransport({command: join(dirname(process.execPath), "npx"), args: ["-y", "file:" + output], cwd: work, env, stderr: "pipe"});
  let errors = "";
  transport.stderr?.on("data", chunk => { errors += chunk; });
  try {
    await client.connect(transport, {timeout: 180000});
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === "iodd_create"));
    const created = await client.callTool({name: "iodd_create", arguments: {template: "counter"}});
    assert.ok(!created.isError, JSON.stringify(created) + errors);
    const data = created.structuredContent || JSON.parse(created.content[0].text);
    const exported = await client.callTool({name: "iodd_export", arguments: {projectId: data.projectId, format: "xml"}});
    assert.ok(!exported.isError, JSON.stringify(exported));
    const result = exported.structuredContent || JSON.parse(exported.content[0].text);
    assert.match(result.content, /<IODevice\s/);
    const saved = await client.callTool({name: "iodd_save", arguments: {projectId: data.projectId}});
    assert.ok(!saved.isError);
    const receipt = JSON.parse(saved.content[0].text);
    assert.equal(receipt.durable, false);
    const restored = await client.callTool({name: "iodd_restore", arguments: {token: receipt.token}});
    assert.ok(!restored.isError);
    const sensor = JSON.parse((await client.callTool({name: "iodd_create", arguments: {template: "switching-sensor"}})).content[0].text);
    const kit = await client.callTool({name: "iodd_firmware_kit", arguments: {projectId: sensor.projectId}});
    assert.ok(!kit.isError, JSON.stringify(kit));
    assert.equal(JSON.parse(kit.content[0].text).encoding, "base64");
    const {stdout} = await exec(join(dirname(process.execPath), "npx"), ["-y", "file:" + output, "cli", "--help"], {cwd: work, env, timeout: 30000});
    assert.match(stdout, /Commands: create/);
  } finally {
    await client.close();
    await rm(work, {recursive: true, force: true});
  }
});
