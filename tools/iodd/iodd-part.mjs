// IODD -> studio part definition.
// Runs in the browser, in Cloudflare Workers and in Node: no node: imports and
// no DOMParser (the XML goes through the lossless tree parser directly, so a
// vendor file the editor would refuse can still be turned into a part).
//
// Where the numbers come from, in order of trust:
//   1. Smart Sensor Profile structures: switching signal channels (SSC/BDC
//      parameter records at index 60/62 and 16384+, config at the next index),
//      the Measurement Data Channel descriptor (index 16512+: lower/upper limit,
//      unit code, scale) and the profile identifiers at index 13. Switch points
//      are in the units of the process value they compare against.
//   2. Menu RecordItemRef/VariableRef gradient, offset and unitCode, taking
//      menu conditions into account (the menu shown at the factory unit wins).
//   3. A unit written in the name or description ("[mm]", "in 0.1 bar").
//   4. Raw device values.
// Every setting carries a `write` object with the raw ISDU coordinates.
import { readPackageFiles } from "../../assets/js/iodd/package.js";
import { parseXml } from "../../assets/js/iodd/vendor/model/xml.js";
import { elements, findAll, path, root } from "../../assets/js/iodd/vendor/model/tree.js";
import { getIdentity } from "../../assets/js/iodd/document.js";
import UNIT_TABLE from "./iodd-units.mjs";

// Bumped whenever the output for the same IODD changes (cache key for /part).
export const CONVERTER_VERSION = "2";

const UNITS = UNIT_TABLE.units;

// Profile identifiers (IO-Link Common Profile / Smart Sensor Profile), named as
// IODDs in IODD Finder name them in their own ProfileCharacteristic values.
// An IODD that names an identifier itself wins. Most IODDs leave index 13 to
// the device (no default), so these are informative, not relied on.
const PROFILE_NAMES = {
  0x0001: "Generic Profiled Sensor",
  0x000c: "Digital Measuring Sensor 16 bit, transducer disable",
  0x4000: "Identification and Diagnosis",
  0x8001: "Switching Signal Channel",
  0x8004: "Teach-in",
  0x8007: "Teach-in single value",
  0x800c: "Transducer disable",
};

const SETTING_STRONG = /sp\d|rp\d|(^|[^a-z])(sp|rp)([^a-z]|$)|switch ?points?|set ?points?|switching point|schaltpunkt/i;
const SETTING_SPAN = /(^|[^a-z])(asp|aep)\d?([^a-z]|$)|analog(ue)? (start|end) ?point|start point|end point/i;
const SETTING_WEAK = /threshold|limit|window|hysteresis|teach ?point|sensitivity|range (start|end)/i;
const SETTING_SKIP = /delay|count|ctr\b|damping|\bdap\b|\bds\b|\bdr\b|time|filter|blink|brightness|display|colou?r|counter|hours|cycles|offset|calib|password|code|tag|baud|address|language/i;
const OPTION_WORDS = /output|function|polarity|logic|mode|pnp|npn|\bno\b|\bnc\b|normally|\bou\d?\b|\bout\d?\b|switching|inverted|contact/i;
const OPTION_SKIP = /\bu?loc\b|lock|factory|restore|command|teach|\buni\b|unit|language|display|colou?r|brightness|\bled\b|password|code|calibr|reset|standard|access|^fou|colr|orientation|rotation/i;
const STOP = new Set(["with", "and", "the", "for", "from", "that", "this", "into", "sensor", "sensors", "device", "type", "the", "mm"]);
const NUMERIC = ["UIntegerT", "IntegerT", "Float32T"];

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function tidy(value) {
  return Number(value.toPrecision(10));
}

// 1997 is the table's "none": a dimensionless value, shown as raw.
const NO_UNIT = 1997;

export function unitInfo(code) {
  const entry = code === null || code === undefined || Number(code) === NO_UNIT ? null : UNITS[String(code)];
  return entry || null;
}

// Some vendors put a non-IO-Link code (e.g. a HART code) in the MDC unit and
// name the unit in the SingleValue; resolve that name against the table.
function unitFromLabel(label) {
  const wanted = String(label || "").trim().toLowerCase();
  if (!wanted) return null;
  const codes = Object.keys(UNITS);
  const hit = codes.find((c) => UNITS[c].abbr.toLowerCase() === wanted) || codes.find((c) => UNITS[c].name.toLowerCase() === wanted) || codes.find((c) => UNITS[c].name && wanted.startsWith(UNITS[c].name.toLowerCase() + " ")) || codes.find((c) => UNITS[c].name && wanted.replace(/ ?unit$/, "") === UNITS[c].name.toLowerCase());
  return hit ? Number(hit) : null;
}

