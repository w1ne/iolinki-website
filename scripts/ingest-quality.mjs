#!/usr/bin/env node
// Ingestion quality harness: samples real IODDs from IODD Finder (through the
// iolinki catalog Worker), converts each with tools/iodd/iodd-part.mjs and
// reports how many convert, how many get settings in real units, categories,
// defaults and the most common failures.
//
//   node scripts/ingest-quality.mjs [--cache DIR] [--per-vendor N] [--offline] [--json OUT] [--converter FILE]
//
// Downloads are cached (one zip per vendorId-ioddId plus sample.json) so a
// second run converts offline. Requests are throttled and 502s retried.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const CATALOG = process.env.CATALOG_ORIGIN || "https://iolinki-iodd-catalog.shylenkoa.workers.dev";
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const cache = flag("--cache", process.env.IODD_CACHE || "iodd-cache");
const perVendor = Number(flag("--per-vendor", 12));
const offline = args.includes("--offline");
const jsonOut = flag("--json", null);
// --converter <file> compares another converter build (e.g. the previous release).
const converterFile = flag("--converter", new URL("../tools/iodd/iodd-part.mjs", import.meta.url).pathname);
const { partFromIoddZip, CONVERTER_VERSION = "1" } = await import(pathToFileURL(resolve(converterFile)).href);

// Vendor names as IODD Finder spells them (substring search on vendorName).
const VENDORS = [
  "ifm", "Balluff", "SICK", "Pepperl", "Baumer", "Turck", "Banner", "Leuze", "Keyence", "Omron",
  "wenglor", "Festo", "Siemens", "Endress", "Murrelektronik", "Contrinex", "di-soric", "SensoPart",
  "Panasonic", "Autonics", "WIKA", "Danfoss", "SMC", "Carlo Gavazzi", "Phoenix", "HYDAC", "Kübler",
  "JUMO", "Telemecanique", "microsonic", "ipf", "Rechner", "BERNSTEIN", "steute", "Schmalz", "Parker",
  "Emerson", "Bosch", "FRABA", "Hengstler", "Trafag", "Keller", "Sensata", "Schneider", "Eaton",
  "Pilz", "Lumberg", "Weidmüller", "Belden", "Harting", "Kistler", "Gefran", "Barksdale", "Suco",
  "Huba", "Elobau", "Pizzato", "Schmersal", "EGE", "Rockwell", "Allen", "Datalogic", "Optex", "Cognex",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(url, kind) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { Origin: "https://iolinki.com", "User-Agent": "iolinki-ingest-quality/1" } }).catch((error) => ({ ok: false, status: 0, error }));
    if (response.ok) return kind === "json" ? response.json() : new Uint8Array(await response.arrayBuffer());
    if (response.status === 404 || response.status === 400) throw Error("HTTP " + response.status);
    await sleep(1500 * (attempt + 1));
  }
  throw Error("gave up after retries: " + url);
}

