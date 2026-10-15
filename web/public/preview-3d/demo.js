// "From the 2D map down into 3D, then what years of unnoticed damp would do", for the House of the
// Masks on Delos, built only from data we may use:
//   ground      the game's satellite picture (Esri) on real terrain (AWS Terrain Tiles)
//   walls       the ruin's outline from OpenStreetMap (historic=ruins), height assumed
//   rooms       ARGUS's own 3D sensor placements, which name the four mosaic rooms (214-217)
//   mosaics     photos from Wikimedia Commons where a straight-down one exists (216, 217);
//               the other two floors are a plain pattern, an illustration
//   sensors     ARGUS's 3D placements (position and height)
//   dangers     ARGUS's risk scenarios for this house, with last night's check from the Pi
//   damage      an illustration, not a prediction
// data.json is written by tools/build_preview_3d.py (README, "3D preview").
// ARGUS's own 3D models would replace the walls and floors; everything else stays.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

const data = await (await fetch("./data.json")).json();
const { lat: LAT0, lon: LON0 } = data.origin;
const [KX, KY] = data.metres_per_degree;
const toLatLng = ([x, y]) => [LAT0 + y / KY, LON0 + x / KX];
const ruin = data.shapes.find((s) => s.osm_id === 384671023); // OSM: historic=ruins, the House of the Masks
const sites = data.shapes.filter((s) => s.kind === "site");
const room = Object.fromEntries(data.rooms.map((r) => [r.room, r]));
const centroid = (ring) => ring.slice(0, -1).reduce((a, p) => [a[0] + p[0] / (ring.length - 1), a[1] + p[1] / (ring.length - 1)], [0, 0]);
const houseCentre = centroid(ruin.ring);
const dampSource = room["215"].xy; // the two soil-moisture sensors under the Theatrical Masks mosaic

// ------------------------------------------------------------------ the 2D map (as in the game)
const ZOOM = 19;
const map = L.map("map", { zoomControl: false, attributionControl: false }).setView(toLatLng(houseCentre), ZOOM);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 18, maxZoom: 21 }).addTo(map);
for (const s of sites) L.polygon(s.ring.map(toLatLng), { color: "#fff", weight: 2, dashArray: "6 6", fill: false }).addTo(map);
L.polygon(ruin.ring.map(toLatLng), { color: "#fff", weight: 2, fill: false }).addTo(map);
for (const s of data.sensors3d) {
  L.marker(toLatLng(s.xy), { icon: L.divIcon({ className: "", html: '<div class="marker"></div>', iconSize: [12, 12] }) }).addTo(map);
}

