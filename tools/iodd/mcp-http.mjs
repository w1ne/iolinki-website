import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createIoddMcpServer } from "./mcp-factory.mjs";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALLOWED_ORIGINS = new Set([
  "https://chatgpt.com",
  "https://claude.ai",
  "https://iolinki.com",
  "https://www.iolinki.com",
]);
const fail = (status, message) => Response.json({ error: message }, { status });
export class IoddHttpHost {
  constructor({
    loadTemplate,
    now = Date.now,
    sessionTTL = 30 * 60 * 1000,
    artifactTTL = 10 * 60 * 1000,
    maxSessions = 8,
    maxProjectBytes = 8 * 1024 * 1024,
    maxArtifactBytes = 16 * 1024 * 1024,
    externalValidation,
    projectVaultFactory,
    firmwareKit,
  } = {}) {
    Object.assign(this, {
      loadTemplate,
      now,
      sessionTTL,
      artifactTTL,
      maxSessions,
      maxProjectBytes,
      maxArtifactBytes,
      externalValidation,
      projectVaultFactory,
      firmwareKit,
    });
    this.sessions = new Map();
    this.pendingSessions = 0;
    this.artifacts = new Map();
  }
  async removeSession(id) {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    for (const [key, value] of this.artifacts)
      if (value.sessionId === id) this.artifacts.delete(key);
    if (session) await session.server.close();
  }
  async prune() {
    const now = this.now();
    for (const [id, session] of this.sessions)
      if (now - session.touched >= this.sessionTTL)
        await this.removeSession(id);
    for (const [key, value] of this.artifacts)
      if (value.expires <= now) this.artifacts.delete(key);
  }
  async fetch(request, newSessionId = crypto.randomUUID()) {
    await this.prune();
    const url = new URL(request.url),
      origin = request.headers.get("Origin");
    if (origin && !ALLOWED_ORIGINS.has(origin))
      return fail(403, "Origin is not allowed.");
    const response = await this.handle(request, url, newSessionId);
    const headers = new Headers(response.headers);
    if (origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
  async handle(request, url, newSessionId) {
    if (url.pathname.startsWith("/artifacts/")) {
      if (request.method !== "GET") return fail(405, "Use GET.");
      const token = url.pathname.slice("/artifacts/".length);
      const artifact = UUID.test(token) && this.artifacts.get(token);
      if (!artifact) return fail(404, "Artifact expired or not found.");
      return new Response(artifact.bytes, {
        headers: {
          "Content-Type": artifact.mimeType,
          "Content-Disposition": `attachment; filename="${artifact.filename}"`,
        },
      });
    }
    if (url.pathname !== "/mcp")
      return fail(404, "Use /mcp for the MCP endpoint.");
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
          "Access-Control-Max-Age": "600",
        },
      });
    if (!["POST", "GET", "DELETE"].includes(request.method))
      return fail(405, "Unsupported method.");
    const id = request.headers.get("Mcp-Session-Id");
    if (id && !UUID.test(id)) return fail(404, "Unknown session.");
    let session = id && this.sessions.get(id);
    if (id && !session)
      return fail(
        404,
        "Session expired or not found. Initialize a new session.",
      );
    if (!session) {
      if (request.method !== "POST")
        return fail(400, "Initialize a session with POST.");
      if (this.sessions.size + this.pendingSessions >= this.maxSessions)
        return fail(
          503,
          "Session capacity reached. Retry after idle sessions expire.",
        );
      if (!UUID.test(newSessionId))
        return fail(400, "Invalid session identifier.");
      const sessionId = newSessionId;
      this.pendingSessions++;
      const server = createIoddMcpServer({
        loadTemplate: this.loadTemplate,
        externalValidation: this.externalValidation,
        projectVault: this.projectVaultFactory?.(sessionId),
        firmwareKit: this.firmwareKit,
        maxBytes: this.maxProjectBytes,
        publishArtifact: async ({ bytes, filename, mimeType }) => {
          await this.prune();
          const total = [...this.artifacts.values()].reduce(
            (sum, a) => sum + a.bytes.length,
            0,
          );
          if (
            this.artifacts.size >= 128 ||
            total + bytes.length > this.maxArtifactBytes
          )
            throw Error(
              "Download memory limit reached. Wait for older downloads to expire.",
            );
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(filename))
            filename = "device-export.bin";
          const token = sessionId[0] + crypto.randomUUID().slice(1),
            expires = this.now() + this.artifactTTL;
          this.artifacts.set(token, {
            bytes: Uint8Array.from(bytes),
            filename,
            mimeType,
            expires,
            sessionId,
          });
          return {
            filename,
            downloadUrl: `${url.origin}/artifacts/${token}`,
            byteLength: bytes.length,
            expiresAt: new Date(expires).toISOString(),
          };
        },
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        enableJsonResponse: true,
        maxRequestBodySize: 4 * 1024 * 1024,
        onsessioninitialized: () => this.sessions.set(sessionId, session),
        onsessionclosed: () => this.removeSession(sessionId),
      });
      session = { server, transport, touched: this.now() };
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        if (!this.sessions.has(sessionId)) await server.close();
        return response;
      } finally {
        this.pendingSessions--;
      }
    }
    session.touched = this.now();
    return session.transport.handleRequest(request);
  }
}
