const CONFIG = new URL("../../iodd/catalog.json", import.meta.url);
export const FINDER_URL = "https://ioddfinder.io-link.com/";
async function endpoint(options, signal) {
  if (options.baseUrl) return options.baseUrl;
  const response = await fetch(CONFIG, { signal });
  if (!response.ok)
    throw Error(
      "Finder configuration is unavailable. Open the official Finder and import its ZIP.",
    );
  return (await response.json()).endpoint;
}
export async function searchIODDs(query, options = {}) {
  const signal = AbortSignal.timeout(25000);
  let baseUrl;
  try {
    baseUrl = await endpoint(options, signal);
  } catch (error) {
    throw Error(
      "Finder search could not connect. Open the official Finder and import its ZIP.",
      { cause: error },
    );
  }
  const automatic = !options.field || options.field === "auto";
  const fields = automatic
    ? [
        "productName",
        "vendorName",
        "productId",
        ...(/^\d+$/.test(query.trim()) ? ["deviceId"] : []),
      ]
    : [options.field];
  let result,
    matchedField = null;
  for (const field of fields) {
    const url = new URL("/search", baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("field", field);
    url.searchParams.set("page", options.page ?? 0);
    url.searchParams.set("size", options.size ?? 12);
    let response;
    try {
      response = await fetch(url, { signal });
      result = await response.json();
    } catch (error) {
      throw Error(
        "Finder search could not connect or timed out. Open the official Finder and import its ZIP.",
        { cause: error },
      );
    }
    if (!response.ok)
      throw Error(
        result.error ||
          "Finder search failed. Open the official Finder and import its ZIP.",
      );
    if (
      !Array.isArray(result.content) ||
      !Number.isSafeInteger(result.totalElements) ||
      result.totalElements < 0
    )
      throw Error(
        "Finder returned an invalid result. Open the official Finder and import its ZIP.",
      );
    // An empty out-of-range page still belongs to a successful search.
    if (result.totalElements > 0 || !automatic) {
      matchedField = field;
      break;
    }
  }
  return {
    entries: result.content.map((entry) => ({
      ...entry,
      id: entry.ioddId,
      name: entry.productName,
      filename: entry.driverName + ".xml",
      sourceUrl: FINDER_URL + "#/productvariants/" + entry.productVariantId,
    })),
    total: result.totalElements,
    page: result.number,
    last: result.last,
    matchedField,
  };
}
export async function downloadIODD(entry, options = {}) {
  const url = new URL("/download", await endpoint(options));
  url.searchParams.set("vendorId", entry.vendorId);
  url.searchParams.set("ioddId", entry.ioddId || entry.id);
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok)
    throw Error(
      "Finder download failed. Open the official Finder and import its ZIP.",
    );
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16 * 1024 * 1024) throw Error("Finder package exceeds16MiB.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