// ------------------------------------------------------------------ real ground: imagery and terrain
function tileXY(lon, lat, z) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}
function tileLonLat(x, y, z) {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}
function loadImage(src) {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}
async function mosaicOfTiles(z, url, R) { // (2R x 2R) tiles around the origin, drawn into one canvas
  const [fx, fy] = tileXY(LON0, LAT0, z);
  const tx0 = Math.floor(fx) - R + 1, ty0 = Math.floor(fy) - R + 1, N = 2 * R;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256 * N;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await Promise.all([...Array(N * N).keys()].map(async (k) => {
    const i = k % N, j = Math.floor(k / N), img = await loadImage(url(z, tx0 + i, ty0 + j));
    if (img) ctx.drawImage(img, i * 256, j * 256);
  }));
  const [lonW, latN] = tileLonLat(tx0, ty0, z), [lonE, latS] = tileLonLat(tx0 + N, ty0 + N, z);
  return { canvas, ctx, west: (lonW - LON0) * KX, east: (lonE - LON0) * KX, north: (latN - LAT0) * KY, south: (latS - LAT0) * KY };
}
const [imagery, dem] = await Promise.all([
  mosaicOfTiles(18, (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, 2),
  mosaicOfTiles(15, (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, 1),
]);
const demPixels = dem.ctx.getImageData(0, 0, dem.canvas.width, dem.canvas.height).data;
const demHeight = (px, py) => {
  const x = Math.max(0, Math.min(dem.canvas.width - 1, Math.round(px))), y = Math.max(0, Math.min(dem.canvas.height - 1, Math.round(py)));
  const o = (y * dem.canvas.width + x) * 4;
  return demPixels[o] * 256 + demPixels[o + 1] + demPixels[o + 2] / 256 - 32768; // Terrarium encoding
};
function terrain(x, y) { // metres above the origin, bilinear
  const px = ((x - dem.west) / (dem.east - dem.west)) * dem.canvas.width - 0.5;
  const py = ((dem.north - y) / (dem.north - dem.south)) * dem.canvas.height - 0.5;
  const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
  const h = (a, b) => demHeight(a, b);
  return (h(x0, y0) * (1 - fx) + h(x0 + 1, y0) * fx) * (1 - fy) + (h(x0, y0 + 1) * (1 - fx) + h(x0 + 1, y0 + 1) * fx) * fy;
}
const H0 = terrain(0, 0);
const ground = (x, y) => terrain(x, y) - H0;
const at = ([x, y], up = 0) => new THREE.Vector3(x, ground(x, y) + up, -y); // metres east/north -> scene

// ------------------------------------------------------------------ the scene
const host = document.getElementById("three");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.className = "labels";
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#cfe2ee");
scene.fog = new THREE.Fog("#cfe2ee", 260, 760);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 4000);
scene.add(new THREE.HemisphereLight("#ffffff", "#bba98c", 1.1));
const sun = new THREE.DirectionalLight("#fff3df", 2.4);
const centre3 = at(houseCentre);
sun.position.copy(centre3).add(new THREE.Vector3(-40, 70, 30));
sun.target.position.copy(centre3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 250 });
scene.add(sun, sun.target);

const SEG = 128; // ground: the satellite picture, lifted onto the terrain
const groundGeo = new THREE.PlaneGeometry(imagery.east - imagery.west, imagery.north - imagery.south, SEG, SEG);
const gp = groundGeo.attributes.position;
const gx0 = (imagery.west + imagery.east) / 2, gy0 = (imagery.north + imagery.south) / 2;
for (let i = 0; i < gp.count; i++) gp.setZ(i, ground(gp.getX(i) + gx0, gp.getY(i) + gy0));
groundGeo.computeVertexNormals();
const groundTex = new THREE.CanvasTexture(imagery.canvas);
groundTex.colorSpace = THREE.SRGBColorSpace;
groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.position.set(gx0, 0, -gy0);
groundMesh.receiveShadow = true;
scene.add(groundMesh);
const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: "#a99b80", roughness: 1 }));
far.rotation.x = -Math.PI / 2;
far.position.y = Math.min(...Array.from({ length: gp.count }, (_, i) => gp.getZ(i))) - 0.2;
scene.add(far);

// ------------------------------------------------------------------ damage, shared by every surface
const NOISE = `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }`;
const src = at(dampSource);
const damage = { damp: { value: 0 }, wet: { value: 0 }, loss: { value: 0 }, salt: { value: 0 }, source: { value: new THREE.Vector2(src.x, src.z) } };
const WORLD_V = ["#include <common>", "#include <common>\nvarying vec3 vWorld;", "#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"];

