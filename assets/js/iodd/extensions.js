import { compilePattern } from "./validation-pattern.js";
import { importSupplementXML, previewXML } from "./document.js";
import { root, path, elements, walk, element } from "./vendor/model/tree.js";
const NS = "http://www.io-link.com/IODD/2010/10";
const PROFILE_NS = "http://www.io-link.com/IODD-Snippets/2025/10";
const referenceKeys = [
  "textId",
  "variableId",
  "datatypeId",
  "menuId",
  "processDataId",
];
export function selectNode(doc, selector) {
  if (typeof selector === "string") {
    const node = [...walk(root(doc))].find((n) => n.attrs.id === selector);
    if (!node) throw Error("Unknown element ID: " + selector);
    return node;
  }
  if (
    !Array.isArray(selector) ||
    selector.length > 128 ||
    selector.some((n) => !Number.isInteger(n) || n < 0)
  )
    throw Error("Selector must be an ID or root-relative child indexes.");
  let node = root(doc);
  for (const index of selector) {
    node = node.children?.[index];
    if (!node) throw Error("Element selector does not exist.");
  }
  return node;
}
function nodeSelector(doc, wanted) {
  function visit(node, selector = []) {
    if (node === wanted) return selector;
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      const result = visit(node.children[i], [...selector, i]);
      if (result) return result;
    }
    return null;
  }
  const selector = visit(root(doc));
  if (!selector) throw Error("Element is outside this document.");
  return selector;
}
function parentOf(doc, node) {
  for (const candidate of walk(root(doc)))
    if (candidate.children.includes(node)) return candidate;
  return null;
}
function validName(name) {
  if (
    typeof name !== "string" ||
    !/^[_A-Za-z][\w.:-]*$/.test(name) ||
    name.length > 128
  )
    throw Error("Invalid XML element or attribute name.");
}
function checkNode(node, depth = 0, budget = { nodes: 0 }) {
  if (!node || depth > 128 || ++budget.nodes > 50000)
    throw Error("Element tree exceeds its depth or node limit.");
  if (node.type === "text" || node.type === "comment") {
    if (typeof node.value !== "string")
      throw Error("Text/comment nodes require a string value.");
    if (
      node.type === "comment" &&
      (/--/.test(node.value) || node.value.endsWith("-"))
    )
      throw Error("Invalid XML comment.");
    return;
  }
  if (node.type !== "element")
    throw Error("Use element, text or comment nodes.");
  validName(node.name);
  if (
    !node.attrs ||
    typeof node.attrs !== "object" ||
    Array.isArray(node.attrs) ||
    !Array.isArray(node.children)
  )
    throw Error("Elements require attrs and children.");
  for (const [key, value] of Object.entries(node.attrs)) {
    validName(key);
    if (typeof value !== "string")
      throw Error("XML attributes must be strings.");
  }
  for (const child of node.children) checkNode(child, depth + 1, budget);
}
export function editTree(doc, operation) {
  const node = selectNode(doc, operation.selector);
  const previousId = node.attrs?.id;
  switch (operation.action) {
    case "attributes":
      if (
        node.type !== "element" ||
        !operation.values ||
        typeof operation.values !== "object"
      )
        throw Error("Select an element and supply attributes.");
      for (const [key, value] of Object.entries(operation.values)) {
        validName(key);
        if (value === null) delete node.attrs[key];
        else if (typeof value === "string") node.attrs[key] = value;
        else throw Error("Attribute values must be strings or null.");
      }
      break;
    case "text":
      if (typeof operation.value !== "string")
        throw Error("Text value must be a string.");
      if (node.type === "text" || node.type === "comment") {
        node.value = operation.value;
        checkNode(node);
      } else {
        if (elements(node).length)
          throw Error(
            "Select a leaf element to set its text; mixed content is not supported.",
          );
        node.children = node.children.filter((n) => n.type !== "text");
        node.children.push({ type: "text", value: operation.value });
      }
      break;
    case "insert":
      if (node.type !== "element") throw Error("Select an element parent.");
      checkNode(operation.node);
      const index = operation.index ?? node.children.length;
      if (!Number.isInteger(index) || index < 0 || index > node.children.length)
        throw Error("Invalid child insertion index.");
      node.children.splice(index, 0, structuredClone(operation.node));
      break;
    case "remove": {
      const parent = parentOf(doc, node);
      if (!parent) throw Error("Cannot remove the document root.");
      parent.children = parent.children.filter((n) => n !== node);
      break;
    }
    default:
      throw Error("Unknown tree action.");
  }
  if (
    operation.action === "attributes" &&
    previousId &&
    node.attrs.id &&
    previousId !== node.attrs.id
  ) {
    const primaryText =
      node.name === "Text" && parentOf(doc, node)?.name === "PrimaryLanguage";
    if (primaryText)
      for (const text of walk(root(doc)))
        if (
          text !== node &&
          text.name === "Text" &&
          text.attrs.id === previousId
        )
          text.attrs.id = node.attrs.id;
    if (node.name !== "Text" || primaryText)
      for (const candidate of walk(root(doc)))
        for (const key of referenceKeys)
          if (candidate.attrs[key] === previousId)
            candidate.attrs[key] = node.attrs.id;
  }
}
export function inspectElementsXML(xml) {
  return structuredClone(root(importSupplementXML(xml)));
}
function primary(source) {
  return (
    path(root(source), "ExternalTextCollection", "PrimaryLanguage") ??
    elements(root(source), "PrimaryLanguage")[0]
  );
}
function dependencies(source, selectors, target) {
  if (!Array.isArray(selectors) || !selectors.length || selectors.length > 128)
    throw Error("Select one to 128 reusable elements.");
  const selected = selectors.map((selector) => selectNode(source, selector));
  const index = new Map();
  for (const node of walk(root(source)))
    if (node.attrs.id && !index.has(node.attrs.id))
      index.set(node.attrs.id, node);
  for (let i = 0; i < selected.length; i++)
    for (const node of walk(selected[i]))
      for (const key of referenceKeys) {
        if (!node.attrs[key]) continue;
        const ref = index.get(node.attrs[key]);
        if (!ref) {
          if (
            target &&
            [...walk(root(target))].some((n) => n.attrs.id === node.attrs[key])
          )
            continue;
          throw Error("Unresolved imported " + key + ": " + node.attrs[key]);
        }
        if (!selected.some((top) => [...walk(top)].includes(ref)))
          selected.push(ref);
        if (selected.length > 512)
          throw Error("Import dependency closure exceeds 512 definitions.");
      }
  return selected.filter(
    (node) =>
      !selected.some(
        (other) => other !== node && [...walk(other)].includes(node),
      ),
  );
}
function fn(doc) {
  return path(root(doc), "ProfileBody", "DeviceFunction");
}
const order = [
  "Features",
  "DatatypeCollection",
  "VariableCollection",
  "ProcessDataCollection",
  "ErrorTypeCollection",
  "EventCollection",
  "UserInterface",
];
function ensureCollection(doc, name) {
  const parent = fn(doc);
  if (!parent) throw Error("Missing DeviceFunction.");
  let collection = path(parent, name);
  if (collection) return collection;
  collection = element(name);
  const rank = order.indexOf(name),
    index = parent.children.findIndex(
      (n) => n.type === "element" && order.indexOf(n.name) > rank,
    );
  parent.children.splice(
    index < 0 ? parent.children.length : index,
    0,
    collection,
  );
  return collection;
}
function destinationFor(doc, node, language) {
  if (node.name === "Text") {
    const collection = path(root(doc), "ExternalTextCollection");
    if (!collection) throw Error("Missing ExternalTextCollection.");
    let target = elements(collection).find(
      (n) => n.attrs["xml:lang"] === language,
    );
    if (!target) {
      target = element("Language", { "xml:lang": language });
      collection.children.push(target);
    }
    return target;
  }
  const types = {
    Variable: "VariableCollection",
    StdVariableRef: "VariableCollection",
    Datatype: "DatatypeCollection",
    ProcessData: "ProcessDataCollection",
    Event: "EventCollection",
    StdEventRef: "EventCollection",
    ErrorType: "ErrorTypeCollection",
    StdErrorTypeRef: "ErrorTypeCollection",
  };
  if (types[node.name]) return ensureCollection(doc, types[node.name]);
  if (node.name === "Menu") {
    let ui = path(fn(doc), "UserInterface");
    if (!ui) throw Error("Missing UserInterface.");
    let collection = path(ui, "MenuCollection");
    if (!collection) {
      collection = element("MenuCollection");
      ui.children.unshift(collection);
    }
    return collection;
  }
  throw Error("Choose an explicit destination for imported " + node.name + ".");
}
// Shared profile definitions are composed only where the schema has typed unions.
// Every concrete definition outside those unions must remain identical.
function definitionSignature(node) {
  if (node.type !== "element") return JSON.stringify(node);
  return JSON.stringify([
    node.name,
    Object.entries(node.attrs).sort(),
    node.children.filter((n) => n.type !== "comment").map(definitionSignature),
  ]);
}
function mergeProfileDefinition(existing, incoming) {
  const conflict = () => {
    throw Error("Shared profile definition conflict: " + incoming.attrs.id);
  };
  if (existing.name !== incoming.name) conflict();
  if (definitionSignature(existing) === definitionSignature(incoming)) return;
  if (!["Menu", "StdVariableRef"].includes(incoming.name)) conflict();
  for (const [key, value] of Object.entries(incoming.attrs)) {
    if (existing.attrs[key] !== undefined && existing.attrs[key] !== value)
      conflict();
    if (incoming.name === "Menu" && existing.attrs[key] === undefined)
      conflict();
  }
  if (
    incoming.name === "Menu" &&
    Object.keys(existing.attrs).some((key) => incoming.attrs[key] === undefined)
  )
    conflict();
  const childKey = (child) => {
    if (child.type !== "element") return definitionSignature(child);
    if (incoming.name === "StdVariableRef") {
      if (!["SingleValue", "StdSingleValueRef"].includes(child.name))
        conflict();
      return "value:" + child.attrs.value;
    }
    if (child.name === "Name") return "Name";
    if (!["MenuRef", "VariableRef", "RecordItemRef"].includes(child.name))
      conflict();
    return (
      child.name +
      ":" +
      (child.attrs.menuId ?? child.attrs.variableId) +
      ":" +
      (child.attrs.subindex ?? "") +
      ":" +
      elements(child, "Button")
        .map((n) => n.attrs.buttonValue)
        .join(",")
    );
  };
  for (const child of incoming.children) {
    if (child.type === "comment") continue;
    const key = childKey(child),
      prior = existing.children
        .filter((n) => n.type !== "comment")
        .find((n) => childKey(n) === key);
    if (prior) {
      if (definitionSignature(prior) !== definitionSignature(child)) conflict();
    } else {
      const copy = structuredClone(child);
      const index =
        child.name === "Name"
          ? 0
          : child.name === "StdSingleValueRef"
            ? existing.children.findIndex((n) => n.name === "SingleValue")
            : -1;
      existing.children.splice(
        index < 0 ? existing.children.length : index,
        0,
        copy,
      );
    }
  }
  // Standard references may contribute previously unspecified schema attributes.
  for (const [key, value] of Object.entries(incoming.attrs))
    existing.attrs[key] ??= value;
}

