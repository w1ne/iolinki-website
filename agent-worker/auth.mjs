// Google sign-in and the Worker's own session.
//
// The page gets a Google ID token (Google Identity Services) and posts it once.
// The Worker verifies it against Google's published keys, then issues its own
// signed session token. The session is sent as a bearer header from iolinki.com
// (a different origin from this Worker, so a cookie here would be a third-party
// cookie that browsers block or partition); there is no cookie to forge a
// cross-site request with.

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const CLOCK_SKEW_S = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;
export const SESSION_TTL_S = 14 * 24 * 3600;

const encoder = new TextEncoder();
let jwksCache = { keys: null, fetched: 0 };

export function resetKeyCache() {
  jwksCache = { keys: null, fetched: 0 };
}

export function b64uEncode(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw Error("Bad encoding.");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const parseJson = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

async function googleKeys(fetcher, now, force) {
  if (!force && jwksCache.keys && now - jwksCache.fetched < JWKS_TTL_MS) return jwksCache.keys;
  // A key-id miss may force a refetch; never more than once a minute.
  if (force && jwksCache.keys && now - jwksCache.fetched < 60 * 1000) return jwksCache.keys;
  const response = await fetcher(GOOGLE_CERTS, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Error("Google keys answered " + response.status);
  const body = await response.json();
  if (!body || !Array.isArray(body.keys)) throw Error("Google keys had an unexpected shape.");
  jwksCache = { keys: body.keys, fetched: now };
  return jwksCache.keys;
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

// Returns { sub, email, name } or throws AuthError.
export async function verifyGoogleToken(idToken, { clientId, fetcher = fetch, now = Date.now() } = {}) {
  if (!clientId) throw new AuthError("Sign-in is not configured.");
  if (typeof idToken !== "string" || idToken.length > 4096) throw new AuthError("Bad sign-in token.");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new AuthError("Bad sign-in token.");
  let header, payload, signature;
  try {
    header = parseJson(b64uDecode(parts[0]));
    payload = parseJson(b64uDecode(parts[1]));
    signature = b64uDecode(parts[2]);
  } catch {
    throw new AuthError("Bad sign-in token.");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AuthError("Unsupported sign-in token.");

  let keys;
  try {
    keys = await googleKeys(fetcher, now, false);
    if (!keys.some((key) => key.kid === header.kid)) keys = await googleKeys(fetcher, now, true);
  } catch {
    throw new AuthError("Could not reach Google to check the sign-in. Try again.");
  }
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new AuthError("Unknown signing key.");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, encoder.encode(parts[0] + "." + parts[1]));
  if (!valid) throw new AuthError("Bad sign-in signature.");

  const seconds = Math.floor(now / 1000);
  if (!ISSUERS.includes(payload.iss)) throw new AuthError("Wrong token issuer.");
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(clientId)) throw new AuthError("The token is for another app.");
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_S < seconds) throw new AuthError("The sign-in expired. Sign in again.");
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_S > seconds) throw new AuthError("The sign-in is from the future.");
  if (typeof payload.sub !== "string" || !payload.sub) throw new AuthError("The token has no account.");
  if (typeof payload.email !== "string" || !payload.email) throw new AuthError("The Google account has no email.");
  if (payload.email_verified !== true && payload.email_verified !== "true") throw new AuthError("The Google email is not verified.");
  return { sub: payload.sub, email: payload.email.slice(0, 200), name: typeof payload.name === "string" ? payload.name.slice(0, 120) : "" };
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(user, secret, now = Date.now()) {
  if (!secret || secret.length < 16) throw Error("SESSION_SECRET is not set.");
  const iat = Math.floor(now / 1000);
  const body = b64uEncode(encoder.encode(JSON.stringify({ sub: user.sub, email: user.email, name: user.name || "", iat, exp: iat + SESSION_TTL_S })));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode("v1." + body));
  return "v1." + body + "." + b64uEncode(new Uint8Array(mac));
}

// Returns the session claims, or null for any bad, forged or expired token.
export async function verifySession(token, secret, now = Date.now()) {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64uDecode(parts[2]), encoder.encode("v1." + parts[1]));
    if (!ok) return null;
    const claims = parseJson(b64uDecode(parts[1]));
    if (typeof claims.sub !== "string" || typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}
