"use strict";

// Library layering: an IODD-ingested part plus a small override file.
//
// The IODD gives the limits, factory defaults, units, process data and the raw
// write coordinates. An override (studio/library/ingest/<id>.json) only adds what
// the IODD cannot know: datasheet facts (part name, power, correction factors,
// size, job words), which IODD parameters the studio shows and under which key,
// and, each with its source, a narrower datasheet range, a scale for a value the
// IODD leaves unscaled, or a studio default. Nothing here may widen an IODD
// range: applyOverrides throws instead.

const LENGTH_MM = { "µm": 0.001, mm: 1, cm: 10, m: 1000, in: 25.4 };
const DATASHEET_FIELDS = ["category", "part", "vendor", "in_catalog", "measures", "source_url", "source", "job_words", "refused", "correction", "port_class", "connector", "size_mm"];

function tidy(value) {
  return Number(Number(value).toPrecision(10));
}

function fail(id, text) {
  throw Error(id + ": " + text);
}

function refOf(entry) {
  return String(entry.iodd_index || "").split(" ")[0];
}

// Re-express a setting in another unit of the same length kind (cm -> mm).
function convertUnit(setting, unit, id) {
  const from = LENGTH_MM[setting.unit];
  const to = LENGTH_MM[unit];
  if (!from || !to) fail(id, "cannot convert " + setting.key + " from " + setting.unit + " to " + unit + ".");
  const k = from / to;
  const scaled = (v) => (v === null || v === undefined ? v : tidy(v * k));
  setting.min = scaled(setting.min);
  setting.max = scaled(setting.max);
  setting.default = scaled(setting.default);
  setting.scale = { gradient: tidy(setting.scale.gradient * k), offset: tidy(setting.scale.offset * k) };
  setting.write = Object.assign({}, setting.write, { gradient: setting.scale.gradient, offset: setting.scale.offset });
  setting.unit = unit;
}

// A scale for a value the IODD leaves raw, from two datasheet anchor points.
function scaleFrom(spec, id, key) {
  if (!spec.source) fail(id, key + ": a scale needs a source.");
  const [r1, r2] = spec.raw;
  const [v1, v2] = spec.real;
  if (r1 === r2) fail(id, key + ": scale anchors must differ.");
  const gradient = (v2 - v1) / (r2 - r1);
  return { exact: { gradient: gradient, offset: v1 - r1 * gradient }, gradient: tidy(gradient), offset: tidy(v1 - r1 * gradient), unit: spec.unit, source: spec.source };
}

function applyScale(setting, scale) {
  const w = setting.write;
  const at = (raw) => Number((raw * scale.exact.gradient + scale.exact.offset).toPrecision(9));
  const ends = [at(w.raw_min), at(w.raw_max)].sort((a, b) => a - b);
  const rawDefault = setting.default === null ? null : (setting.default - setting.scale.offset) / setting.scale.gradient;
  setting.min = ends[0];
  setting.max = ends[1];
  setting.default = rawDefault === null ? null : at(rawDefault);
  setting.unit = scale.unit;
  setting.scale = { gradient: scale.gradient, offset: scale.offset };
  setting.write = Object.assign({}, w, { gradient: scale.gradient, offset: scale.offset });
  setting.unit_source = "override";
  setting.scale_source = scale.source;
}

function settingFrom(ingested, spec, id, report) {
  if (spec.datasheet) {
    if (!spec.source) fail(id, "datasheet-only setting " + spec.key + " needs a source.");
    const out = Object.assign({}, spec);
    delete out.datasheet;
    out.write = null;
    out.source_kind = "datasheet";
    report.push({ key: spec.key, field: "setting", iodd: "not in the IODD as a scaled parameter", library: spec.min + "–" + spec.max + " " + spec.unit, why: spec.source });
    return out;
  }
  const base = ingested.settings.find((s) => refOf(s) === String(spec.iodd));
  if (!base) fail(id, "the IODD conversion has no setting " + spec.iodd + ".");
  const setting = JSON.parse(JSON.stringify(base));
  const iodd = { min: setting.min, max: setting.max, default: setting.default, unit: setting.unit };
  if (spec.scale) {
    if (setting.unit !== "raw") fail(id, spec.key + ": the IODD already scales " + spec.iodd + " (" + setting.unit + "); drop the override scale.");
    applyScale(setting, scaleFrom(spec.scale, id, spec.key));
  }
  if (spec.unit && spec.unit !== setting.unit) convertUnit(setting, spec.unit, id);
  const scaled = { min: setting.min, max: setting.max, default: setting.default, unit: setting.unit };
  if (spec.key) setting.key = spec.key;
  if (spec.name) setting.name = spec.name;
  if (spec.corrected) setting.corrected = true;
  if (spec.min !== undefined || spec.max !== undefined) {
    if (!spec.limit_source) fail(id, setting.key + ": a narrower range needs limit_source.");
    const min = spec.min !== undefined ? spec.min : setting.min;
    const max = spec.max !== undefined ? spec.max : setting.max;
    // Rounding in a datasheet-anchored scale is the only slack allowed.
    const slack = spec.scale ? 1e-6 * Math.max(1, Math.abs(setting.max - setting.min)) : 0;
    if (min < setting.min - slack || max > setting.max + slack) fail(id, setting.key + ": " + min + "–" + max + " is wider than the IODD range " + setting.min + "–" + setting.max + " " + setting.unit + ".");
    setting.min = min;
    setting.max = max;
    setting.limit_source = spec.limit_source;
  }
  if (spec.default !== undefined) {
    if (!/studio default/i.test(spec.default_source || "")) fail(id, setting.key + ": only a default marked as a studio default may replace the IODD factory default.");
    setting.default = spec.default;
    setting.default_source = spec.default_source;
  }
  if (setting.default !== null && (setting.default < setting.min || setting.default > setting.max)) {
    setting.default = null;
    setting.default_source = "IODD factory default is outside the datasheet range";
  }
  // IODD relations (rP below SP) are remapped to the studio keys in applyOverrides.
  Object.defineProperty(setting, "ingested", { value: { key: base.key, below: base.below }, enumerable: false });
  if (spec.below) setting.below = spec.below;
  else delete setting.below;
  report.push({ key: setting.key, field: "setting", iodd: iodd, scaled: spec.scale || spec.unit ? scaled : null, library: { min: setting.min, max: setting.max, default: setting.default, unit: setting.unit }, why: [spec.scale && spec.scale.source, spec.limit_source, spec.default_source].filter(Boolean).join(" | ") });
  return setting;
}

