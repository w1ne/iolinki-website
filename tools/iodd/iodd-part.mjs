// IODD -> studio part definition.
// Runs in the browser, in Cloudflare Workers and in Node: no node: imports and
// no DOMParser (the XML goes through the lossless tree parser directly, so a
// vendor file the editor would refuse can still be turned into a part).
import { readPackageFiles } from "../../assets/js/iodd/package.js";
import { parseXml } from "../../assets/js/iodd/vendor/model/xml.js";
import { elements, findAll, path, root } from "../../assets/js/iodd/vendor/model/tree.js";
import { getIdentity, getProcessData } from "../../assets/js/iodd/document.js";

// IO-Link unit codes (IEC 61158 / PROFIBUS PA table). The ones marked "seen"
// were checked against the ifm sample IODDs (value ranges and gradients);
// the rest come from the table and have not met a device yet.
const UNITS = {
  1000: "K", // table
  1001: "°C", // seen (TA2105)
  1002: "°F", // seen (TA2105, 0.18 x raw + 32)
  1010: "m", // table
  1012: "cm", // seen (O5D100: switch point 5-200)
  1013: "mm", // seen (LR2050)
  1019: "in", // seen (LR2050, gradient 0.03937)
  1054: "s", // seen (PN7092 delay 0-500 x 0.1)
  1056: "ms", // seen (IG6214 delay 0-60000)
  1058: "min", // table
  1059: "h", // seen (operating hours)
  1077: "Hz", // seen (SA5000 frequency output)
  1130: "Pa", // table
  1131: "kPa", // table
  1132: "MPa", // seen (PN7092 menu, 0.01 x raw)
  1137: "bar", // seen (PN7092, 0.1 x raw)
  1138: "mbar", // table
  1141: "psi", // seen (PN7092, gradient 1.4504)
  1342: "%", // seen
};
const PRESSURE_UNITS = [1130, 1131, 1132, 1137, 1138, 1141];
const TEMPERATURE_UNITS = [1000, 1001, 1002];

const SETTING_STRONG = /sp\d|rp\d|(^|[^a-z])(sp|rp)([^a-z]|$)|switch ?points?|set ?points?/i;
const SETTING_WEAK = /reset|threshold|limit|window|teach|hysteresis/i;
const OPTION_WORDS = /output|function|polarity|logic|mode|pnp|npn|\bno\b|\bnc\b|normally|\bou\d?\b|\bout\d?\b|switching|inverted/i;
const OPTION_SKIP = /\bu?loc\b|lock|factory|restore|command|teach|\buni\b|unit|language|display|colou?r|brightness|\bled\b|password|code|calibr|reset|standard|access|^fou|colr/i;
const STOP = new Set(["with", "and", "the", "for", "from", "that", "this", "into", "sensor", "sensors", "device", "type", "the", "mm"]);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function tidy(value) {
  return Number(value.toPrecision(10));
}

function langOf(node) {
  return String((node && node.attrs && node.attrs["xml:lang"]) || "").toLowerCase();
}

function textMap(doc, extra) {
  const map = new Map();
  const collection = path(root(doc), "ExternalTextCollection");
  const primary = path(collection, "PrimaryLanguage");
  const read = (language) => elements(language, "Text").forEach((t) => map.set(t.attrs.id, t.attrs.value));
  read(primary);
  // Prefer English when the primary language is something else.
  if (langOf(primary).slice(0, 2) !== "en") {
    elements(collection, "Language").filter((l) => langOf(l).slice(0, 2) === "en").forEach(read);
    (extra || []).forEach((t) => map.set(t.id, t.value));
  }
  return map;
}

function bitsOf(node) {
  return num(node && node.attrs.bitLength);
}

function typeOf(node) {
  return String((node && node.attrs && node.attrs["xsi:type"]) || "").split(":").pop();
}

function resolver(doc) {
  const collection = path(root(doc), "ProfileBody", "DeviceFunction", "DatatypeCollection");
  const byId = new Map(elements(collection, "Datatype").map((d) => [d.attrs.id, d]));
  // A datatype node is inline or a DatatypeRef; both are used for variables and record items.
  return (node) => {
    if (!node) return undefined;
    const inline = path(node, "Datatype") || path(node, "SimpleDatatype");
    if (inline) return inline;
    const ref = path(node, "DatatypeRef");
    return ref ? byId.get(ref.attrs.datatypeId) : undefined;
  };
}

