"use strict";

const library = window.IOLINKI_LIBRARY;
const $ = (selector) => document.querySelector(selector);
const view = { station: null, library: library, selected: null };
const ui = { group: "sensor", tab: "3d", query: "", notesOpen: false, order: null };
let redraw = () => {};

const EXAMPLES = [
  "Detect stainless at 3 mm",
  "Pump pressure, switch at 40 bar",
  "Tank level, full at 800 mm",
  "Coolant flow, switch at 30 %",
  "Box on the conveyor at 500 mm",
];

function escapeText(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
}

function iconFor(def, kind) {
  if (kind === "master") {
    return partIcon("master");
  }
  if (kind === "equipment") {
    return partIcon("machine");
  }
  return partIcon(def && def.category);
}

function start() {
  if (!library) {
    document.body.innerHTML = "<p class=\"no\" style=\"padding:24px\">The studio data did not load in this browser.</p>";
    return;
  }
  view.station = decodeStation(location.hash, library) || newStation();
  view.onSelect = () => drawInspector();
  view.onMove = () => changed();
  view.onDrop = (ref, at) => add(ref, at);
  redraw = mountStation3d($("#scene"), view);
  $("#examples").innerHTML = EXAMPLES.map((text) => "<button type=\"button\">" + escapeText(text) + "</button>").join("");
  drawLibrary();
  changed();
  if (new URLSearchParams(location.search).get("buy") === "1") {
    openBuy();
  }
}

function plan(text) {
  const result = planFromText(text, library);
  if (!result.opened) {
    $("#ask-note").innerHTML = "<span class=\"no\">" + escapeText(result.reason) + "</span>";
    return;
  }
  view.station = result.station;
  view.selected = (result.station.items.find((item) => item.kind === "sensor") || {}).uid || null;
  $("#ask-note").textContent = "";
  changed();
  const s3d = $("#scene").s3d;
  if (s3d) {
    s3d.fit();
  }
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
  $("#empty").hidden = view.station.items.length > 0;
  redraw();
  $("#wiring").innerHTML = wiringSvg(view.station, library);
  $("#ports").innerHTML = portsHtml(view.station, library);
  drawSummary();
  drawNotes();
  drawInspector();
}

function counts() {
  const of = (kind) => view.station.items.filter((item) => item.kind === kind).length;
  return { sensors: of("sensor"), masters: of("master"), machines: of("equipment") };
}

function drawSummary() {
  const c = counts();
  const notes = checkStation(view.station, library).issues.length;
  const chips = [c.sensors + " sensor" + (c.sensors === 1 ? "" : "s"), c.masters + " master" + (c.masters === 1 ? "" : "s"), c.machines + " machine" + (c.machines === 1 ? "" : "s")];
  $("#summary").innerHTML = chips.map((chip) => "<span>" + chip + "</span>").join("") + (notes ? "<span class=\"warn\">" + notes + " note" + (notes === 1 ? "" : "s") + "</span>" : "");
}

function drawNotes() {
  const issues = checkStation(view.station, library).issues;
  const pill = $("#notes-pill");
  pill.hidden = issues.length === 0;
  pill.textContent = issues.length + " note" + (issues.length === 1 ? "" : "s") + " from the datasheets";
  $("#notes-list").hidden = !ui.notesOpen || issues.length === 0;
  $("#notes-list").innerHTML = "<ul>" + issues.map((issue) => "<li>" + escapeText(issue.problem) + "</li>").join("") + "</ul>";
}

// Parts library: filed parts by group; a search covers every group and, below,
// the full IODD Finder catalog.
function partRow(def, kind) {
  let sub = def.vendor || "generic";
  if (kind === "sensor") {
    const setting = (def.settings || [])[0];
    sub = def.category + (setting ? " · " + setting.min + "–" + setting.max + " " + setting.unit : "");
  } else if (kind === "master") {
    sub = def.ports + " ports · class " + def.port_class;
  } else {
    sub = "generic machine";
  }
  return "<button type=\"button\" draggable=\"true\" class=\"part " + kind + "\" data-ref=\"" + escapeText(def.id) + "\" title=\"Click to add, or drag onto the floor\">" +
    "<span class=\"glyph\">" + iconFor(def, kind) + "</span><span><b>" + escapeText(def.part || def.name) + "</b><small>" + escapeText(sub) + "</small></span><span class=\"add\">+</span></button>";
}

