"use strict";

// Isometric view of a station. Parts are boxes; the view can be turned by
// dragging empty floor, and parts are moved by dragging them.

const FACE_INDEX = [
  [0, 2, 3, 1],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 4, 6, 2],
  [1, 3, 7, 5],
];

const KIND_COLOR = { sensor: "#e07a2f", master: "#3d6fbf" };
const SENSOR_BOX = [0.35, 0.6, 0.35];
const MASTER_BOX = [1.3, 0.5, 0.6];

function boxCorners(at, size) {
  const points = [];
  [-1, 1].forEach((x) => {
    [-1, 1].forEach((y) => {
      [-1, 1].forEach((z) => {
        points.push([at[0] + x * size[0] / 2, at[1] + y * size[1] / 2, at[2] + z * size[2] / 2]);
      });
    });
  });
  return points;
}

function rotateY(point, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [point[0] * c + point[2] * s, point[1], -point[0] * s + point[2] * c];
}

// Orthographic camera tilted down by PITCH; +z after the turn faces the viewer.
const PITCH = 0.62;
const COS_P = Math.cos(PITCH);
const SIN_P = Math.sin(PITCH);

function screenOf(point, scale, origin) {
  return [
    origin[0] + point[0] * scale,
    origin[1] - (point[1] * COS_P - point[2] * SIN_P) * scale,
  ];
}

function depthOf(point) {
  return point[2] * COS_P + point[1] * SIN_P;
}

// Inverse of screenOf for a point on the plane y = height, in world space.
function floorPoint(screen, yaw, scale, origin, height) {
  const x = (screen[0] - origin[0]) / scale;
  const z = ((screen[1] - origin[1]) / scale + height * COS_P) / SIN_P;
  return rotateY([x, height, z], -yaw);
}

function tint(hex, factor) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
  return "rgb(" + channel(16) + "," + channel(8) + "," + channel(0) + ")";
}

// Turn a station into boxes, each tagged with the item it belongs to.
function sceneBoxes(station, library) {
  const fx = station.floor[0];
  const fz = station.floor[1];
  const boxes = [
    { uid: null, at: [0, -0.06, 0], size: [fx, 0.12, fz], color: "#5c6b84" },
    { uid: null, at: [0, 1.7, -fz / 2 - 0.1], size: [fx, 3.4, 0.2], color: "#7d8ba3" },
  ];
  station.items.forEach((item) => {
    const def = byId(library, item.ref);
    if (item.kind === "equipment") {
      ((def && def.boxes) || []).forEach((box) => {
        boxes.push({ uid: item.uid, at: [item.at[0] + box.at[0], box.at[1], item.at[1] + box.at[2]], size: box.size, color: box.color });
      });
    } else if (item.kind === "sensor") {
      boxes.push({ uid: item.uid, at: [item.at[0], SENSOR_HEIGHT, item.at[1]], size: SENSOR_BOX, color: KIND_COLOR.sensor });
      boxes.push({ uid: item.uid, at: [item.at[0], SENSOR_HEIGHT / 2, item.at[1]], size: [0.06, SENSOR_HEIGHT, 0.06], color: "#8b909a" });
    } else if (item.kind === "master") {
      boxes.push({ uid: item.uid, at: [item.at[0], 0.5, item.at[1]], size: MASTER_BOX, color: KIND_COLOR.master });
      boxes.push({ uid: item.uid, at: [item.at[0], 0.12, item.at[1]], size: [0.1, 0.24, 0.1], color: "#8b909a" });
    }
  });
  return boxes;
}

function itemLabel(item, library) {
  const def = byId(library, item.ref);
  if (!def) {
    return item.ref;
  }
  if (item.kind === "sensor") {
    return def.part + (item.port ? " · " + item.master + " X" + item.port : "");
  }
  if (item.kind === "master") {
    return def.part + " · " + item.uid;
  }
  return def.name;
}

function fitFloor(station, yaw, width, height) {
  const hx = station.floor[0] / 2;
  const hz = station.floor[1] / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  [[-hx, 0, -hz], [hx, 0, -hz], [-hx, 0, hz], [hx, 0, hz], [-hx, 3.4, -hz], [hx, 3.4, -hz]].forEach((corner) => {
    const point = screenOf(rotateY(corner, yaw), 1, [0, 0]);
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  });
  const scale = Math.min((width * 0.94) / (maxX - minX), (height * 0.92) / (maxY - minY));
  return { scale: scale, origin: [width / 2 - ((minX + maxX) / 2) * scale, height / 2 - ((minY + maxY) / 2) * scale] };
}

function drawPath(ctx, points, offset) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point[0], point[1] + offset);
    } else {
      ctx.lineTo(point[0], point[1] + offset);
    }
  });
  ctx.stroke();
}

function drawCables(ctx, station, library, yaw, scale, origin) {
  const conductorColor = ["#a56b32", "#3d7fd4", "#1a1a1a"];
  cables(station, library).forEach((cable) => {
    const points = cable.path.map((point) => screenOf(rotateY(point, yaw), scale, origin));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(4, scale * 0.09);
    ctx.strokeStyle = "#e0b000";
    drawPath(ctx, points, 0);
    ctx.lineWidth = Math.max(1, scale * 0.02);
    conductorColor.forEach((color, lane) => {
      ctx.strokeStyle = color;
      drawPath(ctx, points, (lane - 1) * Math.max(1.2, scale * 0.022));
    });
  });
}

