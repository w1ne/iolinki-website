"use strict";

// ChatGPT widget for the iolink_station tool. ChatGPT places and wires the
// parts through the MCP; this only shows the result: the station, what the
// datasheets refuse, the order, and the way to buy it.

const root = document.getElementById("root");
const library = window.IOLINKI_LIBRARY;
let last = null;

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

function details(station, uid) {
  const item = station.items.find((other) => other.uid === uid);
  if (!item) {
    return "<p class=\"small\">Click a part to see it. Drag the floor to turn the view.</p>";
  }
  const def = byId(library, item.ref);
  if (item.kind !== "sensor") {
    return "<p><b>" + esc(def.part || def.name) + "</b> " + (item.kind === "master" ? esc(def.ports + " class " + def.port_class + " ports") : "generic machine") + "</p>";
  }
  const check = checkSensor(def, item);
  return "<p><b>" + esc(def.vendor + " " + def.part) + "</b> on " + esc(item.master + " X" + item.port) + "</p><ul>" +
    check.parameters.map((p) => "<li>" + esc(p.name) + ": " + esc(p.value) + (p.note ? " <span class=\"small\">(" + esc(p.note) + ")</span>" : "") + "</li>").join("") +
    "</ul><p class=\"small\"><a href=\"#\" data-open=\"" + esc(def.source_url) + "\">Datasheet</a></p>";
}

function draw() {
  const out = window.openai && window.openai.toolOutput;
  if (!out || out === last || !out.diagram) {
    if (!out) {
      root.innerHTML = "<p class=\"small\">Waiting for the station…</p>";
    }
    return;
  }
  last = out;
  const built = fromDiagram(out.diagram, library);
  const station = built.station;
  const issues = built.check.issues;
  const lines = orderLines(station, library);
  const link = encodeStation(station);
  root.innerHTML =
    "<div class=\"bar\"><b>" + esc(out.title || "IO-Link station") + "</b><span class=\"small\">" +
    station.items.filter((i) => i.kind === "sensor").length + " sensors · " + station.items.filter((i) => i.kind === "master").length + " masters</span></div>" +
    "<canvas id=\"scene\" class=\"station\"></canvas>" +
    "<div id=\"detail\"></div>" +
    (issues.length ? "<details class=\"notes\"><summary>" + issues.length + " note" + (issues.length === 1 ? "" : "s") + " from the datasheets</summary><ul>" + issues.map((issue) => "<li>" + esc(issue.problem) + "</li>").join("") + "</ul></details>" : "<p class=\"ok\">Every sensor is inside its datasheet and wired to a master port.</p>") +
    portsHtml(station, library) + powerHtml(station, library) +
    "<ul class=\"lines\">" + lines.map((line) => "<li>" + esc(line.kind === "cable" ? line.part + " · " + line.from + " X" + line.port + " → " + line.to : line.vendor + " " + line.part) + "</li>").join("") + "</ul>" +
    "<div class=\"actions\"><button type=\"button\" id=\"buy\">Buy and install</button><button type=\"button\" class=\"quiet\" id=\"studio\">Open in studio</button></div>" +
    "<p class=\"small\">Payment is not taken in ChatGPT. Settings have not been written to a sensor.</p>";
  const view = { station: station, library: library, selected: null, readOnly: true };
  view.onSelect = (uid) => {
    root.querySelector("#detail").innerHTML = details(station, uid);
  };
  mountScene(root.querySelector("#scene"), view);
  view.onSelect(null);
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
