import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/iodd/node-runtime.mjs";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { IoddHttpHost } from "../../tools/iodd/mcp-http.mjs";
const parse = (result) => JSON.parse(result.content[0].text);
const loadTemplate = (name) =>
  readFile(new URL(`../../assets/iodd/${name}.xml`, import.meta.url), "utf8");
async function connect(host) {
  const transport = new StreamableHTTPClientTransport(
    new URL("https://example.test/mcp"),
    { fetch: (url, init) => host.fetch(new Request(url, init)) },
  );
  const client = new Client({ name: "http-proof", version: "1" });
  await client.connect(transport);
  return {
    client,
    transport,
    call: async (name, args = {}) =>
      parse(await client.callTool({ name: `iodd_${name}`, arguments: args })),
  };
}
test("official SDK Streamable HTTP client authors device, downloads exports and isolates sessions", async () => {
  let now = 1000000;
  const host = new IoddHttpHost({
    loadTemplate,
    now: () => now,
    artifactTTL: 1000,
    sessionTTL: 2000,
  });
  const a = await connect(host),
    b = await connect(host);
  try {
    assert.notEqual(a.transport.sessionId, b.transport.sessionId);
    const project = await a.call("create", { template: "counter" });
    const cross = await b.call("inspect", { projectId: project.projectId });
    assert.match(cross.error.message, /Unknown project/);
    await a.call("edit", {
      projectId: project.projectId,
      operation: { type: "identity", values: { productName: "HTTP device" } },
    });
    const validation = await a.call("validate", {
      projectId: project.projectId,
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.officialChecker.status, "unavailable");
    const exported = await a.call("export", {
      projectId: project.projectId,
      format: "xml",
    });
    assert.equal(exported.content, undefined);
    const downloaded = await host.fetch(new Request(exported.downloadUrl));
    assert.equal(downloaded.status, 200);
    assert.match(await downloaded.text(), /HTTP device/);
    assert.equal(downloaded.headers.get("Cache-Control"), "no-store");
    const header = await a.call("header", { projectId: project.projectId });
    assert.match(
      await (await host.fetch(new Request(header.downloadUrl))).text(),
      /IODD_VENDOR_ID/,
    );
    const prompts = await a.client.listPrompts();
    assert.ok(prompts.prompts.find((p) => p.name === "author-device"));
    const guide = await a.client.readResource({ uri: "iodd://guide" });
    assert.match(guide.contents[0].text, /https:\/\/iolinki.com\/llms.txt/);
    now += 1001;
    assert.equal(
      (await host.fetch(new Request(exported.downloadUrl))).status,
      404,
    );
    now += 1000;
    assert.equal(
      (
        await host.fetch(
          new Request("https://example.test/mcp", {
            headers: { "Mcp-Session-Id": a.transport.sessionId },
          }),
        )
      ).status,
      404,
    );
  } finally {
    await a.client.close();
    await b.client.close();
    for (const id of host.sessions.keys()) await host.removeSession(id);
  }
});
test("HTTP rejects unknown sessions, origins, oversized requests and caps sessions/artifacts", async () => {
  const host = new IoddHttpHost({
    loadTemplate,
    maxSessions: 1,
    maxArtifactBytes: 1,
  });
  assert.equal(
    (
      await host.fetch(
        new Request("https://example.test/mcp", {
          headers: { "Mcp-Session-Id": crypto.randomUUID() },
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await host.fetch(
        new Request("https://example.test/mcp", {
          headers: { Origin: "https://evil.test" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await host.fetch(
        new Request("https://example.test/mcp", {
          method: "POST",
          headers: {
            "Content-Length": String(5 * 1024 * 1024),
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
          },
          body: "{}",
        }),
      )
    ).status,
    413,
  );
  const a = await connect(host);
  try {
    await assert.rejects(connect(host), (error) => error.code === 503);
    const project = await a.call("create");
    const exportResult = await a.call("export", {
      projectId: project.projectId,
      format: "xml",
    });
    assert.match(exportResult.error.message, /Download memory limit/);
    await a.transport.terminateSession();
    assert.equal(host.sessions.size, 0);
  } finally {
    await a.client.close();
    for (const id of host.sessions.keys()) await host.removeSession(id);
  }
});
test("assistant disconnect leaves returned downloads usable until their advertised expiry", async () => {
  let now = 1000;
  const host = new IoddHttpHost({ loadTemplate, now: () => now, artifactTTL: 1000 });
  const a = await connect(host), b = await connect(host);
  try {
    const first = await a.call("create");
    const second = await b.call("create");
    const downloadA = await a.call("export", { projectId: first.projectId, format: "xml" });
    const downloadB = await b.call("export", { projectId: second.projectId, format: "package" });
    await a.transport.terminateSession();
    assert.equal(host.sessions.size, 1);
    assert.equal((await host.fetch(new Request(downloadA.downloadUrl))).status, 200);
    const zip = await host.fetch(new Request(downloadB.downloadUrl));
    assert.equal(zip.status, 200);
    assert.deepEqual([...new Uint8Array(await zip.arrayBuffer()).slice(0, 2)], [80, 75]);
    assert.deepEqual((await b.call("inspect", { projectId: second.projectId })).identity, second.identity);
    await b.transport.terminateSession();
    assert.equal(host.sessions.size, 0);
    assert.equal(host.artifacts.size, 2);
    assert.equal((await host.fetch(new Request(downloadB.downloadUrl))).status, 200);
    now = 2000;
    assert.equal((await host.fetch(new Request(downloadA.downloadUrl))).status, 404);
    assert.equal((await host.fetch(new Request(downloadB.downloadUrl))).status, 404);
    assert.equal(host.artifacts.size, 0);
  } finally {
    await a.client.close();
    await b.client.close();
    for (const id of host.sessions.keys()) await host.removeSession(id);
  }
});
test("concurrent initialization reserves capacity and rejected requests leave no sessions", async () => {
  const host = new IoddHttpHost({ loadTemplate, maxSessions: 1 });
  const results = await Promise.allSettled([connect(host), connect(host)]);
  const successes = results.filter((result) => result.status === "fulfilled");
  try {
    assert.equal(successes.length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.code, 503);
    assert.equal(host.pendingSessions, 0);
    await successes[0].value.transport.terminateSession();
    const malformed = await host.fetch(new Request("https://example.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: "{invalid",
    }));
    assert.equal(malformed.status, 400);
    assert.equal(host.sessions.size, 0);
    assert.equal(host.pendingSessions, 0);
    const preflight = await host.fetch(new Request("https://example.test/mcp", {
      method: "OPTIONS", headers: { Origin: "https://chatgpt.com" },
    }));
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://chatgpt.com");
    assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /Mcp-Session-Id/);
    assert.equal(host.sessions.size, 0);
  } finally {
    for (const { value } of successes) await value.client.close();
    for (const id of host.sessions.keys()) await host.removeSession(id);
  }
});

test('durable exports remain downloadable in a recreated HTTP host after session shutdown', async () => {
  const {createArtifactStore} = await import('../../tools/iodd/artifact-store.mjs');
  const {createMemoryProjectStorage} = await import('../../tools/iodd/project-vault.mjs');
  const storage = createMemoryProjectStorage();
  const first = new IoddHttpHost({loadTemplate, artifactStore: createArtifactStore({storage})});
  const connection = await connect(first);
  const project = await connection.call('create', {template:'switching-sensor'});
  const artifact = await connection.call('export', {projectId:project.projectId, format:'xml'});
  await connection.transport.terminateSession();
  await connection.client.close();
  const restarted = new IoddHttpHost({loadTemplate, artifactStore: createArtifactStore({storage})});
  const download = await restarted.fetch(new Request(artifact.downloadUrl));
  assert.equal(download.status, 200);
  assert.match(await download.text(), /<IODevice/);
  assert.equal(restarted.sessions.size, 0);
});

test("SDK exports preserve project basenames in metadata and download headers", async () => {
  const host = new IoddHttpHost({ loadTemplate });
  const connection = await connect(host);
  try {
    for (const template of ["new", "counter", "switching-sensor"]) {
      const project = await connection.call("create", { template });
      const snapshot = await connection.call("export", { projectId: project.projectId, format: "project" });
      const filename = (await (await host.fetch(new Request(snapshot.downloadUrl))).json()).filename;
      assert.match(filename, /-\d{8}-IODD1\.1\.xml$/);
      for (const [format, expected] of [["xml", filename], ["package", filename.replace(/\.xml$/i, ".zip")], ["project", filename.replace(/\.xml$/i, ".iodd-project.json")]]) {
        const artifact = await connection.call("export", { projectId: project.projectId, format });
        assert.equal(artifact.filename, expected);
        const response = await host.fetch(new Request(artifact.downloadUrl));
        assert.equal(response.headers.get("Content-Disposition"), `attachment; filename="${expected}"`);
      }
    }
    const longName = `${"X".repeat(236)}.xml`;
    const longProject = await connection.call("create", { template: "counter", filename: longName });
    for (const [format, expected] of [["xml", longName], ["package", `${"X".repeat(236)}.zip`], ["project", `${"X".repeat(222)}.iodd-project.json`]]) {
      const artifact = await connection.call("export", { projectId: longProject.projectId, format });
      assert.equal(artifact.filename, expected);
      assert.equal(artifact.filename.length, 240);
      const response = await host.fetch(new Request(artifact.downloadUrl));
      assert.equal(response.headers.get("Content-Disposition"), `attachment; filename="${expected}"`);
    }
    const imported = await connection.call("import", { format: "xml", content: await loadTemplate("counter"), filename: "folder/Custom-IODD.xml" });
    const artifact = await connection.call("export", { projectId: imported.projectId, format: "xml" });
    assert.equal(artifact.filename, "Custom-IODD.xml");
  } finally {
    await connection.client.close();
    for (const id of host.sessions.keys()) await host.removeSession(id);
  }
});

test("default-created hosted XML passes genuine Checker using returned filename", { skip: !process.env.IODD_CHECKER }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "iodd-hosted-checker-"));
  const host = new IoddHttpHost({ loadTemplate });
  const connection = await connect(host);
  try {
    const project = await connection.call("create", {});
    const artifact = await connection.call("export", { projectId: project.projectId, format: "xml" });
    const response = await host.fetch(new Request(artifact.downloadUrl));
    assert.match(artifact.filename, /-\d{8}-IODD1\.1\.xml$/);
    const filename = join(directory, artifact.filename);
    await writeFile(filename, await response.text());
    const { stdout } = await promisify(execFile)(process.env.IODD_CHECKER, [filename], { timeout: 45000 });
    assert.match(stdout, /0 errors found/);
  } finally {
    await connection.client.close();
    for (const id of host.sessions.keys()) await host.removeSession(id);
    await rm(directory, { recursive: true, force: true });
  }
});

test("canonical leading hash, underscore and hyphen exports retain metadata and headers", async () => {
  const host = new IoddHttpHost({ loadTemplate });
  const connection = await connect(host);
  try {
    for (const vendorName of ["#Vendor", "_Vendor", "-Vendor"]) {
      const project = await connection.call("create", { identity: { vendorName, releaseDate: "2026-10-02" } });
      const artifact = await connection.call("export", { projectId: project.projectId, format: "xml" });
      assert.equal(artifact.filename, `${vendorName}-new-device-20261002-IODD1.1.xml`);
      const response = await host.fetch(new Request(artifact.downloadUrl));
      assert.equal(response.headers.get("Content-Disposition"), `attachment; filename="${artifact.filename}"`);
    }
  } finally {
    await connection.client.close();
    for (const id of host.sessions.keys()) await host.removeSession(id);
  }
});