function unitName(code) {
  if (code === null || code === undefined || Number(code) === NO_UNIT) return "raw";
  const entry = unitInfo(code);
  return entry ? entry.abbr || entry.name : "unit " + code;
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

function rangeOf(dt) {
  const ranges = elements(dt, "ValueRange").map((r) => [num(r.attrs.lowerValue), num(r.attrs.upperValue)]).filter((r) => r[0] !== null && r[1] !== null);
  if (!ranges.length) return null;
  return [Math.min.apply(null, ranges.map((r) => r[0])), Math.max.apply(null, ranges.map((r) => r[1]))];
}

// What the datatype itself allows: integers by bit length, nothing for floats.
function implicitRange(type, bits) {
  if (!bits || bits > 32) return null;
  if (type === "UIntegerT") return [0, Math.pow(2, bits) - 1];
  if (type === "IntegerT") return [-Math.pow(2, bits - 1), Math.pow(2, bits - 1) - 1];
  return null;
}

function bitsOf(type, dt) {
  const declared = num(dt && dt.attrs.bitLength);
  if (declared !== null) return declared;
  if (type === "Float32T") return 32;
  if (type === "BooleanT") return 1;
  return null;
}

// One flat model of the variable collection: plain variables and every record item.
function readVariables(doc, texts, datatypeOf) {
  const text = (node, name) => {
    const ref = path(node, name);
    return (ref && texts.get(ref.attrs.textId)) || "";
  };
  const collection = path(root(doc), "ProfileBody", "DeviceFunction", "VariableCollection");
  return elements(collection, "Variable").map((variable) => {
    const dt = datatypeOf(variable);
    const type = typeOf(dt);
    const infos = new Map(elements(variable, "RecordItemInfo").map((i) => [i.attrs.subindex, i.attrs.defaultValue]));
    const describe = (sub, node, itemDt, bitOffset) => {
      const itemType = typeOf(itemDt);
      const singles = elements(itemDt, "SingleValue").map((s) => ({ raw: s.attrs.value, label: (path(s, "Name") && texts.get(path(s, "Name").attrs.textId)) || "" }));
      const bits = bitsOf(itemType, itemDt);
      return {
        sub: sub,
        type: itemType,
        bits: bits,
        bitOffset: bitOffset,
        range: rangeOf(itemDt),
        singles: singles,
        name: node ? text(node, "Name") : "",
        description: node ? text(node, "Description") : "",
        default: sub ? infos.get(sub) : variable.attrs.defaultValue,
      };
    };
    const items = type === "RecordT" ? elements(dt, "RecordItem").map((item) => describe(item.attrs.subindex, item, datatypeOf(item), num(item.attrs.bitOffset))) : [describe(null, null, dt, null)];
    return {
      id: variable.attrs.id,
      index: num(variable.attrs.index),
      rights: variable.attrs.accessRights,
      type: type,
      bits: num(dt && dt.attrs.bitLength),
      subindexAccess: !(dt && dt.attrs.subindexAccessSupported === "false"),
      name: text(variable, "Name"),
      description: text(variable, "Description"),
      default: variable.attrs.defaultValue,
      items: items,
    };
  });
}

function defaultOf(vars, variableId, subindex) {
  const v = vars.find((x) => x.id === variableId);
  if (!v) return undefined;
  const item = subindex ? v.items.find((i) => i.sub === String(subindex)) : v.items[0];
  return item ? item.default : undefined;
}

// Display scales from the menus. A menu reached only under a condition that the
// factory defaults do not meet (e.g. the psi menu while the unit is bar) ranks
// below one that is shown at the factory setting.
function menuScales(doc, vars) {
  const menus = path(root(doc), "ProfileBody", "DeviceFunction", "UserInterface", "MenuCollection");
  const conditions = new Map();
  findAll(path(root(doc), "ProfileBody", "DeviceFunction", "UserInterface"), "MenuRef").forEach((ref) => {
    const condition = path(ref, "Condition");
    const list = conditions.get(ref.attrs.menuId) || [];
    list.push(condition ? String(defaultOf(vars, condition.attrs.variableId, condition.attrs.subindex)) === String(condition.attrs.value) : true);
    conditions.set(ref.attrs.menuId, list);
  });
  const found = new Map();
  elements(menus, "Menu").forEach((menu) => {
    const reach = conditions.get(menu.attrs.id);
    const active = !reach || reach.some(Boolean);
    elements(menu, "VariableRef").concat(elements(menu, "RecordItemRef")).forEach((ref) => {
      const sub = ref.attrs.subindex;
      const key = ref.attrs.variableId + (sub ? "#" + sub : "");
      const entry = { gradient: num(ref.attrs.gradient), offset: num(ref.attrs.offset), unitCode: num(ref.attrs.unitCode) };
      const scaled = entry.gradient !== null || entry.unitCode !== null;
      const rank = (scaled ? 2 : 0) + (active ? 1 : 0);
      const old = found.get(key);
      if (!old || old.rank < rank) found.set(key, Object.assign({ scaled: scaled, rank: rank }, entry));
    });
  });
  // Process data scaling declared for the process data itself (IODD 1.1
  // ProcessDataRefCollection): ranks above any menu.
  findAll(path(root(doc), "ProfileBody", "DeviceFunction", "UserInterface", "ProcessDataRefCollection"), "ProcessDataRef").forEach((ref) => {
    const put = (key, node) => {
      const entry = { gradient: num(node.attrs.gradient), offset: num(node.attrs.offset), unitCode: num(node.attrs.unitCode) };
      if (entry.gradient === null && entry.unitCode === null) return;
      found.set(key, Object.assign({ scaled: true, rank: 4 }, entry));
    };
    put(ref.attrs.processDataId, ref);
    elements(ref, "ProcessDataRecordItemInfo").forEach((info) => put(ref.attrs.processDataId + "#" + info.attrs.subindex, info));
  });
  return found;
}

// "[mm]", "(0.1 bar)", "in 1/10 °C", "unit: mm" in a name or description.
const TEXT_UNITS = (() => {
  const wanted = ["mm", "cm", "m", "µm", "°C", "°F", "K", "bar", "mbar", "psi", "kPa", "MPa", "hPa", "Pa", "%", "ms", "s", "min", "h", "Hz", "kHz", "L/min", "L/h", "m³/h", "m/s", "mA", "V", "rpm", "°", "kg", "g", "N", "lux", "in"];
  const byAbbr = new Map();
  Object.keys(UNITS).forEach((code) => {
    const abbr = UNITS[code].abbr;
    if (wanted.includes(abbr) && !byAbbr.has(abbr.toLowerCase())) byAbbr.set(abbr.toLowerCase(), Number(code));
  });
  byAbbr.set("l/min", byAbbr.get("l/min") || null);
  byAbbr.set("°c", 1001);
  byAbbr.set("degc", 1001);
  byAbbr.set("um", byAbbr.get("µm"));
  byAbbr.set("µm", byAbbr.get("µm"));
  return byAbbr;
})();

function unitFromText(text) {
  const s = String(text || "");
  const patterns = [
    /\[\s*(?:(\d+(?:[.,]\d+)?|1\/\d+)\s*)?([^\]\s]{1,6})\s*\]/,
    /\(\s*(?:in\s+)?(?:(\d+(?:[.,]\d+)?|1\/\d+)\s*)?([^)\s]{1,6})\s*\)/,
    /\bin\s+(?:(\d+(?:[.,]\d+)?|1\/\d+)\s*)?(mm|cm|µm|um|°C|°F|bar|mbar|psi|kPa|MPa|%|ms|s|Hz|L\/min|l\/min|m\/s)\b/,
    /\bunit:?\s*(?:(\d+(?:[.,]\d+)?|1\/\d+)\s*)?([^\s,;.]{1,6})/i,
  ];
  for (const pattern of patterns) {
    const m = s.match(pattern);
    if (!m) continue;
    const code = TEXT_UNITS.get(String(m[2]).toLowerCase());
    if (!code) continue;
    let gradient = 1;
    if (m[1]) gradient = m[1].startsWith("1/") ? 1 / Number(m[1].slice(2)) : Number(m[1].replace(",", "."));
    if (!Number.isFinite(gradient) || gradient <= 0) continue;
    return { gradient: gradient, offset: 0, unitCode: code };
  }
  return null;
}

