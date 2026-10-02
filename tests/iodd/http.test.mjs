import test from "node:test";
import assert from "node:assert/strict";
import "../../tools/iodd/node-runtime.mjs";
import { readFile } from "node:fs/promises";
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