// Walls: rubble masonry; damp darkens them from the ground up, with a line of salt at its edge
function wallMaterial(base, groundY) {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.95 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uDamp: damage.damp, uSource: damage.source, uGround: { value: groundY } });
    shader.vertexShader = shader.vertexShader.replace(WORLD_V[0], WORLD_V[1]).replace(WORLD_V[2], WORLD_V[3]);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWorld;\nuniform float uDamp, uGround;\nuniform vec2 uSource;\n${NOISE}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        // rubble masonry: courses about 26 cm high, stones of uneven length, mortar between them
        float along = vWorld.x * 0.71 - vWorld.z * 0.71;
        float row = floor((vWorld.y - uGround) / 0.26);
        float sx = along / 0.38 + hash12(vec2(row, 3.0)) * 3.0 + (vnoise(vec2(along * 2.0, row)) - 0.5) * 0.6;
        vec2 stoneId = vec2(row, floor(sx));
        float fy = fract((vWorld.y - uGround) / 0.26), fx = fract(sx);
        float mortarLine = max(1.0 - smoothstep(0.0, 0.07, min(fy, 1.0 - fy)), 1.0 - smoothstep(0.0, 0.06, min(fx, 1.0 - fx)));
        vec3 tint = mix(vec3(0.93, 0.90, 0.84), vec3(1.05, 0.98, 0.88), hash12(stoneId));
        diffuseColor.rgb *= tint * (0.86 + 0.18 * vnoise(vWorld.xz * 9.0 + vWorld.y * 9.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, mortarLine);
        float near = 1.0 - smoothstep(3.0, 18.0, distance(vWorld.xz, uSource));   // strongest near the damp source
        float damp = uDamp * (0.25 + 0.75 * near);
        if (damp > 0.0) {
          float y = vWorld.y - uGround;
          float edge = damp + (vnoise(vWorld.xz * 1.6 + vWorld.y) - 0.5) * 0.22;
          float wet = 1.0 - smoothstep(edge - 0.05, edge + 0.02, y);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.50, 0.49, 0.45), wet);
          diffuseColor.rgb *= 1.0 - smoothstep(0.10, 0.0, abs(y - (edge - 0.07))) * 0.25 * smoothstep(0.15, 0.35, damp);
          float band = smoothstep(0.07, 0.0, abs(y - edge - 0.035)) * smoothstep(0.15, 0.35, damp);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.96, 0.93), band * (0.55 + 0.45 * vnoise(vWorld.xz * 11.0 + vWorld.y * 9.0)));
        }`);
  };
  return m;
}
const WALL_H = 2.4; // assumed: OpenStreetMap has the outline, not the height
const tops = [];
for (let i = 0; i < ruin.ring.length - 1; i++) {
  const a2 = ruin.ring[i], b2 = ruin.ring[i + 1];
  const a = at(a2), b = at(b2), len = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
  if (len < 0.2) continue;
  const base = Math.min(a.y, b.y);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.55, WALL_H, 0.55), wallMaterial("#d6c8ad", base));
  wall.position.set((a.x + b.x) / 2, base + WALL_H / 2, (a.z + b.z) / 2);
  wall.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
  for (let t = 0; t < 1; t += 0.7 / Math.max(len, 0.7)) tops.push(a.clone().lerp(b, t).setY(base + WALL_H + 0.12));
}
for (const s of sites) { // plot outlines, dashed as in the game's site guide
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(s.ring.map((p) => at(p, 0.08))),
    new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 1.2, gapSize: 1.0 }));
  line.computeLineDistances();
  scene.add(line);
}

// Mosaic floors, one per room ARGUS names, each with its centre panel. Tesserae 4 cm.
let axis = 0, longest = 0; // lined up with the house's longest wall
for (let i = 0; i < ruin.ring.length - 1; i++) {
  const [x1, y1] = ruin.ring[i], [x2, y2] = ruin.ring[i + 1], len = Math.hypot(x2 - x1, y2 - y1);
  if (len > longest) { longest = len; axis = Math.atan2(y2 - y1, x2 - x1); }
}
const FLOOR = 3.1, PANEL = 1.35; // assumed sizes (rooms 215 and 216 are 3.3 m apart)
const DAMAGE_GLSL = `
  // a damp stain spreading from the soil probes, with an irregular edge
  float rs = distance(vWorld.xz, uSource) + (vnoise(vWorld.xz * 1.3) - 0.5) * 0.9 + (vnoise(vWorld.xz * 4.0) - 0.5) * 0.3;
  float wet = uWet > 0.0 ? 1.0 - smoothstep(uWet - 0.35, uWet + 0.05, rs) : 0.0;
  vec2 cell = floor(vWorld.xz / 0.04);
  // lost tesserae come away in patches (lacunae), inside the stain, more where it has been wet longest
  float lossHere = uLoss * wet * (0.5 + 0.5 * (1.0 - clamp(rs / max(uWet, 0.01), 0.0, 1.0)));
  float patchN = vnoise(vWorld.xz * 2.6 + 11.0) * 0.65 + vnoise(vWorld.xz * 7.0) * 0.35;
  float lost = max(step(1.0 - lossHere * 0.45, patchN), step(hash12(cell + 7.3), lossHere * 0.12));
  vec3 mortar = vec3(0.50, 0.45, 0.39);
  col = mix(col * mix(vec3(1.0), vec3(0.56, 0.52, 0.46), wet), mortar * mix(1.0, 0.8, wet), lost);
  // salts: a white tide mark at the stain's edge, then crusts inside it
  float tide = smoothstep(0.16, 0.0, abs(rs - uWet)) * uSalt * (0.55 + 0.45 * hash12(cell * 1.7 + 3.1));
  float crust = smoothstep(0.72, 0.84, vnoise(vWorld.xz * 6.5 + 5.0)) * wet * uSalt * (0.45 + 0.55 * hash12(cell * 2.3));
  col = mix(col, vec3(0.97, 0.96, 0.92), clamp(max(tide, crust), 0.0, 0.9));
  vec2 f = fract(vWorld.xz / 0.04);
  float grout = step(0.06, f.x) * step(0.06, f.y) * step(f.x, 0.94) * step(f.y, 0.94);
  diffuseColor.rgb = mix(mix(col, mortar, 0.55), col, max(grout, lost));`;
function floorMaterial(photo) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, map: photo || null });
  m.defines = { USE_UV: "" };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uWet: damage.wet, uLoss: damage.loss, uSalt: damage.salt, uSource: damage.source });
    shader.vertexShader = shader.vertexShader.replace(WORLD_V[0], WORLD_V[1]).replace(WORLD_V[2], WORLD_V[3]);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWorld;\nuniform float uWet, uLoss, uSalt;\nuniform vec2 uSource;\n${NOISE}`)
      .replace("#include <map_fragment>", photo ? `#include <map_fragment>
          vec3 col = diffuseColor.rgb;${DAMAGE_GLSL.replace("diffuseColor.rgb = mix(mortar * 0.85, col, max(grout, lost));", "diffuseColor.rgb = col;")}` : `#include <map_fragment>
          vec2 c = (vUv - 0.5) * ${FLOOR.toFixed(2)};                 // plain floor with border bands
          float box = max(abs(c.x), abs(c.y));
          vec3 col = vec3(0.87, 0.84, 0.77);
          if (box > ${(FLOOR / 2 - 0.16).toFixed(2)}) col = vec3(0.15, 0.14, 0.15);
          else if (box > ${(FLOOR / 2 - 0.26).toFixed(2)}) col = vec3(0.62, 0.23, 0.16);
          col *= 0.92 + 0.16 * hash12(floor(vWorld.xz / 0.04));${DAMAGE_GLSL}`);
  };
  return m;
}
function emblemMaterial() { // a centre panel without a straight-down photo: an illustration
  const m = floorMaterial(null);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader) => {
    base(shader);
    shader.fragmentShader = shader.fragmentShader.replace(`vec2 c = (vUv - 0.5) * ${FLOOR.toFixed(2)};`, `vec2 c = (vUv - 0.5) * ${PANEL.toFixed(2)};`)
      .replace("vec3 col = vec3(0.87, 0.84, 0.77);", `vec3 col = vec3(0.82, 0.78, 0.70);
        float r = length(c);
        if (r < 0.52) col = mix(vec3(0.70, 0.52, 0.30), vec3(0.22, 0.33, 0.39), step(0.3, r) * step(r, 0.42));`)
      .replace(`if (box > ${(FLOOR / 2 - 0.16).toFixed(2)})`, `if (box > ${(PANEL / 2 - 0.08).toFixed(2)})`)
      .replace(`else if (box > ${(FLOOR / 2 - 0.26).toFixed(2)})`, `else if (box > ${(PANEL / 2 - 0.15).toFixed(2)})`);
  };
  return m;
}
const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");
for (const r of data.rooms) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR, FLOOR), floorMaterial(null));
  floor.rotation.set(-Math.PI / 2, 0, axis);
  floor.position.copy(at(r.xy, 0.03));
  floor.receiveShadow = true;
  scene.add(floor);
  let panel;
  if (r.photo) {
    const tex = await loader.loadAsync(r.photo.url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const w = PANEL * Math.min(1.35, r.photo.w / r.photo.h);
    panel = new THREE.Mesh(new THREE.PlaneGeometry(w, PANEL), floorMaterial(tex));
  } else {
    panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL, PANEL), emblemMaterial());
  }
  panel.rotation.set(-Math.PI / 2, 0, axis);
  panel.position.copy(at(r.xy, 0.036));
  panel.receiveShadow = true;
  scene.add(panel);
  const el = document.createElement("div");
  el.className = "tag";
  el.textContent = `Room ${r.room} · ${r.name.replace("Seilinos", "Silenus")}`;
  const label = new CSS2DObject(el);
  label.position.copy(at(r.xy, 0.45));
  scene.add(label);
}