// Process data in/out: the first ProcessData (the one without a condition, if any).
function readProcessData(doc, datatypeOf, texts) {
  const collection = path(root(doc), "ProfileBody", "DeviceFunction", "ProcessDataCollection");
  const all = elements(collection, "ProcessData");
  const pd = all.find((p) => !path(p, "Condition")) || all[0];
  const side = (name) => {
    const node = pd && path(pd, name);
    if (!node) return null;
    const dt = datatypeOf(node);
    const type = typeOf(dt);
    const label = (n) => (path(n, "Name") && texts.get(path(n, "Name").attrs.textId)) || "";
    const fields = type === "RecordT"
      ? elements(dt, "RecordItem").map((item) => {
        const itemDt = datatypeOf(item);
        const itemType = typeOf(itemDt);
        return { sub: item.attrs.subindex, name: label(item), description: (path(item, "Description") && texts.get(path(item, "Description").attrs.textId)) || "", offset: num(item.attrs.bitOffset) || 0, bits: bitsOf(itemType, itemDt) || 0, type: itemType, range: rangeOf(itemDt) };
      })
      : [{ sub: null, name: label(node) || "Process data", description: "", offset: 0, bits: bitsOf(type, dt) || num(node.attrs.bitLength) || 0, type: type, range: rangeOf(dt) }];
    return { id: node.attrs.id, bits: num(node.attrs.bitLength) || 0, fields: fields.filter((f) => f.type) };
  };
  return { in: side("ProcessDataIn"), out: side("ProcessDataOut") };
}

// Profile identifiers from index 13 (a record of UInteger16 or an array).
function profileIds(vars) {
  const v = vars.find((x) => x.index === 13);
  if (!v) return [];
  const label = (n) => {
    const hit = v.items.map((i) => i.singles.find((x) => num(x.raw) === n)).find(Boolean);
    return hit && hit.label ? hit.label.replace(/^0x[0-9a-f]{4}:\s*/i, "") : PROFILE_NAMES[n] || null;
  };
  const values = [];
  v.items.forEach((item) => {
    String(item.default || "").split(/[,\s]+/).forEach((part) => {
      const n = /^0x/i.test(part) ? parseInt(part, 16) : num(part);
      if (n) values.push(n);
    });
  });
  if (!values.length && v.default) String(v.default).split(/[,\s]+/).forEach((part) => {
    const n = /^0x/i.test(part) ? parseInt(part, 16) : num(part);
    if (n) values.push(n);
  });
  return [...new Set(values)].map((n) => ({ id: n, name: label(n) }));
}

// Measurement Data Channel descriptor: lower, upper, unit code, scale (10^scale).
function readMdc(vars) {
  const list = vars.filter((v) => v.type === "RecordT" && v.items.length >= 3 && ((v.index >= 16512 && v.index < 16520) || /mdc.*descr|descriptor.*mdc|measurement data channel/i.test(v.id + " " + v.name)));
  return list.map((v) => {
    const by = (sub) => v.items.find((i) => i.sub === String(sub));
    const unitItem = by(3);
    const scaleItem = by(4);
    let unitCode = num(unitItem && unitItem.default);
    if (unitItem && (unitCode === null || !unitInfo(unitCode))) {
      const named = unitItem.singles.find((x) => unitCode === null || String(x.raw) === String(unitCode));
      const code = named && unitFromLabel(named.label.replace(/^hertz$/i, "Hz"));
      if (code) unitCode = code;
      else if (unitCode !== null && !unitInfo(unitCode)) unitCode = null;
    }
    return {
      index: v.index,
      id: v.id,
      lower: num(by(1) && by(1).default),
      upper: num(by(2) && by(2).default),
      unitCode: unitCode,
      scale: num(scaleItem && scaleItem.default),
    };
  });
}

function scaleFromMdc(mdc) {
  if (!mdc || mdc.unitCode === null) return null;
  const gradient = mdc.scale === null ? 1 : tidy(Math.pow(10, mdc.scale));
  return { gradient: gradient, offset: 0, unitCode: mdc.unitCode };
}