function optionFrom(ingested, spec, id, report) {
  if (spec.datasheet) {
    if (!spec.source) fail(id, "datasheet-only option " + spec.key + " needs a source.");
    const out = Object.assign({}, spec);
    delete out.datasheet;
    out.write = null;
    out.source_kind = "datasheet";
    report.push({ key: spec.key, field: "option", iodd: "not a writable IODD parameter", library: spec.values.join(" / "), why: spec.source });
    return out;
  }
  const base = ingested.options.find((o) => refOf(o) === String(spec.iodd));
  if (!base) fail(id, "the IODD conversion has no option " + spec.iodd + ".");
  const option = JSON.parse(JSON.stringify(base));
  if (spec.values) {
    // Relabel IODD values; values left out are not offered (a narrower choice).
    const keep = option.values.map((label, i) => [label, option.raw[i]]).filter(([label]) => spec.values[label] !== undefined);
    if (!keep.length) fail(id, option.key + ": no IODD value matches the override labels.");
    const factory = option.default;
    option.values = keep.map(([label]) => spec.values[label]);
    option.raw = keep.map(([, raw]) => raw);
    option.default = spec.values[factory] !== undefined ? spec.values[factory] : null;
    if (option.default === null) option.default_source = "IODD factory value is not offered by the studio";
  }
  if (spec.key) option.key = spec.key;
  if (spec.name) option.name = spec.name;
  if (spec.aliases) option.aliases = spec.aliases;
  if (spec.default !== undefined) {
    if (!/studio default/i.test(spec.default_source || "")) fail(id, option.key + ": only a default marked as a studio default may replace the IODD factory default.");
    option.default = spec.default;
    option.default_source = spec.default_source;
  }
  report.push({ key: option.key, field: "option", iodd: base.values.join(" / ") + " (factory " + base.default + ")", library: option.values.join(" / ") + " (default " + option.default + ")", why: spec.values ? "relabelled IODD values" : "" });
  return option;
}

// ingested: the converter's part for the override's IODD (all referenced
// parameters selected). Returns { def, report }.
function applyOverrides(ingested, override) {
  const id = override.id;
  const report = [];
  const def = { id: id, kind: "sensor" };
  const sheet = override.datasheet || {};
  def.category = sheet.category || ingested.category;
  if (sheet.category && sheet.category !== ingested.category) report.push({ key: "category", field: "category", iodd: ingested.category, library: sheet.category, why: "datasheet override" });
  def.part = sheet.part || ingested.part;
  def.vendor = sheet.vendor || ingested.vendor;
  def.vendor_id = ingested.vendor_id;
  def.device_id = ingested.device_id;
  DATASHEET_FIELDS.filter((field) => !["category", "part", "vendor", "correction", "port_class", "connector", "size_mm"].includes(field)).forEach((field) => {
    if (sheet[field] !== undefined) def[field] = sheet[field];
  });
  def.settings = (override.settings || []).map((spec) => settingFrom(ingested, spec, id, report));
  def.options = (override.options || []).map((spec) => optionFrom(ingested, spec, id, report));
  ["correction", "port_class", "connector", "size_mm"].forEach((field) => {
    def[field] = sheet[field] !== undefined ? sheet[field] : ingested[field];
    if (def[field] === undefined) delete def[field];
  });
  def.iodd = JSON.parse(JSON.stringify(ingested.iodd));
  // A datasheet scale for raw switch points is the scale of the process value they compare against.
  const scaled = def.settings.find((s) => s.role === "switch point" && s.unit_source === "override");
  const pv = def.iodd.process_value;
  if (scaled && pv && pv.unit === "raw") {
    const item = def.iodd.pd_in.find((f) => f.name === pv.name);
    if (item) {
      item.gradient = scaled.scale.gradient;
      if (scaled.scale.offset) item.offset = scaled.scale.offset;
      item.unit = scaled.unit;
    }
    pv.unit = scaled.unit;
    pv.unit_source = "override (see " + scaled.key + " scale_source)";
  }
  def.ingest = {
    iodd: override.iodd.file,
    converter_version: ingested.converter_version,
    overrides: "studio/library/ingest/" + id + ".json",
  };
  def.settings.forEach((s) => {
    const from = s.ingested && s.ingested.below && def.settings.find((o) => o.ingested && o.ingested.key === s.ingested.below);
    if (!s.below && from) s.below = from.key;
  });
  const keys = new Set(def.settings.map((s) => s.key));
  def.settings.forEach((s) => {
    if (s.below && !keys.has(s.below)) fail(id, s.key + " is below " + s.below + ", which is not a studio setting.");
  });
  return { def: def, report: report };
}

// The IODD references an override needs from the converter, in order.
function selectionOf(override) {
  return (override.settings || []).concat(override.options || []).filter((entry) => !entry.datasheet).map((entry) => String(entry.iodd));
}

module.exports = { applyOverrides, selectionOf };
