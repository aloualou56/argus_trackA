// The 3D view of a house (README, "3D view"), built only from data the game may use:
//   ground      the game's satellite picture (Esri) on real terrain: ARGUS's own terrain around the
//               house where tools/fetch_argus_3d.py has taken it (<scene>-terrain.json), else AWS
//               Terrain Tiles
//   house       ARGUS's own photogrammetric model of the house (3D Tiles, the tiles around the house
//               only: tools/fetch_argus_3d.py, <scene>-model.json), placed by ARGUS's own transform;
//               where it is missing, the walls and floors below stand in for it:
//   walls       the ruin's outline from OpenStreetMap (historic=ruins), height assumed
//   rooms       ARGUS's own 3D sensor placements, which name the mosaic rooms
//   mosaics     photos from Wikimedia Commons where a straight-down one exists; the other floors
//               are a plain pattern, an illustration
//   sensors     ARGUS's 3D placements (position and height)
//   damage      an illustration, not a prediction (math.ts, damageAfter)
// One file per place (<scene>.json): the House of the Masks' by tools/build_preview_3d.py (with its
// rooms, outline and photos), every other place's by tools/build_scenes_3d.py (sensors and dangers;
// ARGUS's model is its walls). The damage starts at the sensor that raised the day's alarm and is the
// day's danger's own (math.ts, DamageKind): damp, paint flaking, a worn floor, weathered stone, a
// crack, a leaning wall or plants. This file and three.js load only when a player asks for the view
// (view3d/preload.ts), so they never weigh on the game itself.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cameraHeightFor, seeded, terrarium, tileLonLat, tileXY, type Damage, type DamageKind } from "./math";

type XY = [number, number];

export interface HouseRoom {
  room: string;
  name: string;
  /** Metres east and north of the origin. */
  xy: XY;
  photo?: { url: string; w: number; h: number };
}

export interface HouseDanger {
  key: string;
  level: string;
  /** The copy of a risk check taken when the data was built (the game reads the newest itself). */
  probability: number | null;
  watch: number | null;
}

export interface HouseData {
  /** The scene's name (data/view3d/<scene>.json). */
  scene?: string;
  origin: { lat: number; lon: number };
  metres_per_degree: XY;
  /** The ruin's outline (the drawn walls, where ARGUS's model is missing) and plot outlines; may be empty. */
  shapes: { kind: "ruin" | "site"; ring: XY[] }[];
  /** h: metres above ARGUS's placement of its model; alt: above the WGS84 ellipsoid, where given. */
  sensors3d: { xy: XY; h: number; alt?: number; kind: string; room: string | null; serial?: string | null }[];
  rooms: HouseRoom[];
  dangers: HouseDanger[];
  risk_checked_at: string | null;
  /** ARGUS's model is cut this far above the floor (the House of the Masks: the shelters over the mosaics). */
  cut_above_m?: number | null;
  /** How far away the camera comes to rest, metres (default 28). */
  view_m?: number | null;
}

/** What the view is about: metres east and north of the origin, east and north. The middle of the
 *  ruin, else of ARGUS's sensors there, else the origin (ARGUS's placement of its model). */
export function sceneCentre(data: HouseData): XY {
  const ruin = data.shapes.find((s) => s.kind === "ruin");
  if (ruin) return centroid(ruin.ring);
  const s = data.sensors3d;
  if (!s.length) return [0, 0];
  return [s.reduce((a, x) => a + x.xy[0], 0) / s.length, s.reduce((a, x) => a + x.xy[1], 0) / s.length];
}

interface Mosaic {
  canvas: HTMLCanvasElement;
  /** How many of its tiles loaded. */
  loaded: number;
  west: number;
  east: number;
  north: number;
  south: number;
}

/** Everything the view needs, loaded before anything moves (view3d/preload.ts). */
export interface Assets {
  data: HouseData;
  /** Where the map flies to before the 3D view takes over: the middle of the ruin, [lat, lon]. */
  centre: [number, number];
  imagery: Mosaic;
  dem: Mosaic;
  /** ARGUS's own terrain around the house, finer than the AWS tiles, when it was taken (optional). */
  grid: TerrainGrid | null;
  /** ARGUS's own model of the house in scene axes (x east, y up, z south; y = height on ARGUS's datum),
   *  when it was taken (optional). */
  model: THREE.Group | null;
  photos: Map<string, HTMLImageElement>;
}

/** ARGUS terrain resampled to a regular grid (tools/fetch_argus_3d.py, <scene>-terrain.json). */
export interface TerrainGrid {
  spacing_m: number;
  cols: number;
  rows: number;
  west_m: number;
  north_m: number;
  base_m: number;
  heights_cm_int16_b64: string;
}

/** Height (metres, ARGUS's datum) at x metres east, y north of the origin; null outside the grid. */
export function gridHeight(grid: TerrainGrid, heights: Int16Array, x: number, y: number): number | null {
  const fc = (x - grid.west_m) / grid.spacing_m;
  const fr = (grid.north_m - y) / grid.spacing_m;
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= grid.cols || r0 + 1 >= grid.rows) return null;
  const at = (c: number, r: number) => heights[r * grid.cols + c];
  const h = [at(c0, r0), at(c0 + 1, r0), at(c0, r0 + 1), at(c0 + 1, r0 + 1)];
  if (h.some((v) => v === -32768)) return null;
  const tx = fc - c0;
  const ty = fr - r0;
  const v = (h[0] * (1 - tx) + h[1] * tx) * (1 - ty) + (h[2] * (1 - tx) + h[3] * tx) * ty;
  return grid.base_m + v / 100;
}

/** Least-squares plane z = a x + b y + c through the points [x, y, z]; [0, 0, 0] for too few. */
export function fitPlane(points: [number, number, number][]): [number, number, number] {
  if (points.length < 3) return [0, 0, 0];
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y, z] of points) {
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; sxz += x * z; syz += y * z; sz += z;
  }
  const n = points.length;
  const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const A = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n];
  const d = det3(A);
  if (Math.abs(d) < 1e-9) return [0, 0, sz / n];
  const col = (i: number, v: number[]) => A.map((x, k) => (k % 3 === i ? v[Math.floor(k / 3)] : x));
  const B = [sxz, syz, sz];
  return [det3(col(0, B)) / d, det3(col(1, B)) / d, det3(col(2, B)) / d];
}

/** The plane through ARGUS's model's ground minus the terrain under it ([x, y, difference] per cell),
 *  robust to what is not ground: cells far from the typical difference (a cellar below the ground, a
 *  wall top) are left out, and the tilt is held within 3 degrees. */
export function levelFit(points: [number, number, number][]): [number, number, number] {
  if (!points.length) return [0, 0, 0];
  const sorted = points.map((p) => p[2]).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const near = points.filter((p) => Math.abs(p[2] - median) < 2);
  const [a, b] = fitPlane(near);
  const max = Math.tan((3 * Math.PI) / 180);
  const ca = Math.max(-max, Math.min(max, a));
  const cb = Math.max(-max, Math.min(max, b));
  // the offset again with the held tilt, through the middle of the points kept
  const c = near.reduce((s, p) => s + p[2] - ca * p[0] - cb * p[1], 0) / near.length;
  return [ca, cb, c];
}