// ARGUS sensors at their 3D placements (vermilion squares, as on the game's map)
const sensorMat = new THREE.MeshStandardMaterial({ color: "#a84300" });
const postMat = new THREE.MeshStandardMaterial({ color: "#2b302d" });
for (const s of data.sensors3d) {
  const soil = s.kind === "soil_moisture";
  const h = soil ? 0.05 : s.h; // a soil probe is in the ground; the others at ARGUS's height above the floor
  const cube = new THREE.Mesh(new THREE.BoxGeometry(0.14, soil ? 0.05 : 0.14, 0.14), sensorMat);
  cube.position.copy(at(s.xy, h));
  cube.castShadow = true;
  scene.add(cube);
  if (!soil) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, h), postMat);
    post.position.copy(at(s.xy, h / 2));
    scene.add(post);
  }
}

// Plants rooting in the wall tops when nobody looks after them
tops.sort(() => Math.random() - 0.5);
const plants = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshStandardMaterial({ color: "#56703a", roughness: 1, flatShading: true }), tops.length);
const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), q4 = new THREE.Quaternion();
tops.forEach((p, i) => { const k = 0.6 + Math.random() * 0.9; sc.set(k * 1.3, k * 0.8, k * 1.1);
  plants.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x + Math.random() * 0.24 - 0.12, p.y - 0.05, p.z + Math.random() * 0.24 - 0.12), q4, sc)); });
