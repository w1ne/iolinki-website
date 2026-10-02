// Original IOLFW1.0 implementation from released IO-Link FW-Update V1.2.1 §7.4.
// Official schemas/examples are independently used for local verification only.
import { zipSync } from "./vendor/fflate.js";
import { Crc32 } from "./vendor/checker/crc.mjs";
import { readPackageFiles } from "./package.js";
import { validateName, LIMITS } from "./project.js";
const NS = "http://www.io-link.com/iolfw/2016";
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_TEXT = 4096;
function text(value, label, { empty = false, max = MAX_TEXT } = {}) {
  if (
    typeof value !== "string" ||
    (!empty && !value.length) ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    throw Error(`${label} must be valid text of at most ${max} characters.`);
  return value;
}
function integer(value, label, min, max) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw Error(`${label} must be an integer from ${min} to ${max}.`);
  return Number(value);
}
function flat(name, resource = false) {
  validateName(name);
  if (name.includes("/") || (resource && !/^[a-zA-Z\d_.-]+$/.test(name)))
    throw Error(
      "IOLFW file names must be flat; binary/resource names use letters, digits, underscore, dot and hyphen.",
    );
  return name;
}
function date(value) {
  text(value, "Release date");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw Error("Release date must be a valid YYYY-MM-DD date.");
  return value;
}
function localized(values, label) {
  if (!Array.isArray(values) || values.length > 128)
    throw Error(`${label} must be an array of at most 128 entries.`);
  const used = new Set();
  return values.map((v) => {
    if (!/^[a-z]{2}$/.test(v.lang) || used.has(v.lang))
      throw Error(`${label} needs unique two-letter lowercase language codes.`);
    used.add(v.lang);
    return {
      lang: v.lang,
      description: text(v.description, label, { empty: true }),
    };
  });
}
function normalize(m) {
  if (!m || typeof m !== "object")
    throw Error("Firmware metadata is required.");
  const out = {
    vendorId: integer(m.vendorId, "vendorId", 1, 65535),
    vendorName: text(m.vendorName, "Vendor name", { max: 100 }),
    firmwareDescriptor: text(m.firmwareDescriptor, "Firmware descriptor", {
      max: 100,
    }),
    releaseDate: date(m.releaseDate),
    version: text(m.version, "Document version", { max: 64 }),
    copyright: text(m.copyright, "Copyright", { empty: true }),
    fwRevision: text(m.fwRevision, "Firmware revision", { max: 64 }),
    binaryName: flat(m.binaryName, true),
    fwPasswordRequired: m.fwPasswordRequired ?? false,
    fwActivationRetryCount: integer(
      m.fwActivationRetryCount ?? 3,
      "Activation retry count",
      0,
      65535,
    ),
    descriptions: localized(m.descriptions ?? [], "Firmware descriptions"),
    infoMessages: localized(m.infoMessages ?? [], "Info messages"),
  };
  if (!/^V\d+(\.\d+){1,7}$/.test(out.version))
    throw Error("Document version must use V1.0 or decimal components.");
  if (typeof out.fwPasswordRequired !== "boolean")
    throw Error("fwPasswordRequired must be a boolean.");
  if (
    !Array.isArray(m.hardwareIds) ||
    m.hardwareIds.length < 1 ||
    m.hardwareIds.length > 128
  )
    throw Error("At least one hardware ID is required (maximum 128).");
  const ids = new Set();
  out.hardwareIds = m.hardwareIds.map((v) => {
    const id = text(v.idPattern, "Hardware ID", { max: 64 });
    if (!/^[A-Za-z][A-Za-z0-9 _-]*[A-Za-z0-9*]$/.test(id) || ids.has(id))
      throw Error(
        "Hardware IDs must be unique valid idPattern strings; wildcard * may appear only at the end.",
      );
    ids.add(id);
    return {
      idPattern: id,
      ...(v.productName === undefined
        ? {}
        : {
            productName: text(v.productName, "Product name", { empty: true }),
          }),
      ...(v.productId === undefined
        ? {}
        : { productId: text(v.productId, "Product ID", { empty: true }) }),
    };
  });
  flat(
    `${out.vendorName}-${out.firmwareDescriptor}-${out.releaseDate.replaceAll("-", "")}-IOLFW1.0.xml`,
  );
  return out;
}
function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#9;");
}
function attributes(values) {
  return Object.entries(values)
    .map(([key, value]) => ` iolfw:${key}="${escape(value)}"`)
    .join("");
}
function filenames(m) {
  const stem = `${m.vendorName}-${m.firmwareDescriptor}-${m.releaseDate.replaceAll("-", "")}-IOLFW1.0`;
  return { filename: stem + ".iolfw", metadataFilename: stem + ".xml" };
}
function buildXML(m, resources) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<iolfw:IOLinkFWData xmlns:iolfw="${NS}" iolfw:crc="">`,
    `  <iolfw:DocumentInfo${attributes({ version: m.version, releaseDate: m.releaseDate, copyright: m.copyright })}/>`,
    `  <iolfw:MetaInfo${attributes({ vendorId: m.vendorId, vendorName: m.vendorName, fwRevision: m.fwRevision, fwPasswordRequired: m.fwPasswordRequired, fwActivationRetryCount: m.fwActivationRetryCount })}>`,
  ];
  function collection(container, item, values) {
    if (!values.length) return;
    lines.push(`    <iolfw:${container}>`);
    for (const value of values)
      lines.push(`      <iolfw:${item}${attributes(value)}/>`);
    lines.push(`    </iolfw:${container}>`);
  }
  collection("FWDescriptionCollection", "FWDescription", m.descriptions);
  collection("HardwareIdKeyCollection", "HardwareIdKey", m.hardwareIds);
  collection(
    "AdditionalResourceCollection",
    "Resource",
    resources.map((r) => ({ id: r.id, fileName: r.name })),
  );
  collection("InfoMessageCollection", "InfoMessage", m.infoMessages);
  lines.push(
    "  </iolfw:MetaInfo>",
    `  <iolfw:Blob${attributes({ fileName: m.binaryName })}/>`,
    `</iolfw:IOLinkFWData>`,
  );
  return lines.join("\n") + "\n";
}
function crc(xml, binary, resources) {
  // Locate the root attribute without treating comments or quoted > characters as markup.
  const masked = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, (match) =>
    " ".repeat(match.length),
  );
  const root = /<iolfw:IOLinkFWData\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(masked);
  const attribute = root && /\biolfw:crc\s*=\s*(['"])(\d*)\1/.exec(root[0]);
  if (!attribute) throw Error("Missing root iolfw:crc attribute.");
  const start =
    root.index +
    attribute.index +
    attribute[0].lastIndexOf(attribute[1], attribute[0].length - 2) +
    1;
  const value = xml.slice(0, start) + xml.slice(start + attribute[2].length);
  const c = new Crc32().update(encoder.encode(value)).update(binary);
  for (const resource of resources) c.update(resource.bytes);
  return c.value;
}
async function sha256(bytes) {
  if (!globalThis.crypto?.subtle)
    throw Error(
      "SHA-256 inspection requires a secure browser context (HTTPS/localhost) or Node22+.",
    );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function createFirmwarePackage(metadata, binary, resources = []) {
  const m = normalize(metadata),
    names = filenames(m),
    used = new Set([
      names.metadataFilename.toLowerCase(),
      m.binaryName.toLowerCase(),
    ]),
    ids = new Set();
  if (names.metadataFilename.toLowerCase() === m.binaryName.toLowerCase())
    throw Error("Duplicate metadata and binary file name.");
  if (!(binary instanceof Uint8Array) || !binary.length)
    throw Error("Firmware binary must be a non-empty Uint8Array.");
  if (!Array.isArray(resources) || resources.length + 2 > LIMITS.files)
    throw Error(
      "IOLFW supports at most 128 files including metadata and binary.",
    );
  let total = binary.length;
  const clean = resources.map((r) => {
    flat(r.name, true);
    text(r.id, "Resource ID", { max: 128 });
    if (
      !/^[a-zA-Z\d_.-]+$/.test(r.id) ||
      ids.has(r.id) ||
      used.has(r.name.toLowerCase())
    )
      throw Error("Duplicate or invalid resource ID/file name.");
    if (!(r.bytes instanceof Uint8Array))
      throw Error("Resource content must be Uint8Array.");
    ids.add(r.id);
    used.add(r.name.toLowerCase());
    total += r.bytes.length;
    return { id: r.id, name: r.name, bytes: r.bytes };
  });
  if (total > LIMITS.total)
    throw Error("IOLFW expanded contents exceed 16 MiB.");
  const source = buildXML(m, clean),
    stamped = source.replace(
      'iolfw:crc=""',
      `iolfw:crc="${crc(source, binary, clean)}"`,
    );
  if (total + encoder.encode(stamped).length > LIMITS.total)
    throw Error("IOLFW expanded contents exceed 16 MiB.");
  const files = Object.create(null);
  files[names.metadataFilename] = encoder.encode(stamped);
  files[m.binaryName] = binary;
  for (const r of clean) files[r.name] = r.bytes;
  const bytes = zipSync(files, {
    level: 6,
    mtime: new Date(1980, 0, 1, 0, 0, 0),
  });
  if (bytes.length > LIMITS.total)
    throw Error("IOLFW compressed package exceeds 16 MiB.");
  return bytes;
}
function parseXML(source) {
  if (
    encoder.encode(source).length > LIMITS.xml ||
    /<!\s*(DOCTYPE|ENTITY)\b/i.test(source)
  )
    throw Error(
      "IOLFW metadata must be at most 4 MiB; DTD/entity declarations are unsupported.",
    );
  text(source, "XML", { max: LIMITS.xml });
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (
    doc.getElementsByTagName("parsererror").length ||
    doc.documentElement.nodeName !== "iolfw:IOLinkFWData" ||
    doc.documentElement.namespaceURI !== NS
  )
    throw Error(
      "Import qualified iolfw:IOLinkFWData metadata in the official IOLFW1.0 namespace.",
    );
  const children = (node) =>
    [...node.childNodes].filter((n) => n.nodeType === 1);
  const attr = (node, key, required = true) => {
    if (!node?.hasAttributeNS(NS, key)) {
      if (required) throw Error(`Missing qualified iolfw:${key} attribute.`);
      return undefined;
    }
    return node.getAttributeNS(NS, key);
  };
  const child = (node, name, required = true) => {
    const found = children(node).filter(
      (n) => n.localName === name && n.namespaceURI === NS,
    );
    if (found.length !== 1 && required)
      throw Error(`Metadata requires exactly one ${name}.`);
    if (found.length > 1) throw Error(`Duplicate ${name}.`);
    return found[0];
  };
  const root = doc.documentElement;
  if (
    children(root)
      .map((n) => n.localName)
      .join(",") !== "DocumentInfo,MetaInfo,Blob"
  )
    throw Error(
      "IOLFW root must contain DocumentInfo, MetaInfo, Blob in schema order.",
    );
  const document = child(root, "DocumentInfo"),
    meta = child(root, "MetaInfo"),
    blob = child(root, "Blob");
  const allowed = [
    "FWDescriptionCollection",
    "HardwareIdKeyCollection",
    "AdditionalResourceCollection",
    "InfoMessageCollection",
  ];
  let previous = -1;
  for (const node of children(meta)) {
    const position = allowed.indexOf(node.localName);
    if (node.namespaceURI !== NS || position < 0 || position <= previous)
      throw Error(
        "MetaInfo collections must follow official schema order without duplicates.",
      );
    previous = position;
  }
  if (children(document).length || children(blob).length)
    throw Error("DocumentInfo and Blob cannot contain child elements.");
  const allowedAttrs = {
    IOLinkFWData: ["crc"],
    DocumentInfo: ["version", "releaseDate", "copyright"],
    MetaInfo: [
      "vendorId",
      "vendorName",
      "fwRevision",
      "fwPasswordRequired",
      "fwActivationRetryCount",
    ],
    FWDescription: ["lang", "description"],
    HardwareIdKey: ["idPattern", "productName", "productId"],
    Resource: ["id", "fileName"],
    InfoMessage: ["lang", "description"],
    Blob: ["fileName"],
  };
  for (const node of [root, ...root.getElementsByTagName("*")]) {
    if (
      [...node.childNodes].some(
        (n) => (n.nodeType === 3 || n.nodeType === 4) && n.textContent.trim(),
      )
    )
      throw Error(
        "IOLFW metadata elements cannot contain text or CDATA content.",
      );
    if (node.namespaceURI !== NS || node.prefix !== "iolfw")
      throw Error("All IOLFW elements require the iolfw namespace prefix.");
    for (const attribute of [...node.attributes]) {
      if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
      if (
        attribute.namespaceURI !== NS ||
        attribute.prefix !== "iolfw" ||
        !(allowedAttrs[node.localName] ?? []).includes(attribute.localName)
      )
        throw Error(
          "Unsupported or unqualified IOLFW metadata attribute " +
            attribute.name,
        );
    }
  }
  const items = (container, item, fields) => {
    const group = child(meta, container, false);
    if (!group) return [];
    if (
      children(group).some((n) => n.localName !== item || n.namespaceURI !== NS)
    )
      throw Error(`Unexpected ${container} child.`);
    return children(group).map((n) =>
      Object.fromEntries(
        fields
          .map(([key, required]) => [key, attr(n, key, required)])
          .filter(([, v]) => v !== undefined),
      ),
    );
  };
  const raw = {
    vendorId: attr(meta, "vendorId"),
    vendorName: attr(meta, "vendorName", false) ?? "",
    releaseDate: attr(document, "releaseDate"),
    version: attr(document, "version"),
    copyright: attr(document, "copyright"),
    fwRevision: attr(meta, "fwRevision"),
    binaryName: attr(blob, "fileName"),
    fwPasswordRequired: attr(meta, "fwPasswordRequired", false) ?? "false",
    fwActivationRetryCount: attr(meta, "fwActivationRetryCount", false) ?? 3,
    hardwareIds: items("HardwareIdKeyCollection", "HardwareIdKey", [
      ["idPattern", true],
      ["productName", false],
      ["productId", false],
    ]),
    descriptions: items("FWDescriptionCollection", "FWDescription", [
      ["lang", true],
      ["description", true],
    ]),
    infoMessages: items("InfoMessageCollection", "InfoMessage", [
      ["lang", true],
      ["description", true],
    ]),
  };
  if (!["true", "false", "0", "1"].includes(raw.fwPasswordRequired))
    throw Error("Invalid fwPasswordRequired boolean.");
  raw.fwPasswordRequired = ["true", "1"].includes(raw.fwPasswordRequired);
  const resources = items("AdditionalResourceCollection", "Resource", [
    ["id", true],
    ["fileName", true],
  ]).map((r) => ({ id: r.id, name: r.fileName }));
  return {
    raw,
    resources,
    stored: integer(attr(root, "crc"), "CRC", 0, 0xffffffff),
  };
}
export async function inspectFirmwarePackage(bytes, archiveFilename) {
  const files = await readPackageFiles(bytes, { allowDirectories: false });
  for (const file of files) flat(file.name);
  const candidates = files.filter(
    (f) =>
      /\.xml$/i.test(f.name) &&
      /<iolfw:IOLinkFWData(?:\s|>)/.test(decoder.decode(f.bytes)),
  );
  if (candidates.length !== 1)
    throw Error("IOLFW package requires exactly one XML metadata document.");
  const main = candidates[0],
    xml = decoder.decode(main.bytes),
    parsed = parseXML(xml),
    datePart = parsed.raw.releaseDate.replaceAll("-", ""),
    suffix = `-${datePart}-IOLFW1.0.xml`;
  if (!main.name.endsWith(suffix))
    throw Error(
      "Metadata filename must match releaseDate and IOLFW1.0 naming convention.",
    );
  const stem = main.name.slice(0, -suffix.length),
    prefix = parsed.raw.vendorName ? parsed.raw.vendorName + "-" : "";
  if (!prefix) {
    const split = stem.indexOf("-");
    if (split < 1)
      throw Error("Metadata filename requires vendor and firmware descriptor.");
    parsed.raw.vendorName = stem.slice(0, split);
  }
  const vendorPrefix = parsed.raw.vendorName + "-";
  if (!stem.startsWith(vendorPrefix))
    throw Error("Metadata filename vendor does not match vendorName.");
  const metadata = normalize({
      ...parsed.raw,
      firmwareDescriptor: stem.slice(vendorPrefix.length),
    }),
    names = filenames(metadata);
  if (archiveFilename !== undefined && archiveFilename !== names.filename)
    throw Error(
      "Archive filename must match XML metadata filename and release date.",
    );
  const fileByName = new Map(files.map((f) => [f.name, f.bytes]));
  const binary = fileByName.get(metadata.binaryName);
  if (!binary?.length)
    throw Error("Missing or empty firmware binary named in Blob.");
  const used = new Set([main.name, metadata.binaryName]),
    resourceIds = new Set(),
    resources = [];
  for (const resource of parsed.resources) {
    flat(resource.name, true);
    if (used.has(resource.name) || resourceIds.has(resource.id))
      throw Error("Duplicate firmware resource file or ID.");
    text(resource.id, "Resource ID", { max: 128 });
    const data = fileByName.get(resource.name);
    if (!data) throw Error("Missing declared resource " + resource.name);
    used.add(resource.name);
    resourceIds.add(resource.id);
    resources.push({ ...resource, bytes: data });
  }
  if (files.some((f) => !used.has(f.name)))
    throw Error(
      "IOLFW package contains undeclared files; list them as resources.",
    );
  const computed = crc(xml, binary, resources),
    valid = computed === parsed.stored;
  return {
    metadata,
    ...names,
    xml,
    binary: {
      name: metadata.binaryName,
      size: binary.length,
      sha256: await sha256(binary),
    },
    resources: await Promise.all(
      resources.map(async (r) => ({
        id: r.id,
        name: r.name,
        size: r.bytes.length,
        sha256: await sha256(r.bytes),
      })),
    ),
    files: files.map((f) => ({ name: f.name, size: f.bytes.length })),
    validation: {
      valid,
      issues: valid
        ? []
        : [
            "IOLFW CRC does not match metadata, binary and ordered resource bytes.",
          ],
      crc: { stored: parsed.stored, computed },
      coverage: {
        metadata: true,
        files: true,
        crc: true,
        sha256: true,
        xsd: false,
        signature: false,
        deviceCompatibility: false,
      },
    },
  };
}