/** The grid's heights (little-endian int16 in base64). */
export function gridHeights(grid: TerrainGrid): Int16Array {
  const bytes = Uint8Array.from(atob(grid.heights_cm_int16_b64), (ch) => ch.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Int16Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true));
}

/** One tile of ARGUS's model, as tools/fetch_argus_3d.py exports it (<scene>-model.json). */
export interface ModelTile {
  file: string;
  /** The tileset's transform to the Earth (ECEF), column-major; null for none. */
  transform: number[] | null;
  /** A b3dm tile's own centre (ECEF metres), added before the transform. */
  rtc_center: number[] | null;
  /** The tileset's asset.gltfUpAxis: which glTF axis is up ("Y", glTF's own, unless the tileset says). */
  gltf_up_axis?: "X" | "Y" | "Z";
}

/** Earth-centred position of a point on the WGS84 ellipsoid. */
function ecef(latDeg: number, lonDeg: number, h: number): THREE.Vector3 {
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return new THREE.Vector3((n + h) * Math.cos(lat) * Math.cos(lon), (n + h) * Math.cos(lat) * Math.sin(lon), (n * (1 - e2) + h) * Math.sin(lat));
}

/**
 * From a model tile's own glTF coordinates to the scene: x east and z south of (lat, lon), y the
 * height above the ellipsoid. As 3D Tiles does: glTF is y-up (turned to z-up), plus the tile's
 * RTC_CENTER, then the tileset's transform to Earth-centred coordinates; then into east-north-up at
 * (lat, lon) and into the scene's axes.
 */
export function modelMatrix(tile: ModelTile, lat: number, lon: number): THREE.Matrix4 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const east = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
  const north = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  const up = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  const enuToEcef = new THREE.Matrix4().makeBasis(east, north, up).setPosition(ecef(lat, lon, 0));
  const toScene = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // (east, north, up) -> (x, y up, -z)
  const tf = tile.transform ? new THREE.Matrix4().fromArray(tile.transform) : new THREE.Matrix4();
  const rtc = tile.rtc_center ? new THREE.Matrix4().makeTranslation(tile.rtc_center[0], tile.rtc_center[1], tile.rtc_center[2]) : new THREE.Matrix4();
  // as Cesium: glTF's y up turned to the tileset's z up, or as the tileset's gltfUpAxis says
  const axis = tile.gltf_up_axis ?? "Y";
  const toZUp =
    axis === "Z" ? new THREE.Matrix4() : axis === "X" ? new THREE.Matrix4().makeRotationY(-Math.PI / 2) : new THREE.Matrix4().makeRotationX(Math.PI / 2);
  return toScene.multiply(enuToEcef.invert()).multiply(tf).multiply(rtc).multiply(toZUp);
}

