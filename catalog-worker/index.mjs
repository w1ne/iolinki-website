const SOURCE = "https://ioddfinder.io-link.com";
function cors(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin":
      origin === "https://iolinki.com" ||
      /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin || "")
        ? origin
        : "https://iolinki.com",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}
function error(request, status, message) {
  return Response.json({ error: message }, { status, headers: cors(request) });
}
async function bounded(response, limit) {
  if (Number(response.headers.get("Content-Length")) > limit)
    throw Error("Upstream response exceeds limit.");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("Upstream response exceeds limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
export async function handleCatalogRequest(request, fetcher = fetch) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== "GET")
    return error(request, 405, "Use GET for public catalog reads.");
  const url = new URL(request.url);
  let upstream, limit;
  if (url.pathname === "/search") {
    const query = (url.searchParams.get("q") || "").trim(),
      field = url.searchParams.get("field") || "productName";
    const page = Number(url.searchParams.get("page") || 0),
      size = Number(url.searchParams.get("size") || 12);
    if (
      query.length < 2 ||
      query.length > 80 ||
      /[\x00-\x1f]/.test(query) ||
      !["productName", "vendorName", "productId", "deviceId"].includes(field) ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 1000 ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 24
    )
      return error(
        request,
        400,
        "Enter 2–80 characters and valid catalog filters.",
      );
    upstream = new URL("/api/drivers", SOURCE);
    upstream.searchParams.set(
      field === "deviceId" ? "deviceIdString" : field,
      query,
    );
    upstream.searchParams.set("status", "APPROVED");
    upstream.searchParams.set("size", size);
    upstream.searchParams.set("page", page);
    limit = 1024 * 1024;
  } else if (url.pathname === "/download") {
    const vendor = url.searchParams.get("vendorId"),
      iodd = url.searchParams.get("ioddId");
    if (
      !/^\d{1,5}$/.test(vendor || "") ||
      Number(vendor) < 1 ||
      Number(vendor) > 65535 ||
      !/^\d{1,9}$/.test(iodd || "") ||
      Number(iodd) < 1
    )
      return error(request, 400, "A valid vendor ID and IODD ID are required.");
    upstream = new URL(
      `/api/vendors/${Number(vendor)}/iodds/${Number(iodd)}/files/zip/rated`,
      SOURCE,
    );
    limit = 16 * 1024 * 1024;
  } else return error(request, 400, "Unknown catalog route.");
  try {
    const response = await fetcher(upstream, {
      // Workers supports manual redirects; reject their non-2xx status below.
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept:
          url.pathname === "/search" ? "application/json" : "application/zip",
      },
    });
    if (!response.ok)
      return error(
        request,
        response.status === 404 ? 404 : 502,
        "IODD Finder could not serve this request. Open the official Finder or retry.",
      );
    const body = await bounded(response, limit);
    return new Response(body, {
      headers: {
        ...cors(request),
        "Content-Type":
          url.pathname === "/search" ? "application/json" : "application/zip",
        "Cache-Control":
          url.pathname === "/search"
            ? "public, max-age=120"
            : "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return error(request, 502, e.message);
  }
}
export default {
  fetch(request) {
    return handleCatalogRequest(request);
  },
};
