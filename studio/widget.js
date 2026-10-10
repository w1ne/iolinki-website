"use strict";

// ChatGPT widget for the iolink_station tool. ChatGPT places and wires the
// parts through the MCP; this shows the result in three views (3D, wiring,
// ports), the datasheet notes, the order, and the way to buy it.

const root = document.getElementById("root");
const library = window.IOLINKI_LIBRARY;
let last = null;
let tab = "3d";
const run = { on: false, sim: null, state: null, frame: 0, at: 0, painted: 0 };

function esc(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

function open(href) {
  if (window.openai && typeof window.openai.openExternal === "function") {
    window.openai.openExternal({ href: href });
  } else {
    window.open(href, "_blank", "noopener");
  }
}

function partCard(station, uid) {
  const item = station.items.find((other) => other.uid === uid);
  if (!item) {
    return "<p class=\"hint\">Click a part to see it · drag to turn · scroll to zoom</p>";
  }
  const def = byId(library, item.ref) || {};
  if (item.kind === "equipment") {
    return "<div class=\"card\"><b>" + esc(def.name) + "</b><span class=\"muted\">Generic machine for layout. Not ordered.</span></div>";
  }
  if (item.kind === "master") {
    const used = station.items.filter((other) => other.master === item.uid).length;
    return "<div class=\"card\"><b>" + esc(def.vendor + " " + def.part) + "</b><span class=\"muted\">" + esc(def.ports + " class " + def.port_class + " ports · " + used + " used · " + (def.fieldbus || "")) + "</span></div>";
  }
  const check = checkSensor(def, item);
  return "<div class=\"card\"><b>" + esc(def.vendor + " " + def.part) + "</b><span class=\"muted\">" + esc(def.measures) + " · " + esc(item.master + " X" + item.port) + "</span><span class=\"live-line\"></span>" +
    "<div class=\"params\">" + check.parameters.map((p) => "<span><i>" + esc(p.name) + "</i>" + esc(p.value) + "</span>").join("") + "</div>" +
    "<a href=\"#\" data-open=\"" + esc(def.source_url) + "\">Datasheet</a></div>";
}

function orderSummary(station) {
  const rows = new Map();
  orderLines(station, library).forEach((line) => {
    const key = line.kind === "cable" ? line.part : (line.vendor + " " + line.part);
    rows.set(key, (rows.get(key) || 0) + 1);
  });
  return "<ul class=\"order\">" + Array.from(rows.entries()).map(([name, qty]) => "<li><span>" + qty + "×</span>" + esc(name) + "</li>").join("") + "</ul>";
}

function draw() {
  const out = window.openai && window.openai.toolOutput;
  if (!out || !out.diagram) {
    root.innerHTML = "<p class=\"hint\">Waiting for the station…</p>";
    return;
  }
  if (out === last) {
    return;
  }
  last = out;
  // Devices read from IODD Finder for this call travel with the result.
  (out.extra_parts || []).forEach((def) => {
    if (def && def.id && !byId(library, def.id)) {
      library.sensors.push(def);
    }
  });
  const built = fromDiagram(out.diagram, library);
  const station = built.station;
  const issues = built.check.issues;
  const sensors = station.items.filter((i) => i.kind === "sensor").length;
  const masters = station.items.filter((i) => i.kind === "master").length;
  const power = powerBudget(station, library).masters.map((m) => m.total_ma + (m.total_limit_ma ? "/" + m.total_limit_ma : "") + " mA").join(", ");
  const link = encodeStation(station);
  root.innerHTML =
    "<header><div><h1>" + esc(out.title || "IO-Link station") + "</h1><div class=\"chips\"><span>" + sensors + " sensor" + (sensors === 1 ? "" : "s") + "</span><span>" + masters + " master" + (masters === 1 ? "" : "s") + "</span>" + (power ? "<span>" + esc(power) + "</span>" : "") + "</div></div>" +
    "<nav><button type=\"button\" class=\"run\" id=\"run\">▶ Run</button><button data-tab=\"3d\">3D</button><button data-tab=\"wiring\">Wiring</button><button data-tab=\"ports\">Ports</button></nav></header>" +
    "<div class=\"stage\"><div id=\"view3d\" class=\"pane\"></div><div id=\"wiring\" class=\"pane\">" + wiringSvg(station, library) + "</div><div id=\"ports\" class=\"pane\">" + portsHtml(station, library) + "</div></div>" +
    "<div id=\"detail\"></div>" +
    (issues.length ? "<details class=\"notes\"><summary>" + issues.length + " note" + (issues.length === 1 ? "" : "s") + " for the installer</summary><ul>" + issues.map((issue) => "<li>" + esc(issue.problem) + "</li>").join("") + "</ul></details>" : "<p class=\"ok\">Every sensor is inside its datasheet and wired to a master port.</p>") +
    "<footer>" + orderSummary(station) + "<div class=\"actions\"><button type=\"button\" class=\"primary\" id=\"buy\">Buy and install</button><button type=\"button\" id=\"studio\">Open in studio</button></div></footer>" +
    "<p class=\"fine\">No payment is taken in ChatGPT. Settings have not been written to a sensor.</p>";
  const view = { station: station, library: library, selected: null, readOnly: true };
  view.onSelect = (uid) => {
    root.querySelector("#detail").innerHTML = partCard(station, uid);
  };
  mountStation3d(root.querySelector("#view3d"), view);
  view.onSelect(null);
  // Run: the machines move and each sensor switches on its own settings.
  const runButton = root.querySelector("#run");
  const live = () => {
    const s3d = root.querySelector("#view3d").s3d;
    if (s3d && tab === "3d") {
      s3d.live(run.state);
    }
    if (tab === "ports") {
      root.querySelector("#ports").innerHTML = portsHtml(station, library, run.state && run.state.readings);
    }
    const reading = run.state && view.selected && run.state.readings[view.selected];
    const slot = root.querySelector("#detail .live-line");
    if (slot) {
      slot.textContent = reading ? s3dReading(reading) + (reading.pd ? "  ·  PD " + reading.pd.hex : "") : "";
    }
  };
  const tick = (now) => {
    if (!run.on) {
      return;
    }
    run.state = simStep(station, library, run.sim, Math.min(0.1, (now - run.at) / 1000));
    run.at = now;
    live();
    run.frame = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(run.frame);
  run.on = false;
  runButton.addEventListener("click", () => {
    run.on = !run.on;
    runButton.textContent = run.on ? "❚❚ Stop" : "▶ Run";
    runButton.classList.toggle("on", run.on);
    if (run.on) {
      run.sim = simCreate();
      run.at = performance.now();
      run.frame = requestAnimationFrame(tick);
    } else {
      run.state = null;
      live();
    }
  });
  const show = (name) => {
    tab = name;
    root.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    root.querySelector("#view3d").hidden = name !== "3d";
    root.querySelector("#wiring").hidden = name !== "wiring";
    root.querySelector("#ports").hidden = name !== "ports";
    if (run.on) {
      live();
    }
  };
  root.querySelectorAll("nav button[data-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show(tab);
  root.querySelector("#studio").addEventListener("click", () => open(link));
  root.querySelector("#buy").addEventListener("click", () => open(link.replace("#s=", "?buy=1#s=")));
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-open]");
    if (target) {
      event.preventDefault();
      open(target.dataset.open);
    }
  });
}

window.addEventListener("openai:set_globals", draw, { passive: true });
draw();