/** ARGUS's model of the house (<scene>-model.json and its glTF files), or null where it was not taken. */
async function loadModel(url: string, lat: number, lon: number): Promise<THREE.Group | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const manifest = (await response.json()) as { tiles: ModelTile[] };
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`).setDecoderConfig({ type: "wasm" });
    const loader = new GLTFLoader().setDRACOLoader(draco);
    const base = url.slice(0, url.lastIndexOf("/") + 1);
    const group = new THREE.Group();
    const parts = await Promise.all(manifest.tiles.map((t) => loader.loadAsync(base + t.file)));
    draco.dispose();
    parts.forEach((gltf, i) => {
      const part = gltf.scene;
      part.matrixAutoUpdate = false;
      part.matrix.copy(modelMatrix(manifest.tiles[i], lat, lon));
      group.add(part);
    });
    return group;
  } catch {
    return null; // not taken, offline or not decodable here: the drawn walls and floors stand in
  }
}

async function loadGrid(url: string): Promise<TerrainGrid | null> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as TerrainGrid) : null;
  } catch {
    return null; // not taken yet, or offline: the AWS terrain does
  }
}

const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const IMAGERY_ZOOM = 18; // the satellite tiles the game's map shows when it has flown down
const TERRAIN_ZOOM = 15;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => img.decode().then(() => resolve(img), () => resolve(img));
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function centroid(ring: XY[]): XY {
  const points = ring.slice(0, -1); // the ring repeats its first point at the end
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

/** (2R x 2R) tiles around the origin, drawn into one picture. */
async function mosaic(data: HouseData, z: number, template: string, radius: number, readable: boolean): Promise<Mosaic> {
  const { lat, lon } = data.origin;
  const [kx, ky] = data.metres_per_degree;
  const [fx, fy] = tileXY(lon, lat, z);
  const tx0 = Math.floor(fx) - radius + 1;
  const ty0 = Math.floor(fy) - radius + 1;
  const n = 2 * radius;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256 * n;
  const ctx = canvas.getContext("2d", { willReadFrequently: readable })!;
  let loaded = 0;
  await Promise.all(
    Array.from({ length: n * n }, async (_, k) => {
      const i = k % n;
      const j = Math.floor(k / n);
      const url = template.replace("{z}", String(z)).replace("{x}", String(tx0 + i)).replace("{y}", String(ty0 + j));
      const img = await loadImage(url);
      if (!img) return;
      ctx.drawImage(img, i * 256, j * 256);
      loaded += 1;
    }),
  );
  const [lonW, latN] = tileLonLat(tx0, ty0, z);
  const [lonE, latS] = tileLonLat(tx0 + n, ty0 + n, z);
  return { canvas, loaded, west: (lonW - lon) * kx, east: (lonE - lon) * kx, north: (latN - lat) * ky, south: (latS - lat) * ky };
}

/** The house's data, its satellite tiles (from the game's own map, `imagery` is its tile address),
 *  its terrain and its mosaic photos. Throws when the data or every satellite tile fails (offline). */
export async function loadAssets(dataUrl: string, imagery: string): Promise<Assets> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`${dataUrl}: HTTP ${response.status}`);
  const data = (await response.json()) as HouseData;
  const [ground, dem, grid, model, photos] = await Promise.all([
    mosaic(data, IMAGERY_ZOOM, imagery, 2, false),
    mosaic(data, TERRAIN_ZOOM, TERRAIN, 1, true),
    loadGrid(dataUrl.replace(/\.json$/, "-terrain.json")),
    loadModel(dataUrl.replace(/\.json$/, "-model.json"), data.origin.lat, data.origin.lon),
    Promise.all(data.rooms.map(async (r) => [r.room, r.photo ? await loadImage(r.photo.url) : null] as const)),
  ]);
  if (!ground.loaded) throw new Error("no satellite pictures (offline?)");
  if (!data.shapes.some((s) => s.kind === "ruin") && !(model && grid)) throw new Error(`${dataUrl}: neither a model nor walls to draw`);
  const [cx, cy] = sceneCentre(data);
  const [kx, ky] = data.metres_per_degree;
  return {
    data,
    centre: [data.origin.lat + cy / ky, data.origin.lon + cx / kx],
    imagery: ground,
    dem,
    grid,
    model,
    photos: new Map(photos.filter((p): p is readonly [string, HTMLImageElement] => !!p[1])),
  };
}

export interface HouseOptions {
  /** The words on a room's label, in the game's language. */
  roomLabel: (room: HouseRoom) => string;
  /** The day's danger: its alarm's sensor (its serial number, as in the sensor's name; else where it
   *  stands, metres east and north of the origin; neither: the soil probes of the House of the Masks,
   *  or the middle of the place) and which damage it does. */
  focus?: { serial: string | null; xy: XY | null; kind: DamageKind };
  /** The canvas's name for screen readers (it can be turned and moved with a mouse, touch or keys). */
  canvasLabel: string;
}

/** A view of the game's map: what it is centred on ([lat, lon]) and its scale. */
export interface MapView {
  center: [number, number];
  metresPerPixel: number;
}

export interface House {
  /** Looks straight down on the map's view, north up, from the height where the ground matches it. */
  matchMap(view: MapView): void;
  /** From straight above down to the rooms; then the camera can be turned. */
  flyIn(ms: number): Promise<void>;
  /** Back up to the view of matchMap. */
  flyOut(ms: number): Promise<void>;
  setDamage(damage: Damage): void;
  /** How much of the canvas the view's own title (top) and panel (bottom) cover, in pixels: the
   *  rooms are framed in the space between them (eased; straight above, the map's framing wins). */
  setInsets(top: number, bottom: number): void;
  resize(width: number, height: number): void;
  /** Draws every frame until stop(). */
  start(): void;
  stop(): void;
  /** Prepares the shaders and draws one frame (before the view is shown). */
  renderOnce(): void;
  dispose(): void;
  /** Looks at a room (or the view's end point) from an offset in metres (east, up, south). */
  look(offset: [number, number, number], room?: string): void;
}

// ------------------------------------------------------------------ damage, shared by every surface
const NOISE = `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }`;
const WORLD_VARYING: [string, string] = ["#include <common>", "#include <common>\nvarying vec3 vWorld;"];
const WORLD_POSITION: [string, string] = [
  "#include <worldpos_vertex>",
  "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
];
/** A damp stain spreading from the soil probes, lost tesserae inside it, salt at its edge. `col` is
 *  the floor's own colour; a drawn floor gets grout lines, a photo shows its own tesserae. */
function damageGlsl(grout: boolean): string {
  return `
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
  ${
    grout
      ? `vec2 f = fract(vWorld.xz / 0.04);
  float grout = step(0.06, f.x) * step(0.06, f.y) * step(f.x, 0.94) * step(f.y, 0.94);
  diffuseColor.rgb = mix(mix(col, mortar, 0.55), col, max(grout, lost));`
      : "diffuseColor.rgb = col;"
  }`;
}
const fixed = (n: number) => n.toFixed(2);
/** A drawn floor (border bands round a plain field) or, smaller, a drawn centre panel with an emblem. */
function patternGlsl(size: number, emblem: boolean): string {
  return `
  vec2 c = (vUv - 0.5) * ${fixed(size)};
  float box = max(abs(c.x), abs(c.y));
  vec3 col = ${emblem ? "vec3(0.82, 0.78, 0.70)" : "vec3(0.87, 0.84, 0.77)"};
  ${emblem ? "float r = length(c);\n  if (r < 0.52) col = mix(vec3(0.70, 0.52, 0.30), vec3(0.22, 0.33, 0.39), step(0.3, r) * step(r, 0.42));" : ""}
  if (box > ${fixed(size / 2 - (emblem ? 0.08 : 0.16))}) col = vec3(0.15, 0.14, 0.15);
  else if (box > ${fixed(size / 2 - (emblem ? 0.15 : 0.26))}) col = vec3(0.62, 0.23, 0.16);
  col *= 0.92 + 0.16 * hash12(floor(vWorld.xz / 0.04));`;
}

const WALL_H = 2.4; // assumed: OpenStreetMap has the outline, not the height
const FLOOR = 3.1; // assumed sizes (rooms 215 and 216 are 3.3 m apart)
const PANEL = 1.35;
const NORTH = new THREE.Vector3(0, 0, -1);
const SKY = new THREE.Vector3(0, 1, 0);

export function createHouse(host: HTMLElement, assets: Assets, options: HouseOptions): House {
  const { data, imagery, dem, grid } = assets;
  // ARGUS's model stands on ARGUS's terrain (both above the ellipsoid); without that terrain the
  // two would not meet, so the drawn walls and floors are used then.
  const model = grid ? assets.model : null;
  const { lat: LAT0, lon: LON0 } = data.origin;
  const [KX, KY] = data.metres_per_degree;
  const ruin = data.shapes.find((s) => s.kind === "ruin") ?? null;
  const sites = data.shapes.filter((s) => s.kind === "site");
  const rooms = new Map(data.rooms.map((r) => [r.room, r]));
  const houseCentre = sceneCentre(data);
  const kind: DamageKind = options.focus ? options.focus.kind : "mosaic";
  const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // Where the damage starts: the sensor that raised the day's alarm; on the House of the Masks without
  // one, ARGUS's soil probes (Room 215, under the Theatrical Masks mosaic); else the middle of the place.
  const probe = data.sensors3d.find((s) => s.kind === "soil_moisture" && s.room && rooms.has(s.room));
  const serial = options.focus?.serial;
  const at0 = options.focus?.xy ?? null;
  const focusSensor =
    (serial ? data.sensors3d.find((s) => s.serial === serial) : undefined) ??
    (at0 ? data.sensors3d.filter((s) => dist(s.xy, at0) < 4).sort((a, b) => dist(a.xy, at0) - dist(b.xy, at0))[0] : undefined);
  const focusXY: XY = focusSensor?.xy ?? at0 ?? (probe?.room ? rooms.get(probe.room)?.xy : undefined) ?? data.rooms[0]?.xy ?? houseCentre;
  // The rooms the camera comes down to: the one nearest the damage and the next one.
  const byDistance = [...data.rooms].sort((a, b) => dist(a.xy, focusXY) - dist(b.xy, focusXY));
  const dampRoom = byDistance[0] ?? null;
  const nextRoom = byDistance[1] ?? dampRoom;
  const VIEW = Math.max(1, Math.min(3.5, (data.view_m ?? 28) / 28)); // the scale of the place

  // ---------------------------------------------------------------- real ground: imagery and terrain
  const demPixels = dem.canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, dem.canvas.width, dem.canvas.height).data;
  const demAt = (px: number, py: number): number | null => {
    const x = Math.max(0, Math.min(dem.canvas.width - 1, Math.round(px)));
    const y = Math.max(0, Math.min(dem.canvas.height - 1, Math.round(py)));
    const o = (y * dem.canvas.width + x) * 4;
    return demPixels[o + 3] ? terrarium(demPixels[o], demPixels[o + 1], demPixels[o + 2]) : null; // a tile that did not load
  };
  function awsTerrain(x: number, y: number): number | null {
    const px = ((x - dem.west) / (dem.east - dem.west)) * dem.canvas.width - 0.5;
    const py = ((dem.north - y) / (dem.north - dem.south)) * dem.canvas.height - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const h = [demAt(x0, y0), demAt(x0 + 1, y0), demAt(x0, y0 + 1), demAt(x0 + 1, y0 + 1)];
    if (h.some((v) => v === null)) return null;
    const [a, b, c, d] = h as number[];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  // ARGUS's terrain where it was taken; the AWS terrain beyond it, lifted to ARGUS's datum (ARGUS
  // gives heights above the ellipsoid, AWS above the sea) so the two meet without a step.
  const gridH = grid && gridHeights(grid);
  const gridAt = (x: number, y: number) => (grid && gridH ? gridHeight(grid, gridH, x, y) : null);
  const awsAt0 = awsTerrain(0, 0);
  const gridAt0 = gridAt(0, 0);
  const datumShift = gridAt0 !== null && awsAt0 !== null ? gridAt0 - awsAt0 : 0;
  function terrain(x: number, y: number): number | null {
    const fine = gridAt(x, y);
    if (fine !== null) return fine;
    const coarse = awsTerrain(x, y);
    return coarse === null ? null : coarse + datumShift;
  }
  const H0 = terrain(0, 0);
  // Flat where the terrain did not load: the house still stands, on level ground.
  const ground = (x: number, y: number) => (H0 === null ? 0 : (terrain(x, y) ?? H0) - H0);

  // ARGUS's model, lowered with the ground (whose height 0 is the terrain at the origin). Its floor is
  // the lowest point of the model in each half-metre cell: inside a room, the floor; by a wall, the
  // floor at its foot (sensors stand at ARGUS's height above it).
  let CELL = 0.5;
  let floorAt: (x: number, y: number) => number | null = () => null;
  let lowestNear: (x: number, y: number, r: number) => number | null = () => null;
  const footprint = new THREE.Box3();
  const tops: THREE.Vector3[] = []; // wall tops, where plants root
  const wallCells: XY[] = []; // [x, z] of the cells where the model stands as a wall, near the damage
  if (model) {
    let nx = 0;
    let nz = 0;
    let cells = new Float32Array(0);
    let highs = new Float32Array(0);
    const measure = () => {
      model.updateMatrixWorld(true);
      footprint.setFromObject(model);
      // half-metre cells; coarser over a big place, so the grid stays about a million cells at most
      CELL = Math.max(0.5, Math.max(footprint.max.x - footprint.min.x, footprint.max.z - footprint.min.z) / 1000);
      nx = Math.ceil((footprint.max.x - footprint.min.x) / CELL) + 1;
      nz = Math.ceil((footprint.max.z - footprint.min.z) / CELL) + 1;
      cells = new Float32Array(nx * nz).fill(Infinity);
      highs = new Float32Array(nx * nz).fill(-Infinity);
      const v = new THREE.Vector3();
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
        if (!pos) return;
        mesh.castShadow = mesh.receiveShadow = true;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          const k = Math.floor((v.z - footprint.min.z) / CELL) * nx + Math.floor((v.x - footprint.min.x) / CELL);
          if (v.y < cells[k]) cells[k] = v.y;
          if (v.y > highs[k]) highs[k] = v.y;
        }
      });
    };
    model.position.y = -(H0 ?? 0);
    measure();
    // ARGUS places its models with a slight tilt that its own viewer corrects ("pitch 1°" for the House of
    // the Masks), and some at a height of their own: here the model's ground is levelled onto ARGUS's
    // terrain around it (a plane fitted to the difference), so the two meet without a step.
    const [a, b, c] = levelFit(
      Array.from(cells, (h, k) => {
        if (h === Infinity) return null;
        const x = footprint.min.x + ((k % nx) + 0.5) * CELL;
        const y = -(footprint.min.z + (Math.floor(k / nx) + 0.5) * CELL);
        return [x, y, h - ground(x, y)] as [number, number, number];
      }).filter((p): p is [number, number, number] => p !== null),
    );
    const levelled = new THREE.Matrix4()
      .makeTranslation(0, -c, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(-Math.atan(a))) // x east: tilts east-west
      .multiply(new THREE.Matrix4().makeRotationX(-Math.atan(b))); // -z north: tilts north-south
    model.matrixAutoUpdate = false;
    model.matrix.copy(levelled).multiply(new THREE.Matrix4().makeTranslation(0, -(H0 ?? 0), 0));
    measure();
    floorAt = (x, y) => {
      const col = Math.floor((x - footprint.min.x) / CELL);
      const row = Math.floor((-y - footprint.min.z) / CELL);
      if (col < 0 || row < 0 || col >= nx || row >= nz) return null;
      const h = cells[row * nx + col];
      // a hole in the model's floor (under a sensor) would read the roof above it as the floor: within a
      // metre around, the lowest point is
      const low = lowestNear(x, y, 1);
      if (h === Infinity) return low;
      return low !== null && h - low > 1.5 ? low : h;
    };
    lowestNear = (x, y, r) => {
      let low = Infinity;
      const c0 = Math.floor((x - r - footprint.min.x) / CELL);
      const r0 = Math.floor((-y - r - footprint.min.z) / CELL);
      const n = Math.ceil((2 * r) / CELL);
      for (let row = Math.max(0, r0); row <= Math.min(nz - 1, r0 + n); row++) {
        for (let col = Math.max(0, c0); col <= Math.min(nx - 1, c0 + n); col++) low = Math.min(low, cells[row * nx + col]);
      }
      return low === Infinity ? null : low;
    };
    // Wall tops: cells where the model stands more than 1.2 m above its own ground with a drop of a metre
    // beside them (a wall's top is narrow; a roof is not), under the cut where there is one. Every few
    // cells, so the plants spread along them.
    const cutY = data.cut_above_m != null ? (floorAt(focusXY[0], focusXY[1]) ?? 0) + data.cut_above_m : Infinity;
    const step = Math.max(1, Math.round(1 / CELL));
    const side = Math.max(1, Math.round(1.2 / CELL));
    const highAt = (row: number, col: number) => (row < 0 || col < 0 || row >= nz || col >= nx ? -Infinity : highs[row * nx + col]);
    for (let row = 0; row < nz; row += step) {
      for (let col = 0; col < nx; col += step) {
        const k = row * nx + col;
        const drop = (r: number, c: number) => highAt(r, c) < highs[k] - 1;
        const narrow = (drop(row - side, col) && drop(row + side, col)) || (drop(row, col - side) && drop(row, col + side));
        const cx = footprint.min.x + (col + 0.5) * CELL;
        const cz = footprint.min.z + (row + 0.5) * CELL;
        if (highs[k] - cells[k] > 1.2 && Math.hypot(cx - focusXY[0], -cz - focusXY[1]) < 5) wallCells.push([cx, cz]);
        if (highs[k] - cells[k] > 1.2 && highs[k] < cutY - 0.2 && narrow) {
          tops.push(new THREE.Vector3(footprint.min.x + (col + 0.5) * CELL, highs[k] + 0.05, footprint.min.z + (row + 0.5) * CELL));
        }
      }
    }
  }
  const surface = (x: number, y: number) => floorAt(x, y) ?? ground(x, y);
  const at = ([x, y]: XY, up = 0) => new THREE.Vector3(x, surface(x, y) + up, -y); // metres east/north -> scene

  // ---------------------------------------------------------------- the scene
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.className = "view3d-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", options.canvasLabel);
  host.appendChild(canvas);
  const labels = new CSS2DRenderer();
  labels.domElement.className = "view3d-labels";
  labels.domElement.setAttribute("aria-hidden", "true"); // the panel says the same in words
  host.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#cfe2ee");
  scene.fog = new THREE.Fog("#cfe2ee", 260, 760);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
  scene.add(new THREE.HemisphereLight("#ffffff", "#bba98c", 1.1));
  const sun = new THREE.DirectionalLight("#fff3df", 2.4);
  const centre3 = at(houseCentre);
  sun.position.copy(centre3).add(new THREE.Vector3(-40, 70, 30));
  sun.target.position.copy(centre3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const reachShadow = 45 * VIEW;
  Object.assign(sun.shadow.camera, { left: -reachShadow, right: reachShadow, top: reachShadow, bottom: -reachShadow, near: 1, far: 250 * VIEW });
  scene.add(sun, sun.target);

  const SEG = 128; // ground: the satellite picture, lifted onto the terrain
  const groundGeo = new THREE.PlaneGeometry(imagery.east - imagery.west, imagery.north - imagery.south, SEG, SEG);
  const gp = groundGeo.attributes.position;
  const gx0 = (imagery.west + imagery.east) / 2;
  const gy0 = (imagery.north + imagery.south) / 2;
  // Under ARGUS's model the ground steps down out of sight (below the model's lowest point around it),
  // so it never covers the model's floors; where the model has nothing, the ground is the terrain.
  const reach = (Math.max(imagery.east - imagery.west, imagery.north - imagery.south) / SEG) * 0.75;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i) + gx0;
    const y = gp.getY(i) + gy0;
    const low = model ? lowestNear(x, y, reach) : null;
    gp.setZ(i, low === null ? ground(x, y) : Math.min(ground(x, y), low - 0.4));
  }
  groundGeo.computeVertexNormals();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const groundTex = new THREE.CanvasTexture(imagery.canvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = anisotropy;
  const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(gx0, 0, -gy0);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  let lowest = Infinity;
  for (let i = 0; i < gp.count; i++) lowest = Math.min(lowest, gp.getZ(i));
  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: "#a99b80", roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = lowest - 0.2;
  scene.add(far);

  // ARGUS's sensors where ARGUS's own viewer shows them: with ARGUS's model, moved with it as it was
  // levelled; else at ARGUS's height above the floor. A soil probe is in the ground.
  function sensorAt(s: HouseData["sensors3d"][number]): THREE.Vector3 {
    const floor = surface(s.xy[0], s.xy[1]);
    if (s.kind === "soil_moisture") return at(s.xy, 0.05);
    if (model && s.alt !== undefined) {
      const p = new THREE.Vector3(s.xy[0], s.alt, -s.xy[1]).applyMatrix4(model.matrix);
      // a placement far off the model's own (its height above the ground is not to be trusted then)
      if (p.y < floor + 0.05 || p.y > floor + 60) p.y = floor + 1.3;
      return p;
    }
    return at(s.xy, s.h);
  }
  // The point the damage starts from: the alarm's sensor, else the ground where it stands.
  const src = focusSensor && focusSensor.kind !== "soil_moisture" ? sensorAt(focusSensor) : at(focusSensor ? focusXY : (dampRoom?.xy ?? focusXY));
  // The wall at the damage: its direction from the model's own wall cells around it (their main axis),
  // so a crack runs across it and it leans out of its own line, away from the middle of the place.
  const away = new THREE.Vector2(focusXY[0] - houseCentre[0], -(focusXY[1] - houseCentre[1]));
  if (away.lengthSq() < 0.01) away.set(1, 0);
  away.normalize();
  const along = new THREE.Vector2(-away.y, away.x);
  if (wallCells.length >= 4) {
    const mx = wallCells.reduce((a, c) => a + c[0], 0) / wallCells.length;
    const mz = wallCells.reduce((a, c) => a + c[1], 0) / wallCells.length;
    let sxx = 0, sxz = 0, szz = 0;
    for (const [x, z] of wallCells) {
      sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2;
    }
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    along.set(Math.cos(angle), Math.sin(angle));
    const out = new THREE.Vector2(-along.y, along.x);
    away.copy(out.dot(away) < 0 ? out.negate() : out);
  }
  // A crack or a lean is in the wall itself: at the wall cell nearest the sensor.
  const wallAt =
    (kind === "crack" || kind === "lean") && wallCells.length
      ? wallCells.reduce((best, c) => (Math.hypot(c[0] - src.x, c[1] - src.z) < Math.hypot(best[0] - src.x, best[1] - src.z) ? c : best))
      : null;
  const floorY = floorAt(focusXY[0], focusXY[1]) ?? ground(focusXY[0], focusXY[1]);
  const damage = {
    damp: { value: 0 },
    wet: { value: 0 },
    loss: { value: 0 },
    salt: { value: 0 },
    flake: { value: 0 },
    wear: { value: 0 },
    weather: { value: 0 },
    crack: { value: 0 },
    crackW: { value: 0 },
    lean: { value: 0 },
    source: { value: wallAt ? new THREE.Vector2(wallAt[0], wallAt[1]) : new THREE.Vector2(src.x, src.z) },
    sourceY: { value: src.y },
    leanDir: { value: away },
    wallDir: { value: along },
  };

  // Walls: rubble masonry; damp darkens them from the ground up, with a line of salt at its edge
  function wallMaterial(base: string, groundY: number) {
    const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.95 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uDamp: damage.damp, uSource: damage.source, uGround: { value: groundY } });
      shader.vertexShader = shader.vertexShader.replace(...WORLD_VARYING).replace(...WORLD_POSITION);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vWorld;\nuniform float uDamp, uGround;\nuniform vec2 uSource;\n${NOISE}`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
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
        }`,
        );
    };
    return m;
  }
  // ARGUS's model, its own photographs as its surfaces, and the day's damage drawn on them: on the
  // floors (flat and low) the damp stain, lost tesserae and salt, or a path worn by feet; on the walls
  // damp rising from the ground with its line of salt, paint flaking, a crack growing from the sensor;
  // everywhere the stone weathering; and the wall by a tiltmeter leaning.
  if (model) {
    // A cut above the walls where the data asks for one: the modern shelters over the House of the
    // Masks' mosaics (5-6 m up in ARGUS's model) would hide the floors from above.
    const cutAbove = data.cut_above_m;
    renderer.localClippingEnabled = cutAbove != null;
    const cut = cutAbove != null ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), floorY + cutAbove)] : [];
    const patched = new Set<THREE.Material>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (patched.has(m)) continue;
        patched.add(m);
        m.clippingPlanes = cut;
        m.clipShadows = true;
        m.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, {
            uWet: damage.wet, uLoss: damage.loss, uSalt: damage.salt, uDamp: damage.damp, uSource: damage.source,
            uFlake: damage.flake, uWear: damage.wear, uWeather: damage.weather, uCrack: damage.crack, uCrackW: damage.crackW, uLean: damage.lean,
            uSourceY: damage.sourceY, uLeanDir: damage.leanDir, uWallDir: damage.wallDir, uGround: { value: floorY },
            uReach: { value: VIEW },
          });
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vWorld;\nvarying vec3 vNormalW;\nuniform float uLean, uGround;\nuniform vec2 uSource, uLeanDir;",
            )
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
              if (uLean > 0.0) {
                // the wall by the tiltmeter leans over, more the higher it stands; a few metres along, not at all
                vec4 wl = modelMatrix * vec4(transformed, 1.0);
                float reachL = 1.0 - smoothstep(4.0, 10.0, distance(wl.xz, uSource));
                float off = tan(uLean) * max(0.0, wl.y - uGround) * reachL;
                transformed += inverse(mat3(modelMatrix)) * vec3(uLeanDir.x * off, 0.0, uLeanDir.y * off);
              }`,
            )
            .replace(
              "#include <worldpos_vertex>",
              "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvNormalW = normalize(mat3(modelMatrix) * objectNormal);",
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>\nvarying vec3 vWorld;\nvarying vec3 vNormalW;\nuniform float uWet, uLoss, uSalt, uDamp, uGround, uFlake, uWear, uWeather, uCrack, uCrackW, uSourceY, uReach;\nuniform vec2 uSource, uWallDir, uLeanDir;\n${NOISE}`,
            )
            .replace(
              "#include <map_fragment>",
              `#include <map_fragment>
              vec3 base0 = diffuseColor.rgb;
              vec3 col = base0;
              ${damageGlsl(false)}
              vec3 nW = normalize(vNormalW);
              float flatUp = smoothstep(0.80, 0.95, nW.y);
              float wall = 1.0 - flatUp;
              // the stain is on the floors at the damp floor's level, never on a roof above it
              float nearFloor = 1.0 - smoothstep(0.6, 1.6, abs(vWorld.y - uGround));
              diffuseColor.rgb = mix(base0, diffuseColor.rgb, flatUp * nearFloor);
              vec3 c = diffuseColor.rgb;
              // metres along the damaged wall from the sensor, and out of its line
              float along = dot(vWorld.xz - uSource, uWallDir);
              float across = abs(dot(vWorld.xz - uSource, uLeanDir));
              float dist0 = distance(vWorld.xz, uSource);
              // rising damp is where the ground is wet: around the sensor, fading over some 20 m
              float near = 1.0 - smoothstep(3.0 * uReach, 20.0 * uReach, dist0);
              float damp = uDamp * near * wall;
              float y = vWorld.y - uGround;
              float edge = damp * (1.0 + (vnoise(vec2(along * 0.8, vWorld.x + vWorld.z) * 1.2) - 0.5) * 0.3);
              if (damp > 0.0) {
                // damp rising in the walls from the ground: darker below a wavy tide line, with a white line
                // of salt where it dries out
                float wetWall = (1.0 - smoothstep(edge - 0.08, edge + 0.04, y)) * step(-0.3, y);
                c *= mix(vec3(1.0), vec3(0.58, 0.56, 0.52), wetWall);
                float band = smoothstep(0.08, 0.0, abs(y - edge - 0.04)) * uSalt * step(-0.3, y);
                c = mix(c, vec3(0.95, 0.94, 0.91), band * (0.5 + 0.4 * vnoise(vWorld.xz * 11.0 + vWorld.y * 9.0)));
              }
              if (uFlake > 0.0) {
                // paint and plaster pushed off by the salt where the damp wall dries: around and below the tide
                // line, the stone under it showing
                float zone = (1.0 - smoothstep(edge + 0.1, edge + 0.4, y)) * step(-0.3, y);
                float fl = uFlake * near * wall * zone;
                vec2 w2 = vec2(vWorld.x + vWorld.z, vWorld.y);
                float flakeN = vnoise(w2 * 1.3 + 4.0) * 0.6 + vnoise(w2 * 4.5) * 0.3 + vnoise(w2 * 14.0) * 0.1;
                float gone = step(1.0 - fl * 0.85, flakeN);
                float rim = smoothstep(0.95 - fl * 0.85, 1.0 - fl * 0.85, flakeN) * (1.0 - gone);
                c = mix(c, mix(vec3(0.70, 0.52, 0.42), vec3(0.78, 0.74, 0.66), vnoise(w2 * 3.0)), gone);
                c = mix(c, vec3(0.96, 0.95, 0.91), rim * 0.7);
              }
              if (uWear > 0.0) {
                // a path worn by feet: the floor polished smooth and pale, then stones loosening
                float rw = dist0 + (vnoise(vWorld.xz * 0.7) - 0.5) * 1.5;
                float worn = (1.0 - smoothstep(uWear - 0.8, uWear + 0.2, rw)) * flatUp;
                float lum = dot(c, vec3(0.299, 0.587, 0.114));
                c = mix(c, vec3(min(1.0, lum * 1.3 + 0.06)) * vec3(1.02, 1.0, 0.94), worn * 0.7);
              }
              if (uWeather > 0.0) {
                // weathered stone: a few millimetres of its surface gone (uWeather 1 = 5 mm): paler, rain-
                // streaked, its surface pitted and flaking in places
                float w = uWeather * (0.55 + 0.45 * near);
                float lum = dot(c, vec3(0.299, 0.587, 0.114));
                c = mix(c, vec3(lum) * vec3(1.06, 1.0, 0.92), w * 0.6);
                vec2 sw = vec2(vWorld.x + vWorld.z, vWorld.y);
                float crust = smoothstep(0.52, 0.72, vnoise(sw * 0.6 + vWorld.xz * 0.2));
                c = mix(c, vec3(0.16, 0.15, 0.13), w * 0.35 * crust * smoothstep(-0.15, -0.6, nW.y));
                float streak = smoothstep(0.55, 0.85, vnoise(vec2(sw.x * 3.0, sw.y * 0.12)));
                c *= 1.0 - streak * w * 0.3 * wall;
                float pits = smoothstep(0.6, 0.8, vnoise(vWorld.xz * 5.0 + vWorld.y * 5.0) * 0.6 + vnoise((vWorld.xz + vWorld.y) * 17.0) * 0.4);
                c *= 1.0 - pits * w * 0.5;
              }
              if (uCrack > 0.0) {
                // a crack through the wall at the sensor, uCrackW metres wide in its middle, uCrack metres long
                float yr = vWorld.y - uSourceY;
                float halfLen = uCrack * 0.5;
                float taper = 1.0 - clamp(abs(yr) / max(halfLen, 0.01), 0.0, 1.0);
                float zig = (vnoise(vec2(yr * 1.2, 3.0)) - 0.5) * 1.2 + (vnoise(vec2(yr * 6.0, 9.0)) - 0.5) * 0.2;
                float d = abs(along - zig);
                float width = max(0.002, uCrackW * (0.25 + 0.75 * taper));
                float onWall = wall * (1.0 - smoothstep(halfLen - 0.2, halfLen + 0.1, abs(yr))) * (1.0 - smoothstep(1.2, 2.2, across));
                // a shadowed edge either side, then the open crack itself
                c *= 1.0 - 0.35 * (1.0 - smoothstep(width * 1.5, width * 6.0, d)) * onWall;
                c = mix(c, vec3(0.04, 0.035, 0.03), (1.0 - smoothstep(width * 0.5, width, d)) * onWall);
              }
              diffuseColor.rgb = c;`,
            );
        };
      }
    });
    scene.add(model);
  }

  for (let i = 0; ruin && !model && i < ruin.ring.length - 1; i++) {
    const a2 = ruin.ring[i];
    const b2 = ruin.ring[i + 1];
    const a = at(a2);
    const b = at(b2);
    const len = dist(a2, b2);
    if (len < 0.2) continue;
    const base = Math.min(a.y, b.y);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.55, WALL_H, 0.55), wallMaterial("#d6c8ad", base));
    wall.position.set((a.x + b.x) / 2, base + WALL_H / 2, (a.z + b.z) / 2);
    wall.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    wall.castShadow = wall.receiveShadow = true;
    scene.add(wall);
    for (let t = 0; t < 1; t += 0.7 / Math.max(len, 0.7)) tops.push(a.clone().lerp(b, t).setY(base + WALL_H + 0.12));
  }
  for (const s of sites) {
    // plot outlines, dashed as in the game's site guide
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(s.ring.map((p) => at(p, 0.08))),
      new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 1.2, gapSize: 1.0 }),
    );
    line.computeLineDistances();
    scene.add(line);
  }

  // Mosaic floors, one per room ARGUS names, each with its centre panel, lined up with the
  // house's longest wall. Tesserae 4 cm.
  let axis = 0;
  let longest = 0;
  for (let i = 0; ruin && i < ruin.ring.length - 1; i++) {
    const [x1, y1] = ruin.ring[i];
    const [x2, y2] = ruin.ring[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > longest) {
      longest = len;
      axis = Math.atan2(y2 - y1, x2 - x1);
    }
  }
  function floorMaterial(photo: THREE.Texture | null, size: number, emblem: boolean) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.75, map: photo });
    m.defines = { USE_UV: "" };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uWet: damage.wet, uLoss: damage.loss, uSalt: damage.salt, uSource: damage.source });
      shader.vertexShader = shader.vertexShader.replace(...WORLD_VARYING).replace(...WORLD_POSITION);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vWorld;\nuniform float uWet, uLoss, uSalt;\nuniform vec2 uSource;\n${NOISE}`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>\n${photo ? "vec3 col = diffuseColor.rgb;" : patternGlsl(size, emblem)}${damageGlsl(!photo)}`,
        );
    };
    return m;
  }
  // A label near one already placed at the same height stands higher, so the two never cover each other.
  const anchors: { xy: XY; up: number }[] = [];
  const crowded = (xy: XY, up: number) => anchors.some((a) => a.up === up && dist(a.xy, xy) < 6);
  for (const r of data.rooms) {
    // With ARGUS's model the real floors are there: no drawn floor or photo panel on top of them.
    if (!model) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR, FLOOR), floorMaterial(null, FLOOR, false));
      floor.rotation.set(-Math.PI / 2, 0, axis);
      floor.position.copy(at(r.xy, 0.03));
      floor.receiveShadow = true;
      scene.add(floor);
      const img = assets.photos.get(r.room);
      let panel: THREE.Mesh;
      if (img && r.photo) {
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = anisotropy;
        const w = PANEL * Math.min(1.35, r.photo.w / r.photo.h);
        panel = new THREE.Mesh(new THREE.PlaneGeometry(w, PANEL), floorMaterial(tex, PANEL, false));
      } else {
        panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL, PANEL), floorMaterial(null, PANEL, true));
      }
      panel.rotation.set(-Math.PI / 2, 0, axis);
      panel.position.copy(at(r.xy, 0.036));
      panel.receiveShadow = true;
      scene.add(panel);
    }
    const tag = document.createElement("div");
    tag.className = "view3d-tag";
    tag.textContent = options.roomLabel(r);
    const label = new CSS2DObject(tag);
    const up = [0.45, 4.5, 8].find((h) => !crowded(r.xy, h)) ?? 0.45; // metres above the floor (labels run to 3 lines)
    anchors.push({ xy: r.xy, up });
    label.position.copy(at(r.xy, up));
    scene.add(label);
  }

  // ARGUS sensors at their 3D placements (vermilion squares, as on the game's map)
  const sensorMat = new THREE.MeshStandardMaterial({ color: "#a84300" });
  const postMat = new THREE.MeshStandardMaterial({ color: "#2b302d" });
  const SIZE = 0.14 * VIEW; // seen from further away over a bigger place, a little bigger
  for (const s of data.sensors3d) {
    const soil = s.kind === "soil_moisture";
    const p = sensorAt(s);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(SIZE, soil ? 0.05 : SIZE, SIZE), sensorMat);
    cube.position.copy(p);
    cube.castShadow = true;
    scene.add(cube);
    // on a post where it stands on the ground; one higher up is fixed to the wall
    const h = p.y - surface(s.xy[0], s.xy[1]);
    if (!soil && h > 0.1 && h < 3) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * VIEW, 0.01 * VIEW, h), postMat);
      post.position.copy(p).setY(p.y - h / 2);
      scene.add(post);
    }
  }

  // Plants rooting in the wall tops when nobody looks after them
  const rnd = seeded(11);
  for (let i = tops.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [tops[i], tops[j]] = [tops[j], tops[i]];
  }
  const plants = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(model ? 0.3 : 0.16, 0), // over a real wall top, a tuft that can be seen
    new THREE.MeshStandardMaterial({ color: "#56703a", roughness: 1, flatShading: true }),
    Math.max(tops.length, 1),
  );
  const m4 = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const bushy = kind === "tree" ? 2.8 : 1; // trees and shrubs over the walls, not only weeds
  tops.forEach((p, i) => {
    const k = (0.6 + rnd() * 0.9) * bushy;
    scale.set(k * 1.3, k * 0.8, k * 1.1);
    plants.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x + rnd() * 0.24 - 0.12, p.y - 0.05, p.z + rnd() * 0.24 - 0.12), turn, scale));
  });
  plants.count = 0;
  plants.castShadow = true;
  // Its bounds are measured once, at the first frame, when no plant grows yet: never culled instead.
  plants.frustumCulled = false;
  scene.add(plants);

  // Where the day's alarm went off: an orange ring on the ground (and a line up to the sensor when it is
  // high on a wall), so the player knows where to look. Not for damage all over (stone, plants).
  const marked = kind === "mosaic" || kind === "fresco" || kind === "floor" || kind === "crack" || kind === "lean";
  if (marked && (focusSensor || at0)) {
    const groundY = surface(focusXY[0], focusXY[1]);
    const r = 1.2 * VIEW;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.2 * VIEW, r, 64),
      new THREE.MeshBasicMaterial({ color: "#ff6a00", transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(src.x, groundY + 0.08, src.z);
    ring.renderOrder = 2;
    scene.add(ring);
    if (src.y - groundY > 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(src.x, groundY + 0.08, src.z), src.clone()]),
        new THREE.LineBasicMaterial({ color: "#ff6a00" }),
      );
      scene.add(line);
    }
  }


  // ---------------------------------------------------------------- the camera: from straight above down to the rooms
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 2;
  controls.maxDistance = 400;
  controls.listenToKeyEvents(canvas); // arrow keys move the view while the canvas has the focus
  // The camera comes to rest looking at the damage: between the two rooms nearest it where ARGUS names
  // rooms, else at the alarm's sensor (or the middle of the place).
  // rooms, else at the alarm's sensor where the damage is on the building by it (and ARGUS's model is
  // there); for damage all over (weathered stone, plants) or a sensor off the model, at the building.
  const onModel = (xy: XY) => !model || floorAt(xy[0], xy[1]) !== null;
  const modelMiddle: XY = model ? [(footprint.min.x + footprint.max.x) / 2, -(footprint.min.z + footprint.max.z) / 2] : houseCentre;
  const local = kind === "mosaic" || kind === "fresco" || kind === "floor" || kind === "crack" || kind === "lean";
  // On ARGUS's model of the House of the Masks, straight to the room of the damage (from above, over
  // the cut walls, to see its floor).
  const roomView = kind === "mosaic" && !!dampRoom && !!model;
  const endLook = roomView
    ? at(dampRoom!.xy, 0.2)
    : dampRoom && nextRoom
      ? at([(dampRoom.xy[0] + nextRoom.xy[0]) / 2, (dampRoom.xy[1] + nextRoom.xy[1]) / 2], 0.4)
      : (kind === "crack" || kind === "lean") && wallAt
        ? new THREE.Vector3(wallAt[0], Math.max(src.y, surface(focusXY[0], focusXY[1]) + 1), wallAt[1])
        : local && (focusSensor || at0) && onModel(focusXY)
          ? src.clone().setY(Math.max(src.y, surface(focusXY[0], focusXY[1]) + 0.4))
          : at(onModel(houseCentre) ? houseCentre : modelMiddle, 0.4);
  // How far away the camera comes to rest: a crack is millimetres wide and a lean a few degrees, so for
  // them about 8 m; for damp, paint or a worn floor at the sensor, about 17 m; else about 28 m (further
  // over a bigger place).
  const close = (kind === "crack" || kind === "lean") && !!wallAt;
  const restAt = close ? 8 : (kind === "mosaic" || kind === "fresco" || kind === "floor") && focusSensor && onModel(focusXY) ? Math.max(17, 14 * VIEW) : 28 * VIEW;
  // From which side: the first of these from which nothing of ARGUS's model stands between the camera
  // and the damage (a building, a wall, a roof; never what the cut leaves out), looking down at 34
  // degrees from the south-west, or in front of the damaged wall; then from the other sides, then from
  // higher up.
  const cutTop = model && data.cut_above_m != null ? floorY + data.cut_above_m : Infinity;
  const first = close ? Math.atan2(away.y, away.x) : Math.atan2(18.5, -14);
  const sides = [0, 1, -1, 2, -2, 3, -3, 4].map((k) => first + (k * Math.PI) / 4);
  const heights = roomView ? [55, 70] : close ? [25, 45, 70] : [34, 50, 70];
  const ray = new THREE.Raycaster();
  const clear = (dir: THREE.Vector3) => {
    if (!model) return true;
    ray.set(endLook, dir);
    ray.far = restAt;
    return !ray.intersectObject(model, true).some((h) => h.distance > 0.6 && h.point.y < cutTop);
  };
  let END_OFFSET = new THREE.Vector3(-14, 15.5, 18.5).normalize();
  search: for (const h of heights) {
    for (const az of sides) {
      const e = (h * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az));
      END_OFFSET = dir;
      if (clear(dir)) break search;
    }
  }
  END_OFFSET.multiplyScalar(restAt);
  const endPos = new THREE.Vector3();
  const topLook = at(houseCentre);
  const topPos = topLook.clone().setY(topLook.y + 200);
  const look = topLook.clone();
  let size = { width: 1, height: 1 };
  let lastView: MapView | null = null;
  let above = true; // looking straight down (before flyIn, after flyOut)

  type Pose = { pos: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3 };
  function pose(p: Pose) {
    camera.position.copy(p.pos);
    camera.up.copy(p.up);
    look.copy(p.look);
    camera.lookAt(look);
  }
  pose({ pos: topPos, look: topLook, up: NORTH });

  let flight: { from: Pose; to: Pose; t0: number; ms: number; upAt: (e: number) => number; done: () => void } | null = null;
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  function fly(to: Pose, ms: number, upAt: (e: number) => number): Promise<void> {
    controls.enabled = false;
    flight = null;
    if (ms <= 0) {
      pose(to);
      return Promise.resolve();
    }
    const from = { pos: camera.position.clone(), look: look.clone(), up: camera.up.clone() };
    return new Promise((done) => {
      flight = { from, to, t0: performance.now(), ms, upAt, done };
    });
  }

  // Framing between the view's title and its panel: the picture is shifted up or down (a view
  // offset), eased towards where it should be.
  let shift = 0;
  let shiftTo = 0;
  function applyShift() {
    if (shift === 0) camera.clearViewOffset();
    else camera.setViewOffset(size.width, size.height, 0, shift, size.width, size.height);
  }

  function render() {
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }
  let raf = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (shift !== shiftTo) {
      shift += (shiftTo - shift) * 0.12;
      if (Math.abs(shiftTo - shift) < 0.5) shift = shiftTo;
      applyShift();
    }
    if (flight) {
      const t = Math.min(1, (now - flight.t0) / flight.ms);
      const e = ease(t);
      camera.position.lerpVectors(flight.from.pos, flight.to.pos, e);
      look.lerpVectors(flight.from.look, flight.to.look, e);
      camera.up.lerpVectors(flight.from.up, flight.to.up, flight.upAt(e)).normalize();
      camera.lookAt(look);
      if (t >= 1) {
        const done = flight.done;
        flight = null;
        done();
      }
    } else if (controls.enabled) {
      controls.update();
      look.copy(controls.target);
    }
    render();
  }

  function matchMap(view: MapView) {
    lastView = view;
    const [lat, lon] = view.center;
    topLook.copy(at([(lon - LON0) * KX, (lat - LAT0) * KY]));
    topPos.copy(topLook).setY(topLook.y + cameraHeightFor(size.height, view.metresPerPixel, camera.fov));
    if (above && !flight) pose({ pos: topPos, look: topLook, up: NORTH });
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  return {
    matchMap,
    flyIn(ms) {
      above = false;
      // A narrow (upright) screen sees less from side to side: the camera stays further back there,
      // so the rooms still fit across it.
      endPos.copy(endLook).addScaledVector(END_OFFSET, Math.max(1, 0.95 / (size.width / size.height)));
      // Up turns from north to the sky early, while the camera still looks almost straight down.
      return fly({ pos: endPos, look: endLook, up: SKY }, ms, (e) => Math.min(1, e * 1.6)).then(() => {
        controls.target.copy(endLook);
        controls.enabled = true;
      });
    },
    flyOut(ms) {
      shiftTo = 0; // straight above, the picture is the map's again
      if (ms <= 0) {
        shift = 0;
        applyShift();
      }
      return fly({ pos: topPos, look: topLook, up: NORTH }, ms, (e) => e).then(() => {
        above = true;
      });
    },
    setInsets(top, bottom) {
      shiftTo = above ? 0 : Math.round((bottom - top) / 2);
    },
    setDamage(d) {
      damage.damp.value = d.damp;
      damage.wet.value = d.wet;
      damage.loss.value = d.loss;
      damage.salt.value = d.salt;
      damage.flake.value = d.flake;
      damage.wear.value = d.wear;
      damage.weather.value = Math.min(1, d.surfaceMm / 5);
      damage.crack.value = d.crackM;
      damage.crackW.value = d.crackMm / 1000;
      damage.lean.value = (d.lean * Math.PI) / 180;
      plants.count = Math.round(d.plants * tops.length);
    },
    resize(width, height) {
      if (width < 1 || height < 1) return;
      size = { width, height };
      renderer.setSize(width, height);
      labels.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      applyShift();
      if (lastView) matchMap(lastView);
      if (!raf) render();
    },
    start() {
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop,
    renderOnce() {
      renderer.compile(scene, camera);
      render();
    },
    dispose() {
      stop();
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of materials) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labels.domElement.remove();
    },
    look(offset, room) {
      const r = room ? rooms.get(room) : undefined;
      controls.target.copy(r ? at(r.xy, 0.2) : endLook);
      camera.position.copy(controls.target).add(new THREE.Vector3(...offset));
      controls.update();
      look.copy(controls.target);
    },
  };
}