// First menu reference per variable (or record item) carries the display scale.
function scales(doc) {
  const found = new Map();
  const menus = path(root(doc), "ProfileBody", "DeviceFunction", "UserInterface", "MenuCollection");
  const refs = findAll(menus, "VariableRef").concat(findAll(menus, "RecordItemRef"));
  refs.forEach((ref) => {
    const sub = ref.attrs.subindex;
    const key = ref.attrs.variableId + (sub ? "#" + sub : "");
    const entry = { gradient: num(ref.attrs.gradient), offset: num(ref.attrs.offset), unitCode: num(ref.attrs.unitCode) };
    const scaled = entry.gradient !== null || entry.unitCode !== null;
    const old = found.get(key);
    if (!old || (!old.scaled && scaled)) found.set(key, Object.assign({ scaled: scaled }, entry));
  });
  return found;
}

function unitName(code) {
  if (code === null || code === undefined) return "raw";
  return UNITS[code] || "unit " + code;
}

function keyOf(text, taken) {
  let key = String(text).replace(/^V_/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "param";
  while (taken.has(key)) key += "_";
  taken.add(key);
  return key;
}

function rangeOf(dt) {
  const ranges = elements(dt, "ValueRange").map((r) => [num(r.attrs.lowerValue), num(r.attrs.upperValue)]).filter((r) => r[0] !== null && r[1] !== null);
  if (!ranges.length) return null;
  return [Math.min.apply(null, ranges.map((r) => r[0])), Math.max.apply(null, ranges.map((r) => r[1]))];
}

// Every writable parameter at index >= 60 (below that: system, identification
// and diagnosis; 60 is the first smart-sensor SSC block), flattened: plain variables and the
// numbered items of record variables.
function parameters(doc, texts, datatypeOf, scaleOf) {
  const out = [];
  const name = (node) => texts.get(path(node, "Name") && path(node, "Name").attrs.textId) || "";
  const collection = path(root(doc), "ProfileBody", "DeviceFunction", "VariableCollection");
  elements(collection, "Variable").forEach((variable) => {
    const index = num(variable.attrs.index);
    const rights = variable.attrs.accessRights;
    if (index === null || index < 60 || rights !== "rw") return;
    const dt = datatypeOf(variable);
    const type = typeOf(dt);
    const infos = new Map(elements(variable, "RecordItemInfo").map((i) => [i.attrs.subindex, i.attrs.defaultValue]));
    const items = type === "RecordT" ? elements(dt, "RecordItem").map((item) => ({ item: item, dt: datatypeOf(item), sub: item.attrs.subindex })) : [{ item: null, dt: dt, sub: null }];
    items.forEach((entry) => {
      const itemType = typeOf(entry.dt);
      const label = entry.item ? [name(variable), name(entry.item)].filter(Boolean).join(" ") : name(variable);
      const base = {
        id: variable.attrs.id,
        index: index,
        sub: entry.sub,
        name: label || variable.attrs.id,
        description: (entry.item ? texts.get(path(entry.item, "Description") && path(entry.item, "Description").attrs.textId) : texts.get(path(variable, "Description") && path(variable, "Description").attrs.textId)) || "",
        indexText: index + (entry.sub ? "." + entry.sub : "") + " (" + variable.attrs.id + ")",
        default: entry.item ? infos.get(entry.sub) : variable.attrs.defaultValue,
        scale: scaleOf.get(variable.attrs.id + (entry.sub ? "#" + entry.sub : "")),
      };
      const singles = elements(entry.dt, "SingleValue");
      if (["UIntegerT", "IntegerT"].includes(itemType) && singles.length >= 2) {
        const values = singles.map((s) => ({ raw: s.attrs.value, label: texts.get(path(s, "Name") && path(s, "Name").attrs.textId) || s.attrs.value }));
        out.push(Object.assign(base, { kind: "option", values: values }));
        return;
      }
      if (["UIntegerT", "IntegerT", "Float32T"].includes(itemType)) {
        const range = rangeOf(entry.dt);
        if (range && range[0] < range[1]) out.push(Object.assign(base, { kind: "setting", range: range }));
      }
    });
  });
  return out;
}

// Short codes like "SP_FH1" get the first words of the description beside them.
function nameOf(p) {
  if (/\s/.test(p.name) || !p.description) return p.name;
  const gist = p.description.split(/[.;,]\s|\.$/)[0].trim();
  return gist && gist.length <= 60 && gist.toLowerCase() !== p.name.toLowerCase() ? p.name + " (" + gist + ")" : p.name;
}

function toSetting(p, taken) {
  const g = p.scale && p.scale.gradient !== null ? p.scale.gradient : 1;
  const o = p.scale && p.scale.offset !== null ? p.scale.offset : 0;
  const at = (raw) => tidy(raw * g + o);
  const ends = [at(p.range[0]), at(p.range[1])].sort((a, b) => a - b);
  const raw = num(p.default);
  const setting = {
    key: keyOf(p.id + (p.sub ? "_" + p.sub : ""), taken),
    name: nameOf(p),
    unit: unitName(p.scale ? p.scale.unitCode : null),
    min: ends[0],
    max: ends[1],
    default: raw === null || raw < p.range[0] || raw > p.range[1] ? null : at(raw),
    iodd_index: p.indexText,
    default_source: "IODD factory default",
    scale: { gradient: g, offset: o },
  };
  if (setting.default === null) setting.default_source = "IODD gives no default";
  return setting;
}

function toOption(p, taken) {
  const labels = p.values.map((v) => v.label);
  const hit = p.values.find((v) => String(v.raw) === String(p.default));
  return {
    key: keyOf(p.id + (p.sub ? "_" + p.sub : ""), taken),
    name: nameOf(p),
    values: labels,
    default: hit ? hit.label : labels[0],
    default_source: hit ? "IODD factory default" : "IODD gives no default",
    iodd_index: p.indexText,
    raw: p.values.map((v) => num(v.raw)),
  };
}

// A reset point sits below the switch point with the same number.
function linkBelow(settings, found) {
  // V_rP_FL2_TEMP and V_SP_FH2_TEMP both reduce to "f2_temp".
  const stem = (p) => p.id.toLowerCase().replace(/^v_/, "").replace(/[-_]?(sp|rp)/, "").replace(/f[hl]/, "f").replace(/^[-_]+/, "") + (p.sub || "");
  settings.forEach((s, i) => {
    if (!/^v_rp|[-_]rp|^rp/i.test(found[i].id)) return;
    const j = found.findIndex((o, k) => k !== i && /^v_sp|[-_]sp|^sp/i.test(o.id) && stem(o) === stem(found[i]));
    const sp = settings[j];
    if (sp && s.default !== null && sp.default !== null && s.default < sp.default) s.below = sp.key;
  });
}

function pickByScore(list, score, limit) {
  return list
    .map((p, i) => ({ p: p, s: score(p), i: i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.p);
}

function categoryOf(words, pdUnits, pdIn, pdOut) {
  const text = words.toLowerCase();
  const rules = [
    ["pressure", /pressure|pressostat/],
    ["temperature", /temperature|thermo|\brtd\b|pt ?100/],
    ["inductive", /inductive/],
    ["capacitive", /capacitive/],
    ["optical distance", /photoelectric|optical|laser|time.of.flight|reflex|retro|diffuse|light barrier|background suppression/],
    ["flow", /flow/],
    ["level", /\blevel\b|fill/],
    ["optical distance", /distance/],
  ];
  const hit = rules.find((r) => r[1].test(text));
  if (hit) return hit[0];
  if (pdUnits.some((u) => PRESSURE_UNITS.includes(u))) return "pressure";
  if (pdUnits.some((u) => TEMPERATURE_UNITS.includes(u))) return "temperature";
  if (pdOut > 0 && pdIn === 0) return "actuator";
  return "device";
}

function wordsOf(text, limit) {
  const seen = [];
  String(text).toLowerCase().split(/[^a-z0-9]+/).forEach((w) => {
    if (w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w) && seen.indexOf(w) === -1) seen.push(w);
  });
  return seen.slice(0, limit);
}

// Menus scale process data through RecordItemRefs on the ProcessDataIn/Out variable.
function processData(doc, scaleOf) {
  const views = getProcessData(doc);
  const side = (direction) => {
    const view = views.find((v) => v.direction === direction);
    if (!view) return { bits: 0, items: [] };
    const bits = num(view.bits) || 0;
    const mine = direction === "in" ? /in|pd_?i/i : /out|pd_?o/i;
    const items = view.fields.map((f) => {
      const item = { name: f.name || "Field " + f.subindex, bit_offset: num(f.offset) || 0, bits: num(f.bits) || 0 };
      let scale;
      scaleOf.forEach((entry, key) => {
        const parts = key.split("#");
        if (!scale && parts[1] === String(f.subindex) && (parts[0] === view.id || /process ?data|^v_pd/i.test(parts[0]) && mine.test(parts[0].replace(/process ?data/i, "")))) scale = entry;
      });
      if (scale && scale.gradient !== null) {
        item.gradient = scale.gradient;
        if (scale.offset) item.offset = scale.offset;
        if (scale.unitCode !== null) item.unit = unitName(scale.unitCode);
      }
      return item;
    });
    return { bits: bits, items: items.length ? items : bits ? [{ name: "Process data", bit_offset: 0, bits: bits }] : [] };
  };
  return { in: side("in"), out: side("out") };
}

// Unit codes of the process data item the menus scale (for category fallback).
function processUnits(doc, scaleOf) {
  const units = [];
  scaleOf.forEach((entry, key) => {
    if (/ProcessData/i.test(key) && entry.unitCode !== null) units.push(entry.unitCode);
  });
  return units;
}

function convert(doc, ctx) {
  const texts = textMap(doc, ctx.texts);
  const identity = getIdentity(doc);
  const text = (node) => (node && texts.get(node.attrs.textId)) || "";
  const identityNode = path(root(doc), "ProfileBody", "DeviceIdentity");
  const variants = elements(path(identityNode, "DeviceVariantCollection"), "DeviceVariant");
  const wanted = String(ctx.productId || ctx.productName || "").toLowerCase();
  const variant = variants.find((v) => wanted && String(v.attrs.productId).toLowerCase() === wanted) || variants[0];
  const deviceName = text(path(identityNode, "DeviceName"));
  const family = text(path(identityNode, "DeviceFamily"));
  // A Finder product name that is not a productId of this file still beats a bare order number.
  const matched = variant && wanted && String(variant.attrs.productId).toLowerCase() === wanted;
  const variantName = text(path(variant, "Name"));
  // The variant name is what IODD Finder lists (e.g. "BOS 23K-GI-RE10-S4"); the productId is often an order code.
  // One IODD often covers several variants; unmatched, name the family the IODD names.
  const listed = variants.length > 1 && deviceName && deviceName.length <= 48 ? deviceName : variantName && variantName.length <= 40 ? variantName : "";
  const part = matched ? variant.attrs.productId : ctx.productName || listed || (variant && variant.attrs.productId) || deviceName || "IODD device " + ctx.ioddId;
  const description = text(path(variant, "Description"));

  const scaleOf = scales(doc);
  const pd = processData(doc, scaleOf);
  const category = categoryOf([part, variantName, deviceName, family, description].join(" "), processUnits(doc, scaleOf), pd.in.bits, pd.out.bits);

  const params = parameters(doc, texts, resolver(doc), scaleOf);
  const taken = new Set();
  const numeric = params.filter((p) => p.kind === "setting");
  const strong = (p) => SETTING_STRONG.test(p.id + " " + p.name);
  const weak = (p) => SETTING_WEAK.test(p.id + " " + p.name);
  // Threshold-like names only fill in when no switch or set points exist.
  let chosen = pickByScore(numeric, (p) => (strong(p) ? 3 : numeric.filter(strong).length < 2 && weak(p) ? 1 : 0), 6);
  if (!chosen.length) chosen = numeric.slice(0, 2);
  const settings = chosen.map((p) => toSetting(p, taken));
  linkBelow(settings, chosen);

  const optionTaken = new Set(settings.map((s) => s.key));
  const choices = params.filter((p) => p.kind === "option" && !OPTION_SKIP.test(p.name) && p.values.every((v) => v.label));
  let options = pickByScore(choices, (p) => (OPTION_WORDS.test(p.name + " " + p.id + " " + p.values.map((v) => v.label).join(" ")) ? 2 : 0), 4);
  if (!options.length) options = choices.slice(0, 2);
  const optionDefs = options.map((p) => toOption(p, optionTaken));

  const physical = findAll(root(doc), "PhysicalLayer")[0];
  const minCycle = num(physical && physical.attrs.minCycleTime);
  const vendorId = num(identity.vendorId) !== null ? num(identity.vendorId) : num(ctx.vendorId);
  const deviceId = num(identity.deviceId);
  const file = ctx.file || "";
  const phrase = description || [variantName || part, family && "family " + family].filter(Boolean).join(", ");

  return {
    id: "iodd-" + ctx.vendorId + "-" + ctx.ioddId,
    kind: "sensor",
    source_kind: "iodd",
    category: category,
    part: part,
    vendor: ctx.vendorName || identity.vendorName,
    vendor_id: vendorId,
    device_id: deviceId,
    measures: phrase,
    source: "IODD " + file + ", IODD Finder id " + ctx.ioddId,
    source_url: "https://ioddfinder.io-link.com/productvariants/search?productName=" + encodeURIComponent(part),
    job_words: wordsOf([part, category, family, variantName, deviceName, description].join(" "), 14),
    refused: [],
    settings: settings,
    options: optionDefs,
    port_class: "A",
    connector: "M12",
    iodd: {
      file: file,
      iodd_finder_id: ctx.ioddId,
      min_cycle_ms: minCycle === null ? null : tidy(minCycle / 1000),
      // IODD 1.0.1 spells it "baudrate".
      bitrate: (physical && (physical.attrs.bitrate || physical.attrs.baudrate)) || null,
      pd_in_bits: pd.in.bits,
      pd_in: pd.in.items,
      pd_out_bits: pd.out.bits,
      pd_out: pd.out.items,
    },
  };
}

function optionsOf(opts) {
  const o = opts || {};
  if (o.vendorId === undefined || o.ioddId === undefined) throw Error("partFromIodd needs { vendorId, ioddId }.");
  return o;
}

export function partFromIoddXml(xmlString, opts) {
  const ctx = Object.assign({}, optionsOf(opts));
  const doc = parseXml(String(xmlString));
  if (!root(doc) || root(doc).name !== "IODevice") throw Error("Not an IODD: root element must be IODevice.");
  return convert(doc, ctx);
}

export async function partFromIoddZip(bytes, opts) {
  const ctx = Object.assign({}, optionsOf(opts));
  const decode = new TextDecoder("utf-8");
  const files = (await readPackageFiles(bytes)).filter((f) => /\.xml$/i.test(f.name));
  const texts = files.map((f) => ({ name: f.name, xml: decode.decode(f.bytes) }));
  const mains = texts.filter((f) => /<(?:[A-Za-z_][\w.-]*:)?IODevice(?:\s|>)/.test(f.xml));
  if (!mains.length) throw Error("No IODevice XML in the IODD package.");
  const main = mains.find((f) => !/[-_](de|es|fr|it|ja|ko|kr|pt|ru|zh)\.xml$/i.test(f.name)) || mains[0];
  // External text documents: keep the English one for packages whose main file is not English.
  const english = [];
  texts.forEach((f) => {
    if (f === main || !/<ExternalTextDocument/.test(f.xml)) return;
    const language = path(root(parseXml(f.xml)), "Language");
    if (language && langOf(language).slice(0, 2) === "en") elements(language, "Text").forEach((t) => english.push({ id: t.attrs.id, value: t.attrs.value }));
  });
  ctx.texts = english;
  ctx.file = main.name.split("/").pop();
  const doc = parseXml(main.xml);
  if (!root(doc) || root(doc).name !== "IODevice") throw Error("Not an IODD: root element must be IODevice.");
  return convert(doc, ctx);
}
