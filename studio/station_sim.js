"use strict";

// Run mode: a simple process model per machine drives every sensor, and the
// sensor's own settings decide its output (set point, reset point, NO/NC).
// Process data in is packed with the bit layout from the device's IODD. This
// shows what the configured station does; it is not the sensor firmware.

if (typeof require !== "undefined" && typeof byId === "undefined") {
  // Node: pull the engine into scope the way the browser has it as globals.
  var { byId } = require("./engine.js");
}

const SIM_PERIOD_S = 14;
const SIM_TRACE_S = 24;
const SIM_SAMPLE_S = 0.1;
const PRESENCE = ["inductive", "capacitive", "optical distance"];
const BELT_SPEED = 0.7;
const BELT_PITCH = 3;
const BELT_HALF = 3;

function simCreate() {
  return { t: 0, last: -1, out: {}, hold: {}, trace: {} };
}

// Phase offset per sensor so the process curves do not move in lockstep.
function simPhase(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) {
    h = (h * 31 + uid.charCodeAt(i)) % 997;
  }
  return h / 997;
}

// Rise, hold high, fall, hold low; smooth at the corners.
function simShape(phase) {
  const p = ((phase % 1) + 1) % 1;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  if (p < 0.35) {
    return ease(p / 0.35);
  }
  if (p < 0.5) {
    return 1;
  }
  if (p < 0.85) {
    return 1 - ease((p - 0.5) / 0.35);
  }
  return 0;
}

// Positions of the parts riding each conveyor, in station metres.
function simBelt(station, t) {
  const out = [];
  station.items.filter((item) => item.ref === "conveyor").forEach((belt) => {
    for (let k = 0; k < (2 * BELT_HALF) / BELT_PITCH; k++) {
      const x = (((t * BELT_SPEED + k * BELT_PITCH) % (2 * BELT_HALF)) + 2 * BELT_HALF) % (2 * BELT_HALF) - BELT_HALF;
      out.push({ belt: belt.uid, local: x, at: [belt.at[0] + x, belt.at[1]] });
    }
  });
  return out;
}

function simNearest(station, item, refs, reach) {
  let best = null;
  station.items.filter((other) => refs.indexOf(other.ref) !== -1).forEach((other) => {
    const d = Math.hypot(other.at[0] - item.at[0], other.at[1] - item.at[1]);
    if (d <= reach && (!best || d < best.d)) {
      best = { item: other, d: d };
    }
  });
  return best && best.item;
}

// Whether a target is in front of a presence sensor at time t: a part on the
// nearest conveyor passing the sensor, the part held at a stop, or a timed
// pulse when the sensor stands alone.
function simPresent(station, item, t, boxes) {
  const stop = simNearest(station, item, ["stop"], 3);
  if (stop) {
    return simStop(stop, t).held;
  }
  const belt = simNearest(station, item, ["conveyor"], 2.5);
  if (belt) {
    return boxes.some((box) => box.belt === belt.uid && Math.abs(box.at[0] - item.at[0]) < 0.45);
  }
  const phase = t / 6 + simPhase(item.uid);
  return (phase % 1) < 0.35;
}

// A stop cycle: the part slides in, is held, then slides out downstream.
const STOP_CYCLE_S = 6;
function simStop(stop, t) {
  const p = ((t / STOP_CYCLE_S + simPhase(stop.uid)) % 1 + 1) % 1;
  if (p < 0.15) {
    return { held: false, slide: -1.6 + (1.6 * p) / 0.15 };
  }
  if (p < 0.75) {
    return { held: true, slide: 0 };
  }
  if (p < 0.9) {
    return { held: false, slide: (0.45 * (p - 0.75)) / 0.15 };
  }
  return { held: false, slide: -9 };
}

