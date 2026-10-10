"use strict";

// ChatGPT widget for the iolink_station tool, laid out the way the Apps SDK
// guidelines ask: inline it is one card (the 3D station, one status line, two
// actions); Expand opens fullscreen with the wiring, the port table, the part
// panel with live values in run mode, the notes and the order. Colours follow
// the host theme with the Apps SDK UI tokens.

const root = document.getElementById("root");
const library = window.IOLINKI_LIBRARY;
const ui = { tab: "3d", selected: null, key: null };
const run = { on: false, sim: null, state: null, frame: 0, at: 0, painted: 0 };
let current = null;
let view3d = null;
let scene = null;

const ICON = "<svg viewBox=\"0 0 256 256\" aria-hidden=\"true\"><rect width=\"256\" height=\"256\" rx=\"58\" fill=\"#1f6feb\"/><rect x=\"44\" y=\"104\" width=\"30\" height=\"96\" rx=\"15\" fill=\"#fff\"/><circle cx=\"59\" cy=\"70\" r=\"17\" fill=\"#ffc83d\"/><circle cx=\"160\" cy=\"152\" r=\"54\" fill=\"none\" stroke=\"#fff\" stroke-width=\"20\"/><g fill=\"#fff\"><circle cx=\"141\" cy=\"133\" r=\"11\"/><circle cx=\"179\" cy=\"133\" r=\"11\"/><circle cx=\"141\" cy=\"171\" r=\"11\"/><circle cx=\"179\" cy=\"171\" r=\"11\"/></g></svg>";
const EXPAND = "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6\"/></svg>";
const CLOSE = "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M8 3v5H3M12 17v-5h5M3 3l5 5M17 17l-5-5\"/></svg>";
const PLAY = "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M6 4l10 6-10 6z\"/></svg>";
const PAUSE = "<svg viewBox=\"0 0 20 20\" aria-hidden=\"true\"><path d=\"M6 4h3v12H6zM11 4h3v12h-3z\"/></svg>";

