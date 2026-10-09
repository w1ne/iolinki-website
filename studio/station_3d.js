"use strict";

// WebGL view of a station (three.js r158, global THREE). Machines, sensors and
// masters are modelled from primitives so they read as what they are; cables
// are tubes from the master's M12 sockets to each sensor.

const S3D = {
  steel: { color: 0xc9d0d8, metalness: 0.65, roughness: 0.32 },
  alu: { color: 0xb7bfc9, metalness: 0.55, roughness: 0.4 },
  dark: { color: 0x2b2f36, metalness: 0.1, roughness: 0.75 },
  black: { color: 0x17191d, metalness: 0.2, roughness: 0.6 },
  ral7035: { color: 0xd5d9de, metalness: 0.05, roughness: 0.7 },
  yellow: { color: 0xf2b705, metalness: 0.1, roughness: 0.5 },
  orange: { color: 0xff7a1a, metalness: 0.15, roughness: 0.45 },
  blue: { color: 0x2d6cdf, metalness: 0.25, roughness: 0.45 },
  green: { color: 0x3a8a55, metalness: 0.25, roughness: 0.5 },
  part: { color: 0x8f9aa6, metalness: 0.7, roughness: 0.3 },
  lens: { color: 0xd8262b, metalness: 0.1, roughness: 0.2, emissive: 0x5a0000 },
  ledOk: { color: 0x34d058, emissive: 0x1d8a33, roughness: 0.3 },
  ledWarn: { color: 0xffb020, emissive: 0x9a6200, roughness: 0.3 },
};

function s3dMaterial(name) {
  const spec = S3D[name] || { color: name };
  return new THREE.MeshStandardMaterial(spec);
}

