import { z } from "zod";
import { engine, LIBRARY, WIDGET_HTML } from "./station.generated.mjs";
import { partFromIoddZip } from "./iodd-part.mjs";

// IO-Link station tools: ChatGPT places parts on a factory floor and wires each
// sensor to a master port, like a LabWired lab. Every part is checked against
// its filed datasheet; the result renders as the station widget.

export const STATION_WIDGET_URI = "ui://widget/iolink-station.html";
export const CATALOG_ORIGIN = "https://iolinki-iodd-catalog.shylenkoa.workers.dev";
const IODD_REF = /^iodd-(\d+)-(\d+)$/;
const MAX_IODD_PARTS = 12;
const WIDGET_META = {
  "openai/widgetDescription": "Interactive 3D IO-Link station: machines, sensors, masters and cables, with Run (live sensor switching and process data), wiring, port table, installer notes, the order and a Buy button. It already shows the order and notes, so the reply should stay short.",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
};

const part = z.object({
  id: z.string().min(1).max(40).describe("Your id for this part, used by wires."),
  type: z.string().min(1).max(60).describe("Library ref or part number from iolink_station_parts, e.g. ifm-pn7092, PN7092, ifm-al1301, conveyor, or iodd-<vendorId>-<ioddId> for any device found in IODD Finder."),
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

function summary(built, library, extra) {
  const station = built.station;
  return {
    ok: built.check.ok,
    issues: built.check.issues,
    diagram: engine.toDiagram(station, library),
    order: engine.orderLines(station, library),
    extra_parts: extra,
    studio_link: engine.encodeStation(station),
    written_to_sensor: false,
  };
}

// Devices named iodd-<vendorId>-<ioddId>: read each IODD package through the
// catalog Worker and add it to the library for this call.
async function withIoddParts(parts, catalogFetch) {
  const refs = [...new Set(parts.map((part) => part.type).filter((type) => IODD_REF.test(type) && !engine.byId(LIBRARY, type)))].slice(0, MAX_IODD_PARTS);
  const problems = [];
  const extra = (await Promise.all(refs.map(async (ref) => {
    const [, vendorId, ioddId] = ref.match(IODD_REF);
    try {
      const response = await catalogFetch(CATALOG_ORIGIN + "/download?" + new URLSearchParams({ vendorId, ioddId }));
      if (!response.ok) {
        throw Error("download answered " + response.status);
      }
      return await partFromIoddZip(new Uint8Array(await response.arrayBuffer()), { vendorId: Number(vendorId), ioddId: Number(ioddId) });
    } catch (error) {
      problems.push({ uid: null, problem: ref + ": the IODD could not be read (" + error.message + "). Check the ids with iolink_station_parts." });
      return null;
    }
  }))).filter(Boolean);
  const library = Object.assign({}, LIBRARY, { sensors: LIBRARY.sensors.concat(extra) });
  return { library, extra, problems };
}

async function searchCatalog(query, catalogFetch) {
  const response = await catalogFetch(CATALOG_ORIGIN + "/search?" + new URLSearchParams({ q: query, field: "productName", size: "24" }));
  if (!response.ok) {
    throw Error("IODD Finder search answered " + response.status);
  }
  const data = await response.json();
  return {
    total: data.totalElements,
    devices: engine.markFiled(LIBRARY, data.content).map((hit) => ({
      type: hit.filed || "iodd-" + hit.vendor_id + "-" + hit.iodd_id,
      part: hit.part,
      vendor: hit.vendor,
      device_id: hit.device_id,
      filed: Boolean(hit.filed),
    })),
  };
}

export function registerStationTools(server, { catalogFetch = (url) => fetch(url) } = {}) {
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
      description: "List what can be placed on an IO-Link station: sensors with filed datasheet limits (setting keys, ranges, units, options, materials), IO-Link masters (port count and class) and generic machines. With a query, also search every device in IODD Finder (any vendor); each hit has a type such as iodd-888-878 that iolink_station accepts, with ranges, defaults and process data read from its IODD. Call this before iolink_station.",
      inputSchema: {
        query: z.string().max(80).optional().describe("Product name or number to look up in IODD Finder, e.g. BOS 23K, UM30, PN7092."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ query } = {}) => {
      const data = engine.describeLibrary(LIBRARY);
      if (query && query.trim().length >= 2) {
        try {
          data.iodd_finder = await searchCatalog(query.trim(), catalogFetch);
        } catch (error) {
          data.iodd_finder = { error: error.message };
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    },
  );

  server.registerTool(
    "iolink_station",
    {
      title: "Build IO-Link station",
      description: "Place machines, sensors and IO-Link masters on the factory floor and wire each sensor's C/Q to a master port (X1..Xn), then show the station. Every sensor setting is checked against its datasheet or, for an iodd-<vendorId>-<ioddId> device, its IODD; inductive distances are converted with the material correction factor. A sensor with no wire is put on the first free port, and a master is added when all ports are used. Returns notes part by part (they never block the station or the order), the corrected diagram, the order (sensors, masters, sized M12 cables) and a studio link with a buy button. To change the station, call again with the full updated diagram. Nothing is written to a sensor and no payment is taken.",
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
      const { library, extra, problems } = await withIoddParts(parts, catalogFetch);
      const built = engine.fromDiagram({ parts, wires }, library);
      built.check.issues = problems.concat(built.check.issues);
      built.check.ok = built.check.issues.length === 0;
      const data = Object.assign({ title: title || "IO-Link station" }, summary(built, library, extra));
      // The widget shows the station, notes and order; the reply only needs a line or two.
      const text = "The station is shown in the iolinki widget (3D view, Run, wiring, ports, order, Buy). Keep the reply short and do not repeat the order list. " +
        (data.ok ? "Every setting is inside its datasheet or IODD." : data.issues.length + " note(s) for the installer: " + data.issues.map((issue) => issue.problem).join(" ")) +
        " Studio link: " + data.studio_link;
      return { content: [{ type: "text", text }], structuredContent: data };
    },
  );
}
