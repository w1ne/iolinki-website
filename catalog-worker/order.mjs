// Installation requests from the station studio: keep each request, then
// mail it to the owner. No payment is taken here.

// Straight to the inbox: the shylenko.com forwarder dropped these.
const OWNER = "shylenkoa@gmail.com";
const FROM = "orders@kernelcad.com";
const STUDIO = "https://iolinki.com/studio/#s=";
const PER_HOUR = 10;

const clean = (value, max) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

export function readOrder(body) {
  const email = clean(body && body.email, 200);
  const plant = clean(body && body.plant, 200);
  const text = String((body && body.text) || "").slice(0, 20000);
  const link = String((body && body.link) || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter the email for this order." };
  if (plant.length < 2) return { error: "Enter the plant where iolinki will install the station." };
  if (!text.trim()) return { error: "The order has no parts." };
  if (!link.startsWith(STUDIO) || link.length > 60000 || !/^[A-Za-z0-9_-]+$/.test(link.slice(STUDIO.length))) {
    return { error: "The station link is not a studio link." };
  }
  return { email, plant, text, link };
}

export function orderMessage(order, id) {
  const subject = "iolinki install request: " + clean(order.plant, 80);
  return [
    "From: iolinki orders <" + FROM + ">",
    "To: " + OWNER,
    "Reply-To: " + order.email,
    "Subject: " + subject,
    "Message-ID: <" + id + "@kernelcad.com>",
    "Date: " + new Date().toUTCString(),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Request " + id,
    "",
    order.text,
    "",
    "Open the station: " + order.link,
    "",
  ].join("\r\n");
}

async function sendMail(env, raw) {
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAIL.send(new EmailMessage(FROM, OWNER, raw));
}

// env: { ORDERS (KV), MAIL (send_email) }; send is swapped out in tests.
export async function handleOrder(request, env, headers, send = sendMail) {
  const reply = (status, body) => Response.json(body, { status, headers });
  if (!env || !env.ORDERS) return reply(503, { error: "Orders are not available right now." });
  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "Send the order as JSON." });
  }
  const order = readOrder(body);
  if (order.error) return reply(400, { error: order.error });

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hour = Math.floor(Date.now() / 3600000);
  const limitKey = "rate:" + ip + ":" + hour;
  const count = Number((await env.ORDERS.get(limitKey)) || 0);
  if (count >= PER_HOUR) return reply(429, { error: "Too many requests from here. Try again in an hour." });
  await env.ORDERS.put(limitKey, String(count + 1), { expirationTtl: 3700 });

  const id = new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomUUID().slice(0, 8);
  await env.ORDERS.put("order:" + id, JSON.stringify({ id, received: new Date().toISOString(), ...order, mailed: false }));
  let mailed = true;
  try {
    await send(env, orderMessage(order, id));
  } catch {
    mailed = false;
  }
  if (mailed) {
    await env.ORDERS.put("order:" + id, JSON.stringify({ id, received: new Date().toISOString(), ...order, mailed: true }));
  }
  // The request is kept either way, so the buyer is told it arrived.
  return reply(200, { ok: true, id });
}
