"use strict";

const library = window.IOLINKI_LIBRARY;
const $ = (selector) => document.querySelector(selector);
const canvas = $("#scene");
const view = { station: null, library: library, selected: null };
let redraw = () => {};

function escapeText(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
}

function start() {
  if (!library) {
    $("main").innerHTML = "<p class=\"no\">The studio data did not load in this browser.</p>";
    return;
  }
  view.station = decodeStation(location.hash, library);
  if (view.station) {
    $("#ask-note").textContent = "Station opened from a link.";
  } else {
    build();
  }
  drawPalette();
  view.onSelect = () => drawInspector();
  view.onMove = () => changed();
  view.onDrop = (ref, at) => add(ref, at);
  redraw = mountScene(canvas, view);
  changed();
  if (new URLSearchParams(location.search).get("buy") === "1") {
    $("#buy-form").scrollIntoView({ block: "center" });
    $("#buyer-email").focus();
  }
}

function build() {
  const plan = planFromText($("#use-case").value, library);
  if (!plan.opened) {
    $("#ask-note").innerHTML = "<span class=\"no\">" + escapeText(plan.reason) + "</span> Nothing was placed.";
    if (!view.station) {
      view.station = newStation();
    }
    return;
  }
  view.station = plan.station;
  view.selected = (plan.station.items.find((item) => item.kind === "sensor") || {}).uid || null;
  const todo = plan.todo.length ? " Still to set: " + plan.todo.map(escapeText).join(" ") : "";
  $("#ask-note").innerHTML = "Opened <b>" + escapeText(plan.title) + "</b>. This box matches keywords against the filed sensors; ChatGPT builds stations through the connector." + todo;
}

function add(ref, at) {
  const item = addItem(view.station, library, ref, at);
  if (item) {
    view.selected = item.uid;
  }
  changed();
}

function changed() {
  if (!view.station.items.some((item) => item.uid === view.selected)) {
    view.selected = null;
  }
  history.replaceState(null, "", location.pathname + location.search + "#s=" + encodeStation(view.station).split("#s=")[1]);
  redraw();
  drawInspector();
  drawOrder();
  drawPorts();
}

function drawPorts() {
  $("#ports").innerHTML = portsHtml(view.station, library);
  $("#power").innerHTML = powerHtml(view.station, library);
}