plants.count = 0;
plants.castShadow = true;
scene.add(plants);

// ------------------------------------------------------------------ what ARGUS watches here (real)
const pct = (p) => (p * 100 < 1 ? "under 1" : (p * 100).toFixed(p < 0.1 ? 1 : 0));
try {
  const live = await (await fetch("../live/argus-now.json", { cache: "no-cache" })).json();
  const risk = live?.sites?.delos?.risk;
  if (risk?.evaluated_at) {
    const byKey = Object.fromEntries(risk.scenarios.map((c) => [c.key, c]));
    data.risk_checked_at = risk.evaluated_at;
    for (const d of data.dangers) {
      const c = byKey[d.key];
      Object.assign(d, c ? { state: c.state, probability: c.probability, watch: c.thresholds?.watch ?? d.watch } : { state: null, probability: null });
    }
  }
} catch {
  // not served by the Pi: the copy taken when the data was built
}
const when = data.risk_checked_at
  ? `last check ${new Date(data.risk_checked_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
  : "no check available here (the Pi serves the newest)";
document.getElementById("dangers").innerHTML =
  `<p class="when">ARGUS's risk model, ${when}</p><ul>` +
  data.dangers.slice(0, 6).map((d) => `<li><span class="lvl lvl-${d.level}">${d.level}</span> ${d.title.en.replace(" · House of the Masks", "")}` +
    (d.probability != null ? ` <span class="p">${pct(d.probability)}% (watch from ${pct(d.watch)}%)</span>` : ` <span class="p">not checked nightly</span>`) + "</li>").join("") +
  "</ul>";

