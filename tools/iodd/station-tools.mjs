import { z } from "zod";
import { engine, LIBRARY, WIDGET_HTML } from "./station.generated.mjs";

// IO-Link station tools: ChatGPT places parts on a factory floor and wires each
// sensor to a master port, like a LabWired lab. Every part is checked against
// its filed datasheet; the result renders as the station widget.

export const STATION_WIDGET_URI = "ui://widget/iolink-station.html";
const WIDGET_META = {
  "openai/widgetDescription": "3D view of an IO-Link station: machines, sensors, masters and the cable from each master port, with datasheet problems, the order list and a buy button.",
  "openai/widgetPrefersBorder": true,
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
};

const part = z.object({
  id: z.string().min(1).max(40).describe("Your id for this part, used by wires."),
  type: z.string().min(1).max(60).describe("Library ref or part number from iolink_station_parts, e.g. ifm-pn7092, PN7092, ifm-al1301, conveyor."),
  x: z.number().min(-20).max(20).optional().describe("Metres left/right of floor centre. Floor is 14 x 9 m."),
  z: z.number().min(-20).max(20).optional().describe("Metres front/back of floor centre; negative is toward the back wall."),
  settings: z.record(z.union([z.number(), z.null()])).optional().describe("Setting key to value in the real units at the machine (inductive distances are for the named target material)."),
  options: z.record(z.string()).optional(),
  target: z.string().max(30).optional().describe("Target material for sensors with correction factors, e.g. steel, stainless, brass."),
});
const end = z.object({ part: z.string().min(1).max(40), pin: z.string().min(1).max(10) });
const wire = z.object({
  from: end.describe("Master port: master part id and pin X1, X2, ..."),
  to: end.describe("Sensor part id and pin C/Q."),
});

function summary(built) {
  const station = built.station;
  return {
    ok: built.check.ok,
    issues: built.check.issues,
    diagram: engine.toDiagram(station, LIBRARY),
    order: engine.orderLines(station, LIBRARY),
    studio_link: engine.encodeStation(station),
    written_to_sensor: false,
  };
}

export function registerStationTools(server) {
  server.registerResource(
    "iolink-station-widget",
    STATION_WIDGET_URI,
    { description: "IO-Link station viewer", mimeType: "text/html+skybridge", _meta: WIDGET_META },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/html+skybridge", text: WIDGET_HTML, _meta: WIDGET_META }] }),
  );

  server.registerTool(
    "iolink_station_parts",
    {
      title: "IO-Link station parts",
      description: "List what can be placed on an IO-Link station: sensors with filed datasheet limits (setting keys, ranges, units, options, materials), IO-Link masters (port count and class) and generic machines. Call this before iolink_station. Parts not listed have no filed limits and cannot be placed.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const data = engine.describeLibrary(LIBRARY);
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    },
  );

  server.registerTool(
    "iolink_station",
    {
      title: "Build IO-Link station",
      description: "Place machines, sensors and IO-Link masters on the factory floor and wire each sensor's C/Q to a master port (X1..Xn), then show the station. Every sensor setting is checked against its datasheet; inductive distances are converted with the material correction factor. A sensor with no wire is put on the first free port, and a master is added when all ports are used. Returns notes part by part (they never block the station or the order), the corrected diagram, the order (sensors, masters, sized M12 cables) and a studio link with a buy button. To change the station, call again with the full updated diagram. Nothing is written to a sensor and no payment is taken.",
      inputSchema: {
        title: z.string().max(120).optional(),
        parts: z.array(part).min(1).max(60),
        wires: z.array(wire).max(60).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
      _meta: {
        "openai/outputTemplate": STATION_WIDGET_URI,
        "openai/toolInvocation/invoking": "Wiring the station…",
        "openai/toolInvocation/invoked": "Station ready",
        "openai/widgetAccessible": true,
      },
    },
    async ({ title, parts, wires = [] }) => {
      const built = engine.fromDiagram({ parts, wires }, LIBRARY);
      const data = Object.assign({ title: title || "IO-Link station" }, summary(built));
      const text = (data.ok ? "Station is inside every datasheet. " : data.issues.length + " issue(s): " + data.issues.map((issue) => issue.problem).join(" ") + " ") + "Studio: " + data.studio_link;
      return { content: [{ type: "text", text }], structuredContent: data };
    },
  );
}
