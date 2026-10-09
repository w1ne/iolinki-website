"use strict";

// Port table and power summary, shared by the studio page and the widget.

function tableText(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

function portsHtml(station, library) {
  const rows = portTable(station, library);
  if (!rows.length) {
    return "<p class=\"small\">No sensor is wired yet.</p>";
  }
  return "<div class=\"scroll\"><table class=\"ports-table\"><thead><tr><th>Port</th><th>Device</th><th>Process data in</th><th>Cycle</th><th>Settings</th></tr></thead><tbody>" +
    rows.map((row) => "<tr><td>" + tableText(row.master) + " X" + row.port + "</td><td><b>" + tableText(row.part) + "</b><br><span class=\"small\">" + tableText(row.uid) + " · " + row.vendor_id + "/" + row.device_id + "</span></td><td>" +
      (row.pd_in_bits ? row.pd_in_bits + " bit: " + row.pd_in.map((item) => tableText(item.name) + " <span class=\"small\">@" + item.bit_offset + "·" + item.bits + "</span>").join(", ") : "<span class=\"small\">no IODD filed</span>") +
      "</td><td>" + (row.min_cycle_ms ? row.min_cycle_ms + " ms" : "") + "</td><td>" + row.parameters.map((p) => tableText(p.name) + " " + tableText(p.value)).join("<br>") + "</td></tr>").join("") +
    "</tbody></table></div>";
}

function powerHtml(station, library) {
  return powerBudget(station, library).masters.map((master) => {
    const limit = master.total_limit_ma ? " of " + master.total_limit_ma + " mA" : "";
    const unknown = master.unknown.length ? " <span class=\"small\">No filed current for " + master.unknown.map(tableText).join(", ") + ".</span>" : "";
    const state = master.problems.length ? "<span class=\"no\">" + master.problems.map(tableText).join(" ") + "</span>" : "";
    return "<p class=\"small\"><b>" + tableText(master.uid) + " " + tableText(master.part) + "</b>: sensors draw " + master.total_ma + " mA" + limit + "." + unknown + " " + state + "</p>";
  }).join("");
}

// Wiring view in the style of a PLC network view: each master as a card with
// its ports, a line from every used port to the sensor card on it.
function wiringSvg(station, library) {
  const masters = station.items.filter((item) => item.kind === "master");
  if (!masters.length) {
    return "<p class=\"small\">No master on the floor yet.</p>";
  }
  const rowH = 56;
  const cardW = 230;
  const gap = 150;
  const blocks = [];
  let y = 12;
  masters.forEach((master) => {
    const def = byId(library, master.ref) || {};
    const ports = def.ports || 4;
    const h = 46 + ports * rowH;
    const top = y;
    let svg = "<rect x=\"12\" y=\"" + top + "\" width=\"" + 170 + "\" height=\"" + h + "\" rx=\"10\" class=\"w-master\"/>" +
      "<text x=\"26\" y=\"" + (top + 24) + "\" class=\"w-title\">" + tableText(def.part) + "</text>" +
      "<text x=\"26\" y=\"" + (top + 40) + "\" class=\"w-sub\">" + tableText(master.uid + " · " + (def.fieldbus || "IO-Link master")) + "</text>";
    for (let port = 1; port <= ports; port++) {
      const py = top + 46 + (port - 1) * rowH + rowH / 2;
      const sensor = station.items.find((item) => item.kind === "sensor" && item.master === master.uid && item.port === port);
      svg += "<circle cx=\"182\" cy=\"" + py + "\" r=\"7\" class=\"" + (sensor ? "w-port used" : "w-port") + "\"/><text x=\"160\" y=\"" + (py + 4) + "\" class=\"w-portname\" text-anchor=\"end\">X" + port + "</text>";
      if (!sensor) {
        svg += "<text x=\"" + (182 + 20) + "\" y=\"" + (py + 4) + "\" class=\"w-free\">free</text>";
        continue;
      }
      const sdef = byId(library, sensor.ref) || {};
      const check = checkSensor(sdef, sensor);
      const main = check.parameters[0] ? check.parameters[0].name + " " + check.parameters[0].value : "";
      const bits = sdef.iodd && sdef.iodd.pd_in_bits ? " · PD " + sdef.iodd.pd_in_bits + " bit" : "";
      const x2 = 182 + gap;
      const warn = !check.ok;
      svg += "<path d=\"M189 " + py + " C " + (189 + gap / 2) + " " + py + ", " + (x2 - gap / 2) + " " + py + ", " + x2 + " " + py + "\" class=\"w-cable\"/>" +
        "<text x=\"" + (189 + gap / 2) + "\" y=\"" + (py - 6) + "\" class=\"w-wires\" text-anchor=\"middle\">L+ · L− · C/Q</text>" +
        "<rect x=\"" + x2 + "\" y=\"" + (py - rowH / 2 + 5) + "\" width=\"" + cardW + "\" height=\"" + (rowH - 10) + "\" rx=\"8\" class=\"w-sensor" + (warn ? " warn" : "") + "\"/>" +
        "<text x=\"" + (x2 + 12) + "\" y=\"" + (py - 3) + "\" class=\"w-title\">" + tableText(sdef.part) + " <tspan class=\"w-sub\">" + tableText(sensor.uid + " · " + (sdef.category || "")) + "</tspan></text>" +
        "<text x=\"" + (x2 + 12) + "\" y=\"" + (py + 14) + "\" class=\"w-sub\">" + tableText(main + bits) + "</text>";
    }
    blocks.push(svg);
    y += h + 18;
  });
  const width = 182 + gap + cardW + 14;
  return "<div class=\"scroll\"><svg class=\"wiring\" viewBox=\"0 0 " + width + " " + y + "\" width=\"" + width + "\" height=\"" + y + "\" role=\"img\" aria-label=\"Wiring of masters and sensors\">" + blocks.join("") + "</svg></div>";
}
