import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  stationPartsShape, stationShape, STATION_PARTS_DESCRIPTION, STATION_DESCRIPTION,
  runStationParts, runStation,
} from "../tools/iodd/station-tools.mjs";

// The studio agent: DeepSeek Flash (OpenAI-compatible API on DeepInfra) calls the
// same two station tools ChatGPT calls, with the same input schemas and the same
// code. The tools run here; the page gets the resulting station.

export const DEEPINFRA_URL = "https://api.deepinfra.com/v1/openai/chat/completions";
export const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";
export const MAX_ITERATIONS = 6;
export const MAX_TOKENS = 3000;
const MODEL_TIMEOUT_MS = 60000;
const TURN_BUDGET_MS = 110000;
export const MAX_MESSAGES = 12;
export const MAX_MESSAGE_CHARS = 1500;

export class AgentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const inputSchemas = {
  iolink_station_parts: z.object(stationPartsShape),
  iolink_station: z.object(stationShape),
};

function jsonSchema(schema) {
  const out = zodToJsonSchema(schema, { $refStrategy: "none", target: "openApi3" });
  delete out.$schema;
  return out;
}

export const TOOLS = [
  { type: "function", function: { name: "iolink_station_parts", description: STATION_PARTS_DESCRIPTION, parameters: jsonSchema(inputSchemas.iolink_station_parts) } },
  { type: "function", function: { name: "iolink_station", description: STATION_DESCRIPTION, parameters: jsonSchema(inputSchemas.iolink_station) } },
];

export function systemPrompt(diagram) {
  return [
    "You are the design assistant in the iolinki IO-Link station studio (iolinki.com/studio). The user describes a machine or process; you build and edit an IO-Link station for it: sensors, an IO-Link master and machines on a 14 x 9 m factory floor, each sensor's C/Q wired to a master port. The studio shows the station in 3D next to this chat.",
    "",
    "Tools: iolink_station_parts lists the parts and searches IODD Finder; iolink_station builds the station from a diagram of parts and wires and checks every setting against the datasheet or IODD.",
    "",
    "Rules:",
    "- Call iolink_station_parts first to learn exact part refs and setting keys. Call it without a query first; the filed sensors cover pressure, level, flow, temperature, inductive, capacitive and optical distance. Search IODD Finder with a query only when the user names a specific product or nothing filed measures what they need. Never invent a ref or a setting key.",
    "- Then call iolink_station once with the complete diagram: every part and every wire. To change an existing station, start from the current station below and send the whole updated diagram, keeping parts the user did not mention.",
    "- Include one IO-Link master and wire each sensor's C/Q to a free port (X1, X2, ...). Add a second master when the ports run out.",
    "- Put each setting in real units under the setting's key, for example a switch point of 40 bar into the pressure sensor's switch-point key. If the user asks for a value outside the sensor's range, say so and use the nearest allowed value. Leave other settings at their defaults.",
    "- Give parts positions: x from -6 to 6 and z from -4 to 4 metres. Put the master near the back wall (z about -3.4), each machine in the middle, and each sensor beside the machine it measures, at least 1 m from other parts.",
    "- Notes returned by iolink_station are for the installer. If a note came from a setting you chose, correct it and call again; otherwise mention it in one sentence.",
    "- Answer in one to three short plain sentences, no lists, tables or markdown: the studio already shows the parts, ports and notes. Do not say anything was written to a sensor, ordered or paid.",
    "- If the request is not about an IO-Link station, say so briefly and offer what you can do.",
    "",
    "Current station in the studio: " + (diagram && diagram.parts && diagram.parts.length ? JSON.stringify(diagram) : "empty."),
  ].join("\n");
}

// The model sees a compact parts list: the full one repeats provenance fields it cannot use.
export function compactParts(data) {
  const out = {
    sensors: data.sensors.map((s) => ({
      ref: s.ref, part: s.part, measures: s.measures,
      settings: (s.settings || []).map((x) => ({ key: x.key, name: x.name, unit: x.unit, min: x.min, max: x.max, default: x.default })),
      options: (s.options || []).map((o) => ({ key: o.key, values: o.values, default: o.default })),
      materials: s.materials && s.materials.length ? s.materials : undefined,
    })),
    masters: data.masters.map((m) => ({ ref: m.ref, part: m.part, ports: m.ports, port_class: m.port_class })),
    machines: data.equipment.map((e) => e.ref),
    floor_m: data.floor_m,
  };
  if (data.iodd_finder) out.iodd_finder = data.iodd_finder;
  return out;
}

function compactStation(data) {
  return {
    ok: data.ok,
    notes: data.issues.map((issue) => issue.problem),
    diagram: data.diagram,
    order: data.order.filter((line) => line.kind !== "cable").map((line) => line.part),
  };
}