// Spread the pages over each vendor's catalog so one product family does not dominate.
async function sample() {
  const file = join(cache, "sample.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const picked = new Map();
  for (const vendor of VENDORS) {
    try {
      const first = await get(CATALOG + "/search?" + new URLSearchParams({ q: vendor, field: "vendorName", size: "24", page: "0" }), "json");
      const pages = Math.min(first.totalPages || 1, 1000);
      const want = [0, Math.floor(pages / 3), Math.floor((2 * pages) / 3)].filter((p, i, a) => a.indexOf(p) === i);
      const hits = [];
      for (const page of want) {
        const data = page === 0 ? first : await get(CATALOG + "/search?" + new URLSearchParams({ q: vendor, field: "vendorName", size: "24", page: String(page) }), "json");
        hits.push(...(data.content || []));
        await sleep(300);
      }
      let n = 0;
      for (const hit of hits) {
        const key = hit.vendorId + "-" + hit.ioddId;
        if (picked.has(key) || n >= perVendor) continue;
        // Spread within a page too: skip neighbours of the same driver family.
        picked.set(key, { vendorId: hit.vendorId, ioddId: hit.ioddId, productName: hit.productName, productId: hit.productId, vendorName: hit.vendorName, driverName: hit.driverName });
        n++;
      }
      console.error(vendor, first.totalElements, "->", n);
    } catch (error) {
      console.error(vendor, "search failed:", error.message);
    }
    await sleep(300);
  }
  const list = [...picked.values()];
  writeFileSync(file, JSON.stringify(list, null, 1));
  return list;
}

async function download(entry) {
  const file = join(cache, entry.vendorId + "-" + entry.ioddId + ".zip");
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  if (offline) throw Error("not cached");
  const bytes = await get(CATALOG + "/download?" + new URLSearchParams({ vendorId: entry.vendorId, ioddId: entry.ioddId }), "bytes");
  writeFileSync(file, bytes);
  await sleep(400);
  return bytes;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "n/a");

async function main() {
  mkdirSync(cache, { recursive: true });
  const list = offline ? JSON.parse(readFileSync(join(cache, "sample.json"), "utf8")) : await sample();
  if (!offline) {
    // Three downloads in flight at a time, each worker throttled.
    const queue = list.slice();
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) await download(entry).catch(() => null);
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  const rows = [];
  for (const entry of list) {
    let bytes;
    try {
      bytes = await download(entry);
    } catch (error) {
      rows.push({ entry, fetchError: error.message });
      continue;
    }
    try {
      const def = await partFromIoddZip(bytes, { vendorId: entry.vendorId, ioddId: entry.ioddId, productName: entry.productName, vendorName: entry.vendorName });
      rows.push({ entry, def });
    } catch (error) {
      rows.push({ entry, error: String(error && error.message).slice(0, 120) });
    }
  }
  const fetched = rows.filter((r) => !r.fetchError);
  const ok = fetched.filter((r) => r.def);
  const sensors = ok.filter((r) => r.def.kind === "sensor");
  const withSettings = sensors.filter((r) => r.def.settings.length);
  const realUnits = withSettings.filter((r) => r.def.settings.some((s) => s.unit !== "raw" && !/^unit \d+$/.test(s.unit)));
  const allReal = withSettings.filter((r) => r.def.settings.every((s) => s.unit !== "raw"));
  const profileScaled = withSettings.filter((r) => r.def.settings.some((s) => s.unit_source === "mdc"));
  const resolved = sensors.filter((r) => !["device", "actuator"].includes(r.def.category));
  // Measuring sensors: a studio sensor category, not a hub, module, valve or other device.
  const measuring = withSettings.filter((r) => !["device", "actuator"].includes(r.def.category));
  const measuringReal = measuring.filter((r) => r.def.settings.some((s) => s.unit !== "raw" && !/^unit \d+$/.test(s.unit)));
  const switchPoints = withSettings.filter((r) => r.def.settings.some((s) => s.role === "switch point"));
  const switchPointsReal = switchPoints.filter((r) => r.def.settings.some((s) => s.role === "switch point" && s.unit !== "raw"));
  const withDefaults = withSettings.filter((r) => r.def.settings.some((s) => s.default !== null));
  const allDefaults = withSettings.filter((r) => r.def.settings.every((s) => s.default !== null));
  const withWrite = withSettings.filter((r) => r.def.settings.every((s) => s.write && Number.isInteger(s.write.index)));
  const withOptions = sensors.filter((r) => r.def.options.length);
  const unknownUnits = new Map();
  ok.forEach((r) => r.def.settings.concat(r.def.iodd.pd_in).forEach((s) => {
    if (/^unit \d+$/.test(s.unit || "")) unknownUnits.set(s.unit, (unknownUnits.get(s.unit) || 0) + 1);
  }));
  const categories = {};
  ok.forEach((r) => {
    categories[r.def.category] = (categories[r.def.category] || 0) + 1;
  });
  const failures = {};
  fetched.filter((r) => r.error).forEach((r) => {
    const reason = r.error.replace(/\d+/g, "N");
    failures[reason] = (failures[reason] || 0) + 1;
  });
  const rawOnly = withSettings.filter((r) => !realUnits.includes(r)).map((r) => r.entry.vendorName + " " + r.entry.productName + " (" + r.entry.vendorId + "-" + r.entry.ioddId + "): " + r.def.settings.map((s) => s.name).slice(0, 3).join(", "));
  const vendors = new Set(fetched.map((r) => r.entry.vendorId));
  const report = {
    converter_version: CONVERTER_VERSION,
    sampled: list.length,
    downloaded: fetched.length,
    vendors: vendors.size,
    converted_without_error: pct(ok.length, fetched.length),
    sensors: sensors.length,
    sensors_with_settings: withSettings.length,
    settings_in_real_units_any: pct(realUnits.length, withSettings.length),
    settings_in_real_units_all: pct(allReal.length, withSettings.length),
    measuring_sensors_with_settings: measuring.length,
    measuring_sensors_real_units_any: pct(measuringReal.length, measuring.length),
    with_switch_point: switchPoints.length,
    switch_point_in_real_units: pct(switchPointsReal.length, switchPoints.length),
    settings_scaled_by_profile_mdc: pct(profileScaled.length, withSettings.length),
    category_resolved: pct(resolved.length, sensors.length),
    with_any_default: pct(withDefaults.length, withSettings.length),
    with_all_defaults: pct(allDefaults.length, withSettings.length),
    write_object_on_every_setting: pct(withWrite.length, withSettings.length),
    sensors_with_options: pct(withOptions.length, sensors.length),
    categories: Object.fromEntries(Object.entries(categories).sort((a, b) => b[1] - a[1])),
    failures: Object.fromEntries(Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 10)),
    unknown_unit_codes: Object.fromEntries(unknownUnits),
    raw_only_examples: rawOnly.slice(0, 25),
    fetch_errors: rows.filter((r) => r.fetchError).length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ report, parts: ok.map((r) => ({ ref: r.entry.vendorId + "-" + r.entry.ioddId, vendor: r.entry.vendorName, product: r.entry.productName, category: r.def.category, settings: r.def.settings.map((s) => [s.name, s.min, s.max, s.unit, s.default, s.unit_source]) })) }, null, 1));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

