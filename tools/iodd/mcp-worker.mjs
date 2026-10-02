import "./node-runtime.mjs";
import { DurableObject } from "cloudflare:workers";
import counter from "../../assets/iodd/counter.xml";
import switching from "../../assets/iodd/switching-sensor.xml";
import { IoddHttpHost } from "./mcp-http.mjs";
import { createProjectVault, isRecoveryToken } from "./project-vault.mjs";
import { createArtifactStore } from "./artifact-store.mjs";
import { createWorkerSchemaValidation } from "./schema-worker.mjs";
const externalValidation = createWorkerSchemaValidation();
import { createFirmwareKit } from "./firmware-kit.mjs";
import sensorC from "../../assets/iodd/firmware-kit/switching_sensor.c";
import sensorH from "../../assets/iodd/firmware-kit/switching_sensor.h";
import protocolH from "../../assets/iodd/firmware-kit/protocol.h";
import firmwareLicense from "../../assets/iodd/firmware-kit/LICENSE.GPL-3.0";
import proofMain from "../../assets/iodd/firmware-kit/proof-main.c";
const firmwareAssets = { "switching_sensor.c": sensorC, "switching_sensor.h": sensorH, "protocol.h": protocolH, "LICENSE.GPL-3.0": firmwareLicense, "proof-main.c": proofMain };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class IoddMcpSessions extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.vault = createProjectVault({ storage: state.storage, durable: true });
    this.artifactStore = createArtifactStore({ storage: state.storage });
    this.host = new IoddHttpHost({
      externalValidation,
      artifactOrigin: env.PUBLIC_ORIGIN,
      artifactStore: this.artifactStore,
      firmwareKit: project => createFirmwareKit(project, {loadAsset: async name => firmwareAssets[name]}),
      loadTemplate: async (name) => (name === "counter" ? counter : switching),
      projectVaultFactory: (sessionId) => ({
        save: async (serialized) => {
          const vault = createProjectVault({ storage: state.storage, durable: true, tokenPrefix: sessionId[0] });
          return vault.save(serialized);
        },
        restore: (token) => {
          if (!isRecoveryToken(token)) throw Error("Recovery token unavailable.");
          if (token[0] === sessionId[0]) return this.vault.restore(token);
          return env.IODD_SESSIONS.get(env.IODD_SESSIONS.idFromName("shard-" + token[0])).restoreSavedProject(token);
        },
        delete: (token) => {
          if (!isRecoveryToken(token)) return false;
          if (token[0] === sessionId[0]) return this.vault.delete(token);
          return env.IODD_SESSIONS.get(env.IODD_SESSIONS.idFromName("shard-" + token[0])).deleteSavedProject(token);
        },
      }),
    });
  }
  async restoreSavedProject(token) {
    return this.vault.restore(token);
  }
  async deleteSavedProject(token) {
    return this.vault.delete(token);
  }
  async fetch(request) {
    const response = await this.host.fetch(
      request,
      request.headers.get("X-IODD-New-Session") ?? undefined,
    );
    await this.scheduleAlarm();
    return response;
  }
  async alarm() {
    await this.host.prune();
    await this.vault.prune();
    await this.scheduleAlarm();
  }
  async scheduleAlarm() {
    const [nextExpiry, nextArtifact] = await Promise.all([this.vault.nextExpiry(), this.artifactStore.nextExpiry()]);
    const nextSession = this.host.sessions.size || this.host.artifacts.size ? Date.now() + 60 * 1000 : null;
    const next = [nextExpiry, nextArtifact, nextSession].filter(value => value !== null);
    if (next.length) await this.state.storage.setAlarm(Math.min(...next));
    else await this.state.storage.deleteAlarm();
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const incoming = url.pathname.startsWith("/artifacts/")
      ? url.pathname.slice(11)
      : request.headers.get("Mcp-Session-Id");
    if (incoming && !UUID.test(incoming))
      return Response.json(
        { error: "Unknown session or artifact." },
        { status: 404 },
      );
    const sessionId = incoming || crypto.randomUUID();
    const headers = new Headers(request.headers);
    headers.set("X-IODD-New-Session", sessionId);
    const forwarded = new Request(request, { headers });
    return env.IODD_SESSIONS.get(
      env.IODD_SESSIONS.idFromName("shard-" + sessionId[0]),
    ).fetch(forwarded);
  },
};