function simSwitchPoints(def, item) {
  const settings = def.settings || [];
  const sp = settings.find((s) => !s.below && settings.some((other) => other.below === s.key)) || settings[0];
  const rp = sp && settings.find((s) => s.below === sp.key);
  const value = (setting) => {
    if (!setting) {
      return null;
    }
    const v = item.settings && item.settings[setting.key];
    return v === null || v === undefined || v === "" ? setting.default : Number(v);
  };
  return { sp: sp, rp: rp, spValue: value(sp), rpValue: value(rp) };
}

function simAnalogue(def) {
  return (def.settings || []).some((s) => /start point|ASP/i.test(s.name));
}

function simReading(station, library, sim, item, boxes) {
  const def = byId(library, item.ref) || {};
  const category = def.category || "device";
  const reading = { uid: item.uid, part: def.part, category: category, unit: "", value: null, on: false, pin: null, ma: null, present: null, pd: null, held: sim.hold[item.uid] !== undefined };
  const options = item.options || {};
  const nc = /closed/i.test(options.output || "");
  const points = simSwitchPoints(def, item);
  const phase = sim.t / SIM_PERIOD_S + simPhase(item.uid);

  if (PRESENCE.indexOf(category) !== -1) {
    const present = reading.held ? Boolean(sim.hold[item.uid]) : simPresent(station, item, sim.t, boxes);
    reading.present = present;
    reading.on = present;
    if (points.sp && points.spValue !== null && category !== "capacitive") {
      // A target sits well inside the switching distance; the background is far beyond it.
      reading.unit = points.sp.unit;
      reading.value = present ? Math.round(points.spValue * 0.7 * 10) / 10 : null;
    }
  } else if (simAnalogue(def)) {
    const start = points.rpValue !== null && points.rp && /start/i.test(points.rp.name) ? points.rpValue : (def.settings[0] && Number(item.settings[def.settings[0].key]));
    const endSetting = (def.settings || []).find((s) => /end point|AEP/i.test(s.name));
    const end = endSetting ? Number(item.settings[endSetting.key]) : start + 100;
    // A process that warms from about room temperature, inside the span.
    const lo = Math.max(start, 15);
    const hi = Math.min(end, 85);
    const value = reading.held ? Number(sim.hold[item.uid]) : (hi > lo ? lo + 0.15 * (hi - lo) + 0.7 * (hi - lo) * simShape(phase) : lo);
    reading.unit = (endSetting || {}).unit || "";
    reading.value = Math.round(value * 10) / 10;
    reading.ma = end > start ? Math.max(3.8, Math.min(20.5, 4 + (16 * (value - start)) / (end - start))) : null;
    reading.ma = reading.ma === null ? null : Math.round(reading.ma * 100) / 100;
  } else if (points.sp && points.spValue !== null) {
    const span = points.sp.max - points.sp.min;
    const sp = points.spValue;
    const rp = points.rpValue !== null ? points.rpValue : sp - 0.02 * span;
    const swing = Math.max(sp - rp, 0.04 * span);
    const floor = points.rp ? Math.min(points.rp.min, points.sp.min) : points.sp.min;
    const lo = Math.max(floor, rp - 1.5 * swing - 0.05 * span);
    const hi = Math.min(points.sp.max, sp + swing + 0.05 * span);
    const value = reading.held ? Number(sim.hold[item.uid]) : lo + (hi - lo) * simShape(phase);
    const was = Boolean(sim.out[item.uid]);
    const on = value >= sp ? true : value <= rp ? false : was;
    reading.unit = points.sp.unit;
    reading.value = Math.round(value * 100) / 100;
    reading.on = on;
    reading.range = [lo, hi];
    reading.sp = sp;
    reading.rp = rp;
  } else {
    reading.on = false;
  }
  sim.out[item.uid] = reading.on;
  if (!simAnalogue(def) && reading.category !== "device" && reading.category !== "actuator") {
    reading.pin = nc ? !reading.on : reading.on;
  }
  reading.pd = simProcessData(def, reading);
  return reading;
}

