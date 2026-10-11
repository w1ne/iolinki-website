import { z } from "zod";
import { stationShape } from "../tools/iodd/station-tools.mjs";
import { AgentError, cleanMessages, runAgent } from "./agent.mjs";
import { AuthError, SESSION_TTL_S, signSession, verifyGoogleToken, verifySession } from "./auth.mjs";
import { addTokens, cleanup, isBlocked, recordUser, refund, remaining, reserve } from "./quota.mjs";

const MAX_BODY = 96 * 1024;
const diagramSchema = z.object(stationShape);

// Browsers may call from the site and from a local dev server. Other origins get nothing.
export function allowedOrigin(origin) {
  return origin === "https://iolinki.com" || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || "");
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return allowedOrigin(origin)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "600" }
    : { Vary: "Origin" };
}

function reply(request, status, body) {
  return Response.json(body, { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

const fail = (request, status, code, message, extra = {}) => reply(request, status, { error: message, code, ...extra });

async function readJson(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY) throw new AgentError(413, "too_large", "That request is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new AgentError(413, "too_large", "That request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentError(400, "bad_request", "Send JSON.");
  }
}

export const limitsOf = (env) => ({
  user: Number(env.DAILY_USER_LIMIT) || 30,
  global: Number(env.DAILY_GLOBAL_LIMIT) || 1500,
});

async function signIn(request, env, deps) {
  const body = await readJson(request);
  let user;
  try {
    user = await verifyGoogleToken(body && body.credential, { clientId: env.GOOGLE_CLIENT_ID, fetcher: deps.fetcher, now: deps.now() });
  } catch (error) {
    if (error instanceof AuthError) return fail(request, 401, "signin", error.message);
    throw error;
  }
  await recordUser(env.DB, user, deps.now());
  if (await isBlocked(env.DB, user.sub)) return fail(request, 403, "blocked", "This account cannot use the assistant.");
  const token = await signSession(user, env.SESSION_SECRET, deps.now());
  const limit = limitsOf(env).user;
  return reply(request, 200, {
    token,
    expires: Math.floor(deps.now() / 1000) + SESSION_TTL_S,
    user: { email: user.email, name: user.name },
    limit,
    remaining: await remaining(env.DB, user.sub, limit, deps.now()),
  });
}

async function sessionOf(request, env, deps) {
  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
  return match ? verifySession(match[1], env.SESSION_SECRET, deps.now()) : null;
}

async function chat(request, env, deps, session) {
  const body = await readJson(request);
  // Bad input is refused before it can use up a message.
  const messages = cleanMessages(body && body.messages);
  const parsedDiagram = diagramSchema.safeParse(body && body.diagram);
  const diagram = parsedDiagram.success ? parsedDiagram.data : null;

  if (await isBlocked(env.DB, session.sub)) return fail(request, 403, "blocked", "This account cannot use the assistant.");
  const limits = limitsOf(env);
  const slot = await reserve(env.DB, session.sub, limits, deps.now());
  if (!slot.ok) {
    return slot.scope === "user"
      ? fail(request, 429, "quota", "You have used today's " + slot.limit + " assistant messages. They reset at midnight UTC; the studio still works by hand.", { limit: slot.limit, remaining: 0 })
      : fail(request, 429, "capacity", "The assistant has reached its daily capacity. Try again tomorrow; the studio still works by hand.");
  }
  try {
    const started = deps.now();
    const result = await runAgent({ env, messages, diagram, fetcher: deps.fetcher, catalogFetch: deps.catalogFetch(env), now: deps.now });
    await addTokens(env.DB, session.sub, slot.day, result.usage.prompt_tokens, result.usage.completion_tokens).catch(() => {});
    const station = result.station && {
      title: result.station.title,
      ok: result.station.ok,
      issues: result.station.issues,
      diagram: result.station.diagram,
      extra_parts: result.station.extra_parts,
      studio_link: result.station.studio_link,
    };
    return reply(request, 200, {
      reply: result.reply,
      station,
      steps: result.steps,
      remaining: Math.max(0, slot.limit - slot.used),
      limit: slot.limit,
      ms: deps.now() - started,
    });
  } catch (error) {
    await refund(env.DB, session.sub, slot.day).catch(() => {});
    if (error instanceof AgentError) return fail(request, error.status, error.code, error.message);
    console.log("chat failed: " + (error && error.message));
    return fail(request, 500, "internal", "Something went wrong on our side. Try again.");
  }
}

export async function handle(request, env, deps = {}) {
  deps = {
    fetcher: deps.fetcher || fetch,
    now: deps.now || (() => Date.now()),
    catalogFetch: deps.catalogFetch || ((e) => (url) => (e.CATALOG ? e.CATALOG.fetch(new Request(url)) : fetch(url))),
  };
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigin(origin)) return Response.json({ error: "This origin may not use the assistant." }, { status: 403, headers: { Vary: "Origin" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const path = new URL(request.url).pathname;
  try {
    if (request.method === "GET" && path === "/") return reply(request, 200, { service: "iolinki studio agent", signin: Boolean(env.GOOGLE_CLIENT_ID) });
    if (!env.DB || !env.SESSION_SECRET) return fail(request, 503, "not_configured", "The assistant is not available right now.");
    if (request.method === "POST" && path === "/auth/google") return await signIn(request, env, deps);
    if (path === "/me" || path === "/chat") {
      const session = await sessionOf(request, env, deps);
      if (!session) return fail(request, 401, "signin", "Sign in to use the assistant.");
      if (request.method === "GET" && path === "/me") {
        const limit = limitsOf(env).user;
        return reply(request, 200, { user: { email: session.email, name: session.name }, limit, remaining: await remaining(env.DB, session.sub, limit, deps.now()) });
      }
      if (request.method === "POST" && path === "/chat") return await chat(request, env, deps, session);
    }
    return fail(request, 404, "not_found", "Unknown route.");
  } catch (error) {
    if (error instanceof AgentError) return fail(request, error.status, error.code, error.message);
    console.log("request failed: " + (error && error.message));
    return fail(request, 500, "internal", "Something went wrong on our side. Try again.");
  }
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
  async scheduled(event, env) {
    await cleanup(env.DB);
  },
};