function keyOf(text, taken) {
  let key = String(text).replace(/^V_/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "param";
  while (taken.has(key)) key += "_";
  taken.add(key);
  return key;
}

// Short codes like "SP_FH1" get the first words of the description beside them.
function nameOf(p) {
  if (/\s/.test(p.name) || !p.description) return p.name;
  const gist = p.description.split(/[.;,]\s|\.$/)[0].trim();
  return gist && gist.length <= 60 && gist.toLowerCase() !== p.name.toLowerCase() ? p.name + " (" + gist + ")" : p.name;
}

// Flatten writable numeric parameters and choice parameters (index >= 60 or a
// profile channel; below that sit system, identification and diagnosis).
function candidates(vars) {
  const out = [];
  vars.forEach((variable) => {
    if (variable.index === null || variable.index < 60 || variable.rights !== "rw") return;
    variable.items.forEach((item) => {
      const label = item.sub ? [variable.name, item.name].filter(Boolean).join(" ") : variable.name;
      const base = {
        id: variable.id,
        index: variable.index,
        sub: item.sub,
        item: item,
        variable: variable,
        name: label || variable.id + (item.sub ? " " + item.sub : ""),
        description: (item.sub ? item.description : variable.description) || "",
        indexText: variable.index + (item.sub ? "." + item.sub : "") + " (" + variable.id + ")",
        default: item.default,
      };
      if (["UIntegerT", "IntegerT", "BooleanT"].includes(item.type) && item.singles.length >= 2 && !(item.range && item.range[1] - item.range[0] > 2 * item.singles.length)) {
        out.push(Object.assign(base, { kind: "option" }));
      } else if (NUMERIC.includes(item.type)) {
        out.push(Object.assign(base, { kind: "setting" }));
      }
    });
  });
  return out;
}

// Switching signal channels: a parameter record (SP1, SP2) with its config
// record (logic, mode, hysteresis) at the next index.
function switchingChannels(vars) {
  const byIndex = new Map(vars.filter((v) => v.index !== null).map((v) => [v.index, v]));
  const channels = [];
  vars.forEach((v) => {
    if (v.rights !== "rw" || v.index === null) return;
    const standard = v.index === 60 || v.index === 62 || (v.index >= 16384 && v.index < 16448 && v.index % 2 === 0);
    const words = v.id + " " + v.name;
    const named = /(ssc|bdc)[\s_.-]*\d|switch(ing)? ?signal ?channel|binary data channel/i.test(words) && !/config|conf\b|spc|logic|mode|hyst|counter|ctr|threshold|time|delay|teach/i.test(words);
    if (!standard && !named) return;
    const sp1 = v.items[0];
    if (!sp1 || !NUMERIC.includes(sp1.type) || sp1.singles.length >= 2 && !sp1.range) return;
    const config = byIndex.get(v.index + 1);
    const configOk = config && config.type === "RecordT" && config.items.length >= 2 && config.items[0].singles.length >= 1;
    if (!standard && !configOk) return;
    if (standard && !configOk && v.type !== "RecordT") {
      // A plain variable at 60 without a config record is a vendor parameter, not a channel.
      if (!/ssc|bdc|sp/i.test(v.id + " " + v.name)) return;
    }
    const item = (rec, sub) => rec && rec.items.find((i) => i.sub === String(sub));
    const label = (v.name.match(/(ssc|bdc)[\s_-]*[\d.x-]*\d/i) || v.id.match(/(ssc|bdc)[\s_-]*[\d.x-]*\d/i) || [])[0];
    channels.push({
      param: v,
      config: configOk ? config : null,
      label: label ? label.toUpperCase().replace(/[\s_-]+/g, "") : "SSC" + (channels.length + 1),
      sp1: v.type === "RecordT" ? item(v, 1) : sp1,
      sp2: v.type === "RecordT" ? item(v, 2) : null,
      logic: configOk ? item(config, 1) : null,
      mode: configOk ? item(config, 2) : null,
      hysteresis: configOk ? item(config, 3) : null,
    });
  });
  return channels;
}

function processValue(pd, scaleOf, mdc) {
  // The measured value: the widest numeric field that is not a status or switch bit.
  if (!pd) return null;
  const numeric = pd.fields.filter((f) => ["UIntegerT", "IntegerT", "Float32T"].includes(f.type) && f.bits >= 8 && !/status|state|quality|diag|counter|event/i.test(f.name));
  if (!numeric.length) return null;
  const field = numeric.slice().sort((a, b) => b.bits - a.bits || b.offset - a.offset)[0];
  // Switch points follow the process value only when it is the one measurement.
  const single = numeric.length === 1;
  // The profile's Measurement Data Channel descriptor is the engineering scale
  // of the process value; a vendor menu or ProcessDataRef comes next.
  const channel = mdc.find((m) => m.unitCode !== null && m.unitCode !== NO_UNIT);
  if (channel) return { field: field, scale: scaleFromMdc(channel), source: "mdc", single: true };
  const menu = scaleFor(scaleOf, pd.id, field.sub);
  if (menu && menu.unitCode !== null) return { field: field, scale: menu, source: "menu", single: single };
  const fromText = unitFromText(field.name + " " + field.description);
  if (fromText) {
    // A menu gradient with the unit named in the text.
    if (menu && menu.gradient !== null && menu.gradient !== 1 && fromText.gradient === 1) fromText.gradient = menu.gradient;
    return { field: field, scale: fromText, source: "text", single: single };
  }
  return { field: field, scale: menu, source: menu ? "menu" : null, single: single };
}

// Menu scale for a process data item, whether the menu points at the
// ProcessDataIn id or at the standard V_ProcessDataInput.
function scaleFor(scaleOf, pdId, sub, output) {
  const keys = [pdId + (sub ? "#" + sub : "")].concat(output ? [] : ["V_ProcessDataInput" + (sub ? "#" + sub : "")]);
  for (const key of keys) {
    const entry = scaleOf.get(key);
    if (entry && entry.scaled) return entry;
  }
  return null;
}

function writeOf(p, scale, rawRange) {
  const w = {
    index: p.index,
    subindex: p.sub ? Number(p.sub) : 0,
    datatype: p.item.type,
    bitLength: p.item.bits,
    gradient: scale.gradient,
    offset: scale.offset,
    raw_min: rawRange ? rawRange[0] : null,
    raw_max: rawRange ? rawRange[1] : null,
  };
  if (p.sub && p.item.bitOffset !== null) w.bit_offset = p.item.bitOffset;
  if (p.sub && !p.variable.subindexAccess) {
    // The record has to be written whole: the other items keep their values.
    w.subindex_access = false;
    w.record_bit_length = p.variable.bits;
  }
  return w;
}

function makeSetting(p, ctx, taken, hint) {
  const menu = ctx.scaleOf.get(p.id + (p.sub ? "#" + p.sub : ""));
  let scale = null;
  let unitSource = "raw";
  if (hint && hint.preferProfile && hint.scale) {
    scale = hint.scale;
    unitSource = hint.source;
  } else if (menu && menu.scaled && menu.unitCode !== null) {
    scale = menu;
    unitSource = "menu";
  } else if (hint && hint.scale && hint.scale.unitCode !== null && hint.scale.unitCode !== undefined) {
    scale = hint.scale;
    unitSource = hint.source;
  } else if (menu && menu.scaled) {
    scale = menu;
    unitSource = "menu";
    const fromText = unitFromText(p.name + " " + p.description);
    if (fromText) {
      scale = { gradient: menu.gradient !== null ? menu.gradient : fromText.gradient, offset: menu.offset, unitCode: fromText.unitCode };
      unitSource = "text";
    }
  } else if (hint && hint.scale) {
    scale = hint.scale;
    unitSource = hint.source;
  } else {
    const fromText = unitFromText(p.name + " " + p.description);
    if (fromText) {
      scale = fromText;
      unitSource = "text";
    }
  }
  const g = scale && scale.gradient !== null && scale.gradient !== undefined ? scale.gradient : 1;
  const o = scale && scale.offset !== null && scale.offset !== undefined ? scale.offset : 0;
  const unitCode = scale && scale.unitCode !== undefined ? scale.unitCode : null;
  let rawRange = p.item.range;
  let rangeSource = "IODD ValueRange";
  if (!rawRange && hint && hint.range) {
    rawRange = hint.range;
    rangeSource = hint.rangeSource;
  }
  if (!rawRange) {
    rawRange = implicitRange(p.item.type, p.item.bits);
    rangeSource = "datatype bit length";
  }
  if (!rawRange || rawRange[0] >= rawRange[1]) return null;
  const at = (raw) => tidy(raw * g + o);
  const ends = [at(rawRange[0]), at(rawRange[1])].sort((a, b) => a - b);
  const raw = num(p.default);
  const setting = {
    key: keyOf(p.id + (p.sub ? "_" + p.sub : ""), taken),
    name: hint && hint.name ? hint.name : nameOf(p),
    unit: unitName(unitCode),
    min: ends[0],
    max: ends[1],
    default: raw === null || raw < rawRange[0] || raw > rawRange[1] ? null : at(raw),
    iodd_index: p.indexText,
    default_source: "IODD factory default",
    scale: { gradient: g, offset: o },
    unit_source: unitName(unitCode) === "raw" ? "raw" : unitSource,
    range_source: rangeSource,
    write: writeOf(p, { gradient: g, offset: o }, rawRange),
  };
  if (setting.default === null) setting.default_source = "IODD gives no default";
  if (hint && hint.role) setting.role = hint.role;
  const kind = unitInfo(unitCode);
  if (kind && kind.kind) setting.quantity = kind.kind;
  return setting;
}

function makeOption(p, taken, name) {
  const values = p.item.singles.map((s) => ({ raw: s.raw, label: s.label || s.raw }));
  const labels = values.map((v) => v.label);
  const hit = values.find((v) => String(v.raw) === String(p.default) || (p.item.type === "BooleanT" && String(v.raw) === String(p.default)));
  return {
    key: keyOf(p.id + (p.sub ? "_" + p.sub : ""), taken),
    name: name || nameOf(p),
    values: labels,
    default: hit ? hit.label : labels[0],
    default_source: hit ? "IODD factory default" : "IODD gives no default",
    iodd_index: p.indexText,
    raw: values.map((v) => (num(v.raw) === null ? v.raw : num(v.raw))),
    write: { index: p.index, subindex: p.sub ? Number(p.sub) : 0, datatype: p.item.type, bitLength: p.item.bits },
  };
}

// A reset point sits below the switch point with the same number; an analogue
// start point below its end point.
function linkBelow(settings, found) {
  const stem = (p) => p.id.toLowerCase().replace(/^v_/, "").replace(/[-_]?(sp|rp)/, "").replace(/f[hl]/, "f").replace(/^[-_]+/, "") + (p.sub || "");
  settings.forEach((s, i) => {
    if (s.below) return;
    if (/^v_rp|[-_]rp|^rp/i.test(found[i].id)) {
      const j = found.findIndex((o, k) => k !== i && /^v_sp|[-_]sp|^sp/i.test(o.id) && stem(o) === stem(found[i]));
      if (j !== -1 && settings[j].unit === s.unit) s.below = settings[j].key;
    }
    const asp = (found[i].id + " " + found[i].name).match(/(^|[^a-z])asp(\d?)/i);
    if (asp) {
      const j = found.findIndex((o) => new RegExp("(^|[^a-z])aep" + asp[2] + "([^a-z0-9]|$)", "i").test(o.id + " " + o.name));
      if (j !== -1 && settings[j].unit === s.unit) s.below = settings[j].key;
    }
  });
}

function wordsOf(text, limit) {
  const seen = [];
  String(text).toLowerCase().split(/[^a-z0-9]+/).forEach((w) => {
    if (w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w) && seen.indexOf(w) === -1) seen.push(w);
  });
  return seen.slice(0, limit);
}