function drawLibrary() {
  const q = ui.query.toLowerCase().split(/\s+/).filter(Boolean);
  const groups = [["sensor", library.sensors], ["master", library.masters], ["equipment", library.equipment]];
  const rows = [];
  groups.forEach(([kind, defs]) => {
    if (!q.length && kind !== ui.group) {
      return;
    }
    defs.forEach((def) => {
      const text = [def.part, def.name, def.vendor, def.category, def.measures, (def.job_words || []).join(" "), def.id].join(" ").toLowerCase();
      if (q.every((word) => text.includes(word))) {
        rows.push(partRow(def, kind));
      }
    });
  });
  $("#parts").innerHTML = rows.length ? rows.join("") : "<p class=\"muted\" style=\"padding:0 8px\">No filed part matches. See IODD Finder below.</p>";
  document.querySelectorAll(".segmented button").forEach((button) => button.classList.toggle("on", !q.length && button.dataset.group === ui.group));
  $("#parts").querySelectorAll(".part").forEach((button) => {
    button.addEventListener("click", () => add(button.dataset.ref, null));
    button.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", button.dataset.ref));
  });
}

let searchTimer = null;
function searchCatalog() {
  const text = ui.query.trim();
  const out = $("#catalog");
  if (text.length < 2) {
    out.innerHTML = "";
    return;
  }
  out.innerHTML = "<h3>IODD Finder</h3><p class=\"muted\">Searching…</p>";
  fetch(CATALOG_SEARCH + "?" + new URLSearchParams({ q: text, field: "productName", size: "24" })).then((response) => {
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    return response.json();
  }).then((data) => {
    if (ui.query.trim() !== text) {
      return;
    }
    const hits = markFiled(library, data.content);
    out.innerHTML = "<h3>IODD Finder · " + data.totalElements + "</h3><ul>" + hits.map((hit) =>
      "<li><b>" + escapeText(hit.part) + "</b><span>" + escapeText(hit.vendor) + (hit.filed ? " · filed" : "") + "</span></li>").join("") + "</ul>" +
      "<p class=\"muted\">Filed parts carry datasheet limits and can be placed. Ask for more to be filed.</p>";
  }).catch(() => {
    out.innerHTML = "<h3>IODD Finder</h3><p class=\"muted\">The search did not answer.</p>";
  });
}

// Inspector: the station when nothing is selected, otherwise the part.
function drawInspector() {
  const box = $("#inspector");
  const item = view.station.items.find((other) => other.uid === view.selected);
  if (!item) {
    box.innerHTML = stationPanel();
    bindStationPanel(box);
    return;
  }
  const def = byId(library, item.ref) || {};
  const issues = checkStation(view.station, library).issues.filter((issue) => issue.uid === item.uid);
  let html = "<button type=\"button\" class=\"back\" data-back>← Station</button>" +
    "<div class=\"ihead " + item.kind + "\"><span class=\"glyph\">" + iconFor(def, item.kind) + "</span><div><h2>" + escapeText(def.part || def.name) + "</h2><span class=\"muted\">" + escapeText(item.kind === "equipment" ? "Generic machine for layout" : def.vendor) + "</span></div></div>";
  if (item.kind === "sensor") {
    const badges = [def.category, item.master ? item.master + " · X" + item.port : "no port", "device " + def.device_id];
    if (def.iodd && def.iodd.min_cycle_ms) {
      badges.push(def.iodd.min_cycle_ms + " ms cycle");
    }
    html += "<div class=\"badges\">" + badges.map((b) => "<span>" + escapeText(b) + "</span>").join("") + "</div>";
    html += "<h3>Settings</h3>";
    if (def.correction) {
      html += "<div class=\"field\"><label>Target material</label><div class=\"seg\" data-target>" + Object.keys(def.correction).filter((m) => m !== "aluminum" && m !== "metal").map((m) => "<button type=\"button\" data-value=\"" + m + "\"" + (m === item.target ? " class=\"on\"" : "") + ">" + escapeText(m) + "</button>").join("") + "</div></div>";
    }
    const warnKeys = new Set();
    issues.forEach((issue) => (def.settings || []).forEach((s) => {
      if (issue.problem.indexOf(s.name) !== -1) {
        warnKeys.add(s.key);
      }
    }));
    (def.settings || []).forEach((setting) => {
      const value = item.settings[setting.key];
      const shown = value === null || value === undefined ? "" : value;
      const step = (setting.max - setting.min) > 50 ? 1 : 0.1;
      html += "<div class=\"field" + (warnKeys.has(setting.key) ? " warn" : "") + "\"><label>" + escapeText(setting.name) + "<span>" + setting.min + "–" + setting.max + " " + escapeText(setting.unit) + (setting.corrected ? " on steel" : "") + "</span></label>" +
        "<div class=\"row\"><input type=\"range\" min=\"" + setting.min + "\" max=\"" + setting.max + "\" step=\"" + step + "\" value=\"" + escapeText(shown === "" ? setting.min : shown) + "\" data-range=\"" + escapeText(setting.key) + "\" /><input type=\"number\" step=\"any\" value=\"" + escapeText(shown) + "\" placeholder=\"set\" data-setting=\"" + escapeText(setting.key) + "\" /></div></div>";
    });
    (def.options || []).forEach((option) => {
      const value = item.options[option.key];
      html += "<div class=\"field\"><label>" + escapeText(option.name) + "</label><div class=\"seg\" data-option=\"" + escapeText(option.key) + "\">" + option.values.map((choice) => "<button type=\"button\" data-value=\"" + escapeText(choice) + "\"" + (choice === value ? " class=\"on\"" : "") + ">" + escapeText(choice) + "</button>").join("") + "</div></div>";
    });
    const slots = [];
    view.station.items.filter((other) => other.kind === "master").forEach((master) => {
      const ports = (byId(library, master.ref) || {}).ports || 0;
      for (let port = 1; port <= ports; port++) {
        const holder = view.station.items.find((other) => other.kind === "sensor" && other.master === master.uid && other.port === port);
        const mine = item.master === master.uid && item.port === port;
        slots.push("<option value=\"" + master.uid + ":" + port + "\"" + (mine ? " selected" : "") + ">" + master.uid + " · X" + port + (holder && !mine ? " (swap with " + escapeText((byId(library, holder.ref) || {}).part) + ")" : "") + "</option>");
      }
    });
    html += "<div class=\"field\"><label>Master port</label><select data-port>" + slots.join("") + "</select></div>";
    const check = checkSensor(def, item);
    if (check.parameters.length) {
      html += "<h3>Written to the sensor</h3><div class=\"written\">" + check.parameters.map((p) => "<div><span>" + escapeText(p.name) + "</span><b>" + escapeText(p.value) + "</b></div>").join("") + "</div>";
    }
  } else if (item.kind === "master") {
    const used = view.station.items.filter((other) => other.master === item.uid).length;
    const budget = powerBudget(view.station, library).masters.find((m) => m.uid === item.uid) || {};
    html += "<div class=\"badges\"><span>" + def.ports + " class " + escapeText(def.port_class) + " ports</span><span>" + used + " used</span><span>" + escapeText(def.fieldbus || "") + "</span></div>";
    html += "<h3>Sensor supply</h3>" + meter(budget.total_ma, budget.total_limit_ma);
  } else {
    html += "<p class=\"muted\" style=\"margin-top:10px\">Placed for layout and cable routing. Not part of the order.</p>";
  }
  if (issues.length) {
    html += "<div class=\"inote\"><ul>" + issues.map((issue) => "<li>" + escapeText(issue.problem) + "</li>").join("") + "</ul></div>";
  }
  if (def.source_url) {
    html += "<p><a href=\"" + escapeText(def.source_url) + "\" target=\"_blank\" rel=\"noopener\">Datasheet</a>" + (def.iodd && def.iodd.file ? " <span class=\"muted\">· IODD " + escapeText(def.iodd.file) + "</span>" : "") + "</p>";
  }
  html += "<button type=\"button\" class=\"danger\" data-remove>Remove from station</button>";
  box.innerHTML = html;
  bindPartPanel(box, item);
}

