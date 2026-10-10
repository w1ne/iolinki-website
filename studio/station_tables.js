"use strict";

// Port table and power summary, shared by the studio page and the widget.

function tableText(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}

// With readings (run mode) the table shows what the master sees on each port.
function portsHtml(station, library, readings) {
  const rows = portTable(station, library);
  if (!rows.length) {
    return "<p class=\"small\">No sensor is wired yet.</p>";
  }
  const live = (row) => {
    const reading = readings && readings[row.uid];
    if (!reading) {
      return "";
    }
    const value = reading.value === null || reading.value === undefined ? (reading.present === null ? "online" : reading.present ? "target" : "no target") : reading.value + " " + reading.unit;
    return "<td class=\"pd\"><b>" + tableText(value) + "</b>" + (reading.ma !== null && reading.ma !== undefined ? " · " + reading.ma.toFixed(2) + " mA" : "") + "<br>" +
      (reading.pin === null ? "" : "<span class=\"" + (reading.on ? "on" : "") + "\">OUT1 " + (reading.on ? "on" : "off") + "</span> ") +
      (reading.pd ? "<code>" + tableText(reading.pd.hex) + "</code>" : "") + "</td>";
  };
  return "<div class=\"scroll\"><table class=\"ports-table\"><thead><tr><th>Port</th><th>Device</th>" + (readings ? "<th>Live</th>" : "") + "<th>Process data in</th><th>Cycle</th><th>Settings</th></tr></thead><tbody>" +
    rows.map((row) => "<tr><td>" + tableText(row.master) + " X" + row.port + "</td><td><b>" + tableText(row.part) + "</b><br><span class=\"small\">" + tableText(row.uid) + " · " + row.vendor_id + "/" + row.device_id + "</span></td>" + live(row) + "<td>" +
      (row.pd_in_bits ? row.pd_in_bits + " bit: " + row.pd_in.map((item) => tableText(item.name) + " <span class=\"small\">@" + item.bit_offset + "·" + item.bits + (item.gradient ? " ×" + item.gradient + " " + tableText(item.unit || "") : "") + "</span>").join(", ") : "<span class=\"small\">no IODD filed</span>") +
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
  const cardW = 262;
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
      "<text x=\"26\" y=\"" + (top + 40) + "\" class=\"w-sub\">" + tableText(master.uid + " · " + String(def.fieldbus || "IO-Link master").split(" (")[0]) + "</text>";
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

// Small line icons for part categories, 20 x 20, stroke uses currentColor.
const PART_ICONS = {
  inductive: "<path d='M7 3h6v11a3 3 0 0 1-6 0z'/><path d='M7 7h6M7 10h6'/>",
  capacitive: "<path d='M6 4v12M14 4v12M3 10h3M14 10h3'/>",
  pressure: "<circle cx='10' cy='10' r='7'/><path d='M10 10l4-3'/><circle cx='10' cy='10' r='1'/>",
  flow: "<path d='M2 7h12l-3-3M18 13H6l3 3'/>",
  temperature: "<path d='M8 3a2 2 0 0 1 4 0v8a4 4 0 1 1-4 0z'/><path d='M10 8v6'/>",
  level: "<path d='M4 4v12h12V4'/><path d='M4 11c2-1.5 4 1.5 6 0s4 1.5 6 0'/>",
  "optical distance": "<rect x='3' y='6' width='6' height='8' rx='1'/><path d='M9 10h9M15 7l3 3-3 3'/>",
  master: "<rect x='3' y='6' width='14' height='8' rx='1.5'/><circle cx='6.5' cy='10' r='1'/><circle cx='10' cy='10' r='1'/><circle cx='13.5' cy='10' r='1'/>",
  machine: "<path d='M3 15h14M5 15V9l4 2V9l4 2V6h2v9'/>",
};

function partIcon(category) {
  const body = PART_ICONS[category] || PART_ICONS.machine;
  return "<svg class=\"icon\" viewBox=\"0 0 20 20\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">" + body + "</svg>";
}
