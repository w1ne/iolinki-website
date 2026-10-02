import "./node-runtime.mjs";
import counter from "../../assets/iodd/counter.xml";
import switching from "../../assets/iodd/switching-sensor.xml";
import { IoddHttpHost } from "./mcp-http.mjs";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class IoddMcpSessions {
  constructor(state) {
    this.state = state;
    this.host = new IoddHttpHost({
      loadTemplate: async (name) => (name === "counter" ? counter : switching),
    });
  }
  async fetch(request) {
    const response = await this.host.fetch(
      request,
      request.headers.get("X-IODD-New-Session") ?? undefined,
    );
    await this.state.storage.setAlarm(Date.now() + 60 * 1000);
    return response;
  }
  async alarm() {
    await this.host.prune();
    if (this.host.sessions.size || this.host.artifacts.size)
      await this.state.storage.setAlarm(Date.now() + 60 * 1000);
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