function drawScene(canvas, view) {
  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 360;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#1b1e27";
  ctx.fillRect(0, 0, width, height);
  const fit = fitFloor(view.station, view.yaw, width, height);
  view.scale = fit.scale;
  view.origin = fit.origin;
  const faces = [];
  view.hits = [];
  sceneBoxes(view.station, view.library).forEach((box, boxIndex) => {
    const world = boxCorners(box.at, box.size).map((point) => rotateY(point, view.yaw));
    const projected = world.map((point) => screenOf(point, fit.scale, fit.origin));
    FACE_INDEX.forEach((face, index) => {
      const a = projected[face[0]];
      const b = projected[face[1]];
      const c = projected[face[2]];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) {
        return;
      }
      // Floor and wall are the room: always behind everything placed in it.
      const room = box.uid === null ? -1e6 + boxIndex * 1e3 : 0;
      const depth = room + face.reduce((sum, corner) => sum + depthOf(world[corner]), 0) / 4 + boxIndex * 1e-6;
      faces.push({ box: box, points: face.map((corner) => projected[corner]), depth: depth, factor: 0.62 + (index % 3) * 0.16 });
    });
  });
  faces.sort((a, b) => a.depth - b.depth);
  faces.forEach((face) => {
    ctx.beginPath();
    face.points.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
    ctx.closePath();
    const selected = face.box.uid && face.box.uid === view.selected;
    ctx.fillStyle = tint(face.box.color, face.factor * (selected ? 1.25 : 1));
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (face.box.uid) {
      view.hits.push({ uid: face.box.uid, points: face.points, depth: face.depth });
    }
  });
  drawCables(ctx, view.station, view.library, view.yaw, fit.scale, fit.origin);
  ctx.font = (width < 600 ? 10 : 13) + "px sans-serif";
  const problems = new Set(checkStation(view.station, view.library).issues.map((issue) => issue.uid));
  // Sensors and masters label first; a label that would cover another one
  // moves down until it is clear.
  const placed = [];
  const order = { sensor: 0, master: 1, equipment: 2 };
  view.station.items.slice().sort((a, b) => order[a.kind] - order[b.kind]).forEach((item) => {
    const lift = item.kind === "sensor" ? SENSOR_HEIGHT + 0.5 : item.kind === "master" ? 1 : 0.2;
    const point = screenOf(rotateY([item.at[0], lift, item.at[1]], view.yaw), fit.scale, fit.origin);
    const text = itemLabel(item, view.library);
    const box = { x: point[0] + 6, y: point[1] - 13, w: ctx.measureText(text).width + 8, h: 18 };
    for (let tries = 0; tries < 6 && placed.some((other) => box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h); tries++) {
      box.y += 19;
    }
    placed.push(box);
    ctx.fillStyle = "rgba(18, 20, 26, 0.75)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = problems.has(item.uid) ? "#ffb4b4" : item.kind === "equipment" ? "#aab3c2" : "#f4f4f4";
    ctx.fillText(text, box.x + 4, box.y + 13);
  });
}

function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
}

function pick(view, point) {
  for (let i = view.hits.length - 1; i >= 0; i--) {
    if (inside(point, view.hits[i].points)) {
      return view.hits[i].uid;
    }
  }
  return null;
}

// view: { station, library, yaw, selected, onSelect(uid), onMove() }
function mountScene(canvas, view) {
  view.yaw = view.yaw === undefined ? -0.35 : view.yaw;
  const frame = () => drawScene(canvas, view);
  let drag = null;
  const local = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  canvas.onpointerdown = (event) => {
    canvas.setPointerCapture(event.pointerId);
    const point = local(event);
    const uid = pick(view, point);
    view.selected = uid;
    if (view.onSelect) {
      view.onSelect(uid);
    }
    if (uid && !view.readOnly) {
      const item = view.station.items.find((other) => other.uid === uid);
      const ground = floorPoint(point, view.yaw, view.scale, view.origin, 0);
      drag = { uid: uid, offset: [item.at[0] - ground[0], item.at[1] - ground[2]], moved: false };
    } else {
      drag = { x: event.clientX };
    }
    frame();
  };
  canvas.onpointermove = (event) => {
    if (!drag || event.buttons === 0) {
      return;
    }
    if (drag.uid) {
      const ground = floorPoint(local(event), view.yaw, view.scale, view.origin, 0);
      const item = view.station.items.find((other) => other.uid === drag.uid);
      item.at = clampToFloor(view.station, [ground[0] + drag.offset[0], ground[2] + drag.offset[1]]);
      drag.moved = true;
    } else {
      view.yaw += (event.clientX - drag.x) * 0.01;
      drag.x = event.clientX;
    }
    frame();
  };
  canvas.onpointerup = () => {
    if (drag && drag.moved && view.onMove) {
      view.onMove();
    }
    drag = null;
  };
  canvas.ondragover = (event) => event.preventDefault();
  canvas.ondrop = (event) => {
    event.preventDefault();
    const ref = event.dataTransfer.getData("text/plain");
    if (!ref || !view.onDrop) {
      return;
    }
    const ground = floorPoint(local(event), view.yaw, view.scale, view.origin, 0);
    view.onDrop(ref, [ground[0], ground[2]]);
  };
  window.addEventListener("resize", frame);
  frame();
  return frame;
}

if (typeof module !== "undefined") {
  module.exports = { floorPoint, screenOf, rotateY, sceneBoxes };
}