export function importElementsInto(doc, operation) {
  const source = importSupplementXML(operation.xml),
    selected = dependencies(source, operation.selectors, doc),
    targetIDs = new Set(
      [...walk(root(doc))].map((n) => n.attrs.id).filter(Boolean),
    );
  for (const [key, value] of Object.entries(root(source).attrs))
    if (key.startsWith("xmlns:")) {
      const current = root(doc).attrs[key];
      if (current && current !== value)
        throw Error(
          "Namespace prefix collision: " +
            key +
            ". Rename the source prefix before importing.",
        );
      root(doc).attrs[key] = value;
    }
  const mapping = new Map(),
    copies = selected.map((n) => structuredClone(n)),
    collision = operation.collision ?? "rename";
  if (!["rename", "error"].includes(collision))
    throw Error("Collision policy must be rename or error.");
  for (const top of copies)
    for (const node of walk(top)) {
      const id = node.attrs.id;
      if (!id || mapping.has(id)) continue;
      if (targetIDs.has(id)) {
        if (operation.composeProfiles || node.name === "StdVariableRef") {
          mapping.set(id, id);
          continue;
        }
        if (collision === "error") throw Error("Imported ID collision: " + id);
        let candidate = (operation.prefix ?? "Imported_") + id,
          serial = 1;
        while (targetIDs.has(candidate))
          candidate = (operation.prefix ?? "Imported_") + id + "_" + serial++;
        if (!/^[A-Za-z][A-Za-z0-9 _-]*[A-Za-z0-9]$/.test(candidate))
          throw Error("Import prefix produces an invalid IODD ID.");
        mapping.set(id, candidate);
        targetIDs.add(candidate);
      } else {
        mapping.set(id, id);
        targetIDs.add(id);
      }
    }
  for (const top of copies)
    for (const node of walk(top)) {
      if (mapping.has(node.attrs.id))
        node.attrs.id = mapping.get(node.attrs.id);
      for (const key of referenceKeys)
        if (mapping.has(node.attrs[key]))
          node.attrs[key] = mapping.get(node.attrs[key]);
    }
  const indexes = new Set(
    elements(path(fn(doc), "VariableCollection"), "Variable").map((n) =>
      Number(n.attrs.index),
    ),
  );
  for (let i = 0; i < copies.length; i++) {
    const node = copies[i],
      original = selected[i];
    const shared = [...walk(root(doc))].find(
      (n) => n.attrs.id && n.attrs.id === node.attrs.id,
    );
    if (
      shared &&
      (operation.composeProfiles || node.name === "StdVariableRef")
    ) {
      mergeProfileDefinition(shared, node);
      continue;
    }
    if (node.name === "Variable") {
      if (indexes.has(Number(node.attrs.index))) {
        if (collision === "error")
          throw Error("Imported variable index collision.");
        let index = 256;
        while (indexes.has(index)) index++;
        if (index > 65535) throw Error("No free variable index.");
        node.attrs.index = String(index);
      }
      indexes.add(Number(node.attrs.index));
    }
    const isSelected = operation.selectors.some(
      (selector) => selectNode(source, selector) === original,
    );
    const language =
      node.name === "Text"
        ? (parentOf(source, original)?.attrs["xml:lang"] ??
          primary(source)?.attrs["xml:lang"])
        : undefined;
    const destination =
      operation.destination !== undefined && isSelected && node.name !== "Text"
        ? selectNode(doc, operation.destination)
        : destinationFor(doc, node, language);
    if (
      ["Event", "StdEventRef"].includes(node.name) &&
      elements(destination).some(
        (n) =>
          ["Event", "StdEventRef"].includes(n.name) &&
          Number(n.attrs.code) === Number(node.attrs.code),
      )
    )
      throw Error(
        "Imported event code collision; choose another code before importing.",
      );
    if (destination.type !== "element")
      throw Error("Import destination must be an element.");
    if (node.name === "StdVariableRef") {
      const next = destination.children.findIndex((n) => n.name === "Variable");
      destination.children.splice(
        next < 0 ? destination.children.length : next,
        0,
        node,
      );
    } else destination.children.push(node);
  }
  // Bring the translations for every imported primary text along with its ID.
  for (const language of elements(
    path(root(source), "ExternalTextCollection"),
    "Language",
  ))
    for (const text of elements(language, "Text"))
      if (mapping.has(text.attrs.id)) {
        const copy = structuredClone(text);
        copy.attrs.id = mapping.get(text.attrs.id);
        const destination = destinationFor(
          doc,
          copy,
          language.attrs["xml:lang"],
        );
        if (
          !elements(destination, "Text").some(
            (n) => n.attrs.id === copy.attrs.id,
          )
        )
          destination.children.push(copy);
      }
  return Object.fromEntries(mapping);
}
export function exportElementsXML(doc, selectors) {
  const selected = dependencies(doc, selectors),
    wrapper = element("IODDElements", {
      ...Object.fromEntries(
        Object.entries(root(doc).attrs).filter(([key]) =>
          key.startsWith("xmlns:"),
        ),
      ),
      xmlns: NS,
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    });
  const texts = selected.filter((n) => n.name === "Text"),
    other = selected.filter((n) => n.name !== "Text");
  wrapper.children.push(...structuredClone(other));
  if (texts.length) {
    const collection = element("ExternalTextCollection"),
      sourcePrimary = primary(doc);
    collection.children.push(
      element(
        "PrimaryLanguage",
        { "xml:lang": sourcePrimary?.attrs["xml:lang"] ?? "en" },
        structuredClone(texts),
      ),
    );
    const ids = new Set(texts.map((n) => n.attrs.id));
    for (const language of elements(
      path(root(doc), "ExternalTextCollection"),
      "Language",
    ))
      collection.children.push(
        element(
          "Language",
          { ...language.attrs },
          structuredClone(
            elements(language, "Text").filter((n) => ids.has(n.attrs.id)),
          ),
        ),
      );
    wrapper.children.push(collection);
  }
  return previewXML({
    declaration: { version: "1.0", encoding: "UTF-8" },
    children: [wrapper],
  });
}
export function communicationView(doc) {
  const node = path(root(doc), "CommNetworkProfile"),
    physical = path(node, "TransportLayers", "PhysicalLayer");
  return {
    mode:
      node?.attrs["xsi:type"]?.split(":").pop() ===
      "IOLinkWirelessCommNetworkProfileT"
        ? "wireless"
        : "wired",
    revision:
      node?.attrs.iolinkWirelessRevision ?? node?.attrs.iolinkRevision ?? "",
    physicalLayer: { attrs: { ...physical?.attrs } },
  };
}
function integer(value, min, max, label) {
  if (
    !/^-?\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw Error(label + " must be an integer from " + min + " to " + max + ".");
  return String(Number(value));
}
function boolean(value) {
  if (![true, false, "true", "false", "1", "0"].includes(value))
    throw Error("Use true or false.");
  return [true, "true", "1"].includes(value) ? "true" : "false";
}
export function editCommunication(doc, operation) {
  const profile = path(root(doc), "CommNetworkProfile"),
    physical = path(profile, "TransportLayers", "PhysicalLayer");
  if (!profile || !physical)
    throw Error("Missing communication profile or physical layer.");
  const values = operation.values ?? {},
    mode = operation.mode;
  if (!["wired", "wireless"].includes(mode))
    throw Error("Choose wired or wireless communication.");
  const same = communicationView(doc).mode === mode,
    attrs = same ? { ...physical.attrs } : {};
  if (mode === "wireless") {
    for (const key of ["WMinCycleTimeIn", "WMinCycleTimeOut"]) {
      const value = values[key] ?? attrs[key] ?? 5000;
      attrs[key] = integer(value, 0, 315000, key);
      if (Number(attrs[key]) > 0 && Number(attrs[key]) < 5000)
        throw Error(key + " must be 0 or 5000–315000.");
    }
    attrs.maxTxPower = integer(
      values.maxTxPower ?? attrs.maxTxPower ?? 0,
      -20,
      10,
      "Maximum TX power",
    );
    attrs.defaultSlotType =
      values.defaultSlotType ?? attrs.defaultSlotType ?? "SSLOT";
    if (!["SSLOT", "DSLOT"].includes(attrs.defaultSlotType))
      throw Error("Slot type must be SSLOT or DSLOT.");
    for (const key of ["isABridge", "isLowPowerDevice"])
      if (key in values || key in attrs)
        attrs[key] = boolean(values[key] ?? attrs[key]);
    delete profile.attrs.iolinkRevision;
    delete profile.attrs.compatibleWith;
    profile.attrs["xsi:type"] = "IOLinkWirelessCommNetworkProfileT";
    profile.attrs.iolinkWirelessRevision = values.revision ?? "V1.1";
  } else {
    attrs.bitrate = values.bitrate ?? attrs.bitrate ?? "COM2";
    if (!["COM1", "COM2", "COM3"].includes(attrs.bitrate))
      throw Error("Bitrate must be COM1, COM2 or COM3.");
    attrs.minCycleTime = integer(
      values.minCycleTime ?? attrs.minCycleTime ?? 1000,
      0,
      132800,
      "Minimum cycle time",
    );
    attrs.mSequenceCapability = integer(
      values.mSequenceCapability ?? attrs.mSequenceCapability ?? 11,
      0,
      255,
      "M-sequence capability",
    );
    attrs.sioSupported = boolean(
      values.sioSupported ?? attrs.sioSupported ?? false,
    );
    delete profile.attrs.iolinkWirelessRevision;
    profile.attrs["xsi:type"] = "IOLinkCommNetworkProfileT";
    profile.attrs.iolinkRevision = "V1.1";
  }
  physical.attrs = attrs;
}

function safePattern(pattern) {
  return compilePattern(pattern);
}
export function checkRules(rules) {
  if (!Array.isArray(rules) || rules.length > 128)
    throw Error("Use at most 128 validation rules.");
  const ids = new Set();
  for (const rule of rules) {
    if (
      !rule ||
      typeof rule.id !== "string" ||
      !rule.id ||
      rule.id.length > 128 ||
      ids.has(rule.id)
    )
      throw Error("Validation rule IDs must be unique and nonempty.");
    ids.add(rule.id);
    if (!["required", "range", "pattern"].includes(rule.kind))
      throw Error("Rule kind must be required, range or pattern.");
    if (
      typeof rule.selector !== "string" &&
      (!Array.isArray(rule.selector) ||
        rule.selector.length > 128 ||
        rule.selector.some((n) => !Number.isInteger(n) || n < 0))
    )
      throw Error("Invalid rule selector.");
    if (rule.attribute !== undefined) validName(rule.attribute);
    if (
      rule.severity !== undefined &&
      !["error", "warning"].includes(rule.severity)
    )
      throw Error("Invalid rule severity.");
    if (rule.kind === "range") {
      if (
        (rule.min !== undefined && !Number.isFinite(rule.min)) ||
        (rule.max !== undefined && !Number.isFinite(rule.max)) ||
        (rule.min !== undefined &&
          rule.max !== undefined &&
          rule.min > rule.max)
      )
        throw Error("Invalid numeric rule range.");
    }
    if (rule.kind === "pattern") safePattern(rule.pattern);
  }
}
export function ruleIssues(doc, rules = []) {
  checkRules(rules);
  const issues = [];
  for (const rule of rules) {
    try {
      const node = selectNode(doc, rule.selector),
        value = rule.attribute
          ? node.attrs?.[rule.attribute]
          : node.type === "text"
            ? node.value
            : node.children
                ?.filter((n) => n.type === "text")
                .map((n) => n.value)
                .join("");
      let valid = true;
      if (rule.kind === "required")
        valid = rule.attribute
          ? value !== undefined && String(value).trim() !== ""
          : !!node;
      if (rule.kind === "range") {
        valid =
          value !== undefined &&
          String(value).trim() !== "" &&
          Number.isFinite(Number(value)) &&
          (rule.min === undefined || Number(value) >= rule.min) &&
          (rule.max === undefined || Number(value) <= rule.max);
      }
      if (rule.kind === "pattern")
        valid =
          typeof value === "string" &&
          value.length <= 512 &&
          safePattern(rule.pattern).test(value);
      if (!valid)
        throw Error(
          "does not satisfy " +
            rule.kind +
            " check" +
            (rule.attribute ? " for " + rule.attribute : ""),
        );
    } catch (error) {
      issues.push({
        severity: rule.severity ?? "error",
        message: "Rule " + rule.id + ": " + error.message,
        check: "rules",
      });
    }
  }
  return issues;
}
function catalog(doc) {
  const supported = path(root(doc), "SupportedProfiles");
  if (!supported) throw Error("Profile definitions require SupportedProfiles.");
  return {
    name: supported.attrs.profileClassName ?? "Profile definitions",
    namespace: PROFILE_NS,
    variants: elements(supported)
      .filter((n) => ["ProfileVariant", "FunctionClass"].includes(n.name))
      .map((n) => ({ ...n.attrs })),
    requirements: supported.attrs.requiredProfile ?? "",
  };
}
export function profileView(pack) {
  const doc = importSupplementXML(pack.xml);
  if (root(doc).name !== "IODDProfileDefinitions")
    throw Error("Use official IODDProfileDefinitions XML for profile packs.");
  const placeholders = [];
  function visit(node, selector = []) {
    if (node.type !== "element") return;
    for (const [attribute, value] of Object.entries(node.attrs))
      if (
        value.includes("#tbd") ||
        (node.attrs.checkAttributes ?? "").includes("startsWith " + attribute)
      )
        placeholders.push({
          key: JSON.stringify(selector) + "@" + attribute,
          value,
          selector,
          attribute,
          optional: /minOccurs\s+0/.test(node.attrs.checkElement ?? ""),
          kind: value.includes("#tbd") ? "value" : "binding",
        });
    node.children.forEach((child, index) => visit(child, [...selector, index]));
  }
  visit(root(doc));
  return { id: pack.id, ...catalog(doc), placeholders };
}
export function loadProfile(profiles, operation) {
  const pack = { id: "Profile_" + (profiles.length + 1), xml: operation.xml };
  const view = profileView(pack);
  if (operation.name) pack.name = String(operation.name);
  if (!view.variants.length)
    throw Error("Profile definitions have no supported variants.");
  return pack;
}
function materializeProfile(pack, profileId, replacements = {}, targetDoc) {
  const doc = importSupplementXML(pack.xml),
    view = catalog(doc),
    variant = view.variants.find(
      (n) => String(n.profileId) === String(profileId),
    );
  if (!variant) throw Error("Unknown profile ID in this pack.");
  const bindings = new Map();
  function convert(node, selector = []) {
    if (node.type !== "element") return structuredClone(node);
    if (
      node.attrs.profileConstraints &&
      !node.attrs.profileConstraints.split(/[,\s]+/).includes(variant.id)
    )
      return null;
    if (/maxOccurs\s+0/.test(node.attrs.checkElement ?? "")) return null;
    const optional = /minOccurs\s+0/.test(node.attrs.checkElement ?? "");
    if (optional) {
      const prefix = JSON.stringify(selector).slice(0, -1),
        explicit =
          Object.keys(replacements).some((key) => key.startsWith(prefix)) ||
          [...walk(node)].some((child) =>
            Object.values(child.attrs).some(
              (value) =>
                value.includes("#tbd") && replacements[value] !== undefined,
            ),
          );
      if (!explicit) return null;
    }
    if ((node.attrs.checkAttributes ?? "").includes("startsWith id")) {
      const value =
        replacements[JSON.stringify(selector) + "@id"] ??
        replacements[node.attrs.id + "@id"];
      if (value === undefined) {
        if (optional) return null;
        throw Error(
          "Bind profile template " +
            JSON.stringify(selector) +
            "@id (" +
            node.attrs.id +
            ") to an existing element ID.",
        );
      }
      const target = selectNode(targetDoc, String(value));
      if (target.name !== node.name)
        throw Error(
          "Profile binding must reference an existing " + node.name + ".",
        );
      bindings.set(node.attrs.id, target.attrs.id);
      return null;
    }
    const copy = structuredClone(node);
    copy.children = [];
    for (const [key, value] of Object.entries(copy.attrs)) {
      if (value.includes("#tbd")) {
        const replacement =
          replacements[JSON.stringify(selector) + "@" + key] ??
          replacements[value];
        if (replacement !== undefined) copy.attrs[key] = String(replacement);
        else if (optional) return null;
        else if ((node.attrs.checkAttributes ?? "").includes("option " + key))
          delete copy.attrs[key];
        else
          throw Error(
            "Provide profile placeholder " +
              JSON.stringify(selector) +
              "@" +
              key +
              ": " +
              value,
          );
      }
      if (
        [
          "checkElement",
          "checkAttributes",
          "profileConstraints",
          "contextConstraints",
        ].includes(key)
      )
        delete copy.attrs[key];
    }
    node.children.forEach((child, index) => {
      const next = convert(child, [...selector, index]);
      if (next) copy.children.push(next);
    });
    if (
      copy.name === "Menu" &&
      !elements(copy).some((n) =>
        ["VariableRef", "RecordItemRef", "MenuRef"].includes(n.name),
      )
    )
      return null;
    return copy;
  }
  for (const node of walk(root(doc)))
    for (const key of referenceKeys)
      if (bindings.has(node.attrs[key]))
        node.attrs[key] = bindings.get(node.attrs[key]);
  const result = {
    declaration: { version: "1.0", encoding: "UTF-8" },
    children: [convert(root(doc))],
  };
  root(result).name = "IODDElements";
  root(result).attrs = {
    xmlns: NS,
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  };
  for (const node of walk(root(result)))
    for (const key of referenceKeys)
      if (bindings.has(node.attrs[key]))
        node.attrs[key] = bindings.get(node.attrs[key]);
  return { doc: result, variant, view };
}
export function applyProfile(doc, pack, operation) {
  const materialized = materializeProfile(
      pack,
      operation.profileId,
      operation.replacements,
      doc,
    ),
    selectors = [];
  for (const collection of [
    "DatatypeCollection",
    "VariableCollection",
    "ProcessDataCollection",
    "EventCollection",
    "ErrorTypeCollection",
  ])
    for (const node of elements(path(root(materialized.doc), collection)))
      selectors.push(node.attrs.id ?? nodeSelector(materialized.doc, node));
  const menus = elements(
    path(root(materialized.doc), "UserInterface", "MenuCollection"),
    "Menu",
  );
  selectors.push(...menus.map((n) => n.attrs.id));
  if (!selectors.length)
    throw Error("Selected profile has no materialized definitions.");
  const mapping = importElementsInto(doc, {
      xml: previewXML(materialized.doc),
      selectors,
      collision: "error",
      composeProfiles: true,
    }),
    features = path(fn(doc), "Features");
  if (!features) throw Error("Missing Features.");
  const characteristics = new Set(
    (features.attrs.profileCharacteristic ?? "").split(/\s+/).filter(Boolean),
  );
  characteristics.add(String(operation.profileId));
  features.attrs.profileCharacteristic = [...characteristics].join(" ");
  // Connect profile menus to matching existing role menus while preserving device menus.
  const sourceUI = path(root(materialized.doc), "UserInterface"),
    targetUI = path(fn(doc), "UserInterface");
  for (const role of [
    "ObserverRoleMenuSet",
    "MaintenanceRoleMenuSet",
    "SpecialistRoleMenuSet",
  ])
    for (const ref of elements(path(sourceUI, role))) {
      const menuId = mapping[ref.attrs.menuId] ?? ref.attrs.menuId;
      if (!menus.some((n) => n.attrs.id === ref.attrs.menuId)) continue;
      const targetRole = path(targetUI, role);
      if (!targetRole)
        throw Error("Missing target role menu set " + role + ".");
      const targetRef = path(targetRole, ref.name);
      if (!targetRef) {
        const names = [
            "IdentificationMenu",
            "ParameterMenu",
            "ObservationMenu",
            "DiagnosisMenu",
          ],
          rank = names.indexOf(ref.name),
          index = targetRole.children.findIndex(
            (n) => names.indexOf(n.name) > rank,
          );
        targetRole.children.splice(
          index < 0 ? targetRole.children.length : index,
          0,
          element(ref.name, { menuId }),
        );
        continue;
      }
      const targetMenu = elements(
        path(targetUI, "MenuCollection"),
        "Menu",
      ).find((n) => n.attrs.id === targetRef.attrs.menuId);
      if (
        targetMenu &&
        menuId !== targetMenu.attrs.id &&
        !elements(targetMenu, "MenuRef").some((n) => n.attrs.menuId === menuId)
      )
        targetMenu.children.push(element("MenuRef", { menuId }));
    }
  return {
    profileId: String(operation.profileId),
    name: materialized.variant.name,
    requiredProfiles: [
      ...new Set([
        ...materialized.view.requirements.split(/\s+/).filter(Boolean),
        ...(materialized.variant.profileContext
          ? [materialized.variant.profileContext]
          : []),
      ]),
    ].join(" "),
  };
}

export function newDeviceXML() {
  const text = (name, value) => element(name, {}, [{ type: "text", value }]);
  const header = element("ProfileHeader", {}, [
    text("ProfileIdentification", "IO Device Profile"),
    text("ProfileRevision", "1.1"),
    text("ProfileName", "Device Profile for IO Devices"),
    text("ProfileSource", "IO-Link Consortium"),
    text("ProfileClassID", "Device"),
    element("ISO15745Reference", {}, [
      text("ISO15745Part", "1"),
      text("ISO15745Edition", "1"),
      text("ProfileTechnology", "IODD"),
    ]),
  ]);
  const identity = element(
    "DeviceIdentity",
    { vendorId: "1234", deviceId: "5678", vendorName: "New manufacturer" },
    ["VendorText", "VendorUrl", "DeviceName", "DeviceFamily"].map((name) =>
      element(name, { textId: "T_" + name }),
    ),
  );
  identity.children.push(
    element("DeviceVariantCollection", {}, [
      element("DeviceVariant", { productId: "new-device" }, [
        element("Name", { textId: "T_ProductName" }),
        element("Description", { textId: "T_Description" }),
      ]),
    ]),
  );
  const menus = element("UserInterface", {}, [
    element("MenuCollection", {}, [
      element("Menu", { id: "M_Identification" }, [
        element("Name", { textId: "T_Identification" }),
        element("VariableRef", { variableId: "V_DirectParameters_1" }),
        element("VariableRef", { variableId: "V_ApplicationSpecificTag" }),
      ]),
    ]),
    ...[
      "ObserverRoleMenuSet",
      "MaintenanceRoleMenuSet",
      "SpecialistRoleMenuSet",
    ].map((name) =>
      element(name, {}, [
        element("IdentificationMenu", { menuId: "M_Identification" }),
      ]),
    ),
  ]);
  const fn = element("DeviceFunction", {}, [
    element("Features", { blockParameter: "false", dataStorage: "false" }),
    element("VariableCollection", {}, [
      element("StdVariableRef", { id: "V_DirectParameters_1" }),
      element("StdVariableRef", { id: "V_DirectParameters_2" }),
      element("StdVariableRef", { id: "V_ProductName" }),
      element("StdVariableRef", { id: "V_ApplicationSpecificTag" }),
      element("StdVariableRef", {
        id: "V_ProductID",
        defaultValue: "new-device",
      }),
    ]),
    element("ProcessDataCollection", {}, [
      element("ProcessData", { id: "PD_None" }),
    ]),
    menus,
  ]);
  const connection = element("Connection", { "xsi:type": "OtherConnectionT" }, [
    element("ProductRef", { productId: "new-device" }),
    element("Description", { textId: "T_Connection" }),
  ]);
  const comm = element(
    "CommNetworkProfile",
    { "xsi:type": "IOLinkCommNetworkProfileT", iolinkRevision: "V1.1" },
    [
      element("TransportLayers", {}, [
        element(
          "PhysicalLayer",
          {
            bitrate: "COM2",
            minCycleTime: "1000",
            sioSupported: "false",
            mSequenceCapability: "11",
          },
          [connection],
        ),
      ]),
      element("Test", {}, [
        element("Config1", { index: "24", testValue: "0x49" }),
        element("Config2", { index: "256", testValue: "0x00" }),
        element("Config3", { index: "24", testValue: "0x49,0x49,0x49,0x49,0x49,0x49,0x49,0x49,0x49,0x49,0x49,0x49,0x49" }),
      ]),
    ],
  );
  const texts = {
    VendorText: "New manufacturer",
    VendorUrl: "",
    DeviceName: "New device",
    DeviceFamily: "Device",
    ProductName: "New device",
    Description:
      "New device description; complete the actual device identity and communication settings.",
    Identification: "Identification",
    Connection: "Define the actual physical connection before release.",
  };
  const document = {
    declaration: { version: "1.0", encoding: "UTF-8" },
    children: [
      element(
        "IODevice",
        {
          xmlns: NS,
          "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
          "xsi:schemaLocation": NS + " IODD1.1.xsd",
        },
        [
          element("DocumentInfo", {
            copyright: "Device manufacturer",
            releaseDate: "2000-01-01",
            version: "V1.0",
          }),
          header,
          element("ProfileBody", {}, [identity, fn]),
          comm,
          element("ExternalTextCollection", {}, [
            element(
              "PrimaryLanguage",
              { "xml:lang": "en" },
              Object.entries(texts).map(([name, value]) =>
                element("Text", { id: "T_" + name, value }),
              ),
            ),
          ]),
          element("Stamp", { crc: "0" }, [
            element("Checker", { name: "iolinki-authoring", version: "V1.0" }),
          ]),
        ],
      ),
    ],
  };
  return previewXML(document);
}