// Studio categories: pressure, temperature, flow, level, inductive, capacitive,
// optical distance, device, actuator.
const OPTICAL = /couleur|farb|kontrast|contraste|photoelectric|photo-electric|optical|optoelectronic|opto|laser|time.of.flight|reflex|réflex|retro|diffuse|light (barrier|grid|curtain|scanner)|lichtschranke|lichttaster|lichtgitter|lichtvorhang|background supp?ression|hintergrundausblendung|\bphoto\b|\bcolou?r\b|ultrasonic|ultraschall|ultrason|distance|fib(er|re)|faser|colou?r sensor|contrast|luminescence|through.beam|profile? sensor|smart profil|\btaster\b/;
const LEVEL = /(fill|point|liquid|limit|tank|bulk) ?level|level (sensor|switch|probe|transmitter|measurement|limit|gauge)|liquiphant|liquipoint|soliphant|vibronic|vibrat\w* fork|tuning fork|guided (wave|microwave)|radar|füllstand|grenzstand|niveau/;

// Studio categories: pressure, temperature, flow, level, inductive, capacitive,
// optical distance, device, actuator. Measured quantity first (profile MDC,
// process data and switch point units), the device's own words second.
function categoryOf(words, kinds, pdIn, pdOut) {
  const text = words.toLowerCase();
  if (/inductive|induktiv|inductif|inductivo/.test(text)) return "inductive";
  if (/capacitive|kapazitiv|capacitif|capacitivo/.test(text)) return "capacitive";
  if (/\b(io-?link )?(master|hub)\b|\bi\/o[- ](module|hub|box)\b|\bio[- ]?(module|modul|box)\b|valve terminal|ventilinsel|\brfid\b|encoder|drehgeber|inclin|\bgateway\b|power supply|netzteil|logic modul|relay|motor starter|starter|circuit breaker|strain gauge|amplifier|verstärker|identification/.test(text) && !/fib(er|re)|faser|sensor (with|mit) /.test(text)) {
    return pdOut > 0 && !pdIn ? "actuator" : "device";
  }
  if (/vibration|schwingung|current monitor|energy meter/.test(text)) return "device";
  const primary = kinds[0];
  if (LEVEL.test(text) && (!primary || ["length", "percent", "volume", "frequency"].includes(primary))) return "level";
  if (primary === "length") return "optical distance";
  if (primary === "pressure") return "pressure";
  if (primary === "temperature" && !/flow|strömung/.test(text)) return "temperature";
  if (primary === "flow" || (primary === "velocity" && /flow|strömung/.test(text))) return "flow";
  if (/proximity|näherungs|proximit/.test(text) && !OPTICAL.test(text)) return "inductive";
  const rules = [
    ["pressure", /pressure|pressostat|druck|\d\s*(m?bar|psi|kpa|mpa)\b|vacuum|vakuum/],
    ["flow", /\bflow|strömung|durchfluss|débit/],
    ["temperature", /temperature|thermo|\brtd\b|pt ?100|pt ?1000|temperatur|thermocouple/],
    ["level", LEVEL],
    ["optical distance", OPTICAL],
  ];
  const hit = rules.find((r) => r[1].test(text));
  if (hit) return hit[0];
  if (primary === "length") return "optical distance";
  if (kinds.includes("pressure")) return "pressure";
  if (kinds.includes("temperature")) return "temperature";
  if (pdOut > 0 && !pdIn) return "actuator";
  if (/valve|ventil|lamp|light|tower|signal|beacon|gripper|greifer|actuator|motor|drive/.test(text) && pdOut > 0) return "actuator";
  return "device";
}