// A setting and its process value can use different length units, such as a
// switch point in mm and a distance reported in cm.
const LENGTH_MM = { mm: 1, cm: 10, m: 1000 };
function inUnit(value, from, to) {
  return LENGTH_MM[from] && LENGTH_MM[to] ? (value * LENGTH_MM[from]) / LENGTH_MM[to] : null;
}

// Pack process data in the way the master sees it: field at bit_offset with
// bit 0 the least significant bit of the last octet.
function simProcessData(def, reading) {
  const iodd = def.iodd || {};
  const bits = Number(iodd.pd_in_bits) || 0;
  if (!bits || !iodd.pd_in) {
    return null;
  }
  let total = 0;
  const fields = [];
  iodd.pd_in.forEach((field) => {
    let raw = null;
    if (field.bits === 1) {
      raw = /OUT1|SSC1|BDC1|\[OUT1\]/i.test(field.name) ? (reading.on ? 1 : 0) : 0;
    } else if (field.gradient && reading.value !== null && (!field.unit || field.unit === reading.unit || inUnit(reading.value, reading.unit, field.unit) !== null)) {
      const value = field.unit && field.unit !== reading.unit ? inUnit(reading.value, reading.unit, field.unit) : reading.value;
      raw = Math.round((value - (field.offset || 0)) / field.gradient);
      if (raw < 0) {
        raw += Math.pow(2, field.bits);
      }
      raw = Math.max(0, Math.min(Math.pow(2, field.bits) - 1, raw));
    } else if (field.gradient && field.unit === "°C") {
      // A second channel such as medium temperature: room temperature.
      raw = Math.round((22 - (field.offset || 0)) / field.gradient);
    }
    fields.push({ name: field.name, raw: raw });
    if (raw !== null) {
      total += raw * Math.pow(2, field.bit_offset);
    }
  });
  const hex = total.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), "0");
  return { bits: bits, hex: hex.replace(/(..)(?=.)/g, "$1 "), fields: fields };
}

function simStep(station, library, sim, dt) {
  sim.t += dt;
  const boxes = simBelt(station, sim.t);
  const readings = {};
  const sample = sim.t - sim.last >= SIM_SAMPLE_S;
  station.items.filter((item) => item.kind === "sensor").forEach((item) => {
    const reading = simReading(station, library, sim, item, boxes);
    readings[item.uid] = reading;
    if (sample) {
      const trace = sim.trace[item.uid] || (sim.trace[item.uid] = []);
      trace.push([sim.t, reading.value, reading.on]);
      while (trace.length && trace[0][0] < sim.t - SIM_TRACE_S) {
        trace.shift();
      }
    }
  });
  if (sample) {
    sim.last = sim.t;
  }
  const stops = {};
  station.items.filter((item) => item.ref === "stop").forEach((stop) => {
    stops[stop.uid] = simStop(stop, sim.t);
  });
  return { t: sim.t, boxes: boxes, readings: readings, tanks: simTanks(station, readings), stops: stops };
}

// Fill fraction for each tank: from a level sensor on it, else a slow cycle.
function simTanks(station, readings) {
  const out = {};
  station.items.filter((item) => item.ref === "tank").forEach((tank) => {
    const level = Object.values(readings).find((r) => r.category === "level" && r.range && simNearestUid(station, r.uid, tank.uid));
    out[tank.uid] = level ? Math.max(0.05, Math.min(0.95, (level.value - level.range[0]) / (level.range[1] - level.range[0]) * 0.6 + 0.2)) : 0.55;
  });
  return out;
}

function simNearestUid(station, sensorUid, tankUid) {
  const sensor = station.items.find((item) => item.uid === sensorUid);
  const tank = simNearest(station, sensor, ["tank"], 3);
  return tank && tank.uid === tankUid;
}

if (typeof module !== "undefined") {
  module.exports = { simCreate, simStep, simBelt, simShape, simProcessData, SIM_TRACE_S };
}