function meter(used, limit) {
  if (!limit) {
    return "<div class=\"stat\"><span>Sensors draw</span><b>" + (used || 0) + " mA</b></div>";
  }
  const pct = Math.min(100, Math.round(((used || 0) / limit) * 100));
  return "<div class=\"stat\"><span>Sensors draw</span><b>" + (used || 0) + " / " + limit + " mA</b></div><div class=\"meter\"><i style=\"width:" + pct + "%\"></i></div>";
}

function bindPartPanel(box, item) {
  box.querySelector("[data-back]").addEventListener("click", () => {
    view.selected = null;
    changed();
  });
  box.querySelectorAll("[data-range]").forEach((range) => {
    const number = box.querySelector("[data-setting=\"" + range.dataset.range + "\"]");
    range.addEventListener("input", () => {
      number.value = range.value;
    });
    range.addEventListener("change", () => {
      item.settings[range.dataset.range] = Number(range.value);
      changed();
    });
  });
  box.querySelectorAll("[data-setting]").forEach((input) => input.addEventListener("change", () => {
    item.settings[input.dataset.setting] = input.value === "" ? null : Number(input.value);
    changed();
  }));
  box.querySelectorAll("[data-option] button").forEach((button) => button.addEventListener("click", () => {
    item.options[button.parentElement.dataset.option] = button.dataset.value;
    changed();
  }));
  box.querySelectorAll("[data-target] button").forEach((button) => button.addEventListener("click", () => {
    item.target = button.dataset.value;
    changed();
  }));
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

function stationPanel() {
  const c = counts();
  if (!view.station.items.length) {
    return "<h2>Station</h2><p class=\"muted\">Empty. Add parts from the library, or let ChatGPT build the station.</p>";
  }
  const rows = new Map();
  orderLines(view.station, library).forEach((line) => {
    const key = line.kind === "cable" ? line.part : line.vendor + " " + line.part;
    rows.set(key, (rows.get(key) || 0) + 1);
  });
  const power = powerBudget(view.station, library).masters.map((m) => "<div class=\"stat\"><span>" + escapeText(m.uid + " " + (m.part || "")) + "</span></div>" + meter(m.total_ma, m.total_limit_ma)).join("");
  const done = ui.order;
  return "<h2>Station</h2><p class=\"muted\">" + c.sensors + " sensors on " + c.masters + " master" + (c.masters === 1 ? "" : "s") + ". Click a part to set it up.</p>" +
    (power ? "<h3>Power</h3>" + power : "") +
    "<h3>Order</h3><ul class=\"order\">" + Array.from(rows.entries()).map(([name, qty]) => "<li><span>" + qty + "×</span>" + escapeText(name) + "</li>").join("") + "</ul>" +
    "<h3>Buy and install</h3><form class=\"buy\" id=\"buy-form\"><input id=\"buyer-email\" type=\"email\" placeholder=\"Email\" autocomplete=\"email\" value=\"" + escapeText(done ? done.email : "") + "\" /><input id=\"buyer-plant\" type=\"text\" placeholder=\"Plant and line\" autocomplete=\"organization\" value=\"" + escapeText(done ? done.plant : "") + "\" /><button type=\"submit\" class=\"primary\">Buy and install</button><div class=\"result\" id=\"order-note\"></div></form>" +
    "<p class=\"muted\">iolinki buys the parts and installs the station. No payment is taken here, and no settings have been written to a sensor.</p>";
}

function bindStationPanel(box) {
  const form = box.querySelector("#buy-form");
  if (!form) {
    return;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const order = buyStation(view.station, library, { email: $("#buyer-email").value, plant: $("#buyer-plant").value });
    const note = $("#order-note");
    if (!order.ok) {
      note.innerHTML = "<span class=\"no\">" + escapeText(order.reason) + "</span>";
      return;
    }
    ui.order = order;
    note.innerHTML = "<p>Ready: " + escapeText(order.plant) + "." + (order.notes.length ? " " + order.notes.length + " note" + (order.notes.length === 1 ? "" : "s") + " go to the installer." : "") + "</p><p><a id=\"send-order\" href=\"" + escapeText(orderMail(order)) + "\">Send this order</a></p>";
  });
}