function download(name, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function paletteButton(def, label, sub) {
  // Search text also matches what the part measures and its job words.
  const tags = [def.measures, (def.job_words || []).join(" ")].join(" ");
  return "<button type=\"button\" draggable=\"true\" class=\"part\" data-ref=\"" + escapeText(def.id) + "\" title=\"" + escapeText(tags) + "\"><b>" + escapeText(label) + "</b><span>" + escapeText(sub) + "</span></button>";
}

function drawPalette() {
  const range = (def) => {
    const setting = (def.settings || [])[0];
    return setting ? " · " + setting.min + "–" + setting.max + " " + setting.unit : "";
  };
  const sensors = library.sensors.map((def) => paletteButton(def, def.part, def.category + range(def))).join("");
  const masters = library.masters.map((def) => paletteButton(def, def.part, def.ports + "-port master · class " + def.port_class)).join("");
  const equipment = library.equipment.map((def) => paletteButton(def, def.name, "generic")).join("");
  $("#palette").innerHTML = "<input type=\"search\" id=\"palette-filter\" placeholder=\"Filter: pressure, flow, PN70…\" aria-label=\"Filter parts\" /><h2>Sensors</h2>" + sensors + "<h2>Masters</h2>" + masters + "<h2>Machines</h2>" + equipment;
  $("#palette-filter").addEventListener("input", (event) => {
    const words = event.target.value.toLowerCase().split(/\s+/).filter(Boolean);
    $("#palette").querySelectorAll(".part").forEach((button) => {
      const text = (button.textContent + " " + button.dataset.ref + " " + button.title).toLowerCase();
      button.hidden = !words.every((word) => text.includes(word));
    });
  });
  $("#palette").querySelectorAll(".part").forEach((button) => {
    button.addEventListener("click", () => add(button.dataset.ref, null));
    button.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", button.dataset.ref));
  });
}

function drawInspector() {
  const box = $("#inspector");
  const item = view.station.items.find((other) => other.uid === view.selected);
  const issues = checkStation(view.station, library).issues;
  if (!item) {
    const counts = ["sensor", "master", "equipment"].map((kind) => view.station.items.filter((other) => other.kind === kind).length);
    box.innerHTML = "<h2>Station</h2><p>" + counts[0] + " sensors, " + counts[1] + " masters, " + counts[2] + " machines.</p>" +
      (issues.length ? "<p class=\"small\">Notes from the datasheets:</p><ul class=\"warn\">" + issues.map((issue) => "<li>" + escapeText(issue.problem) + "</li>").join("") + "</ul>" : "<p>Every sensor is inside its datasheet and on a port.</p>") +
      "<p class=\"small\">Click a part to set it up.</p>";
    return;
  }
  const def = byId(library, item.ref);
  let html = "<h2>" + escapeText(def.part || def.name) + "</h2>";
  if (item.kind === "sensor") {
    html += "<p class=\"small\">" + escapeText(def.vendor) + " · vendor " + def.vendor_id + " · device " + def.device_id + " · " + escapeText(def.measures) + "</p>";
    if (def.correction) {
      html += "<label>Target material<select data-target>" + Object.keys(def.correction).map((material) => "<option" + (material === item.target ? " selected" : "") + ">" + escapeText(material) + "</option>").join("") + "</select></label>";
    }
    (def.settings || []).forEach((setting) => {
      const value = item.settings[setting.key];
      html += "<label>" + escapeText(setting.name) + " <span class=\"small\">" + setting.min + "–" + setting.max + " " + escapeText(setting.unit) + (setting.corrected ? ", steel" : "") + "</span><input type=\"number\" step=\"any\" data-setting=\"" + escapeText(setting.key) + "\" value=\"" + escapeText(value === null ? "" : value) + "\" /></label>";
    });
    (def.options || []).forEach((option) => {
      const value = item.options[option.key];
      html += "<label>" + escapeText(option.name) + "<select data-option=\"" + escapeText(option.key) + "\">" + (value === null || value === undefined ? "<option value=\"\">choose</option>" : "") + option.values.map((choice) => "<option" + (choice === value ? " selected" : "") + ">" + escapeText(choice) + "</option>").join("") + "</select></label>";
    });
    const slots = [];
    view.station.items.filter((other) => other.kind === "master").forEach((master) => {
      const ports = byId(library, master.ref).ports;
      for (let port = 1; port <= ports; port++) {
        const holder = view.station.items.find((other) => other.kind === "sensor" && other.master === master.uid && other.port === port);
        const mine = item.master === master.uid && item.port === port;
        slots.push("<option value=\"" + master.uid + ":" + port + "\"" + (mine ? " selected" : "") + ">" + master.uid + " X" + port + (holder && !mine ? " (swap with " + escapeText(byId(library, holder.ref).part) + ")" : "") + "</option>");
      }
    });
    html += "<label>Master port<select data-port>" + slots.join("") + "</select></label>";
    const check = checkSensor(def, item);
    if (check.parameters.length) {
      html += "<p class=\"small\">Written to the sensor:</p><ul>" + check.parameters.map((p) => "<li>" + escapeText(p.name) + ": " + escapeText(p.value) + (p.note ? " <span class=\"small\">(" + escapeText(p.note) + ")</span>" : "") + "</li>").join("") + "</ul>";
    }
    html += "<p class=\"small\"><a href=\"" + escapeText(def.source_url) + "\" target=\"_blank\" rel=\"noopener\">Datasheet</a>: " + escapeText(def.source) + "</p>";
  } else if (item.kind === "master") {
    html += "<p class=\"small\">" + escapeText(def.vendor) + " · " + def.ports + " class " + def.port_class + " ports · " + escapeText(def.fieldbus || "") + "</p><p class=\"small\"><a href=\"" + escapeText(def.source_url) + "\" target=\"_blank\" rel=\"noopener\">Datasheet</a></p>";
  } else {
    html += "<p class=\"small\">Generic shape for layout. It is not ordered.</p>";
  }
  const mine = issues.filter((issue) => issue.uid === item.uid);
  if (mine.length) {
    html += "<ul class=\"warn\">" + mine.map((issue) => "<li>" + escapeText(issue.problem) + "</li>").join("") + "</ul>";
  }
  html += "<button type=\"button\" class=\"quiet\" data-remove>Remove</button>";
  box.innerHTML = html;
  box.querySelectorAll("[data-setting]").forEach((input) => input.addEventListener("change", () => {
    item.settings[input.dataset.setting] = input.value === "" ? null : Number(input.value);
    changed();
  }));
  box.querySelectorAll("[data-option]").forEach((select) => select.addEventListener("change", () => {
    item.options[select.dataset.option] = select.value || null;
    changed();
  }));
  const target = box.querySelector("[data-target]");
  if (target) {
    target.addEventListener("change", () => {
      item.target = target.value;
      changed();
    });
  }
  const port = box.querySelector("[data-port]");
  if (port) {
    port.addEventListener("change", () => {
      const parts = port.value.split(":");
      setPort(view.station, library, item.uid, parts[0], Number(parts[1]));
      changed();
    });
  }
  box.querySelector("[data-remove]").addEventListener("click", () => {
    removeItem(view.station, library, item.uid);
    view.selected = null;
    changed();
  });
}

function drawOrder() {
  const lines = orderLines(view.station, library);
  if (!lines.length) {
    $("#order").innerHTML = "<p class=\"small\">Add a sensor to start the order.</p>";
    return;
  }
  $("#order").innerHTML = "<ul class=\"lines\">" + lines.map((line) => {
    if (line.kind === "cable") {
      return "<li>" + escapeText(line.part) + " <span class=\"small\">" + escapeText(line.from) + " X" + line.port + " → " + escapeText(line.to) + " · " + line.conductors.join(" ") + "</span></li>";
    }
    const where = line.kind === "sensor" ? " <span class=\"small\">on " + escapeText(line.master) + " X" + line.port + "</span>" : "";
    return "<li><b>" + escapeText(line.vendor) + " " + escapeText(line.part) + "</b>" + where + "</li>";
  }).join("") + "</ul>";
}

$("#ask").addEventListener("submit", (event) => {
  event.preventDefault();
  build();
  changed();
});

$("#buy-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const order = buyStation(view.station, library, { email: $("#buyer-email").value, plant: $("#buyer-plant").value });
  const note = $("#order-note");
  if (!order.ok) {
    note.innerHTML = "<p class=\"no\">" + escapeText(order.reason) + "</p>";
    return;
  }
  note.innerHTML = "<p>" + escapeText(order.action) + " at " + escapeText(order.plant) + ".</p>" + (order.notes.length ? "<p class=\"small\">The order includes " + order.notes.length + " note" + (order.notes.length === 1 ? "" : "s") + " for the installer.</p>" : "") + "<p class=\"small\">Payment is not taken here. Nothing has been bought or installed yet.</p><p><a id=\"send-order\" href=\"" + escapeText(orderMail(order)) + "\">Send this order</a></p>";
});

