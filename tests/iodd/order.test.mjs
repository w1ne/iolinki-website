import test from "node:test";
import assert from "node:assert/strict";
import { handleCatalogRequest } from "../../catalog-worker/index.mjs";
import { handleOrder, readOrder, orderMessage } from "../../catalog-worker/order.mjs";

const link = "https://iolinki.com/studio/#s=eyJ2IjoxfQ";
const good = { email: "buyer@plant.example", plant: "Line 3", text: "- ifm electronic PN7092", link };

function kv() {
  const store = new Map();
  return { store, get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
}
const post = (body, ip = "1.2.3.4") =>
  new Request("https://catalog.example/order", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://iolinki.com", "CF-Connecting-IP": ip }, body: JSON.stringify(body) });

test("an installation request is kept and mailed to the owner", async () => {
  const env = { ORDERS: kv() };
  const sent = [];
  const response = await handleOrder(post(good), env, {}, async (_env, raw) => sent.push(raw));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.ok && body.id);
  const kept = JSON.parse(env.ORDERS.store.get("order:" + body.id));
  assert.equal(kept.email, good.email);
  assert.equal(kept.mailed, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Reply-To: buyer@plant\.example/);
  assert.match(sent[0], /Subject: iolinki install request: Line 3/);
});

test("a request is still kept when the mail fails", async () => {
  const env = { ORDERS: kv() };
  const response = await handleOrder(post(good), env, {}, async () => { throw new Error("down"); });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(JSON.parse(env.ORDERS.store.get("order:" + body.id)).mailed, false);
});

test("bad requests are refused and headers cannot be injected", () => {
  assert.ok(readOrder({ ...good, email: "nope" }).error);
  assert.ok(readOrder({ ...good, plant: "" }).error);
  assert.ok(readOrder({ ...good, link: "https://evil.example/#s=x" }).error);
  assert.ok(readOrder({ ...good, link: link + "\r\nBcc: x@y.z" }).error);
  const order = readOrder({ ...good, plant: "Line\r\nBcc: x@y.z" });
  assert.doesNotMatch(orderMessage(order, "id"), /\r\nBcc:/);
});

test("one address can send ten requests an hour", async () => {
  const env = { ORDERS: kv() };
  for (let i = 0; i < 10; i++) assert.equal((await handleOrder(post(good), env, {}, async () => {})).status, 200);
  assert.equal((await handleOrder(post(good), env, {}, async () => {})).status, 429);
  assert.equal((await handleOrder(post(good, "5.6.7.8"), env, {}, async () => {})).status, 200);
});

test("the catalog Worker routes POST /order and allows it from the studio", async () => {
  const preflight = await handleCatalogRequest(new Request("https://catalog.example/order", { method: "OPTIONS", headers: { Origin: "https://iolinki.com" } }));
  assert.match(preflight.headers.get("Access-Control-Allow-Methods"), /POST/);
  const missing = await handleCatalogRequest(post(good), fetch, undefined, {});
  assert.equal(missing.status, 503);
  const other = await handleCatalogRequest(new Request("https://catalog.example/search", { method: "POST" }));
  assert.equal(other.status, 405);
});