function openBuy() {
  view.selected = null;
  changed();
  const email = $("#buyer-email");
  if (email) {
    email.scrollIntoView({ block: "center" });
    email.focus();
  }
}

function setTab(name) {
  ui.tab = name;
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("on", button.dataset.view === name));
  $("#scene").hidden = name !== "3d";
  $("#wiring").hidden = name !== "wiring";
  $("#ports").hidden = name !== "ports";
  $("#view-tools").style.visibility = name === "3d" ? "visible" : "hidden";
  if (name === "3d") {
    redraw();
  }
}

function download(name, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

$("#part-search").addEventListener("input", (event) => {
  ui.query = event.target.value;
  drawLibrary();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchCatalog, 300);
});
document.querySelectorAll(".segmented button").forEach((button) => button.addEventListener("click", () => {
  ui.group = button.dataset.group;
  ui.query = "";
  $("#part-search").value = "";
  $("#catalog").innerHTML = "";
  drawLibrary();
}));
document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.view)));
document.querySelectorAll("[data-cam]").forEach((button) => button.addEventListener("click", () => {
  const s3d = $("#scene").s3d;
  if (!s3d) {
    return;
  }
  if (button.dataset.cam === "fit") {
    s3d.fit();
  } else {
    s3d.view(button.dataset.cam);
  }
}));
$("#notes-pill").addEventListener("click", () => {
  ui.notesOpen = !ui.notesOpen;
  drawNotes();
});
$("#ask").addEventListener("submit", (event) => {
  event.preventDefault();
  plan($("#use-case").value);
});
$("#examples").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) {
    $("#use-case").value = button.textContent;
    plan(button.textContent);
  }
});
$("#share").addEventListener("click", () => {
  const link = encodeStation(view.station);
  const done = () => {
    $("#share").textContent = "Link copied";
    setTimeout(() => {
      $("#share").textContent = "Share";
    }, 1500);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(done, () => prompt("Station link", link));
  } else {
    prompt("Station link", link);
  }
});
$("#export-toggle").addEventListener("click", () => {
  const menu = $("#export-menu");
  menu.hidden = !menu.hidden;
  $("#export-toggle").setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu")) {
    $("#export-menu").hidden = true;
  }
});
$("#csv-order").addEventListener("click", () => download("iolink-station-order.csv", orderCsv(view.station, library)));
$("#csv-ports").addEventListener("click", () => download("iolink-station-ports.csv", portCsv(view.station, library)));
$("#buy-open").addEventListener("click", openBuy);

start();
