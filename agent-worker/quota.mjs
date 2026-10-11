// Daily message counters in D1: one per user and one for everybody.
// The increment and the limit check are a single statement, so two requests
// racing for the last slot cannot both get it.

export const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

async function take(db, day, key, limit) {
  if (limit <= 0) return null;
  const row = await db
    .prepare("INSERT INTO usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n")
    .bind(day, key, limit)
    .first();
  return row ? row.n : null;
}

async function give(db, day, key) {
  await db.prepare("UPDATE usage SET n = MAX(n - 1, 0) WHERE day = ? AND key = ?").bind(day, key).run();
}

// { ok: true, used, limit, day } or { ok: false, scope: "user" | "global", limit }.
export async function reserve(db, sub, limits, now = Date.now()) {
  const day = dayOf(now);
  const global = await take(db, day, "global", limits.global);
  if (global === null) return { ok: false, scope: "global", limit: limits.global, day };
  const used = await take(db, day, "u:" + sub, limits.user);
  if (used === null) {
    await give(db, day, "global");
    return { ok: false, scope: "user", limit: limits.user, day };
  }
  return { ok: true, used, limit: limits.user, day };
}

// A turn that never reached the model (provider down, bad request) is not charged.
export async function refund(db, sub, day) {
  await give(db, day, "global");
  await give(db, day, "u:" + sub);
}

export async function addTokens(db, sub, day, prompt, completion) {
  const sql = "UPDATE usage SET prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ? WHERE day = ? AND key = ?";
  await db.batch([db.prepare(sql).bind(prompt, completion, day, "global"), db.prepare(sql).bind(prompt, completion, day, "u:" + sub)]);
}

export async function remaining(db, sub, limit, now = Date.now()) {
  const row = await db.prepare("SELECT n FROM usage WHERE day = ? AND key = ?").bind(dayOf(now), "u:" + sub).first();
  return Math.max(0, limit - (row ? row.n : 0));
}

export async function recordUser(db, user, now = Date.now()) {
  await db
    .prepare("INSERT INTO users (sub, email, name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT (sub) DO UPDATE SET email = excluded.email, name = excluded.name, last_seen = excluded.last_seen")
    .bind(user.sub, user.email, user.name || "", now, now)
    .run();
}

export async function isBlocked(db, sub) {
  const row = await db.prepare("SELECT blocked FROM users WHERE sub = ?").bind(sub).first();
  return Boolean(row && row.blocked);
}

export const COUNTER_DAYS = 35;
export const IDLE_USER_DAYS = 365;

// Daily job: counters older than 35 days and accounts unseen for a year are deleted.
export async function cleanup(db, now = Date.now()) {
  const oldDay = dayOf(now - COUNTER_DAYS * 24 * 3600 * 1000);
  await db.prepare("DELETE FROM usage WHERE day < ?").bind(oldDay).run();
  await db.prepare("DELETE FROM users WHERE last_seen < ?").bind(now - IDLE_USER_DAYS * 24 * 3600 * 1000).run();
}