function s3dBox(group, size, at, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), s3dMaterial(material));
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function s3dCyl(group, radius, height, at, material, axis, segments) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments || 28), s3dMaterial(material));
  mesh.position.set(at[0], at[1], at[2]);
  if (axis === "x") {
    mesh.rotation.z = Math.PI / 2;
  } else if (axis === "z") {
    mesh.rotation.x = Math.PI / 2;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

// Generic machines. Shapes follow the equipment ids in library/equipment.json;
// an unknown id falls back to its filed boxes.
const S3D_MACHINES = {
  conveyor(g) {
    s3dBox(g, [6, 0.05, 0.9], [0, 0.84, 0], "dark");
    [-0.5, 0.5].forEach((z) => s3dBox(g, [6.1, 0.14, 0.07], [0, 0.82, z], "alu"));
    [-3, 3].forEach((x) => s3dCyl(g, 0.07, 1.0, [x, 0.82, 0], "steel", "z"));
    for (let x = -2.5; x <= 2.5; x += 0.5) {
      s3dCyl(g, 0.035, 0.9, [x, 0.79, 0], "steel", "z", 12);
    }
    [-2.7, 2.7].forEach((x) => [-0.45, 0.45].forEach((z) => s3dBox(g, [0.07, 0.78, 0.07], [x, 0.39, z], "alu")));
    s3dBox(g, [0.5, 0.35, 0.35], [-3.2, 0.62, 0.62], "blue");
  },
  stop(g) {
    s3dBox(g, [3, 0.08, 1.4], [0, 0.82, 0], "alu");
    [-1.3, 1.3].forEach((x) => [-0.6, 0.6].forEach((z) => s3dBox(g, [0.07, 0.78, 0.07], [x, 0.39, z], "alu")));
    s3dBox(g, [0.22, 0.45, 1.2], [1.2, 1.08, 0], "yellow");
    s3dBox(g, [0.7, 0.35, 0.7], [0.65, 1.04, 0], "part");
  },
  tank(g) {
    s3dCyl(g, 0.9, 2.0, [0, 1.35, 0], "steel", null, 40);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), s3dMaterial("steel"));
    dome.position.set(0, 2.35, 0);
    dome.castShadow = true;
    g.add(dome);
    s3dCyl(g, 0.12, 0.25, [0, 3.3, 0], "steel");
    [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]].forEach((p) => s3dCyl(g, 0.05, 0.4, [p[0], 0.2, p[1]], "steel", null, 12));
    s3dCyl(g, 0.1, 0.6, [0.95, 0.6, 0], "steel", "x");
  },
  pipe(g) {
    s3dCyl(g, 0.11, 5, [0, 0.9, 0], "steel", "x");
    [-2.5, 0, 2.5].forEach((x) => s3dCyl(g, 0.2, 0.05, [x, 0.9, 0], "steel", "x"));
    [-2, 2].forEach((x) => {
      s3dBox(g, [0.08, 0.78, 0.08], [x, 0.39, 0], "yellow");
      s3dBox(g, [0.3, 0.05, 0.3], [x, 0.78, 0], "yellow");
    });
  },
  pump(g) {
    s3dBox(g, [1.6, 0.12, 0.8], [0, 0.06, 0], "dark");
    s3dCyl(g, 0.3, 0.8, [-0.35, 0.48, 0], "blue", "x");
    s3dCyl(g, 0.34, 0.1, [-0.78, 0.48, 0], "blue", "x");
    s3dCyl(g, 0.36, 0.3, [0.35, 0.48, 0], "green", "x");
    s3dCyl(g, 0.11, 0.5, [0.6, 0.85, 0], "steel");
    s3dCyl(g, 0.11, 0.4, [0.75, 0.48, 0], "steel", "x");
  },
  press(g) {
    s3dBox(g, [2, 0.8, 1.6], [0, 0.4, 0], "yellow");
    [-0.8, 0.8].forEach((x) => s3dBox(g, [0.3, 2.4, 1.2], [x, 2.0, 0], "yellow"));
    s3dBox(g, [2, 0.45, 1.4], [0, 3.3, 0], "yellow");
    s3dBox(g, [1.2, 0.5, 1.0], [0, 2.3, 0], "steel");
    s3dBox(g, [1.3, 0.1, 1.1], [0, 0.85, 0], "dark");
  },
  robot(g) {
    s3dCyl(g, 0.45, 0.3, [0, 0.15, 0], "dark");
    s3dCyl(g, 0.35, 0.5, [0, 0.55, 0], "orange");
    const upper = s3dBox(g, [0.28, 1.2, 0.28], [0.25, 1.3, 0], "orange");
    upper.rotation.z = -0.35;
    const fore = s3dBox(g, [1.1, 0.22, 0.22], [0.85, 1.85, 0], "orange");
    fore.rotation.z = -0.2;
    s3dCyl(g, 0.1, 0.25, [1.4, 1.65, 0], "dark");
  },
  cabinet(g) {
    s3dBox(g, [1.2, 2.0, 0.6], [0, 1.0, 0], "ral7035");
    s3dBox(g, [0.012, 1.9, 0.01], [0, 1.0, 0.305], "dark");
    s3dBox(g, [0.04, 0.2, 0.04], [0.5, 1.1, 0.32], "dark");
    s3dBox(g, [1.2, 0.1, 0.6], [0, 0.05, 0], "dark");
  },
};

// Sensors, drawn about three times life size so they read on a 14 m floor.
function s3dSensor(g, def, warn) {
  const kind = def ? def.category : "";
  let face = 1.0;
  if (kind === "pressure" || kind === "flow") {
    s3dCyl(g, 0.09, 0.24, [0, 1.0, 0], "steel");
    s3dCyl(g, 0.1, 0.05, [0, 0.86, 0], "steel", null, 6);
    s3dCyl(g, 0.11, 0.08, [0, 1.16, 0], "black");
    face = 1.2;
  } else if (kind === "temperature") {
    s3dCyl(g, 0.02, 0.7, [0, 0.62, 0], "steel", null, 10);
    s3dCyl(g, 0.08, 0.2, [0, 1.07, 0], "steel");
    face = 1.17;
  } else if (kind === "level") {
    s3dCyl(g, 0.015, 1.4, [0, 0.72, 0], "steel", null, 10);
    s3dCyl(g, 0.1, 0.22, [0, 1.52, 0], "steel");
    s3dCyl(g, 0.11, 0.06, [0, 1.65, 0], "black");
    face = 1.68;
  } else if (kind === "optical distance") {
    s3dBox(g, [0.2, 0.26, 0.12], [0, 1.0, 0], "dark");
    s3dCyl(g, 0.045, 0.03, [0, 1.0, 0.07], "lens", "z");
    s3dBox(g, [0.04, 1.0, 0.04], [0, 0.5, -0.08], "alu");
    face = 1.13;
  } else {
    s3dCyl(g, 0.07, 0.36, [0, 1.0, 0], kind === "capacitive" ? "black" : "steel");
    s3dBox(g, [0.04, 0.82, 0.04], [0, 0.41, -0.1], "alu");
    s3dBox(g, [0.04, 0.04, 0.2], [0, 0.82, -0.02], "alu");
    face = 1.18;
  }
  const led = s3dCyl(g, 0.072, 0.025, [0, face + 0.01, 0], warn ? "ledWarn" : "ledOk");
  led.castShadow = false;
  s3dCyl(g, 0.045, 0.12, [0, face + 0.08, 0], "black", null, 16);
  return [0, face + 0.14, 0];
}