// ------------------------------------------------------------------ years without anyone noticing
let years = 0, watched = false;
function applyDamage() {
  const y = watched ? Math.min(years, 1) : years; // watched: the soil probes show it in the first months; it is treated
  damage.damp.value = y > 0 ? 0.1 + 1.1 * (1 - Math.exp(-y / 15)) : 0; // rising damp in the walls, up to about 1.2 m
  damage.wet.value = y > 0 ? 0.4 + 2.6 * (1 - Math.exp(-y / 18)) : 0; // the stain's radius, up to about 3 m
  damage.loss.value = Math.min(0.85, Math.max(0, (y - 3) / 40));
  damage.salt.value = Math.min(1, Math.max(0, (y - 1) / 10));
  plants.count = y < 15 ? 0 : Math.round(((y - 15) / 35) * tops.length * 0.45);
  document.getElementById("years-value").textContent = years === 0 ? "today" : `${years} years`;
  document.getElementById("note").textContent = watched
    ? "With ARGUS watching: the two soil-moisture probes under the masks mosaic show the damp within months; it is treated and the damage stays small. An illustration, not a prediction."
    : "Nobody watching: damp rises from the ground under Room 215 (ARGUS: 'Water rising from below'), salts crystallise ('Salt in the walls') and push tesserae out, and plants root in the wall tops. An illustration, not a prediction.";
}
document.getElementById("years").addEventListener("input", (e) => { years = Number(e.target.value); applyDamage(); });
for (const [id, value] of [["nobody", false], ["watched", true]]) {
  document.getElementById(id).addEventListener("click", () => {
    watched = value;
    document.getElementById("nobody").setAttribute("aria-pressed", String(!value));
    document.getElementById("watched").setAttribute("aria-pressed", String(value));
    applyDamage();
  });
}
applyDamage();

// ------------------------------------------------------------------ from the 2D map down into 3D
const fov = (camera.fov * Math.PI) / 180;
const mpp = (156543.03392 * Math.cos((LAT0 * Math.PI) / 180)) / 2 ** ZOOM; // metres per screen pixel on the map
const startLook = at(houseCentre);
const startPos = startLook.clone().setY(startLook.y + (innerHeight * mpp) / (2 * Math.tan(fov / 2)));
const endLook = at([(room["215"].xy[0] + room["216"].xy[0]) / 2, (room["215"].xy[1] + room["216"].xy[1]) / 2], 0.4);
const endPos = endLook.clone().add(new THREE.Vector3(-14, 15.5, 18.5));
camera.position.copy(startPos);
camera.up.set(0, 0, -1); // north up, as on the map
camera.lookAt(startLook);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 2;
controls.maxDistance = 400;

let flight = null;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function go3D(duration = 3600) {
  document.getElementById("three").classList.add("on");
  document.getElementById("map").classList.add("off");
  document.getElementById("go").style.display = "none";
  document.getElementById("sub").textContent = "House of the Masks, Delos: a 3D preview from ARGUS, OpenStreetMap and Wikimedia data.";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return new Promise((done) => { flight = { t0: performance.now(), duration: reduce ? 1 : duration, done }; });
}
document.getElementById("go").addEventListener("click", () => go3D());
const upNorth = new THREE.Vector3(0, 0, -1), upSky = new THREE.Vector3(0, 1, 0), look = new THREE.Vector3();
function frame(now) {
  if (flight) {
    const t = Math.min(1, (now - flight.t0) / flight.duration), e = ease(t);
    camera.position.lerpVectors(startPos, endPos, e);
    look.lerpVectors(startLook, endLook, e);
    camera.up.lerpVectors(upNorth, upSky, Math.min(1, e * 1.6)).normalize();
    camera.lookAt(look);
    if (t >= 1) {
      camera.up.copy(upSky);
      controls.target.copy(endLook);
      controls.enabled = true;
      document.getElementById("panel").classList.add("on");
      flight.done();
      flight = null;
    }
  } else if (controls.enabled) {
    controls.update();
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});
window.demo = {
  ready: Promise.resolve(),
  go3D,
  setYears(n) { years = n; document.getElementById("years").value = n; applyDamage(); },
  setWatched(b) { document.getElementById(b ? "watched" : "nobody").click(); },
  view(offset, target = endLook) { controls.target.copy(target); camera.position.copy(target).add(new THREE.Vector3(...offset)); controls.update(); },
  room: (id) => at(room[id].xy, 0.2),
};