export function cleanMessages(messages) {
  if (!Array.isArray(messages)) throw new AgentError(400, "bad_request", "Send a messages list.");
  const kept = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_MESSAGE_CHARS) }));
  while (kept.length && kept[0].role !== "user") kept.shift();
  if (!kept.length || kept[kept.length - 1].role !== "user") throw new AgentError(400, "bad_request", "The last message must come from the user.");
  return kept;
}

async function callModel(env, fetcher, body, deadline) {
  const timeout = Math.min(MODEL_TIMEOUT_MS, deadline - Date.now());
  if (timeout < 3000) throw new AgentError(504, "timeout", "The assistant took too long. Try a shorter request.");
  let response;
  try {
    response = await fetcher(DEEPINFRA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.DEEPINFRA_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new AgentError(504, "timeout", "The assistant took too long. Try again.");
    throw new AgentError(502, "upstream", "The assistant could not be reached. Try again in a minute.");
  }
  if (!response.ok) {
    console.log("deepinfra status " + response.status);
    if (response.status === 402) throw new AgentError(503, "upstream_credit", "The assistant is out of credit right now. The station studio still works by hand; try the assistant again later.");
    if (response.status === 429) throw new AgentError(503, "upstream_busy", "The assistant is busy. Try again in a minute.");
    if (response.status === 401 || response.status === 403) throw new AgentError(503, "upstream_config", "The assistant is not available right now.");
    throw new AgentError(502, "upstream", "The assistant had a problem. Try again in a minute.");
  }
  try {
    return await response.json();
  } catch {
    throw new AgentError(502, "upstream", "The assistant sent a reply that could not be read. Try again.");
  }
}

async function runTool(name, rawArguments, catalogFetch) {
  const schema = inputSchemas[name];
  if (!schema) return { error: "Unknown tool " + name };
  let args;
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    return { error: "The arguments were not valid JSON." };
  }
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { error: "Invalid arguments: " + parsed.error.issues.slice(0, 5).map((i) => i.path.join(".") + " " + i.message).join("; ") };
  }
  try {
    if (name === "iolink_station_parts") {
      const data = await runStationParts(parsed.data, catalogFetch);
      return { model: compactParts(data), summary: parsed.data.query ? "Looked up " + parsed.data.query : "Read the parts list" };
    }
    const data = await runStation(parsed.data, catalogFetch);
    return { model: compactStation(data), station: data, summary: "Built the station: " + data.diagram.parts.length + " parts" };
  } catch (error) {
    return { error: "The tool failed: " + error.message };
  }
}

// Returns { reply, station, steps, usage }. station is the last result of iolink_station, or null.
export async function runAgent({ env, messages, diagram, fetcher = fetch, catalogFetch, now = () => Date.now() }) {
  if (!env.DEEPINFRA_API_KEY) throw new AgentError(503, "upstream_config", "The assistant is not available right now.");
  const history = cleanMessages(messages);
  const conversation = [{ role: "system", content: systemPrompt(diagram) }, ...history];
  const deadline = now() + TURN_BUDGET_MS;
  const usage = { prompt_tokens: 0, completion_tokens: 0, model_calls: 0 };
  const steps = [];
  let station = null;

  for (let turn = 0; turn < MAX_ITERATIONS; turn++) {
    const data = await callModel(env, fetcher, {
      model: env.MODEL || DEFAULT_MODEL,
      messages: conversation,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
      stream: false,
    }, deadline);
    usage.model_calls++;
    usage.prompt_tokens += (data.usage && data.usage.prompt_tokens) || 0;
    usage.completion_tokens += (data.usage && data.usage.completion_tokens) || 0;
    const message = data.choices && data.choices[0] && data.choices[0].message;
    if (!message) throw new AgentError(502, "upstream", "The assistant sent an empty reply. Try again.");
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      const reply = (message.content || "").trim();
      return { reply: reply || (station ? "The station is updated." : "I could not work out a station from that. Say what the machine should sense."), station, steps, usage };
    }
    conversation.push({ role: "assistant", content: message.content || "", tool_calls: calls });
    for (const call of calls) {
      const name = call.function && call.function.name;
      const result = await runTool(name, call.function && call.function.arguments, catalogFetch);
      steps.push({ tool: name, ok: !result.error, summary: result.error || result.summary });
      if (result.station) station = result.station;
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.error ? { error: result.error } : result.model) });
    }
  }
  return {
    reply: station ? "I built the station but ran out of steps before polishing it. Check the notes and ask me to adjust it." : "I could not finish that in the steps allowed. Try a simpler request.",
    station, steps, usage,
  };
}
