import {
  importXML,
  getIdentity,
  editIdentity,
  getVariables,
  editVariable,
  addVariable,
  removeVariable,
  getProcessData,
  editProcessField,
  validateDocument,
  previewXML,
  exportXML,
} from "./document.js";
let documentModel = null,
  filename = "device-IODD1.1.xml",
  xmlPending = false;
const $ = (id) => document.getElementById(id);
function message(text) {
  $("status").textContent = text;
}
function input(parent, label, value, key, options) {
  const wrap = document.createElement("label");
  wrap.append(document.createTextNode(label));
  const control = document.createElement(options ? "select" : "input");
  control.name = key;
  if (options)
    for (const value of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      control.append(option);
    }
  control.value = value ?? "";
  wrap.append(control);
  parent.append(wrap);
  return control;
}
function values(form) {
  return Object.fromEntries(new FormData(form));
}
function apply(operation, success) {
  if (xmlPending) {
    message(
      "Apply or restore the pending XML changes before using the structured forms.",
    );
    return;
  }
  try {
    const copy = structuredClone(documentModel);
    operation(copy);
    documentModel = copy;
    xmlPending = false;
    render();
    message(success);
  } catch (error) {
    message(error.message);
  }
}
function button(parent, label, click, type = "button", className = "") {
  const node = document.createElement("button");
  node.type = type;
  node.textContent = label;
  node.className = className;
  if (click) node.addEventListener("click", click);
  parent.append(node);
  return node;
}
function render() {
  $("workspace").hidden = false;
  $("identity-fields").replaceChildren();
  const id = getIdentity(documentModel);
  for (const [key, label] of [
    ["vendorId", "Vendor ID"],
    ["deviceId", "Device ID"],
    ["vendorName", "Vendor name"],
    ["productName", "English device name"],
    ["productId", "Product ID"],
    ["releaseDate", "Release date"],
    ["version", "Document version"],
  ])
    input($("identity-fields"), label, id[key], key);
  $("parameters").replaceChildren();
  const variables = getVariables(documentModel);
  if (!variables.length) {
    const p = document.createElement("p");
    p.textContent =
      "No vendor parameters. Add one or edit standard variables in XML.";
    $("parameters").append(p);
  }
  for (const variable of variables) {
    const form = document.createElement("form");
    form.className = "parameter";
    form.dataset.variable = variable.id;
    const heading = document.createElement("h3");
    heading.textContent = variable.id;
    form.append(heading);
    if (!variable.editable) {
      const p = document.createElement("p");
      p.textContent =
        "Shared or complex datatype. Preserve and edit this parameter in the XML panel.";
      form.append(p);
      $("parameters").append(form);
      continue;
    }
    const grid = document.createElement("div");
    grid.className = "form-grid";
    form.append(grid);
    for (const [key, label, options] of [
      ["name", "Parameter name"],
      ["index", "Index"],
      ["access", "Access", ["ro", "rw", "wo"]],
      [
        "type",
        "Datatype",
        ["UIntegerT", "IntegerT", "StringT", "OctetStringT"],
      ],
      ["bits", "Bit length"],
      ["defaultValue", "Default value"],
      ["lower", "Lower bound"],
      ["upper", "Upper bound"],
    ])
      input(grid, label, variable[key], key, options);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    form.append(actions);
    button(actions, "Apply parameter", null, "submit");
    button(
      actions,
      "Remove parameter",
      () =>
        apply((doc) => removeVariable(doc, variable.id), "Parameter removed."),
      "button",
      "remove",
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      apply(
        (doc) => editVariable(doc, variable.id, values(form)),
        "Parameter updated.",
      );
    });
    $("parameters").append(form);
  }
  $("process-data").replaceChildren();
  for (const pd of getProcessData(documentModel)) {
    const block = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = `${pd.id} · ${pd.direction} · ${pd.bits} bits`;
    block.append(heading);
    if (!pd.editable) {
      const p = document.createElement("p");
      p.textContent =
        "This layout uses a simple or shared datatype. Edit it in XML.";
      block.append(p);
    }
    for (const field of pd.fields) {
      const form = document.createElement("form");
      form.className = "process-field";
      const grid = document.createElement("div");
      grid.className = "form-grid";
      form.append(grid);
      for (const [key, label, options] of [
        ["name", "Field name"],
        ["offset", "Bit offset"],
        ["bits", "Field bits"],
        ["type", "Field datatype", ["UIntegerT", "IntegerT", "BooleanT"]],
      ]) {
        const control = input(grid, label, field[key], key, options);
        control.disabled = !pd.editable || !field.editable;
      }
      if (pd.editable && field.editable) {
        button(form, "Apply field", null, "submit");
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          apply(
            (doc) => editProcessField(doc, pd.id, field.index, values(form)),
            "Process-data field updated.",
          );
        });
      }
      block.append(form);
    }
    $("process-data").append(block);
  }
  const issues = validateDocument(documentModel);
  $("checks").replaceChildren();
  for (const issue of issues) {
    const li = document.createElement("li");
    li.className = "check-" + issue.severity;
    li.textContent = issue.message;
    $("checks").append(li);
  }
  if (!issues.some((i) => i.severity === "error")) {
    const li = document.createElement("li");
    li.textContent = "Basic structure, parameter and layout checks passed.";
    $("checks").prepend(li);
  }
  $("download").disabled = issues.some((i) => i.severity === "error");
  $("xml-source").value = previewXML(documentModel);
}
async function loadTemplate(name) {
  try {
    const response = await fetch("/assets/iodd/" + name + ".xml");
    if (!response.ok)
      throw Error(
        "Example could not be loaded. Try opening a downloaded XML file.",
      );
    documentModel = importXML(await response.text());
    filename = `iolinki-${name.replace(/[^A-Za-z0-9]/g, "")}-20261002-IODD1.1.xml`;
    xmlPending = false;
    render();
    message("Example loaded. Edit the description, then download your IODD.");
  } catch (error) {
    message(error.message);
  }
}
$("counter").addEventListener("click", () => loadTemplate("counter"));
$("sensor").addEventListener("click", () => loadTemplate("switching-sensor"));
$("import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024)
      throw Error("File exceeds the 4 MiB limit.");
    const parsed = importXML(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      ),
    );
    documentModel = parsed;
    filename = file.name;
    xmlPending = false;
    render();
    message("XML opened locally. Imported sections remain in the document.");
  } catch (error) {
    message(error.message);
  }
  event.target.value = "";
});
$("identity-form").addEventListener("submit", (event) => {
  event.preventDefault();
  apply(
    (doc) => editIdentity(doc, values(event.target)),
    "Device identity updated.",
  );
});
$("add-parameter").addEventListener("click", () =>
  apply((doc) => addVariable(doc), "Parameter added."),
);
$("xml-source").addEventListener("input", () => {
  xmlPending = true;
  $("download").disabled = true;
  message("XML has unapplied changes. Apply XML before downloading.");
});
$("apply-xml").addEventListener("click", () => {
  try {
    const parsed = importXML($("xml-source").value);
    documentModel = parsed;
    xmlPending = false;
    render();
    message("XML applied. Review the checks below.");
  } catch (error) {
    message(error.message);
  }
});
$("download").addEventListener("click", () => {
  if (!documentModel || xmlPending) return;
  try {
    const issues = validateDocument(documentModel);
    if (issues.some((i) => i.severity === "error"))
      throw Error("Fix the reported checks before downloading.");
    const xml = exportXML(documentModel);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("IODD downloaded with an updated CRC.");
  } catch (error) {
    message(error.message);
  }
});