function esc(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

function host() {
  return window.openai || {};
}

function theme() {
  const given = host().theme;
  if (given === "dark" || given === "light") {
    return given;
  }
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function fullscreen() {
  return host().displayMode === "fullscreen";
}

function open(href) {
  if (typeof host().openExternal === "function") {
    host().openExternal({ href: href });
  } else {
    window.open(href, "_blank", "noopener");
  }
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

function orderRows(station) {
  const rows = new Map();
  orderLines(station, library).forEach((line) => {
    const key = line.kind === "cable" ? line.part : line.vendor + " " + line.part;
    rows.set(key, (rows.get(key) || 0) + 1);
  });
  return Array.from(rows.entries());
}

function liveText(reading) {
  if (!reading) {
    return "";
  }
  if (reading.value === null || reading.value === undefined) {
    return reading.present === null ? (reading.on ? "on" : "off") : reading.present ? "target" : "no target";
  }
  const value = Math.abs(reading.value) >= 100 ? Math.round(reading.value) : reading.value.toFixed(1);
  return value + " " + reading.unit + (reading.ma !== null && reading.ma !== undefined ? " · " + reading.ma.toFixed(1) + " mA" : "");
}

// Side panel in fullscreen: the selected part, or the station.
function partPanel(station, uid) {
  const item = station.items.find((other) => other.uid === uid);
  if (!item) {
    const issues = current.issues;
    return "<h2>Station</h2>" +
      (issues.length ? "<div class=\"notes\"><b>" + plural(issues.length, "note") + " for the installer</b><ul>" + issues.map((issue) => "<li>" + esc(issue.problem) + "</li>").join("") + "</ul></div>" : "<p class=\"ok\">Every sensor is inside its datasheet and wired to a master port.</p>") +
      "<h3>Order</h3><ul class=\"order\">" + orderRows(station).map(([name, qty]) => "<li><span>" + qty + "×</span>" + esc(name) + "</li>").join("") + "</ul>" +
      "<p class=\"fine\">Click a part in the scene to see its settings. Press Run to watch every sensor switch.</p>";
  }
  const def = byId(library, item.ref) || {};
  if (item.kind === "equipment") {
    return "<button class=\"back\" data-back>← Station</button><h2>" + esc(def.name) + "</h2><p class=\"fine\">Generic machine, placed for the layout and cable lengths. Not ordered.</p>";
  }
  if (item.kind === "master") {
    const used = station.items.filter((other) => other.master === item.uid).length;
    const budget = powerBudget(station, library).masters.find((m) => m.uid === item.uid) || {};
    return "<button class=\"back\" data-back>← Station</button><h2>" + esc(def.part) + "</h2><p class=\"sub\">" + esc(def.vendor) + "</p>" +
      "<div class=\"facts\"><span>" + def.ports + " class " + esc(def.port_class) + " ports</span><span>" + used + " used</span><span>" + esc(def.fieldbus || "") + "</span></div>" +
      "<div class=\"stat\"><span>Sensors draw</span><b>" + (budget.total_ma || 0) + (budget.total_limit_ma ? " / " + budget.total_limit_ma : "") + " mA</b></div>";
  }
  const check = checkSensor(def, item);
  const issues = current.issues.filter((issue) => issue.uid === item.uid);
  const facts = [def.category, item.master ? item.master + " · X" + item.port : "no port", "device " + def.device_id];
  if (def.iodd && def.iodd.min_cycle_ms) {
    facts.push(def.iodd.min_cycle_ms + " ms cycle");
  }
  return "<button class=\"back\" data-back>← Station</button><h2>" + esc(def.part) + "</h2><p class=\"sub\">" + esc(def.vendor + " · " + (def.measures || "")) + "</p>" +
    "<div class=\"facts\">" + facts.map((f) => "<span>" + esc(f) + "</span>").join("") + "</div>" +
    "<div class=\"live\" data-live" + (run.on ? "" : " hidden") + "><div><span class=\"lv-value\" data-lv=\"value\"></span><span class=\"lv-out\" data-lv=\"out\"></span></div><code data-lv=\"pd\"></code></div>" +
    "<h3>Written to the sensor</h3><div class=\"params\">" + check.parameters.map((p) => "<div><span>" + esc(p.name) + "</span><b>" + esc(p.value) + "</b></div>").join("") + "</div>" +
    (issues.length ? "<div class=\"notes\"><ul>" + issues.map((issue) => "<li>" + esc(issue.problem) + "</li>").join("") + "</ul></div>" : "") +
    (def.source_url ? "<p><a href=\"#\" data-open=\"" + esc(def.source_url) + "\">Datasheet</a>" + (def.iodd && def.iodd.file ? " <span class=\"fine\">· IODD " + esc(def.iodd.file) + "</span>" : "") + "</p>" : "");
}

function status(issues, sensors) {
  if (issues.length) {
    return "<button class=\"status warn\" data-expand>" + plural(issues.length, "note") + " for the installer · view</button>";
  }
  return "<p class=\"status ok\">" + (sensors ? "All " + plural(sensors, "sensor") + " inside their datasheets and wired" : "Station placed") + "</p>";
}

function draw() {
  const out = host().toolOutput;
  document.documentElement.dataset.theme = theme();
  if (!out || !out.diagram) {
    root.innerHTML = "<div class=\"waiting\"><span class=\"mark\">" + ICON + "</span>Placing the station…</div>";
    return;
  }
  const key = JSON.stringify(out.diagram) + "|" + fullscreen() + "|" + theme();
  if (key === ui.key) {
    return;
  }
  ui.key = key;
  // Devices read from IODD Finder for this call travel with the result.
  (out.extra_parts || []).forEach((def) => {
    if (def && def.id && !byId(library, def.id)) {
      library.sensors.push(def);
    }
  });
  const built = fromDiagram(out.diagram, library);
  const station = built.station;
  current = { station: station, issues: built.check.issues, link: encodeStation(station) };
  const sensors = station.items.filter((i) => i.kind === "sensor").length;
  const masters = station.items.filter((i) => i.kind === "master").length;
  const power = powerBudget(station, library).masters.map((m) => m.total_ma + (m.total_limit_ma ? " / " + m.total_limit_ma : "") + " mA").join(", ");
  const items = orderRows(station).reduce((sum, row) => sum + row[1], 0);
  const big = fullscreen();
  document.body.classList.toggle("full", big);
  const facts = [plural(sensors, "sensor"), plural(masters, "master")].concat(power ? [power] : []).concat([plural(items, "item") + " to order"]);
  // Two actions only, as the Apps SDK asks: Buy first, studio second.
  const actions = "<footer><button class=\"primary\" id=\"buy\">Buy and install</button><button id=\"studio\">Open in studio</button><span class=\"fine\">No payment in ChatGPT · nothing is written to a sensor</span></footer>";
  const stage = "<div class=\"stage\">" +
    "<div id=\"view3d\" class=\"pane\"></div>" +
    (big ? "<div id=\"wiring\" class=\"pane doc\" hidden>" + wiringSvg(station, library) + "</div><div id=\"ports\" class=\"pane doc\" hidden>" + portsHtml(station, library) + "</div>" : "") +
    "<div class=\"overlay\">" + (big ? "<div class=\"seg\" role=\"tablist\"><button data-tab=\"3d\">3D</button><button data-tab=\"wiring\">Wiring</button><button data-tab=\"ports\">Ports</button></div>" : "<span></span>") +
    "<button class=\"run\" id=\"run\" title=\"Run: machines move and each sensor switches on its own settings\">" + PLAY + "<span>Run</span></button></div>" +
    "<div class=\"chip-live\" id=\"clock\" hidden></div></div>";
  root.innerHTML =
    "<header><span class=\"mark\">" + ICON + "</span><div class=\"head\"><h1>" + esc(out.title || "IO-Link station") + "</h1><p class=\"sub\">" + facts.map(esc).join(" · ") + "</p></div>" +
    "<button class=\"icon\" id=\"expand\" title=\"" + (big ? "Exit full screen" : "Full screen") + "\" aria-label=\"" + (big ? "Exit full screen" : "Full screen") + "\">" + (big ? CLOSE : EXPAND) + "</button></header>" +
    (big ? "<div class=\"body\">" + stage + "<div class=\"rail\">" + actions + "<aside id=\"side\"></aside></div></div>" : stage + status(current.issues, sensors) + actions);

  const wasRunning = run.on;
  stopRun();
  const view = { station: station, library: library, selected: ui.selected, readOnly: true, theme: theme() === "dark" ? "dark" : "card", machineLabels: big && window.innerWidth >= 700, compactTags: !big || window.innerWidth < 700, tightFit: !big };
  view.onSelect = (uid) => {
    ui.selected = uid;
    view.selected = uid;
    drawSide();
  };
  view3d = root.querySelector("#view3d");
  scene = { view: view, rebuild: mountStation3d(view3d, view) };
  drawSide();
  if (big) {
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    showTab(ui.tab);
  }
  root.querySelector("#run").addEventListener("click", () => (run.on ? stopRun() : startRun()));
  if (wasRunning) {
    startRun();
  }
  root.querySelector("#expand").addEventListener("click", () => setMode(big ? "inline" : "fullscreen"));
  root.querySelectorAll("[data-expand]").forEach((b) => b.addEventListener("click", () => setMode("fullscreen")));
  root.querySelector("#studio").addEventListener("click", () => open(current.link));
  root.querySelector("#buy").addEventListener("click", () => open(current.link.replace("#s=", "?buy=1#s=")));
}

function drawSide() {
  const side = root.querySelector("#side");
  if (!side) {
    return;
  }
  side.innerHTML = partPanel(current.station, ui.selected);
  side.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => {
    ui.selected = null;
    scene.view.selected = null;
    scene.rebuild();
    drawSide();
  }));
  paintLive();
}

function showTab(name) {
  ui.tab = name;
  root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  ["3d", "wiring", "ports"].forEach((tab) => {
    const pane = root.querySelector(tab === "3d" ? "#view3d" : "#" + tab);
    if (pane) {
      pane.hidden = tab !== name;
    }
  });
  if (run.on) {
    paintLive();
  }
}

function setMode(mode) {
  if (typeof host().requestDisplayMode === "function") {
    host().requestDisplayMode({ mode: mode });
  }
}

function startRun() {
  run.on = true;
  run.sim = simCreate();
  run.at = performance.now();
  const button = root.querySelector("#run");
  button.classList.add("on");
  button.innerHTML = PAUSE + "<span>Stop</span>";
  root.querySelector("#clock").hidden = false;
  const live = root.querySelector("[data-live]");
  if (live) {
    live.hidden = false;
  }
  run.frame = requestAnimationFrame(tick);
}

function stopRun() {
  run.on = false;
  cancelAnimationFrame(run.frame);
  run.state = null;
  if (view3d && view3d.s3d) {
    view3d.s3d.live(null);
  }
  const button = root.querySelector("#run");
  if (button) {
    button.classList.remove("on");
    button.innerHTML = PLAY + "<span>Run</span>";
  }
  const clock = root.querySelector("#clock");
  if (clock) {
    clock.hidden = true;
  }
}

function tick(now) {
  if (!run.on) {
    return;
  }
  run.state = simStep(current.station, library, run.sim, Math.min(0.1, (now - run.at) / 1000));
  run.at = now;
  if (view3d.s3d && ui.tab === "3d") {
    view3d.s3d.live(run.state);
  }
  if (now - run.painted > 200) {
    run.painted = now;
    paintLive();
  }
  run.frame = requestAnimationFrame(tick);
}

function paintLive() {
  if (!run.on || !run.state) {
    return;
  }
  const clock = root.querySelector("#clock");
  const switched = Object.values(run.state.readings).filter((r) => r.on).length;
  clock.textContent = run.state.t.toFixed(0) + " s · " + switched + " switched";
  const live = root.querySelector("[data-live]");
  const reading = ui.selected && run.state.readings[ui.selected];
  if (live && reading) {
    live.querySelector("[data-lv=value]").textContent = liveText(reading);
    const out = live.querySelector("[data-lv=out]");
    out.textContent = reading.ma !== null ? "analogue" : reading.on ? "OUT1 on" : "OUT1 off";
    out.classList.toggle("on", Boolean(reading.on));
    live.querySelector("[data-lv=pd]").textContent = reading.pd ? "PD in " + reading.pd.hex : "";
  }
  if (ui.tab === "ports") {
    const ports = root.querySelector("#ports");
    if (ports) {
      ports.innerHTML = portsHtml(current.station, library, run.state.readings);
    }
  }
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-open]");
  if (target) {
    event.preventDefault();
    open(target.dataset.open);
  }
});
window.addEventListener("openai:set_globals", draw, { passive: true });
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    ui.key = null;
    draw();
  });
}
draw();
