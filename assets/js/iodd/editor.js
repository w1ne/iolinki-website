import {
  createProject,
  createNewProject,
  loadProject,
  saveProject,
  inspectProject,
  applyOperation,
  validateProject,
  exportProjectXML,
  generateFirmwareHeader,
  diffProjects,
  inspectDocumentTree,
} from "./project.js";
import { importPackage, exportPackage } from "./package.js";
let project = null,
  section = "identity",
  selectedVariable = null,
  selectedProcess = null,
  selectedText = null,
  xmlPending = false,
  saved = false,
  comparison = null,
  selectedNode = [],
  snippetSource = null,
  validationChecks = {
    structure: true,
    references: true,
    ranges: true,
    processData: true,
    crc: true,
  };
const $ = (id) => document.getElementById(id);
const labels = {
  identity: "Identity",
  parameters: "Parameters",
  process: "Process data",
  texts: "Texts & languages",
  events: "Events & menus",
  files: "Files & changes",
  validation: "Validation",
  xml: "XML",
  tree: "Document tree",
  library: "Element library",
  communication: "Communication",
  finder: "IODD Finder",
  firmware: "Firmware package",
};
function message(text) {
  $("status").textContent = text;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function field(parent, label, value, key, options) {
  const wrap = element("label", label);
  const control = element(options ? "select" : "input");
  control.setAttribute("aria-label", label);
  control.name = key;
  if (options)
    for (const option of options) {
      const node = element("option", option);
      node.value = option;
      control.append(node);
    }
  control.value = value ?? "";
  wrap.append(control);
  parent.append(wrap);
  return control;
}
function action(parent, label, callback, type = "button", className = "") {
  const node = element("button", label, className);
  node.type = type;
  if (callback) node.addEventListener("click", callback);
  parent.append(node);
  return node;
}
function formValues(form) {
  return Object.fromEntries(new FormData(form));
}
function guard() {
  if (xmlPending) {
    message(
      "Apply the pending XML changes before using another editor or export.",
    );
    return false;
  }
  return true;
}
function apply(operation, success) {
  if (!guard()) return false;
  try {
    project = applyOperation(project, operation);
    saved = false;
    render();
    message(success);
    return true;
  } catch (error) {
    message(error.message);
    return false;
  }
}
function activate(name, focus = false) {
  section = name;
  for (const button of document.querySelectorAll("[data-panel]")) {
    const selected = button.dataset.panel === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $("panel-" + button.dataset.panel).hidden = !selected;
    if (selected && focus) button.focus();
  }
}
function updateState() {
  const view = inspectProject(project);
  $("project-title").textContent =
    view.identity.productName || project.filename || "Device project";
  $("save-state").textContent = xmlPending
    ? "XML changes not applied"
    : saved
      ? "Project saved to file"
      : "Unsaved changes";
  $("save-project").disabled = xmlPending;
  const validation = validateProject(project, { checks: validationChecks });
  $("download").disabled = xmlPending || !validation.valid;
}
function renderIdentity(view) {
  $("identity-fields").replaceChildren();
  for (const [key, label] of [
    ["vendorId", "Vendor ID"],
    ["deviceId", "Device ID"],
    ["vendorName", "Vendor name"],
    ["productName", "English device name"],
    ["productId", "Product ID"],
    ["releaseDate", "Release date"],
    ["version", "Document version"],
  ])
    field($("identity-fields"), label, view.identity[key], key);
}
function renderParameters(view) {
  const query = $("parameter-search").value.toLowerCase();
  const list = view.variables.filter((v) =>
    [v.id, v.name, v.index].join(" ").toLowerCase().includes(query),
  );
  $("parameter-rows").replaceChildren();
  $("parameter-empty").hidden = list.length > 0;
  if (!view.variables.some((v) => v.id === selectedVariable))
    selectedVariable = view.variables[0]?.id;
  for (const variable of list) {
    const row = element("tr");
    row.className = variable.id === selectedVariable ? "selected" : "";
    const index = element("td");
    index.append(
      element("strong", String(variable.index)),
      element("code", "0x" + Number(variable.index).toString(16).toUpperCase()),
    );
    const name = element("td");
    action(name, variable.name || variable.id, () => {
      selectedVariable = variable.id;
      renderParameters(inspectProject(project));
    });
    name.append(
      element("code", variable.type + " · " + variable.bits + " bits"),
    );
    row.append(index, name, element("td", variable.access));
    $("parameter-rows").append(row);
  }
  $("parameter-detail").replaceChildren();
  const variable = view.variables.find((v) => v.id === selectedVariable);
  if (!variable) {
    $("parameter-detail").append(
      element("p", "Select or add a parameter.", "empty-note"),
    );
    return;
  }
  const form = element("form");
  form.dataset.variable = variable.id;
  form.append(element("h3", variable.id));
  if (!variable.editable) {
    form.append(
      element(
        "p",
        "Shared or complex datatype. Its complete definition is preserved; edit it in XML.",
        "small-note",
      ),
    );
    $("parameter-detail").append(form);
    return;
  }
  const grid = element("div", undefined, "form-grid");
  form.append(grid);
  for (const [key, label, options] of [
    ["name", "Parameter name"],
    ["index", "Index"],
    ["access", "Access", ["ro", "rw", "wo"]],
    ["type", "Datatype", ["UIntegerT", "IntegerT", "StringT", "OctetStringT"]],
    ["bits", "Bit length"],
    ["defaultValue", "Default value"],
    ["lower", "Lower bound"],
    ["upper", "Upper bound"],
  ])
    field(grid, label, variable[key], key, options);
  const actions = element("div", undefined, "row-actions");
  form.append(actions);
  action(actions, "Apply parameter", null, "submit", "primary-button");
  action(
    actions,
    "Remove",
    () =>
      apply({ type: "removeVariable", id: variable.id }, "Parameter removed."),
    "button",
    "remove",
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply(
      { type: "editVariable", id: variable.id, values: formValues(form) },
      "Parameter updated.",
    );
  });
  $("parameter-detail").append(form);
}
function renderProcess(view) {
  $("process-data").replaceChildren();
  $("process-detail").replaceChildren();
  for (const pd of view.processData) {
    const record = element("section", undefined, "process-record");
    const heading = element("div", undefined, "record-heading");
    heading.append(
      element(
        "h3",
        pd.direction.toUpperCase() + " · " + pd.id + " · " + pd.bits + " bits",
      ),
    );
    if (pd.editable)
      action(heading, "+ Add field", () => {
        if (!guard()) return;
        const used = new Set();
        for (const f of pd.fields)
          for (
            let b = Number(f.offset);
            b < Number(f.offset) + Number(f.bits);
            b++
          )
            used.add(b);
        let offset = 0;
        while (used.has(offset)) offset++;
        selectedProcess = {
          id: pd.id,
          isNew: true,
          values: {
            name: "New field",
            offset: String(offset),
            bits: "1",
            type: "BooleanT",
          },
        };
        renderProcess(inspectProject(project));
      });
    record.append(heading);
    const bits = element("div", undefined, "bit-layout");
    bits.setAttribute(
      "aria-label",
      "Process bit layout, most significant bit first",
    );
    for (let b = Number(pd.bits) - 1; b >= 0; b--) {
      const index = pd.fields.findIndex(
        (f) => b >= Number(f.offset) && b < Number(f.offset) + Number(f.bits),
      );
      const cell = element(
        "span",
        String(b),
        "bit-cell" + (index >= 0 ? " field-" + (index % 4) : ""),
      );
      cell.title =
        index >= 0 ? pd.fields[index].name + ": bit " + b : "Unused bit " + b;
      bits.append(cell);
    }
    record.append(bits);
    const fields = element("div", undefined, "field-list");
    for (const f of pd.fields) {
      const chip = action(
        fields,
        "",
        () => {
          selectedProcess = { id: pd.id, index: f.index };
          renderProcess(inspectProject(project));
        },
        "button",
        "field-chip" +
          (selectedProcess?.id === pd.id && selectedProcess?.index === f.index
            ? " selected"
            : ""),
      );
      chip.append(
        element("i"),
        element("strong", f.name),
        element("span", "bit " + f.offset + " · " + f.bits + "b"),
      );
    }
    record.append(fields);
    $("process-data").append(record);
  }
  if (!selectedProcess) {
    const pd = view.processData.find((pd) => pd.editable && pd.fields.length);
    if (pd) selectedProcess = { id: pd.id, index: 0 };
  }
  const pd = view.processData.find((pd) => pd.id === selectedProcess?.id);
  const current = selectedProcess?.isNew
    ? selectedProcess.values
    : pd?.fields.find((f) => f.index === selectedProcess?.index);
  if (!current) return;
  const form = element("form");
  form.append(
    element("h3", selectedProcess.isNew ? "Add process field" : current.name),
  );
  const grid = element("div", undefined, "form-grid");
  form.append(grid);
  for (const [key, label, options] of [
    ["name", "Field name"],
    ["offset", "Bit offset"],
    ["bits", "Field bits"],
    ["type", "Field datatype", ["UIntegerT", "IntegerT", "BooleanT"]],
  ])
    field(grid, label, current[key], key, options).disabled =
      !pd?.editable || current.editable === false;
  const actions = element("div", undefined, "row-actions");
  form.append(actions);
  if (pd?.editable && current.editable !== false) {
    action(
      actions,
      selectedProcess.isNew ? "Add field" : "Apply field",
      null,
      "submit",
      "primary-button",
    );
    if (!selectedProcess.isNew)
      action(
        actions,
        "Remove field",
        () => {
          const removed = apply(
            {
              type: "removeProcessField",
              id: pd.id,
              index: selectedProcess.index,
            },
            "Process field removed.",
          );
          if (removed) {
            selectedProcess = null;
            renderProcess(inspectProject(project));
          }
        },
        "button",
        "remove",
      );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const isNew = selectedProcess.isNew;
      const changed = apply(
        {
          type: isNew ? "addProcessField" : "editProcessField",
          id: pd.id,
          index: selectedProcess.index,
          values: formValues(form),
        },
        isNew ? "Process field added." : "Process field updated.",
      );
      if (isNew && changed) {
        selectedProcess = {
          id: pd.id,
          index:
            inspectProject(project).processData.find((p) => p.id === pd.id)
              .fields.length - 1,
        };
        renderProcess(inspectProject(project));
      }
    });
  } else
    form.append(
      element("p", "Edit this preserved datatype in XML.", "small-note"),
    );
  $("process-detail").append(form);
}
function renderTexts(view) {
  const oldLanguage = $("text-language").value;
  $("text-language").replaceChildren();
  for (const lang of view.texts || []) {
    const option = element(
      "option",
      lang.language + (lang.primary ? " · primary" : ""),
    );
    option.value = lang.language;
    $("text-language").append(option);
  }
  if ((view.texts || []).some((lang) => lang.language === oldLanguage))
    $("text-language").value = oldLanguage;
  const group = (view.texts || []).find(
    (lang) => lang.language === $("text-language").value,
  );
  const query = $("text-search").value.toLowerCase();
  $("text-rows").replaceChildren();
  for (const text of group?.texts || []) {
    if (![text.id, text.value].join(" ").toLowerCase().includes(query))
      continue;
    const button = action(
      $("text-rows"),
      text.id,
      () => {
        selectedText = text.id;
        $("text-language-code").value = group.language;
        $("text-id").value = text.id;
        $("text-value").value = text.value;
        renderTexts(inspectProject(project));
      },
      "button",
      selectedText === text.id ? "selected" : "",
    );
    button.append(element("span", text.value));
  }
  if (!selectedText && group?.texts?.length) {
    selectedText = group.texts[0].id;
    $("text-language-code").value = group.language;
    $("text-id").value = selectedText;
    $("text-value").value = group.texts[0].value;
  }
}
function renderEvents(view) {
  $("event-list").replaceChildren();
  for (const event of view.events || [])
    action(
      $("event-list"),
      String(event.code) + " · " + (event.name || event.type),
      () => {
        for (const [key, value] of Object.entries(event))
          if ($("event-form").elements.namedItem(key))
            $("event-form").elements.namedItem(key).value = value;
      },
    );
  if (!view.events?.length)
    $("event-list").append(element("p", "No device events yet.", "empty-note"));
  $("menu-list").replaceChildren();
  for (const menu of view.menus || [])
    action($("menu-list"), menu.name || menu.id, () => {
      for (const [key, value] of Object.entries(menu))
        if ($("menu-form").elements.namedItem(key))
          $("menu-form").elements.namedItem(key).value = Array.isArray(value)
            ? value.join(", ")
            : value;
    });
}
function renderFiles(view) {
  $("asset-list").replaceChildren();
  for (const asset of view.assets || []) {
    const row = element("div", undefined, "asset-item");
    row.append(
      element("strong", asset.name),
      element(
        "span",
        Number.isFinite(asset.size)
          ? asset.size + " bytes"
          : "Package resource",
      ),
    );
    action(
      row,
      "Remove",
      () => apply({ type: "removeAsset", name: asset.name }, "File removed."),
      "button",
      "remove",
    );
    $("asset-list").append(row);
  }
  if (!view.assets?.length)
    $("asset-list").append(
      element(
        "p",
        "No extra files. Add images or open an existing IODD ZIP.",
        "empty-note",
      ),
    );
  if (comparison) {
    const diff = diffProjects(comparison, project);
    $("comparison-result").replaceChildren(
      element(
        "p",
        diff.mappingCompatible
          ? "Firmware mapping remains compatible."
          : "Firmware mapping changed.",
      ),
    );
    const list = element("ul");
    for (const change of diff.changes)
      list.append(
        element(
          "li",
          change.path +
            ": " +
            JSON.stringify(change.before) +
            " → " +
            JSON.stringify(change.after),
        ),
      );
    if (!diff.changes.length) list.append(element("li", "No changes."));
    $("comparison-result").append(list);
  }
}