function pdItems(pd, scaleOf, measured, output) {
  if (!pd) return { bits: 0, items: [] };
  const items = pd.fields.map((f) => {
    const item = { name: f.name || "Field " + f.sub, bit_offset: f.offset, bits: f.type === "BooleanT" ? 1 : f.bits };
    let scale = scaleFor(scaleOf, pd.id, f.sub, output);
    if (!scale && measured && measured.field === f && measured.scale) scale = measured.scale;
    if (scale && scale.gradient !== null && scale.gradient !== undefined) {
      item.gradient = scale.gradient;
      if (scale.offset) item.offset = scale.offset;
      if (scale.unitCode !== null && scale.unitCode !== undefined) item.unit = unitName(scale.unitCode);
    } else if (scale && scale.unitCode !== null && scale.unitCode !== undefined) {
      item.gradient = 1;
      item.unit = unitName(scale.unitCode);
    }
    return item;
  });
  return { bits: pd.bits, items: items.length ? items : pd.bits ? [{ name: "Process data", bit_offset: 0, bits: pd.bits }] : [] };
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

  const datatypeOf = resolver(doc);
  const vars = readVariables(doc, texts, datatypeOf);
  const scaleOf = menuScales(doc, vars);
  const pdRaw = readProcessData(doc, datatypeOf, texts);
  const mdc = readMdc(vars);
  const profiles = profileIds(vars);
  const measured = processValue(pdRaw.in, scaleOf, mdc);
  const productText = (vars.find((v) => v.index === 20) || {}).default || "";

  const taken = new Set();
  const settings = [];
  const found = [];
  const optionDefs = [];
  const optionTaken = new Set();
  const used = new Set();
  const params = candidates(vars);

  // 1. Switching signal channels (Smart Sensor Profile and look-alikes).
  const channels = switchingChannels(vars);
  const channelInfo = [];
  const roles = new Map();
  const refOf = (variable, item) => item && params.find((p) => p.id === variable.id && p.sub === item.sub);
  const lim = mdc.find((m) => m.lower !== null && m.upper !== null && m.lower < m.upper);
  channels.forEach((ch) => {
    [ch.param, ch.config].filter(Boolean).forEach((v) => params.filter((p) => p.id === v.id).forEach((p) => roles.set(p, { channel: ch, role: "channel" })));
    const mode = ch.mode ? num(ch.mode.default) : null;
    channelInfo.push({ channel: ch.label, index: ch.param.index, mode: mode, logic: ch.logic ? num(ch.logic.default) : null });
    const hint = { role: "switch point" };
    // Switch points compare against the process value: same scale and limits.
    if (measured && measured.scale && measured.single) {
      hint.scale = measured.scale;
      hint.source = measured.source === "mdc" ? "mdc" : "process data " + measured.source;
      hint.preferProfile = measured.source === "mdc";
    }
    if (lim) {
      hint.range = [lim.lower, lim.upper];
      hint.rangeSource = "MDC descriptor limits";
    } else if (measured && measured.single && measured.field.range) {
      hint.range = measured.field.range;
      hint.rangeSource = "process data range";
    }
    const point = (item, label) => ch.label + " " + (item.name && !/^sp\d?$/i.test(item.name.trim()) ? item.name.trim() : "switch point " + label);
    const sp1 = refOf(ch.param, ch.sp1);
    const sp2 = refOf(ch.param, ch.sp2);
    if (sp1) roles.set(sp1, { channel: ch, role: "sp1", hint: Object.assign({}, hint, { name: point(ch.sp1, "SP1") }) });
    // SP2 only matters in window (2) and two-point (3) mode.
    if (sp2) roles.set(sp2, { channel: ch, role: "sp2", active: mode === 2 || mode === 3, hint: Object.assign({}, hint, { name: point(ch.sp2, "SP2") }) });
    const logic = ch.config && refOf(ch.config, ch.logic);
    const modeRef = ch.config && refOf(ch.config, ch.mode);
    const hyst = ch.config && refOf(ch.config, ch.hysteresis);
    if (logic) roles.set(logic, { channel: ch, role: "logic", name: ch.label + " logic" });
    if (modeRef) roles.set(modeRef, { channel: ch, role: "mode", name: ch.label + " mode" });
    if (hyst) roles.set(hyst, { channel: ch, role: "hysteresis", hint: { name: ch.label + " hysteresis", role: "hysteresis" } });
  });

  const strong = (p) => SETTING_STRONG.test(p.id + " " + p.name);
  const span = (p) => SETTING_SPAN.test(p.id + " " + p.name + " " + p.description);
  const weak = (p) => SETTING_WEAK.test(p.id + " " + p.name);
  const hintFor = (p) => {
    const role = roles.get(p);
    if (role) return role.hint || null;
    // Vendor switch points without a scale of their own also follow the process value.
    if (strong(p) && measured && measured.scale && measured.single && !(scaleOf.get(p.id + (p.sub ? "#" + p.sub : "")) || {}).scaled) return { scale: measured.scale, source: "process data " + measured.source, role: "switch point" };
    if (strong(p)) return { role: "switch point" };
    if (span(p)) return { role: "analogue span" };
    return null;
  };
  const addSetting = (p) => {
    const s = makeSetting(p, { scaleOf: scaleOf }, taken, hintFor(p));
    if (!s) return null;
    settings.push(s);
    found.push(p);
    used.add(p);
    return s;
  };
  const addOption = (p) => {
    const role = roles.get(p);
    const o = makeOption(p, optionTaken, role && role.name);
    optionDefs.push(o);
    used.add(p);
    return o;
  };

  if (ctx.select) {
    // Exactly the parameters asked for, by "index" or "index.subindex".
    ctx.select.forEach((ref) => {
      const p = params.find((x) => String(x.index) + (x.sub ? "." + x.sub : "") === String(ref));
      if (!p) throw Error("IODD has no writable parameter " + ref + ".");
      if (p.kind === "option") addOption(p);
      else if (!addSetting(p)) throw Error("IODD parameter " + ref + " has no usable range.");
    });
  } else {
    channels.forEach((ch, n) => {
      params.filter((p) => roles.has(p) && roles.get(p).channel === ch).forEach((p) => used.add(p));
      const mine = (role) => params.find((p) => roles.get(p) && roles.get(p).channel === ch && roles.get(p).role === role);
      if (n > 0 && settings.length >= 4) return;
      const sp1 = mine("sp1");
      const sp2 = mine("sp2");
      // A switch point with neither a range nor a unit tells the studio nothing.
      const useful = (p) => {
        const probe = makeSetting(p, { scaleOf: scaleOf }, new Set(), hintFor(p));
        return probe && !(probe.range_source === "datatype bit length" && probe.unit === "raw");
      };
      const a = sp1 && sp1.kind === "setting" && useful(sp1) ? addSetting(sp1) : null;
      const b = a && sp2 && sp2.kind === "setting" && roles.get(sp2).active ? addSetting(sp2) : null;
      // Two-point mode: SP2 is the lower point of the hysteresis.
      if (a && b && channelInfo[n].mode === 3) b.below = a.key;
      if (n > 0) return;
      const logic = mine("logic");
      const mode = mine("mode");
      const hyst = mine("hysteresis");
      if (logic && logic.kind === "option") addOption(logic);
      if (mode && mode.kind === "option") addOption(mode);
      if (hyst && hyst.kind === "setting" && hyst.item.range) addSetting(hyst);
    });

    // 2. Vendor switch points, analogue span, thresholds.
    const numeric = params.filter((p) => p.kind === "setting" && !used.has(p) && !SETTING_SKIP.test(p.id + " " + p.name));
    const room = Math.max(0, 6 - settings.length);
    let chosen = pickByScore(numeric, (p) => (strong(p) ? 3 : span(p) ? 2 : numeric.filter(strong).length < 2 && weak(p) ? 1 : 0), room);
    if (!chosen.length && !settings.length) {
      chosen = params.filter((p) => p.kind === "setting" && !used.has(p) && p.item.range && !SETTING_SKIP.test(p.id + " " + p.name) && !/\bid\b|identifier|equipment|serial|version|index|number|quality|resolution|measurement count|average/i.test(p.id + " " + p.name)).slice(0, 2);
    }
    chosen.forEach((p) => {
      const s = makeSetting(p, { scaleOf: scaleOf }, taken, hintFor(p));
      if (!s || (s.range_source === "datatype bit length" && s.unit === "raw")) return;
      settings.push(s);
      found.push(p);
      used.add(p);
    });

    // 3. Options.
    const choices = params.filter((p) => p.kind === "option" && !used.has(p) && !OPTION_SKIP.test(p.name + " " + p.id) && p.item.singles.every((v) => v.label));
    let options = pickByScore(choices, (p) => (OPTION_WORDS.test(p.name + " " + p.id + " " + p.item.singles.map((v) => v.label).join(" ")) ? 2 : 0), Math.max(0, 4 - optionDefs.length));
    if (!options.length && !optionDefs.length) options = choices.slice(0, 2);
    options.forEach(addOption);
  }
  linkBelow(settings, found);

  // 4. Category: profile and units first, words second.
  const pdIn = pdItems(pdRaw.in, scaleOf, measured);
  const pdOut = pdItems(pdRaw.out, scaleOf, null, true);
  const kinds = [];
  const addKind = (code) => {
    const info = unitInfo(code);
    if (info && info.kind && !kinds.includes(info.kind)) kinds.push(info.kind);
  };
  // The main switch point's own unit (menu or MDC) says what the sensor switches on.
  const mainPoint = settings.find((x) => x.role === "switch point");
  if (mainPoint && mainPoint.quantity && (mainPoint.unit_source === "menu" || mainPoint.unit_source === "mdc")) addKind(Number(Object.keys(UNITS).find((c) => UNITS[c].abbr === mainPoint.unit)));
  mdc.forEach((m) => addKind(m.unitCode));
  if (measured && measured.scale) addKind(measured.scale.unitCode);
  pdRaw.in && pdRaw.in.fields.forEach((f) => {
    const s = scaleFor(scaleOf, pdRaw.in.id, f.sub);
    if (s) addKind(s.unitCode);
  });
  settings.filter((s) => s.role === "switch point").forEach((s) => s.quantity && !kinds.includes(s.quantity) && kinds.push(s.quantity));
  if (ctx.debugWords) ctx.debugWords([part, variantName, deviceName, family, description, productText].join(" "), kinds);
  const category = categoryOf([part, variantName, deviceName, family, description, productText].join(" "), kinds, pdIn.bits, pdOut.bits);

  const physical = findAll(root(doc), "PhysicalLayer")[0];
  const minCycle = num(physical && physical.attrs.minCycleTime);
  const vendorId = num(identity.vendorId) !== null ? num(identity.vendorId) : num(ctx.vendorId);
  const deviceId = num(identity.deviceId);
  const file = ctx.file || "";
  const phrase = description || [variantName || part, family && "family " + family].filter(Boolean).join(", ");

  const iodd = {
    file: file,
    iodd_finder_id: ctx.ioddId,
    min_cycle_ms: minCycle === null ? null : tidy(minCycle / 1000),
    // IODD 1.0.1 spells it "baudrate".
    bitrate: (physical && (physical.attrs.bitrate || physical.attrs.baudrate)) || null,
    pd_in_bits: pdIn.bits,
    pd_in: pdIn.items,
    pd_out_bits: pdOut.bits,
    pd_out: pdOut.items,
  };
  if (profiles.length || channelInfo.length || mdc.length) {
    iodd.profile = {
      ids: profiles.map((p) => ({ id: "0x" + p.id.toString(16).padStart(4, "0"), name: p.name })),
      switching_channels: channelInfo,
      mdc: mdc.map((m) => ({ index: m.index, lower: m.lower, upper: m.upper, unit: m.unitCode === null ? null : unitName(m.unitCode), scale: m.scale })),
    };
  }
  if (measured) {
    iodd.process_value = { name: measured.field.name, unit: measured.scale && measured.scale.unitCode !== null && measured.scale.unitCode !== undefined ? unitName(measured.scale.unitCode) : "raw", unit_source: measured.source || "raw" };
  }

  return {
    id: "iodd-" + ctx.vendorId + "-" + ctx.ioddId,
    kind: "sensor",
    source_kind: "iodd",
    converter_version: CONVERTER_VERSION,
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
    iodd: iodd,
  };
}