$("#share").addEventListener("click", () => {
  const link = encodeStation(view.station);
  const done = () => { $("#share").textContent = "Link copied"; setTimeout(() => { $("#share").textContent = "Copy station link"; }, 1500); };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(done, () => prompt("Station link", link));
  } else {
    prompt("Station link", link);
  }
});

$("#csv-order").addEventListener("click", () => download("iolink-station-order.csv", orderCsv(view.station, library)));
$("#csv-ports").addEventListener("click", () => download("iolink-station-ports.csv", portCsv(view.station, library)));

$("#clear").addEventListener("click", () => {
  view.station = newStation();
  view.selected = null;
  changed();
});

let searchTimer = null;

$("#catalog-query").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchCatalog, 250);
});

function searchCatalog() {
  const text = $("#catalog-query").value.trim();
  const out = $("#catalog-results");
  if (text.length < 2) {
    out.innerHTML = "";
    return;
  }
  out.innerHTML = "<p class=\"small\">Searching IODD Finder…</p>";
  fetch(CATALOG_SEARCH + "?" + new URLSearchParams({ q: text, field: "productName", size: "24" })).then((response) => {
    if (!response.ok) {
      throw new Error(response.status);
    }
    return response.json();
  }).then((data) => {
    if ($("#catalog-query").value.trim() !== text) {
      return;
    }
    const hits = markFiled(library, data.content);
    out.innerHTML = "<p class=\"small\">" + data.totalElements + " IODD Finder entries. Only parts marked filed have datasheet limits and can be placed.</p><ul class=\"lines\">" + hits.map((hit) => {
      const action = hit.filed ? " <button type=\"button\" class=\"inline\" data-ref=\"" + escapeText(hit.filed) + "\">Add</button>" : " <span class=\"small\">no limits filed</span>";
      return "<li><b>" + escapeText(hit.vendor) + " " + escapeText(hit.part) + "</b> <span class=\"small\">vendor " + hit.vendor_id + " · device " + hit.device_id + "</span>" + action + "</li>";
    }).join("") + "</ul>";
    out.querySelectorAll("[data-ref]").forEach((button) => button.addEventListener("click", () => add(button.dataset.ref, null)));
  }).catch(() => {
    out.innerHTML = "<p class=\"no\">The IODD Finder search did not answer.</p>";
  });
}

start();