function treeNode(root, path) {
  return path.reduce((node, index) => node?.children?.[index], root);
}
function treeItems(root) {
  const items = [];
  function walk(node, path, depth) {
    if (node.type === "element") items.push({ node, path, depth });
    for (const [index, child] of (node.children || []).entries())
      if (child.type === "element") walk(child, [...path, index], depth + 1);
  }
  walk(root, [], 0);
  return items;
}
function renderTree() {
  const root = inspectDocumentTree(project);
  const filter = $("tree-search").value.toLowerCase();
  $("document-tree").replaceChildren();
  for (const { node, path, depth } of treeItems(root)) {
    if (
      filter &&
      ![node.name, ...Object.values(node.attrs || {})]
        .join(" ")
        .toLowerCase()
        .includes(filter)
    )
      continue;
    const button = action(
      $("document-tree"),
      node.name + (node.attrs?.id ? " · " + node.attrs.id : ""),
      () => {
        selectedNode = path;
        renderTree();
      },
      "button",
      JSON.stringify(path) === JSON.stringify(selectedNode) ? "selected" : "",
    );
    button.style.paddingLeft = `${12 + Math.min(depth, 8) * 12}px`;
    button.setAttribute(
      "aria-pressed",
      String(JSON.stringify(path) === JSON.stringify(selectedNode)),
    );
  }
  const node = treeNode(root, selectedNode);
  $("node-editor").replaceChildren();
  if (!node) {
    selectedNode = [];
    return renderTree();
  }
  $("node-editor").append(element("h3", node.name));
  $("snippet-target").textContent =
    "Selected destination: " +
    node.name +
    (node.attrs?.id ? " · " + node.attrs.id : "");
  const form = element("form");
  const fields = element("div", undefined, "form-grid");
  form.append(fields);
  for (const [key, value] of Object.entries(node.attrs || {})) {
    field(fields, key, value, key);
    action(fields, "Remove attribute " + key, () =>
      apply(
        {
          type: "tree",
          action: "attributes",
          selector: selectedNode,
          values: { [key]: null },
        },
        "Attribute removed.",
      ),
    );
  }
  if (Object.keys(node.attrs || {}).length)
    action(form, "Apply element attributes", null, "submit", "primary-action");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply(
      {
        type: "tree",
        action: "attributes",
        selector: selectedNode,
        values: formValues(form),
      },
      "Element attributes updated.",
    );
  });
  $("node-editor").append(form);
  const addAttribute = element("form", undefined, "form-grid");
  field(addAttribute, "New attribute name", "", "attributeName");
  field(addAttribute, "New attribute value", "", "attributeValue");
  action(addAttribute, "Add attribute", null, "submit");
  addAttribute.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = formValues(addAttribute);
    apply(
      {
        type: "tree",
        action: "attributes",
        selector: selectedNode,
        values: { [values.attributeName]: values.attributeValue },
      },
      "Attribute added.",
    );
  });
  $("node-editor").append(addAttribute);
  const text = (node.children || [])
    .filter((child) => child.type === "text")
    .map((child) => child.value ?? child.text ?? "")
    .join("");
  if (!(node.children || []).some((child) => child.type === "element")) {
    const textForm = element("form");
    field(textForm, "Element text", text, "text");
    action(textForm, "Apply element text", null, "submit");
    textForm.addEventListener("submit", (event) => {
      event.preventDefault();
      apply(
        {
          type: "tree",
          action: "text",
          selector: selectedNode,
          value: formValues(textForm).text,
        },
        "Element text updated.",
      );
    });
    $("node-editor").append(textForm);
  }
  const childForm = element("form", undefined, "form-grid");
  field(childForm, "Child element name", "", "name");
  action(childForm, "Add child element", null, "submit");
  childForm.addEventListener("submit", (event) => {
    event.preventDefault();
    apply(
      {
        type: "tree",
        action: "insert",
        selector: selectedNode,
        node: {
          type: "element",
          name: formValues(childForm).name,
          attrs: {},
          children: [],
        },
      },
      "Child element added. Complete its attributes in the tree.",
    );
  });
  $("node-editor").append(childForm);
  if (selectedNode.length)
    action(
      $("node-editor"),
      "Remove selected element",
      () => {
        const selector = selectedNode;
        if (
          apply(
            { type: "tree", action: "remove", selector },
            "Element removed.",
          )
        ) {
          selectedNode = selector.slice(0, -1);
          renderTree();
        }
      },
      "button",
      "remove-action",
    );
}

