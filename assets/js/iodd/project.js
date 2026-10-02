import * as advanced from "./extensions.js";
import * as d from "./document.js";
import { verifyStampCrc } from "./vendor/checker/crc.mjs";
import { root, walk, path } from "./vendor/model/tree.js";
export const LIMITS = {
  xml: 4 * 1024 * 1024,
  total: 16 * 1024 * 1024,
  files: 128,
};
const encoder = new TextEncoder();
export function validateName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 240 ||
    name.normalize("NFC") !== name ||
    /[\\\x00-\x1f\x7f:]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw Error("Invalid package file name or path.");
  return name;
}
export function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(LIMITS.total / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw Error("Invalid or oversized base64 asset.");
  const raw = atob(value);
  if (btoa(raw) !== value) throw Error("Noncanonical base64 asset.");
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export function encodeBase64(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 16384)
    raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(raw);
}
function check(project) {
  if (
    !project ||
    project.format !== "iolinki-iodd-project" ||
    project.version !== 1 ||
    typeof project.xml !== "string" ||
    !Array.isArray(project.assets)
  )
    throw Error("Unsupported IODD project format or version.");
  if (
    project.appliedProfiles !== undefined &&
    (!Array.isArray(project.appliedProfiles) ||
      project.appliedProfiles.length > 64 ||
      project.appliedProfiles.some(
        (n) =>
          typeof n.profileId !== "string" ||
          typeof n.requiredProfiles !== "string",
      ))
  )
    throw Error("Invalid applied profile metadata.");
  if (project.rules !== undefined) advanced.checkRules(project.rules);
  if (
    project.profiles !== undefined &&
    (!Array.isArray(project.profiles) || project.profiles.length > 16)
  )
    throw Error("Use at most 16 profile packs.");
  if (project.profiles) {
    let size = 0;
    for (const pack of project.profiles) {
      size += encoder.encode(pack.xml).length;
      advanced.profileView(pack);
    }
    if (size > 8 * 1024 * 1024) throw Error("Profile packs exceed 8 MiB.");
  }
  if (
    (project.profiles || project.rules) &&
    encoder.encode(JSON.stringify(project)).length > 24 * 1024 * 1024
  )
    throw Error("Project JSON exceeds the 24 MiB limit.");
  validateName(project.filename);
  if (!/\.xml$/i.test(project.filename))
    throw Error("Main document filename must end in .xml.");
  if (project.assets.length + 1 > LIMITS.files)
    throw Error("Package exceeds 128 files.");
  let total = encoder.encode(project.xml).length;
  const names = new Set([project.filename.toLowerCase()]);
  for (const asset of project.assets) {
    validateName(asset.name);
    const key = asset.name.toLowerCase();
    if (names.has(key)) throw Error("Duplicate package file name.");
    names.add(key);
    total += decodeBase64(asset.base64).length;
    if (total > LIMITS.total)
      throw Error("Project exceeds the 16 MiB expanded limit.");
  }
  if (total > LIMITS.total)
    throw Error("Project exceeds the 16 MiB expanded limit.");
  d.importXML(project.xml);
  return project;
}
export function createNewProject(identity = {}, filename = "new-device.xml") {
  const project = createProject(advanced.newDeviceXML(), filename);
  return applyOperation(project, {
    type: "identity",
    values: { releaseDate: new Date().toISOString().slice(0, 10), ...identity },
  });
}
export function createProject(xml, filename = "device.xml") {
  const project = {
    format: "iolinki-iodd-project",
    version: 1,
    filename,
    xml,
    assets: [],
  };
  check(project);
  return project;
}
export function loadProject(json) {
  if (typeof json === "string") {
    if (encoder.encode(json).length > 24 * 1024 * 1024)
      throw Error("Project JSON exceeds size limit.");
    json = JSON.parse(json);
  }
  return structuredClone(check(json));
}
export function saveProject(project) {
  check(project);
  return JSON.stringify(project, null, 2) + "\n";
}
export function missingAssets(project) {
  const directory = project.filename.includes("/")
    ? project.filename.slice(0, project.filename.lastIndexOf("/") + 1)
    : "";
  const available = new Set(project.assets.map((a) => a.name)),
    referenced = [];
  for (const node of walk(root(d.importXML(project.xml)))) {
    if (node.name === "VendorLogo" && node.attrs.name)
      referenced.push(node.attrs.name);
    if (node.attrs.connectionSymbol)
      referenced.push(node.attrs.connectionSymbol);
    if (node.attrs.deviceIcon) referenced.push(node.attrs.deviceIcon);
    if (node.attrs.deviceSymbol) referenced.push(node.attrs.deviceSymbol);
  }
  return [
    ...new Set(
      referenced
        .map((name) => directory + name)
        .filter((name) => !available.has(name)),
    ),
  ];
}
function externalLanguages(project) {
  const languages = [];
  for (const asset of project.assets) {
    if (!/\.xml$/i.test(asset.name)) continue;
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64(asset.base64),
    );
    if (!/<ExternalTextDocument(?:\s|>)/.test(xml)) continue;
    const doc = d.importTextXML(xml);
    languages.push({ ...d.getExternalTexts(doc), asset: asset.name, doc });
  }
  return languages;
}
export function inspectDocumentTree(project) {
  check(project);
  return structuredClone(root(d.importXML(project.xml)));
}
export function inspectElements(xml) {
  return advanced.inspectElementsXML(xml);
}
export function exportElements(project, selectors) {
  check(project);
  return advanced.exportElementsXML(d.importXML(project.xml), selectors);
}
export function inspectProject(project) {
  check(project);
  const doc = d.importXML(project.xml);
  return {
    communication: advanced.communicationView(doc),
    profiles: (project.profiles ?? []).map(advanced.profileView),
    rules: structuredClone(project.rules ?? []),
    identity: d.getIdentity(doc),
    variables: d.getVariables(doc),
    processData: d.getProcessData(doc),
    texts: [
      ...d.getTexts(doc),
      ...externalLanguages(project).map(({ doc, ...language }) => language),
    ],
    events: d.getEvents(doc),
    menus: d.getMenus(doc),
    assets: project.assets.map((a) => ({
      name: a.name,
      size: decodeBase64(a.base64).length,
    })),
  };
}
export function applyOperation(project, operation) {
  check(project);
  if (!operation || typeof operation.type !== "string")
    throw Error("An operation type is required.");
  const copy = structuredClone(project),
    doc = d.importXML(copy.xml),
    v = operation.values ?? {};
  switch (operation.type) {
    case "tree":
      advanced.editTree(doc, operation);
      break;
    case "importElements":
      advanced.importElementsInto(doc, operation);
      break;
    case "communication":
      advanced.editCommunication(doc, operation);
      break;
    case "validationRules":
      advanced.checkRules(operation.rules);
      copy.rules = structuredClone(operation.rules);
      break;
    case "profile": {
      copy.profiles ??= [];
      if ((operation.action ?? "load") === "load")
        copy.profiles.push(advanced.loadProfile(copy.profiles, operation));
      else if (operation.action === "apply") {
        const pack = copy.profiles.find((n) => n.id === operation.id);
        if (!pack) throw Error("Unknown loaded profile pack.");
        const applied = advanced.applyProfile(doc, pack, operation);
        copy.appliedProfiles ??= [];
        copy.appliedProfiles.push(applied);
      } else throw Error("Profile action must be load or apply.");
      break;
    }

    case "identity":
      d.editIdentity(doc, v);
      break;
    case "addVariable": {
      const id = d.addVariable(doc),
        existing = d.getVariables(doc).find((n) => n.id === id);
      if (v.id !== undefined && v.id !== id) {
        if (
          !/^[A-Za-z][A-Za-z0-9 _-]*[A-Za-z0-9]$/.test(v.id) ||
          [...walk(root(doc))].some((n) => n.attrs.id === v.id)
        )
          throw Error("Invalid or duplicate variable ID.");
        [...walk(root(doc))].find((n) => n.attrs.id === id).attrs.id = v.id;
      }
      d.editVariable(doc, v.id ?? id, { ...existing, ...v });
      break;
    }
    case "editVariable": {
      const existing = d.getVariables(doc).find((n) => n.id === operation.id);
      if (!existing) throw Error("Unknown variable.");
      d.editVariable(doc, operation.id, { ...existing, ...v });
      break;
    }
    case "removeVariable":
      if (!d.getVariables(doc).some((n) => n.id === operation.id))
        throw Error("Unknown variable.");
      d.removeVariable(doc, operation.id);
      break;
    case "editProcessField": {
      const existing = d.getProcessData(doc).find((n) => n.id === operation.id)
        ?.fields[operation.index];
      if (!Number.isInteger(operation.index) || !existing)
        throw Error("Unknown process field.");
      d.editProcessField(doc, operation.id, operation.index, {
        ...existing,
        ...v,
      });
      break;
    }
    case "addProcessField":
      d.addProcessField(doc, operation.id, v);
      break;
    case "removeProcessField":
      d.removeProcessField(doc, operation.id, operation.index);
      break;
    case "text": {
      const external = externalLanguages(copy).filter(
        (n) => n.language === operation.language,
      );
      const internal = d
        .getTexts(doc)
        .some((n) => n.language === operation.language);
      if (external.length > 1 || (external.length && internal))
        throw Error(
          "Ambiguous internal/external language; resolve duplicate languages first.",
        );
      if (external.length) {
        if (
          !d
            .getTexts(doc)
            .find((n) => n.primary)
            ?.texts.some((n) => n.id === operation.id)
        )
          throw Error("Translations need an existing primary text ID.");
        d.editExternalText(external[0].doc, operation.id, operation.value);
        copy.assets.find((a) => a.name === external[0].asset).base64 =
          encodeBase64(
            encoder.encode(
              d.exportXML(external[0].doc, {
                mainIoddCrc: verifyStampCrc(encoder.encode(d.exportXML(doc)))
                  .stored,
              }),
            ),
          );
      } else d.editText(doc, operation.language, operation.id, operation.value);
      break;
    }
    case "event":
      d.editEvent(doc, v);
      break;
    case "removeEvent":
      d.removeEvent(doc, operation.code);
      break;
    case "menu":
      d.editMenu(doc, v);
      break;
    case "removeMenu":
      d.removeMenu(doc, operation.id);
      break;
    case "asset": {
      validateName(operation.name);
      decodeBase64(operation.base64);
      const index = copy.assets.findIndex((n) => n.name === operation.name);
      const asset = { name: operation.name, base64: operation.base64 };
      if (index < 0) copy.assets.push(asset);
      else copy.assets[index] = asset;
      check(copy);
      return copy;
    }
    case "removeAsset": {
      const index = copy.assets.findIndex((n) => n.name === operation.name);
      if (index < 0) throw Error("Unknown asset.");
      copy.assets.splice(index, 1);
      return copy;
    }
    default:
      throw Error("Unsupported operation: " + operation.type);
  }
  copy.xml = d.previewXML(doc);
  check(copy);
  return copy;
}
export function validateProject(project, options = {}) {
  const coverage = {
    basic: true,
    model: true,
    crc: true,
    assets: true,
    xsd: false,
    official: false,
  };
  try {
    check(project);
    const doc = d.importXML(project.xml),
      issues = d.validateDocument(doc),
      missing = missingAssets(project),
      primary = d.getTexts(doc).find((n) => n.primary);
    const languages = new Set(d.getTexts(doc).map((n) => n.language));
    const mainCRC = (() => {
      try {
        return verifyStampCrc(encoder.encode(project.xml)).stored;
      } catch {
        return null;
      }
    })();
    for (const external of externalLanguages(project)) {
      try {
        const bytes = decodeBase64(
          project.assets.find((a) => a.name === external.asset).base64,
        );
        if (
          mainCRC === null ||
          !verifyStampCrc(bytes, { mainIoddCrc: mainCRC }).valid
        )
          issues.push({
            severity: "warning",
            message: `External language CRC for ${external.asset} will be refreshed in the ZIP export.`,
          });
      } catch {
        issues.push({
          severity: "warning",
          message: `External language CRC stamp for ${external.asset} will be created in the ZIP export.`,
        });
      }

      if (languages.has(external.language))
        issues.push({
          severity: "error",
          message:
            "Duplicate internal/external language " + external.language + ".",
        });
      languages.add(external.language);
      const ids = new Set();
      for (const text of external.texts) {
        if (ids.has(text.id))
          issues.push({
            severity: "error",
            message: "Duplicate external text ID " + text.id + ".",
          });
        ids.add(text.id);
        if (!primary?.texts.some((n) => n.id === text.id))
          issues.push({
            severity: "error",
            message: "Translation has no primary text: " + text.id + ".",
          });
      }
    }
    issues.push(...advanced.ruleIssues(doc, project.rules ?? []));
    const presentProfiles = new Set(
      (
        path(root(doc), "ProfileBody", "DeviceFunction", "Features")?.attrs
          .profileCharacteristic ?? ""
      ).split(/\s+/),
    );
    for (const applied of project.appliedProfiles ?? [])
      for (const required of applied.requiredProfiles
        .split(/[,\s]+/)
        .filter(Boolean))
        if (!presentProfiles.has(required))
          issues.push({
            severity: "warning",
            message:
              "Profile " +
              applied.profileId +
              " also requires profile " +
              required +
              ". Import its official definitions before release.",
          });
    function group(issue) {
      if (issue.check) return issue.check;
      const m = issue.message;
      if (/CRC/i.test(m)) return "crc";
      if (/package asset/i.test(m)) return "assets";
      if (
        /Unresolved|Duplicate ID|text ID|Translation|language|Menu .*referenced/i.test(
          m,
        )
      )
        return "references";
      if (
        /process-data|Process-data|record|subindex|field|datatype size/i.test(m)
      )
        return "processData";
      if (/parameter|variable index|Index|Default|bound|range/i.test(m))
        return "ranges";
      return "structure";
    }
    for (const name of missing)
      issues.push({
        severity: "warning",
        message: "Missing package asset: " + name + ".",
      });
    const checks = {
      structure: true,
      references: true,
      ranges: true,
      processData: true,
      crc: true,
      assets: true,
      rules: true,
      ...options.checks,
    };
    const selectedIssues = issues.filter(
      (issue) => checks[group(issue)] !== false,
    );
    coverage.checks = checks;
    return {
      packageValid:
        missing.length === 0 && !issues.some((n) => n.severity === "error"),
      valid: !selectedIssues.some((n) => n.severity === "error"),
      issues: selectedIssues,
      coverage,
    };
  } catch (error) {
    return {
      valid: false,
      packageValid: false,
      issues: [{ severity: "error", message: error.message }],
      coverage,
    };
  }
}
export function exportProjectXML(project) {
  const result = validateProject(project);
  if (!result.valid)
    throw Error(
      result.issues
        .filter((n) => n.severity === "error")
        .map((n) => n.message)
        .join(" "),
    );
  return d.exportXML(d.importXML(project.xml));
}
function symbol(value) {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
}
export function generateFirmwareHeader(project) {
  exportProjectXML(project);
  const view = inspectProject(project),
    lines = [
      "/* Generated IODD mapping. Bit offsets follow IODD; serialize wire bytes explicitly. */",
      "#ifndef IOLINKI_IODD_MAPPING_H",
      "#define IOLINKI_IODD_MAPPING_H",
      "#include <stdint.h>",
      "#include <stddef.h>",
      `#define IODD_VENDOR_ID ${Number(view.identity.vendorId)}u`,
      `#define IODD_DEVICE_ID ${Number(view.identity.deviceId)}u`,
    ];
  const used = new Set();
  function define(name, value) {
    if (used.has(name)) throw Error("Firmware symbol collision: " + name);
    used.add(name);
    lines.push(`#define ${name} ${Number(value)}u`);
  }
  for (const variable of view.variables)
    define("IODD_" + symbol(variable.id) + "_INDEX", variable.index);
  for (const pd of view.processData) {
    define("IODD_" + symbol(pd.id) + "_BITS", pd.bits);
    define("IODD_" + symbol(pd.id) + "_BYTES", Math.ceil(Number(pd.bits) / 8));
    for (const f of pd.fields) {
      if (!f.bits || !f.offset) {
        if (f.offset !== "0")
          throw Error(
            "Firmware mapping requires supported process field datatypes.",
          );
      }
      if (!f.bits)
        throw Error(
          "Firmware mapping requires supported process field datatypes.",
        );
      const prefix = "IODD_" + symbol(pd.id) + "_FIELD_" + f.subindex;
      define(prefix + "_SUBINDEX", f.subindex);
      define(prefix + "_OFFSET", f.offset);
      define(prefix + "_BITS", f.bits);
    }
  }
  lines.push(`/* Byte 0 is most significant. Offset 0 is bit 0 of the final byte.
 * Callers use the *_BYTES, *_OFFSET and *_BITS constants above.
 * Bounds failures return 0; no packed C structs or host endianness assumptions. */
static inline uint64_t iodd_read_bits(const uint8_t *data, size_t bytes, unsigned offset, unsigned bits) {
  uint64_t value = 0;
  if (!data || bits > 64u || offset > bytes * 8u || bits > bytes * 8u - offset) return 0;
  for (unsigned i = 0; i < bits; ++i) {
    unsigned position = offset + i;
    value |= (uint64_t)((data[bytes - 1u - position / 8u] >> (position % 8u)) & 1u) << i;
  }
  return value;
}
static inline int iodd_write_bits(uint8_t *data, size_t bytes, unsigned offset, unsigned bits, uint64_t value) {
  if (!data || bits > 64u || offset > bytes * 8u || bits > bytes * 8u - offset) return 0;
  for (unsigned i = 0; i < bits; ++i) {
    unsigned position = offset + i;
    size_t byte = bytes - 1u - position / 8u;
    uint8_t mask = (uint8_t)(1u << (position % 8u));
    data[byte] = (uint8_t)((data[byte] & (uint8_t)~mask) | (((value >> i) & 1u) ? mask : 0u));
  }
  return 1;
}`);
  return lines.join("\n") + "\n#endif\n";
}
export function diffProjects(before, after) {
  const a = inspectProject(before),
    b = inspectProject(after),
    changes = [];
  function compare(old, next, path) {
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    if (
      old &&
      next &&
      typeof old === "object" &&
      typeof next === "object" &&
      !Array.isArray(old) &&
      !Array.isArray(next)
    ) {
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)]))
        compare(old[key], next[key], path ? path + "." + key : key);
    } else changes.push({ path, before: old ?? null, after: next ?? null });
  }
  compare(a, b, "");
  if (
    !changes.length &&
    d.previewXML(d.importXML(before.xml)) !==
      d.previewXML(d.importXML(after.xml))
  )
    changes.push({
      path: "xml",
      before: "previous document",
      after: "updated document",
    });
  if (before.filename !== after.filename)
    changes.push({
      path: "filename",
      before: before.filename,
      after: after.filename,
    });
  for (const asset of after.assets) {
    const old = before.assets.find((n) => n.name === asset.name);
    if (old && old.base64 !== asset.base64)
      changes.push({
        path: "assets." + asset.name + ".content",
        before: "changed",
        after: "changed",
      });
  }
  const mapping = (v) => ({
    vendorId: Number(v.identity.vendorId),
    deviceId: Number(v.identity.deviceId),
    variables: v.variables.map((n) => ({
      id: n.id,
      index: Number(n.index),
      type: n.type,
      bits: Number(n.bits),
      access: n.access,
    })),
    processData: v.processData.map((n) => ({
      id: n.id,
      direction: n.direction,
      bits: Number(n.bits),
      fields: n.fields.map((f) => ({
        subindex: Number(f.subindex),
        offset: Number(f.offset),
        bits: Number(f.bits),
        type: f.type,
      })),
    })),
  });
  const compatible = JSON.stringify(mapping(a)) === JSON.stringify(mapping(b));
  return {
    changes,
    mappingCompatible: compatible,
    diagnostics: compatible
      ? []
      : [
          {
            severity: "warning",
            message:
              "Firmware indexes, identity or process bit layout changed. Update the firmware mapping before release.",
          },
        ],
  };
}
