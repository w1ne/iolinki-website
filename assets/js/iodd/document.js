import { parseXml, serialiseXml } from "./vendor/model/xml.js";
import { root, path, elements, walk, element } from "./vendor/model/tree.js";
import { applyStampCrc, verifyStampCrc } from "./vendor/checker/crc.mjs";
export const NS = "http://www.io-link.com/IODD/2010/10";
const encoder = new TextEncoder();
const kinds = ["UIntegerT", "IntegerT", "BooleanT", "StringT", "OctetStringT"];
export function importXML(source) {
  if (encoder.encode(source).length > 4 * 1024 * 1024)
    throw Error("File exceeds the 4 MiB limit.");
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source))
    throw Error("DTD and entity declarations are not supported.");
  const encoding = source.match(
    /<\?xml[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i,
  )?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding))
    throw Error(
      "Import UTF-8 XML. Other encoding declarations are not supported; convert the file to UTF-8 first.",
    );
  const native = new DOMParser().parseFromString(source, "application/xml");
  if (native.getElementsByTagName("parsererror").length)
    throw Error(
      "XML syntax is invalid. Check the XML editor or import a valid file.",
    );
  if (
    native.documentElement.localName !== "IODevice" ||
    native.documentElement.namespaceURI !== NS
  )
    throw Error("Import an IODD 1.1 IODevice document (namespace 2010/10).");
  for (const node of native.getElementsByTagName("*")) {
    if (
      node.getAttributeNS("http://www.w3.org/XML/1998/namespace", "space") ===
      "preserve"
    )
      throw Error(
        "xml:space preservation is not supported. The file was not changed; edit it with an XML tool that preserves whitespace.",
      );
    if (
      [...node.childNodes].some((n) => n.nodeType === 1) &&
      [...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    )
      throw Error(
        "Mixed-content XML is not supported. The file was not changed; edit it with an XML tool that preserves mixed text.",
      );
  }
  const doc = parseXml(source);
  if (root(doc).name !== "IODevice")
    throw Error(
      "Prefixed root elements are preserved outside this editor; use an IODD with the default namespace.",
    );
  return doc;
}
function identity(doc) {
  return path(root(doc), "ProfileBody", "DeviceIdentity");
}
function primary(doc) {
  return path(root(doc), "ExternalTextCollection", "PrimaryLanguage");
}
function textValue(doc, node) {
  const id = node?.attrs.textId;
  return (
    elements(primary(doc), "Text").find((n) => n.attrs.id === id)?.attrs
      .value || ""
  );
}
function setTextValue(doc, parent, tag, value) {
  let ref = path(parent, tag);
  if (!ref) throw Error(`Missing ${tag}; repair it in XML first.`);
  const id = ref.attrs.textId;
  if (!id) throw Error(`Missing ${tag} textId.`);
  let text = elements(primary(doc), "Text").find((n) => n.attrs.id === id);
  if (!text) {
    text = element("Text", { id, value: "" });
    primary(doc).children.push(text);
  }
  text.attrs.value = String(value);
}
export function getIdentity(doc) {
  const id = identity(doc);
  const variant = elements(
    path(id, "DeviceVariantCollection"),
    "DeviceVariant",
  )[0];
  const info = path(root(doc), "DocumentInfo");
  return {
    vendorId: id?.attrs.vendorId || "",
    deviceId: id?.attrs.deviceId || "",
    vendorName: id?.attrs.vendorName || "",
    productName: textValue(doc, path(id, "DeviceName")),
    productId: variant?.attrs.productId || "",
    releaseDate: info?.attrs.releaseDate || "",
    version: info?.attrs.version || "",
  };
}
function number(value, label, min, max) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw Error(`${label} must be an integer from ${min} to ${max}.`);
  return Number(value);
}
function scalar(value, label) {
  if (!/^-?\d+$/.test(String(value)))
    throw Error(`${label} must be a decimal integer.`);
  return BigInt(value);
}
export function editIdentity(doc, values) {
  const id = identity(doc);
  if (!id) throw Error("Missing DeviceIdentity.");
  for (const [key, max] of [
    ["vendorId", 65535],
    ["deviceId", 16777215],
  ])
    if (key in values) id.attrs[key] = String(number(values[key], key, 1, max));
  if ("vendorName" in values) {
    if (!values.vendorName.trim()) throw Error("Vendor name is required.");
    id.attrs.vendorName = values.vendorName;
  }
  if ("productName" in values) {
    setTextValue(doc, id, "DeviceName", values.productName);
    const variant = elements(
      path(id, "DeviceVariantCollection"),
      "DeviceVariant",
    )[0];
    if (variant) setTextValue(doc, variant, "Name", values.productName);
  }
  if ("productId" in values) {
    if (!values.productId.trim()) throw Error("Product ID is required.");
    const variant = elements(
      path(id, "DeviceVariantCollection"),
      "DeviceVariant",
    )[0];
    if (!variant) throw Error("Missing device variant.");
    const old = variant.attrs.productId;
    variant.attrs.productId = values.productId;
    for (const n of walk(root(doc))) {
      if (n.name === "ProductRef" && n.attrs.productId === old)
        n.attrs.productId = values.productId;
      if (
        n.name === "StdVariableRef" &&
        n.attrs.id === "V_ProductID" &&
        n.attrs.defaultValue === old
      )
        n.attrs.defaultValue = values.productId;
    }
  }
  const info = path(root(doc), "DocumentInfo");
  if ("releaseDate" in values) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(values.releaseDate) ||
      new Date(values.releaseDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        values.releaseDate
    )
      throw Error("Release date must be a valid YYYY-MM-DD date.");
    info.attrs.releaseDate = values.releaseDate;
  }
  if ("version" in values) {
    if (!/^V\d+(\.\d+){1,7}$/.test(values.version))
      throw Error("Version must use V1.0 or decimal components.");
    info.attrs.version = values.version;
  }
}
function functionNode(doc) {
  return path(root(doc), "ProfileBody", "DeviceFunction");
}
function datatype(doc, node) {
  const inline = path(node, "Datatype");
  if (inline) return inline;
  const ref = path(node, "DatatypeRef");
  return elements(
    path(functionNode(doc), "DatatypeCollection"),
    "Datatype",
  ).find((n) => n.attrs.id === ref?.attrs.datatypeId);
}
function typeOf(dt) {
  return (dt?.attrs["xsi:type"] || "").split(":").pop();
}
export function getVariables(doc) {
  return elements(
    path(functionNode(doc), "VariableCollection"),
    "Variable",
  ).map((node) => {
    const dt = datatype(doc, node),
      type = typeOf(dt),
      range = path(dt, "ValueRange");
    return {
      id: node.attrs.id,
      index: node.attrs.index,
      name: textValue(doc, path(node, "Name")),
      access: node.attrs.accessRights,
      type,
      bits: dt?.attrs.bitLength || Number(dt?.attrs.fixedLength) * 8 || "",
      defaultValue: node.attrs.defaultValue ?? "",
      lower: range?.attrs.lowerValue ?? "",
      upper: range?.attrs.upperValue ?? "",
      editable:
        kinds.includes(type) &&
        type !== "BooleanT" &&
        !!path(node, "Datatype") &&
        elements(dt).every((n) => n.name === "ValueRange") &&
        elements(dt, "ValueRange").length <= 1,
    };
  });
}
function checkParameter(values) {
  number(values.index, "Index", 16, 65535);
  if (!["ro", "rw", "wo"].includes(values.access))
    throw Error("Access must be ro, rw or wo.");
  if (!kinds.includes(values.type) || values.type === "BooleanT")
    throw Error("Use a supported parameter datatype.");
  const bits = number(
    values.bits,
    "Bit length",
    2,
    values.type.includes("String") ? 1856 : 64,
  );
  if (values.type.includes("String") && bits % 8)
    throw Error("String lengths must be whole bytes.");
  if (
    values.type === "StringT" &&
    encoder.encode(values.defaultValue).length > bits / 8
  )
    throw Error("Default UTF-8 text exceeds the string byte length.");
  if (["UIntegerT", "IntegerT"].includes(values.type)) {
    const min = values.type === "IntegerT" ? -(1n << BigInt(bits - 1)) : 0n;
    const max =
      (1n << BigInt(bits - (values.type === "IntegerT" ? 1 : 0))) - 1n;
    const low = values.lower === "" ? min : scalar(values.lower, "Lower bound"),
      high = values.upper === "" ? max : scalar(values.upper, "Upper bound");
    if (low < min || high > max || low > high)
      throw Error(
        "Parameter range exceeds the datatype or has reversed bounds.",
      );
    if (
      values.defaultValue !== "" &&
      (scalar(values.defaultValue, "Default") < low ||
        scalar(values.defaultValue, "Default") > high)
    )
      throw Error("Default value is outside the parameter range.");
  }
}
export function editVariable(doc, id, values) {
  const existing = getVariables(doc).find((v) => v.id === id);
  if (!existing?.editable)
    throw Error(
      "This datatype uses a shared or complex definition. Edit it in XML.",
    );
  checkParameter(values);
  if (
    getVariables(doc).some(
      (v) => v.id !== id && Number(v.index) === Number(values.index),
    )
  )
    throw Error("Duplicate variable index.");
  const node = elements(
    path(functionNode(doc), "VariableCollection"),
    "Variable",
  ).find((v) => v.attrs.id === id);
  node.attrs.index = String(values.index);
  node.attrs.accessRights = values.access;
  if (values.defaultValue === "") delete node.attrs.defaultValue;
  else node.attrs.defaultValue = String(values.defaultValue);
  setTextValue(doc, node, "Name", values.name);
  const dt = path(node, "Datatype");
  dt.attrs["xsi:type"] = values.type;
  delete dt.attrs.bitLength;
  delete dt.attrs.fixedLength;
  delete dt.attrs.encoding;
  if (values.type.includes("String")) {
    dt.attrs.fixedLength = String(Number(values.bits) / 8);
    if (values.type === "StringT") dt.attrs.encoding = "UTF-8";
  } else dt.attrs.bitLength = String(values.bits);
  dt.children = dt.children.filter(
    (n) => n.type !== "element" || n.name !== "ValueRange",
  );
  if (
    ["UIntegerT", "IntegerT"].includes(values.type) &&
    (values.lower !== "" || values.upper !== "")
  ) {
    const bits = Number(values.bits),
      signed = values.type === "IntegerT";
    dt.children.push(
      element("ValueRange", {
        lowerValue:
          values.lower !== ""
            ? String(values.lower)
            : signed
              ? String(-(1n << BigInt(bits - 1)))
              : "0",
        upperValue:
          values.upper !== ""
            ? String(values.upper)
            : String((1n << BigInt(bits - (signed ? 1 : 0))) - 1n),
      }),
    );
  }
}
export function addVariable(doc) {
  const collection = path(functionNode(doc), "VariableCollection");
  let index = 256;
  const used = new Set(getVariables(doc).map((v) => Number(v.index)));
  while (used.has(index)) index++;
  let id = `V_Parameter_${index}`;
  const ids = new Set([...walk(root(doc))].map((n) => n.attrs.id));
  while (ids.has(id)) id += "_";
  const textId = "T_" + id;
  collection.children.push(
    element(
      "Variable",
      { id, index: String(index), accessRights: "rw", defaultValue: "0" },
      [
        element("Datatype", { "xsi:type": "UIntegerT", bitLength: "16" }),
        element("Name", { textId }),
      ],
    ),
  );
  primary(doc).children.push(
    element("Text", { id: textId, value: "New parameter" }),
  );
  return id;
}
export function removeVariable(doc, id) {
  for (const n of walk(root(doc)))
    if (n.attrs.variableId === id)
      throw Error(
        "This parameter is referenced by a menu or another section. Remove its references in XML first.",
      );
  const collection = path(functionNode(doc), "VariableCollection");
  collection.children = collection.children.filter(
    (n) => n.type !== "element" || n.attrs.id !== id,
  );
}
export function getProcessData(doc) {
  const output = [];
  for (const pd of elements(
    path(functionNode(doc), "ProcessDataCollection"),
    "ProcessData",
  ))
    for (const direction of ["In", "Out"]) {
      const node = path(pd, "ProcessData" + direction);
      if (!node) continue;
      const dt = datatype(doc, node);
      const fields = elements(dt, "RecordItem").map((field, i) => {
        const simple = path(field, "SimpleDatatype");
        const type = typeOf(simple);
        return {
          index: i,
          name: textValue(doc, path(field, "Name")),
          offset: field.attrs.bitOffset,
          bits: type === "BooleanT" ? "1" : simple?.attrs.bitLength || "",
          type,
          editable:
            ["UIntegerT", "IntegerT", "BooleanT"].includes(type) && !!simple,
        };
      });
      output.push({
        id: node.attrs.id,
        direction: direction.toLowerCase(),
        bits: node.attrs.bitLength,
        editable: !!path(node, "Datatype") && typeOf(dt) === "RecordT",
        fields,
      });
    }
  return output;
}
export function editProcessField(doc, id, index, values) {
  const view = getProcessData(doc).find((v) => v.id === id);
  if (!view?.editable || !view.fields[index]?.editable)
    throw Error("Edit this process-data type in XML.");
  const offset = number(values.offset, "Bit offset", 0, 255),
    bits = number(values.bits, "Field bits", 1, 64);
  if (
    !["UIntegerT", "IntegerT", "BooleanT"].includes(values.type) ||
    (values.type === "BooleanT" && bits !== 1) ||
    (values.type !== "BooleanT" && bits < 2)
  )
    throw Error("Boolean fields need one bit; integer fields need 2–64 bits.");
  if (offset + bits > Number(view.bits))
    throw Error("Field extends beyond the process-data record.");
  for (const f of view.fields)
    if (
      f.index !== index &&
      offset < Number(f.offset) + Number(f.bits) &&
      Number(f.offset) < offset + bits
    )
      throw Error("Process-data fields overlap.");
  const node = [...walk(root(doc))].find((n) => n.attrs.id === id);
  const field = elements(path(node, "Datatype"), "RecordItem")[index];
  field.attrs.bitOffset = String(offset);
  const dt = path(field, "SimpleDatatype");
  dt.attrs["xsi:type"] = values.type;
  if (values.type === "BooleanT") delete dt.attrs.bitLength;
  else dt.attrs.bitLength = String(bits);
  setTextValue(doc, field, "Name", values.name);
}
export function validateDocument(doc) {
  const issues = [];
  const error = (message) => issues.push({ severity: "error", message });
  const device = root(doc);
  for (const tag of [
    "DocumentInfo",
    "ProfileHeader",
    "ProfileBody",
    "CommNetworkProfile",
    "ExternalTextCollection",
    "Stamp",
  ])
    if (!path(device, tag)) error("Missing " + tag + ".");
  for (const tag of [
    "Features",
    "VariableCollection",
    "ProcessDataCollection",
    "UserInterface",
  ])
    if (!path(functionNode(doc), tag))
      error("Missing DeviceFunction/" + tag + ".");
  const variants = elements(
    path(identity(doc), "DeviceVariantCollection"),
    "DeviceVariant",
  );
  const products = new Set(variants.map((n) => n.attrs.productId));
  if (products.size !== variants.length)
    error("Duplicate device variant product ID.");
  for (const n of walk(device))
    if (n.name === "ProductRef" && !products.has(n.attrs.productId))
      error("Unresolved productId: " + n.attrs.productId + ".");
  const ids = new Set();
  for (const n of walk(device)) {
    if (n.attrs.id) {
      if (ids.has(n.attrs.id)) error("Duplicate ID " + n.attrs.id + ".");
      ids.add(n.attrs.id);
    }
  }
  for (const n of walk(device))
    for (const key of [
      "textId",
      "variableId",
      "datatypeId",
      "menuId",
      "processDataId",
    ])
      if (n.attrs[key] && !ids.has(n.attrs[key]))
        error(`Unresolved ${key}: ${n.attrs[key]}.`);
  try {
    const id = getIdentity(doc);
    number(id.vendorId, "Vendor ID", 1, 65535);
    number(id.deviceId, "Device ID", 1, 16777215);
    if (!/^V\d+(\.\d+){1,7}$/.test(id.version))
      error("Document version must use V1.0 or decimal components.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(id.releaseDate) ||
      new Date(id.releaseDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        id.releaseDate
    )
      error("Release date must be a valid YYYY-MM-DD date.");
    if (!id.vendorName.trim() || !id.productId.trim() || !id.productName.trim())
      error("Vendor name, product ID and device name are required.");
  } catch (e) {
    error(e.message);
  }
  const indexes = new Set();
  for (const v of getVariables(doc)) {
    if (indexes.has(Number(v.index)))
      error("Duplicate variable index " + v.index + ".");
    indexes.add(Number(v.index));
    try {
      number(v.index, "Index", 16, 65535);
      if (v.editable) checkParameter(v);
    } catch (e) {
      error(v.id + ": " + e.message);
    }
  }
  for (const pd of getProcessData(doc)) {
    try {
      number(pd.bits, "Process-data bits", 1, 256);
    } catch (e) {
      error(e.message);
    }
    const used = new Set();
    const node = [...walk(device)].find((n) => n.attrs.id === pd.id);
    const dt = datatype(doc, node);
    if (
      typeOf(dt) === "RecordT" &&
      Number(dt.attrs.bitLength) !== Number(pd.bits)
    )
      error(pd.id + ": datatype size differs from process-data size.");
    const subindexes = new Set();
    for (const field of elements(dt, "RecordItem")) {
      try {
        const sub = number(field.attrs.subindex, "Record subindex", 1, 255);
        if (subindexes.has(sub)) error(pd.id + ": duplicate record subindex.");
        subindexes.add(sub);
      } catch (e) {
        error(pd.id + ": " + e.message);
      }
    }
    for (const f of pd.fields) {
      if (!f.editable) continue;
      try {
        const offset = number(f.offset, "Bit offset", 0, 255),
          bits = number(f.bits, "Field bits", 1, 64);
        if (
          (f.type === "BooleanT" && bits !== 1) ||
          (f.type !== "BooleanT" && bits < 2)
        )
          error(
            pd.id +
              ": boolean fields need one bit; integer fields need 2–64 bits.",
          );
        if (offset + bits > Number(pd.bits))
          error(pd.id + ": field exceeds record size.");
        for (let b = offset; b < offset + bits; b++) {
          if (used.has(b)) error(pd.id + ": process-data fields overlap.");
          used.add(b);
        }
      } catch (e) {
        error(pd.id + ": " + e.message);
      }
    }
  }
  try {
    if (!verifyStampCrc(encoder.encode(serialiseXml(doc))).valid)
      issues.push({
        severity: "warning",
        message: "CRC will be refreshed when you download.",
      });
  } catch {
    issues.push({
      severity: "warning",
      message: "CRC stamp will be created when you download.",
    });
  }
  return issues;
}
export function previewXML(doc) {
  return serialiseXml(doc, { eol: "\n", indent: "  " });
}
export function exportXML(doc) {
  const copy = structuredClone(doc);
  copy.declaration = { version: "1.0", encoding: "UTF-8" };
  let stamp = path(root(copy), "Stamp");
  if (!stamp) {
    stamp = element("Stamp", { crc: "0" }, []);
    root(copy).children.push(stamp);
  }
  stamp.attrs.crc = "0";
  let checker = path(stamp, "Checker");
  if (!checker) {
    checker = element("Checker", {}, []);
    stamp.children.push(checker);
  }
  checker.attrs.name = "iolinki-browser-editor";
  checker.attrs.version = "V1.0";
  return new TextDecoder().decode(
    applyStampCrc(encoder.encode(serialiseXml(copy))).bytes,
  );
}