function renderProfiles(view) {
  $("profile-catalog").replaceChildren();
  for (const profile of view.profiles || []) {
    const card = element("form", undefined, "detail-card");
    card.append(element("h3", profile.name || profile.id));
    const fields = element("div", undefined, "form-grid");
    card.append(fields);
    const variants = profile.variants || [];
    const select = field(
      fields,
      "Profile variant",
      variants[0]?.profileId,
      "profileId",
      variants.map((v) => v.profileId),
    );
    for (const [index, placeholder] of (profile.placeholders || []).entries())
      field(
        fields,
        `${placeholder.attribute}: ${placeholder.value} · ${placeholder.optional ? "optional" : "required when used"}`,
        "",
        String(index),
      );
    action(card, "Apply profile", null, "submit", "primary-action");
    card.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formValues(card),
        replacements = {};
      for (const [index, placeholder] of (profile.placeholders || []).entries())
        if (values[String(index)])
          replacements[placeholder.key || placeholder.value] =
            values[String(index)];
      apply(
        {
          type: "profile",
          action: "apply",
          id: profile.id,
          profileId: select.value,
          replacements,
        },
        "Profile applied. Review its parameters and validation.",
      );
    });
    $("profile-catalog").append(card);
  }
}
$("profile-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file || !guard()) return;
  try {
    if (file.size > 4 * 1024 * 1024)
      throw Error("Profile definitions are limited to 4 MiB.");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    apply(
      { type: "profile", action: "load", xml },
      "Profile definitions loaded. Select a variant and resolve its fields.",
    );
  } catch (error) {
    message(error.message);
  }
  event.target.value = "";
});
function renderCommunication(view) {
  const communication = view.communication;
  $("communication-editor").replaceChildren();
  if (!communication) {
    $("communication-editor").append(
      element(
        "p",
        "This document has no editable communication profile. Add one in Document tree or import a profile fragment.",
      ),
    );
    return;
  }
  const form = element("form");
  const fields = element("div", undefined, "form-grid");
  form.append(fields);
  field(fields, "Communication mode", communication.mode, "mode", [
    "wired",
    "wireless",
  ]);
  for (const [key, value] of Object.entries(
    communication.physicalLayer?.attrs || {},
  ))
    field(fields, key, value, key);
  action(form, "Apply communication", null, "submit", "primary-action");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { mode, ...values } = formValues(form);
    apply(
      { type: "communication", mode, values },
      "Communication profile updated.",
    );
  });
  $("communication-editor").append(form);
  $("communication-editor").append(
    element(
      "p",
      "Switching mode preserves the document. Complete mode-specific fields in Document tree, then run schema checks.",
      "small-note",
    ),
  );
}
function renderValidation() {
  const validation = validateProject(project);
  $("validation-summary").textContent = validation.valid
    ? Object.values(validationChecks).every(Boolean)
      ? "Ready to export"
      : "Selected checks passed"
    : "Needs attention";
  $("checks").replaceChildren();
  const ruleList = $("validation-rule-editor").querySelector(".rules-list");
  ruleList.replaceChildren();
  for (const rule of project.rules || []) {
    const li = element(
      "li",
      rule.id + " · " + rule.kind + " · " + JSON.stringify(rule.selector),
    );
    action(li, "Remove rule", () =>
      apply(
        {
          type: "validationRules",
          rules: project.rules.filter((r) => r.id !== rule.id),
        },
        "Rule removed.",
      ),
    );
    ruleList.append(li);
  }
  for (const issue of validation.issues) {
    const li = element("li", issue.message, "check-" + issue.severity);
    $("checks").append(li);
  }
  if (validation.valid)
    $("checks").prepend(element("li", "Project checks passed."));
  $("validation-coverage").replaceChildren();
  for (const [key, label] of [
    ["basic", "Structure"],
    ["model", "Model & references"],
    ["crc", "CRC"],
    ["official", "Official checker"],
  ])
    $("validation-coverage").append(
      element(
        "span",
        label + (validation.coverage[key] ? " ✓" : " · not run"),
        validation.coverage[key] ? "" : "unchecked",
      ),
    );
}
function render() {
  if (!project) return;
  const view = inspectProject(project);
  $("workspace").hidden = false;
  renderIdentity(view);
  renderParameters(view);
  renderProcess(view);
  renderTexts(view);
  renderEvents(view);
  renderFiles(view);
  renderValidation();
  renderTree();
  renderCommunication(view);
  renderProfiles(view);
  if (!xmlPending) $("xml-source").value = project.xml;
  activate(section);
  updateState();
}
function reset(next, success) {
  project = next;
  selectedVariable = null;
  selectedProcess = null;
  selectedText = null;
  comparison = null;
  selectedNode = [];
  snippetSource = null;
  xmlPending = false;
  saved = false;
  section = "identity";
  render();
  message(success);
}
async function template(name) {
  try {
    const response = await fetch("/assets/iodd/" + name + ".xml");
    if (!response.ok) throw Error("Example could not be loaded.");
    reset(
      createProject(
        await response.text(),
        `iolinki-${name.replace(/[^A-Za-z0-9]/g, "")}-20261002-IODD1.1.xml`,
      ),
      "Example loaded. Edit, save or export your device project.",
    );
  } catch (error) {
    message(error.message);
  }
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = element("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let finderPage = 0;
async function runFinder(page = 0) {
  const query = $("finder-query").value.trim();
  if (!query) return;
  $("finder-results").replaceChildren(
    element("p", "Searching public IODD Finder…"),
  );
  try {
    const { searchIODDs, downloadIODD, FINDER_URL } = await import(
      "./finder.js"
    );
    const result = await searchIODDs(query, {
      page,
      size: 12,
      field: $("finder-field").value,
    });
    finderPage = result.page;
    $("finder-results").replaceChildren(
      element("p", `${result.total} public matches · page ${result.page + 1}`),
    );
    for (const entry of result.entries) {
      const card = element("div", undefined, "detail-card");
      card.append(element("h3", entry.name || entry.productName));
      card.append(element("p", entry.vendorName || `Vendor ${entry.vendorId}`));
      const link = element("a", "View in official Finder");
      link.href = entry.sourceUrl || FINDER_URL;
      link.target = "_blank";
      link.rel = "noopener";
      card.append(link);
      action(card, "Open manufacturer package", async () => {
        if (!guard()) return;
        try {
          message("Downloading public manufacturer package…");
          reset(
            await importPackage(await downloadIODD(entry)),
            "Manufacturer package opened locally from IODD Finder.",
          );
        } catch (error) {
          message(error.message);
        }
      });
      $("finder-results").append(card);
    }
    const pages = element("div", undefined, "file-toolbar");
    if (finderPage > 0)
      action(pages, "Previous results", () => runFinder(finderPage - 1));
    if (!result.last)
      action(pages, "Next results", () => runFinder(finderPage + 1));
    $("finder-results").append(pages);
  } catch (error) {
    $("finder-results").replaceChildren(element("p", error.message));
    const link = element("a", "Open official IODD Finder and import its ZIP");
    link.href = "https://ioddfinder.io-link.com/";
    link.target = "_blank";
    link.rel = "noopener";
    $("finder-results").append(link);
  }
}
$("finder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runFinder();
});
function setupFirmware() {
  const form = element("form");
  const fields = element("div", undefined, "form-grid");
  form.append(fields);
  for (const [label, key, value] of [
    ["Firmware vendor ID", "vendorId", "1234"],
    ["Firmware vendor name", "vendorName", "iolinki example"],
    ["Firmware descriptor", "firmwareDescriptor", "Counter"],
    ["Release date", "releaseDate", "2026-10-02"],
    ["Firmware revision", "fwRevision", "V1.0"],
    ["Firmware copyright", "copyright", "Copyright your company"],
    ["Hardware ID pattern", "hardwareId", "COUNTER-A"],
    ["Binary file name", "binaryName", "firmware.bin"],
    ["Firmware description", "description", "Example firmware update"],
  ])
    field(fields, label, value, key);
  const label = element("label", "Firmware binary");
  const binary = element("input");
  binary.type = "file";
  binary.required = true;
  binary.id = "firmware-binary";
  label.append(binary);
  fields.append(label);
  const resourcesLabel = element(
    "label",
    "Additional resource files (IDs use file names)",
  );
  const resourcesInput = element("input");
  resourcesInput.type = "file";
  resourcesInput.multiple = true;
  resourcesInput.id = "firmware-resources";
  resourcesLabel.append(resourcesInput);
  fields.append(resourcesLabel);
  action(form, "Create firmware package", null, "submit", "primary-action");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!guard()) return;
    try {
      const file = binary.files[0];
      if (!file || !file.size)
        throw Error("Select a non-empty firmware binary.");
      if (file.size > 16 * 1024 * 1024)
        throw Error("Firmware binary is limited to 16 MiB.");
      const values = formValues(form);
      const metadata = {
        vendorId: Number(values.vendorId),
        vendorName: values.vendorName,
        firmwareDescriptor: values.firmwareDescriptor,
        releaseDate: values.releaseDate,
        version: "V1.0",
        copyright: values.copyright,
        fwRevision: values.fwRevision,
        hardwareIds: [{ idPattern: values.hardwareId }],
        binaryName: values.binaryName,
        descriptions: [{ lang: "en", description: values.description }],
      };
      const { createFirmwarePackage, inspectFirmwarePackage } = await import(
        "./firmware-package.js"
      );
      const resourceFiles = [...resourcesInput.files];
      if (
        resourceFiles.length > 126 ||
        resourceFiles.reduce(
          (total, resource) => total + resource.size,
          file.size,
        ) >
          16 * 1024 * 1024
      )
        throw Error(
          "Firmware and resources are limited to 16 MiB and 126 resource files.",
        );
      const resources = await Promise.all(
        resourceFiles.map(async (file) => ({
          id: file.name,
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const bytes = await createFirmwarePackage(
        metadata,
        new Uint8Array(await file.arrayBuffer()),
        resources,
      );
      const report = await inspectFirmwarePackage(bytes);
      if (!report.validation.valid)
        throw Error(report.validation.issues.join("; "));
      download(bytes, report.filename, "application/zip");
      $("firmware-result").textContent =
        `Created ${report.filename}: ${report.binary.size} firmware bytes; SHA-256 ${report.binary.sha256}. Package CRC verified.`;
      message(
        "Firmware package downloaded. Validate target compatibility before use.",
      );
    } catch (error) {
      message(error.message);
    }
  });
  $("firmware-editor").append(
    form,
    element(
      "p",
      "Packages describe firmware content; this tool does not flash your device or sign the firmware.",
      "small-note",
    ),
    element("p", undefined),
  );
  $("firmware-editor").lastElementChild.id = "firmware-result";
}
setupFirmware();
$("tree-search").addEventListener("input", renderTree);
$("snippet-file").addEventListener("change", async (event) => {
  if (!guard()) return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024)
      throw Error("Element XML is limited to 4 MiB.");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    const { inspectElements } = await import("./project.js");
    snippetSource = { xml };
    const root = inspectElements(xml);
    $("snippet-preview").replaceChildren(
      element("h3", "Choose source element"),
    );
    for (const { node, path, depth } of treeItems(root)) {
      const button = action(
        $("snippet-preview"),
        node.name + (node.attrs?.id ? " · " + node.attrs.id : ""),
        () => {
          if (
            apply(
              {
                type: "importElements",
                xml: snippetSource.xml,
                selectors: [path],
                destination: selectedNode,
                collision: "rename",
                prefix: "Imported_",
              },
              "Element imported. Review its references and validation.",
            )
          )
            activate("tree");
        },
      );
      button.style.marginLeft = `${Math.min(depth, 8) * 10}px`;
    }
    message(
      "Element library opened. Select an element to insert into the destination.",
    );
  } catch (error) {
    message(error.message);
  }
  event.target.value = "";
});
$("export-snippet").addEventListener("click", async () => {
  if (!guard()) return;
  try {
    const { exportElements } = await import("./project.js");
    download(
      exportElements(project, [selectedNode]),
      "iolinki-elements.xml",
      "application/xml;charset=utf-8",
    );
    message("Selected element downloaded for reuse.");
  } catch (error) {
    message(error.message);
  }
});
$("validation-options").addEventListener("change", () => {
  for (const control of $("validation-options").elements)
    if (control.name) validationChecks[control.name] = control.checked;
  renderValidation();
});
function setupRules() {
  const form = element("form");
  const fields = element("div", undefined, "form-grid");
  form.append(element("h3", "Add a project rule"), fields);
  field(fields, "Rule ID", "", "id");
  field(fields, "Element ID or path", "", "selector");
  field(fields, "Rule kind", "required", "kind", [
    "required",
    "range",
    "pattern",
  ]);
  field(fields, "Attribute to check", "", "attribute");
  field(fields, "Minimum", "", "min");
  field(fields, "Maximum", "", "max");
  field(fields, "Pattern", "", "pattern");
  field(fields, "Severity", "error", "severity", ["error", "warning"]);
  action(form, "Save validation rule", null, "submit", "primary-action");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = formValues(form);
    let selector = values.selector;
    try {
      if (selector.startsWith("[")) selector = JSON.parse(selector);
    } catch {
      message("Enter an element ID or a JSON path such as [1,0].");
      return;
    }
    const rule = {
      id: values.id,
      selector,
      kind: values.kind,
      severity: values.severity,
    };
    if (values.attribute) rule.attribute = values.attribute;
    if (values.kind === "range") {
      rule.min = Number(values.min);
      rule.max = Number(values.max);
    }
    if (values.kind === "pattern") rule.pattern = values.pattern;
    apply(
      {
        type: "validationRules",
        rules: [...(project.rules || []).filter((r) => r.id !== rule.id), rule],
      },
      "Project validation rule saved.",
    );
  });
  $("validation-rule-editor").append(
    form,
    element("ul", undefined, "rules-list"),
  );
}
setupRules();
$("new-device").addEventListener("click", () => {
  if (!guard()) return;
  try {
    reset(
      createNewProject(),
      "New device created. Enter your assigned vendor/device IDs and describe your device.",
    );
  } catch (error) {
    message(error.message);
  }
});
$("counter").addEventListener("click", () => template("counter"));
$("sensor").addEventListener("click", () => template("switching-sensor"));
$("import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 16 * 1024 * 1024)
      throw Error("File exceeds the 16 MiB package limit.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".zip"))
      reset(await importPackage(bytes), "ZIP package opened locally.");
    else {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (file.name.toLowerCase().endsWith(".json"))
        reset(loadProject(text), "Project opened locally.");
      else reset(createProject(text, file.name), "XML opened locally.");
    }
  } catch (error) {
    message(error.message);
  }
  event.target.value = "";
});
for (const button of document.querySelectorAll("[data-panel]")) {
  button.addEventListener("click", () => activate(button.dataset.panel));
  button.addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll("[data-panel]")];
    let index = tabs.indexOf(button);
    if (
      [
        "ArrowDown",
        "ArrowRight",
        "ArrowUp",
        "ArrowLeft",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      event.preventDefault();
      index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index +
                (event.key === "ArrowUp" || event.key === "ArrowLeft"
                  ? -1
                  : 1) +
                tabs.length) %
              tabs.length;
      activate(tabs[index].dataset.panel, true);
    }
  });
}
$("identity-form").addEventListener("submit", (event) => {
  event.preventDefault();
  apply(
    { type: "identity", values: formValues(event.target) },
    "Device identity updated.",
  );
});
$("parameter-search").addEventListener("input", () =>
  renderParameters(inspectProject(project)),
);
$("add-parameter").addEventListener("click", () => {
  if (!guard()) return;
  try {
    const before = new Set(inspectProject(project).variables.map((v) => v.id));
    project = applyOperation(project, { type: "addVariable", values: {} });
    selectedVariable = inspectProject(project).variables.find(
      (v) => !before.has(v.id),
    ).id;
    saved = false;
    render();
    message("Parameter added. Set its index and values.");
  } catch (error) {
    message(error.message);
  }
});
$("text-language").addEventListener("change", () => {
  selectedText = null;
  renderTexts(inspectProject(project));
});
$("text-search").addEventListener("input", () =>
  renderTexts(inspectProject(project)),
);
$("text-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = formValues(event.target);
  apply({ type: "text", ...values }, "Text saved.");
});
$("event-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = formValues(event.target);
  values.code = Number(values.code);
  apply({ type: "event", values }, "Event saved.");
});
$("menu-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const values = formValues(event.target);
  for (const key of ["variableIds", "menuIds"])
    values[key] = values[key]
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  apply({ type: "menu", values }, "Menu saved.");
});
$("asset-file").addEventListener("change", async (event) => {
  if (!guard()) return;
  try {
    let next = project;
    for (const file of event.target.files) {
      if (file.size > 16 * 1024 * 1024)
        throw Error("Asset exceeds the package size limit.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let start = 0; start < bytes.length; start += 16384)
        binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
      next = applyOperation(next, {
        type: "asset",
        name: file.name,
        base64: btoa(binary),
      });
    }
    project = next;
    saved = false;
    render();
    message("Files added to the project.");
  } catch (error) {
    message(error.message);
  }
  event.target.value = "";
});
$("compare-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 16 * 1024 * 1024)
      throw Error("Comparison file exceeds the project limit.");
    comparison = loadProject(await file.text());
    renderFiles(inspectProject(project));
    message("Saved revision compared.");
  } catch (error) {
    message(error.message);
  }
  event.target.value = "";
});
$("xml-source").addEventListener("input", () => {
  xmlPending = true;
  updateState();
  message(
    "XML has unapplied changes. Apply XML before another edit or export.",
  );
});
$("apply-xml").addEventListener("click", () => {
  try {
    const next = createProject($("xml-source").value, project.filename);
    next.assets = structuredClone(project.assets);
    project = loadProject(saveProject(next));
    xmlPending = false;
    saved = false;
    render();
    message("XML applied. Review Validation before export.");
  } catch (error) {
    message(error.message);
  }
});
$("save-project").addEventListener("click", () => {
  if (!project || !guard()) return;
  try {
    download(
      saveProject(project),
      project.filename.replace(/\.xml$/i, "") + ".iolinki.json",
      "application/json",
    );
    saved = true;
    updateState();
    message("Project saved. Reopen this JSON to continue later.");
  } catch (error) {
    message(error.message);
  }
});
$("download").addEventListener("click", async () => {
  if (!project || !guard()) return;
  try {
    const format = $("export-format").value;
    if (format === "zip")
      download(
        await exportPackage(project),
        project.filename.replace(/\.xml$/i, "") + ".zip",
        "application/zip",
      );
    else if (format === "header")
      download(
        generateFirmwareHeader(project),
        project.filename.replace(/\.xml$/i, "") + ".h",
        "text/plain",
      );
    else
      download(exportProjectXML(project), project.filename, "application/xml");
    message(
      format === "xml"
        ? "IODD downloaded with an updated CRC."
        : format === "zip"
          ? "IODD ZIP package downloaded."
          : "Firmware mapping header downloaded.",
    );
  } catch (error) {
    message(error.message);
  }
});
