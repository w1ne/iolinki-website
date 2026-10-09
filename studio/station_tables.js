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
