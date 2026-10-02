const CONFIG = new URL("../../iodd/catalog.json", import.meta.url);
export const FINDER_URL = "https://ioddfinder.io-link.com/";
async function endpoint(options) {
  return options.baseUrl || (await (await fetch(CONFIG)).json()).endpoint;
}
export async function searchIODDs(query, options = {}) {
  const url = new URL("/search", await endpoint(options));
  url.searchParams.set("q", query);
  url.searchParams.set("field", options.field || "productName");
  url.searchParams.set("page", options.page || 0);
  url.searchParams.set("size", options.size || 12);
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Finder search failed.");
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