function optionsOf(opts) {
  const o = opts || {};
  if (o.vendorId === undefined || o.ioddId === undefined) throw Error("partFromIodd needs { vendorId, ioddId }.");
  return o;
}

function stripPrefixes(node) {
  if (node && node.type === "element") {
    node.name = node.name.replace(/^[A-Za-z_][\w.-]*:/, "");
    (node.children || []).forEach(stripPrefixes);
  }
  return node;
}

function parseIodd(xml) {
  // Some packages start with a byte order mark or blank lines before the declaration.
  // Processing instructions after the declaration (xml-stylesheet) are not part of the model.
  const doc = parseXml(String(xml).replace(/^\uFEFF/, "").replace(/^\s+(?=<\?xml)/, "").replace(/<\?(?!xml\s)[\s\S]*?\?>\s*/g, ""));
  (doc.children || []).forEach(stripPrefixes);
  if (!root(doc) || root(doc).name !== "IODevice") throw Error("Not an IODD: root element must be IODevice.");
  return doc;
}

export function partFromIoddXml(xmlString, opts) {
  const ctx = Object.assign({}, optionsOf(opts));
  return convert(parseIodd(xmlString), ctx);
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
    if (f === main || !/<(?:[A-Za-z_][\w.-]*:)?ExternalTextDocument/.test(f.xml)) return;
    try {
      const top = stripPrefixes(root(parseXml(f.xml.replace(/^\uFEFF/, "").replace(/^\s+(?=<\?xml)/, ""))));
      const language = path(top, "Language");
      if (language && langOf(language).slice(0, 2) === "en") elements(language, "Text").forEach((t) => english.push({ id: t.attrs.id, value: t.attrs.value }));
    } catch (error) {
      // A broken translation file does not stop the conversion.
    }
  });
  ctx.texts = english;
  ctx.file = main.name.split("/").pop();
  return convert(parseIodd(main.xml), ctx);
}