function s3dMaster(g, ports) {
  s3dBox(g, [0.06, 1.2, 0.06], [0, 0.6, -0.06], "alu");
  s3dBox(g, [0.7, 0.22, 0.12], [0, 1.25, 0], "steel");
  s3dBox(g, [0.7, 0.03, 0.125], [0, 1.37, 0], "blue");
  const sockets = [];
  for (let port = 1; port <= ports; port++) {
    const x = -0.28 + ((port - 1) / Math.max(1, ports - 1)) * 0.56;
    s3dCyl(g, 0.035, 0.05, [x, 1.2, 0.08], "black", "z", 16);
    sockets.push([x, 1.2, 0.1]);
  }
  return sockets;
}

function mountStation3d(container, view) {
  container.classList.add("s3d");
  container.innerHTML = "";
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const labels = document.createElement("div");
  labels.className = "s3d-labels";
  container.appendChild(labels);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef1f5);
  scene.fog = new THREE.Fog(0xeef1f5, 30, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c2cf, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  const orbit = { theta: -0.55, phi: 0.95, radius: 17, target: new THREE.Vector3(0, 0.6, 0) };
  const world = new THREE.Group();
  scene.add(world);
  let pickables = [];
  let anchors = [];
  let hovered = null;
  let framed = false;

  // Aim at the placed parts, not the empty floor.
  function frame() {
    const box = new THREE.Box3();
    pickables.forEach((g) => box.expandByObject(g));
    if (box.isEmpty()) {
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    orbit.target.set(center.x, Math.min(center.y, 0.8), center.z);
    orbit.radius = Math.max(7, Math.min(26, Math.hypot(size.x, size.z) * 1.1 + 2.5));
  }

  function place() {
    const r = orbit.radius;
    camera.position.set(
      orbit.target.x + r * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      orbit.target.y + r * Math.cos(orbit.phi),
      orbit.target.z + r * Math.sin(orbit.phi) * Math.cos(orbit.theta),
    );
    camera.lookAt(orbit.target);
  }

  function build() {
    world.clear();
    pickables = [];
    anchors = [];
    const station = view.station;
    const fx = station.floor[0];
    const fz = station.floor[1];
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fx, fz), new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    world.add(floor);
    const grid = new THREE.GridHelper(Math.max(fx, fz), Math.max(fx, fz), 0xc3c9d2, 0xc3c9d2);
    grid.position.y = 0.002;
    grid.scale.set(fx / Math.max(fx, fz), 1, fz / Math.max(fx, fz));
    world.add(grid);
    const lane = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 });
    [[0, fz / 2 - 0.15, fx, 0.08], [0, -fz / 2 + 0.15, fx, 0.08]].forEach((l) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(l[2], l[3]), lane);
      m.rotation.x = -Math.PI / 2;
      m.position.set(l[0], 0.004, l[1]);
      world.add(m);
    });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(fx, 3.2, 0.15), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.95 }));
    wall.position.set(0, 1.6, -fz / 2 - 0.08);
    wall.receiveShadow = true;
    world.add(wall);

    const issues = new Set(checkStation(station, view.library).issues.map((issue) => issue.uid));
    const sockets = new Map();
    const tops = new Map();
    station.items.forEach((item) => {
      const def = byId(view.library, item.ref);
      const g = new THREE.Group();
      g.position.set(item.at[0], 0, item.at[1]);
      g.userData.uid = item.uid;
      let top = [0, 1.6, 0];
      if (item.kind === "equipment") {
        const make = S3D_MACHINES[item.ref];
        if (make) {
          make(g);
        } else {
          ((def && def.boxes) || []).forEach((box) => s3dBox(g, box.size, box.at, box.color));
        }
        const bounds = new THREE.Box3().setFromObject(g);
        top = [0, bounds.max.y + 0.25, 0];
      } else if (item.kind === "sensor") {
        top = s3dSensor(g, def, issues.has(item.uid));
        tops.set(item.uid, top);
      } else if (item.kind === "master") {
        const ports = (def && def.ports) || 4;
        sockets.set(item.uid, s3dMaster(g, ports));
        top = [0, 1.55, 0];
      }
      g.traverse((child) => {
        child.userData.uid = item.uid;
      });
      world.add(g);
      pickables.push(g);
      anchors.push({ item: item, def: def, at: new THREE.Vector3(item.at[0] + top[0], top[1], item.at[1] + top[2]), warn: issues.has(item.uid) });
    });

    // Cables: down from the socket, along the floor, up the sensor bracket.
    cables(station, view.library).forEach((cable) => {
      const master = station.items.find((item) => item.uid === cable.from);
      const sensor = station.items.find((item) => item.uid === cable.to);
      const socket = (sockets.get(cable.from) || [])[cable.port - 1];
      const top = tops.get(cable.to);
      if (!master || !sensor || !socket || !top) {
        return;
      }
      const start = new THREE.Vector3(master.at[0] + socket[0], socket[1], master.at[1] + socket[2]);
      const lane = 0.25 + (cable.port - 1) * 0.08;
      const end = new THREE.Vector3(sensor.at[0] + top[0], top[1], sensor.at[1] + top[2]);
      const pts = [
        start,
        new THREE.Vector3(start.x, start.y - 0.05, start.z + 0.15),
        new THREE.Vector3(start.x, 0.05, start.z + lane),
        new THREE.Vector3(end.x, 0.05, start.z + lane),
        new THREE.Vector3(end.x, 0.05, end.z + 0.12),
        new THREE.Vector3(end.x, end.y - 0.4, end.z + 0.12),
        new THREE.Vector3(end.x, end.y + 0.12, end.z),
      ];
      const curve = s3dRoundedPath(pts, 0.18);
      const selected = view.selected && (view.selected === cable.to || view.selected === cable.from);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 0.045, 10, false), new THREE.MeshStandardMaterial({ color: selected ? 0xff7a1a : 0x2a2e35, roughness: 0.45, metalness: 0.1 }));
      tube.castShadow = true;
      tube.userData.uid = cable.to;
      world.add(tube);
    });
    if (!framed) {
      frame();
      framed = true;
    }
    render();
  }

  function resize() {
    const width = container.clientWidth || 640;
    const height = container.clientHeight || 400;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = width + "px";
    renderer.domElement.style.height = height + "px";
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    resize();
    place();
    renderer.render(scene, camera);
    drawLabels();
  }

  function drawLabels() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const placed = [];
    const order = { sensor: 0, master: 1, equipment: 2 };
    const html = [];
    anchors.slice().sort((a, b) => order[a.item.kind] - order[b.item.kind]).forEach((anchor) => {
      const p = anchor.at.clone().project(camera);
      if (p.z > 1) {
        return;
      }
      let x = (p.x * 0.5 + 0.5) * width;
      let y = (-p.y * 0.5 + 0.5) * height;
      const def = anchor.def || {};
      let text;
      let cls = "s3d-tag " + anchor.item.kind;
      if (anchor.item.kind === "sensor") {
        text = "<b>" + s3dEsc(def.part || anchor.item.ref) + "</b>" + (anchor.item.port ? "<i>" + s3dEsc(anchor.item.master) + " · X" + anchor.item.port + "</i>" : "");
      } else if (anchor.item.kind === "master") {
        text = "<b>" + s3dEsc(def.part || "") + "</b><i>" + s3dEsc(anchor.item.uid) + "</i>";
      } else {
        text = s3dEsc(def.name || anchor.item.ref);
      }
      if (anchor.warn) {
        cls += " warn";
      }
      if (view.selected === anchor.item.uid) {
        cls += " selected";
      }
      const w = anchor.item.kind === "equipment" ? 90 : 120;
      for (let i = 0; i < 6 && placed.some((o) => Math.abs(o[0] - x) < (w + o[2]) / 2 && Math.abs(o[1] - y) < 24); i++) {
        y -= 24;
      }
      y = Math.max(34, y);
      x = Math.max(w / 2 + 4, Math.min(width - w / 2 - 4, x));
      placed.push([x, y, w]);
      html.push("<div class=\"" + cls + "\" style=\"left:" + Math.round(x) + "px;top:" + Math.round(y) + "px\">" + text + "</div>");
    });
    labels.innerHTML = html.join("");
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function hit(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const found = raycaster.intersectObjects(world.children, true).find((h) => h.object.userData.uid);
    return found ? found.object.userData.uid : null;
  }
  function groundPoint(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const out = new THREE.Vector3();
    return raycaster.ray.intersectPlane(ground, out) ? out : null;
  }

  let drag = null;
  const el = renderer.domElement;
  el.style.touchAction = "none";
  el.addEventListener("pointerdown", (event) => {
    el.setPointerCapture(event.pointerId);
    const uid = hit(event);
    view.selected = uid;
    if (view.onSelect) {
      view.onSelect(uid);
    }
    if (uid && !view.readOnly) {
      const item = view.station.items.find((other) => other.uid === uid);
      const g = groundPoint(event);
      drag = { uid: uid, offset: g ? [item.at[0] - g.x, item.at[1] - g.z] : [0, 0], moved: false };
    } else {
      drag = { x: event.clientX, y: event.clientY };
    }
    build();
  });
  el.addEventListener("pointermove", (event) => {
    if (!drag) {
      const uid = hit(event);
      if (uid !== hovered) {
        hovered = uid;
        el.style.cursor = uid ? "pointer" : "grab";
      }
      return;
    }
    if (drag.uid) {
      const g = groundPoint(event);
      if (g) {
        const item = view.station.items.find((other) => other.uid === drag.uid);
        item.at = clampToFloor(view.station, [g.x + drag.offset[0], g.z + drag.offset[1]]);
        drag.moved = true;
        build();
      }
    } else {
      orbit.theta -= (event.clientX - drag.x) * 0.008;
      orbit.phi = Math.max(0.25, Math.min(1.45, orbit.phi - (event.clientY - drag.y) * 0.006));
      drag.x = event.clientX;
      drag.y = event.clientY;
      render();
    }
  });
  el.addEventListener("pointerup", () => {
    if (drag && drag.moved && view.onMove) {
      view.onMove();
    }
    drag = null;
  });
  el.addEventListener("wheel", (event) => {
    event.preventDefault();
    orbit.radius = Math.max(6, Math.min(32, orbit.radius * (1 + Math.sign(event.deltaY) * 0.08)));
    render();
  }, { passive: false });
  el.addEventListener("dragover", (event) => event.preventDefault());
  el.addEventListener("drop", (event) => {
    event.preventDefault();
    const ref = event.dataTransfer.getData("text/plain");
    const g = groundPoint(event);
    if (ref && g && view.onDrop) {
      view.onDrop(ref, [g.x, g.z]);
    }
  });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => render()).observe(container);
  } else {
    window.addEventListener("resize", render);
  }
  build();
  // Test hook: lets a headless check set the camera and re-render.
  container.s3d = {
    orbit: orbit,
    render: render,
    scene: scene,
    fit: () => {
      frame();
      render();
    },
    view: (name) => {
      frame();
      if (name === "top") {
        orbit.phi = 0.25;
        orbit.theta = 0;
      } else {
        orbit.phi = 0.95;
        orbit.theta = -0.55;
      }
      render();
    },
  };
  return build;
}

// Straight runs joined by small bends, so a cable never dips below the floor
// the way a spline through these points would.
function s3dRoundedPath(points, radius) {
  const path = new THREE.CurvePath();
  let from = points[0].clone();
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i];
    const inLen = corner.distanceTo(points[i - 1]);
    const outLen = corner.distanceTo(points[i + 1]);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = corner.clone().add(points[i - 1].clone().sub(corner).normalize().multiplyScalar(r));
    const b = corner.clone().add(points[i + 1].clone().sub(corner).normalize().multiplyScalar(r));
    if (from.distanceTo(a) > 1e-4) {
      path.add(new THREE.LineCurve3(from, a));
    }
    path.add(new THREE.QuadraticBezierCurve3(a, corner.clone(), b));
    from = b;
  }
  path.add(new THREE.LineCurve3(from, points[points.length - 1].clone()));
  return path;
}

function s3dEsc(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
}
