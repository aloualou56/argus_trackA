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
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cameraHeightFor, placeCardIn, seeded, terrarium, tileLonLat, tileXY, type Damage, type DamageKind, type Effect } from "./math";
import { createWeather, makeEnv, type Weather } from "./weather";

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
  sensors3d: HouseSensor[];
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

/** How far the terrain is bent round a model: given the model's edge ([x, y, how far the edge stands
 *  above the terrain there], metres east and north) and the box round the model, the bend at any point:
 *  at the edge, the difference there (an average of the edge points nearest, so a ragged edge does not make
 *  a bumpy ground); away from it, fading out, slowly where it is big (a slope of 1 in 3 on average),
 *  within 60 m of the edge; nothing beyond. */
export function bendToEdge(
  edge: [number, number, number][],
  box: { west: number; east: number; south: number; north: number },
): (x: number, y: number) => number {
  const GRID = 3;
  const REACH = 60;
  const BUCKET = 6;
  const west = box.west - REACH;
  const north = box.north + REACH;
  const cols = Math.ceil((box.east - box.west + 2 * REACH) / GRID) + 1;
  const rows = Math.ceil((box.north - box.south + 2 * REACH) / GRID) + 1;
  // the edge points in 6 m squares over the whole field (an edge point outside it is never needed)
  const bcols = Math.ceil((cols * GRID) / BUCKET) + 1;
  const brows = Math.ceil((rows * GRID) / BUCKET) + 1;
  const buckets: [number, number, number][][] = Array.from({ length: bcols * brows }, () => []);
  const bucketOf = (x: number, y: number) => [Math.floor((x - west) / BUCKET), Math.floor((north - y) / BUCKET)];
  for (const p of edge) {
    const [bc, br] = bucketOf(p[0], p[1]);
    if (bc >= 0 && br >= 0 && bc < bcols && br < brows) buckets[br * bcols + bc].push(p);
  }
  const field = new Float32Array(cols * rows);
  const near: [number, number][] = []; // [distance, difference] of the edge points round a node
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = west + c * GRID;
      const y = north - r * GRID;
      const [bc, br] = bucketOf(x, y);
      // the nearest edge point: rings of squares outwards, until a ring is further than it
      let dmin = Infinity;
      const look = (bi: number, bj: number) => {
        if (bi < 0 || bj < 0 || bi >= bcols || bj >= brows) return;
        for (const [sx, sy] of buckets[bj * bcols + bi]) dmin = Math.min(dmin, Math.hypot(sx - x, sy - y));
      };
      look(bc, br);
      for (let ring = 1; (ring - 1) * BUCKET <= Math.min(dmin, REACH); ring++) {
        for (let i = -ring; i <= ring; i++) {
          look(bc + i, br - ring);
          look(bc + i, br + ring);
        }
        for (let j = 1 - ring; j < ring; j++) {
          look(bc - ring, br + j);
          look(bc + ring, br + j);
        }
      }
      if (dmin > REACH) continue;
      // the edge points within 12 m further than the nearest weigh, the nearest most
      near.length = 0;
      const span = Math.ceil((dmin + 12) / BUCKET);
      for (let j = Math.max(0, br - span); j <= Math.min(brows - 1, br + span); j++) {
        for (let i = Math.max(0, bc - span); i <= Math.min(bcols - 1, bc + span); i++) {
          for (const [sx, sy, d] of buckets[j * bcols + i]) {
            const dist = Math.hypot(sx - x, sy - y);
            if (dist < dmin + 12) near.push([dist, d]);
          }
        }
      }
      let sw = 0;
      let sd = 0;
      for (const [dist, d] of near) {
        const w = Math.exp(-(((dist - dmin) / 4) ** 2)) / (dist + 1);
        sw += w;
        sd += w * d;
      }
      const d = sd / sw;
      const s = Math.max(0, 1 - dmin / Math.min(REACH, Math.max(12, 3 * Math.abs(d))));
      field[r * cols + c] = d * s * s * (3 - 2 * s);
    }
  }
  return (x, y) => {
    const fc = (x - west) / GRID;
    const fr = (north - y) / GRID;
    const c0 = Math.floor(fc);
    const r0 = Math.floor(fr);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= cols || r0 + 1 >= rows) return 0;
    const tx = fc - c0;
    const ty = fr - r0;
    const at = (c: number, r: number) => field[r * cols + c];
    return (at(c0, r0) * (1 - tx) + at(c0 + 1, r0) * tx) * (1 - ty) + (at(c0, r0 + 1) * (1 - tx) + at(c0 + 1, r0 + 1) * tx) * ty;
  };
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

/** One of ARGUS's sensors in a scene's data (metres east and north of the origin; h above the model). */
export interface HouseSensor {
  xy: XY;
  h: number;
  alt?: number;
  /** the game's own grouping of the sensor ("humidity"; "other": a type the game has no sensor of) */
  kind: string;
  /** ARGUS's name for the instrument's type ("Humidity Sensor") */
  type?: string | null;
  /** where ARGUS says it stands ("Cellar 193 - Lagar") */
  where?: string | null;
  room: string | null;
  room_name?: string | null;
  serial?: string | null;
}

/** A sensor as a pin tells of it (HouseOptions.sensorPin). */
export interface SensorRef {
  kind: string;
  type: string | null;
  where: string | null;
  /** the number of ARGUS's room it is in (the House of the Masks), whose name the game has in every language */
  room: string | null;
  serial: string | null;
  /** it raised the day's alarm */
  alarm: boolean;
}

/** What a pin is made of, in the game's language. */
export interface SensorPinFace {
  /** inside the pin: the sensor's drawing (an SVG), or how many sensors stand there */
  icon: string;
  /** the pin's name for screen readers */
  name: string;
  /** what opens by it when it is pressed */
  card: HTMLElement;
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
  /** The words, with a picture sign, on the label at the damage ("💧 The water rises"), in the game's
   *  language: for the day's danger, or "plants" for the plants on the walls. */
  damageLabel?: (what: Exclude<DamageKind, null> | "plants") => string;
  /** A pin to press on each of ARGUS's sensors (one for sensors at one spot), which opens a card of what it
   *  is. Not given (the alarm's picture): no pins. */
  sensorPin?: (sensors: SensorRef[]) => SensorPinFace;
  /** The words on the magnifier: "{n} times closer". */
  magnifierLabel?: (times: number) => string;
  /** No pulsing (the player asked for less motion). */
  still?: boolean;
  /** The view of an alarm going off (Alarm3D.tsx): the camera comes to rest a little way back from the
   *  alarm's sensor, out beyond it, the sensor in the middle and the place behind it (not up close to
   *  the damage). */
  alarm?: boolean;
}

/** A view of the game's map: what it is centred on ([lat, lon]) and its scale. */
export interface MapView {
  center: [number, number];
  metresPerPixel: number;
}

export interface House {
  /** Looks straight down on the map's view, north up, from the height where the ground matches it. */
  matchMap(view: MapView): void;
  /** From straight above down to the rooms; then the camera can be turned. `spin`: turning round them
   *  on the way down, in radians (the alarm's way in). */
  flyIn(ms: number, spin?: number): Promise<void>;
  /** Back up to the view of matchMap. */
  flyOut(ms: number): Promise<void>;
  setDamage(damage: Damage): void;
  /** "See it happen": plays out one of the weather and the dangers ARGUS rates here (weather.ts), or
   *  stops (null). */
  setWeather(effect: Effect | null): void;
  /** Whether this place can show it (plants need wall tops, visitors level floors). */
  canWeather(effect: Effect): boolean;
  /** Marks in red where the damage is (a sign, like an arrow; not the stone's colour). */
  setHighlight(on: boolean): void;
  /** The alarm going off at its sensor: red waves spreading on the ground from it and a beam of light
   *  over it, so it is found from anywhere (App.tsx, the day's alarm in 3D). */
  setAlarm(on: boolean): void;
  /** The camera circling slowly round what it looks at, until the player takes it over. */
  orbit(on: boolean): void;
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

/** How the ground moves ("See it happen", weather.ts: creep, sink), in world space: what a point at w
 *  is shifted by. Creep: below a tear across the slope the ground slides downhill and a little down, and
 *  what stands on it leans. Sink: a dish, deepest in the middle, the walls leaning in where it bends. */
const GEO_GLSL = `
  uniform float uEnvCreep, uEnvSink, uGeoR;
  uniform vec2 uGeoCentre, uGeoDir;
  vec3 geoShift(vec3 w, float ground) {
    vec2 rel = w.xz - uGeoCentre;
    float d = length(rel);
    float inR = 1.0 - smoothstep(uGeoR * 0.7, uGeoR, d);
    float up = max(0.0, w.y - ground);
    float below = smoothstep(-1.5, 1.5, dot(rel, uGeoDir)) * inR;
    vec3 s = vec3(uGeoDir.x, -0.25, uGeoDir.y) * uEnvCreep * below;
    s.xz += uGeoDir * uEnvCreep * 0.06 * up * below;
    float dish = 1.0 - smoothstep(0.0, uGeoR, d);
    s.y -= uEnvSink * dish;
    vec2 inward = d > 0.01 ? -rel / d : vec2(0.0);
    s.xz += inward * uEnvSink * 0.08 * up * dish * (1.0 - dish) * 4.0;
    return s;
  }`;

/** A cellar caving in ("See it happen", weather.ts), in ARGUS's model: the cellars' points (attribute
 *  `cellar`) under the roof over the collapse come down onto the floor, ragged; the ground above sinks into
 *  a hollow over it. uCave and uHollow from 0 to 1; uCaveC the floor at the collapse, uCaveR its radius. */
const CAVE_VERTEX = `
  attribute float cellar;
  varying float vCellar;
  uniform float uCave, uCaveR, uHollow;
  uniform vec3 uCaveC;`;
const CAVE_BEGIN = `
  vCellar = cellar;
  if (uCave > 0.0 || uHollow > 0.0) {
    vec4 wc = modelMatrix * vec4(transformed, 1.0);
    float dC = distance(wc.xz, uCaveC.xz);
    if (cellar > 0.5) {
      float fall = uCave * (1.0 - smoothstep(uCaveR * 0.45, uCaveR, dC));
      float roof = smoothstep(uCaveC.y + 0.6, uCaveC.y + 1.6, wc.y);
      float rest = uCaveC.y + 0.9 * uCave * (1.0 - smoothstep(0.0, uCaveR, dC)) + 0.05 + 0.3 * fract(sin(dot(wc.xz, vec2(12.9898, 78.233))) * 43758.5453); // a rough mound of what fell (the pieces lie on it: weather.ts, debris)
      transformed += inverse(mat3(modelMatrix)) * vec3(0.0, min(0.0, (rest - wc.y) * fall * roof), 0.0);
    } else {
      float dish = 1.0 - smoothstep(0.0, uCaveR * 1.8, dC);
      transformed += inverse(mat3(modelMatrix)) * vec3(0.0, -uHollow * 1.4 * dish * dish, 0.0);
    }
  }`;
/** The cellars' plain surface: dug into clay and limestone, a warm earth with pale stone in places; inside,
 *  lit by the camera's lamp (what faces it bright, falling off with distance). Drawn, not photographed.
 *  After the model's colours are applied (color_fragment), which it takes the place of. */
const CAVE_FRAGMENT = `
  if (vCellar > 0.5) {
    vec3 nC = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 toCam = cameraPosition - vWorld;
    float dCam = length(toCam);
    toCam /= max(dCam, 0.001);
    if (dot(nC, toCam) < 0.0) nC = -nC;
    float n1 = vnoise(vWorld.xz * 1.7 + vWorld.y * 1.3);
    float n2 = vnoise(vec2(vWorld.x + vWorld.z, vWorld.y) * 6.0);
    float n3 = vnoise(vWorld.xz * 14.0 + vWorld.y * 11.0);
    vec3 earth = mix(vec3(0.36, 0.27, 0.19), vec3(0.58, 0.52, 0.42), smoothstep(0.5, 0.8, n1));
    earth *= 0.78 + 0.28 * n2 + 0.14 * n3;
    float lamp = (0.12 + 0.88 * max(dot(nC, toCam), 0.0)) / (1.0 + 0.09 * dCam * dCam);
    float day = 0.55 + 0.45 * max(dot(nC, normalize(vec3(-0.4, 0.8, 0.3))), 0.0);
    diffuseColor.rgb = earth * mix(day, clamp(lamp * 1.9 + 0.02, 0.0, 1.2), uInCellar);
  } else if (uHollow > 0.0) {
    // the ground over the collapse sunk into a hollow: darker towards its middle (the model is drawn unlit,
    // so a dip would not show), and a ring of cracks where it tore away
    float dH = distance(vWorld.xz, uCaveC.xz);
    float dishH = 1.0 - smoothstep(0.0, uCaveR * 1.8, dH);
    diffuseColor.rgb *= 1.0 - 0.55 * uHollow * dishH * dishH;
    float ringH = abs(dH - uCaveR * 1.5 + (vnoise(vWorld.xz * 1.4) - 0.5) * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.04, 0.03), uHollow * (1.0 - smoothstep(0.03, 0.12, ringH)));
  }`;

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
  // The step between the two datums: the median difference over ARGUS's whole grid. (Taken at one point,
  // a hilltop that the coarse AWS tiles round off lifted all the terrain around into a wall.)
  let datumShift = 0;
  if (grid && gridH) {
    const diffs: number[] = [];
    const every = Math.max(1, Math.floor(grid.cols / 24));
    for (let r = 0; r < grid.rows; r += every) {
      for (let c = 0; c < grid.cols; c += every) {
        const x = grid.west_m + c * grid.spacing_m;
        const y = grid.north_m - r * grid.spacing_m;
        const fine = gridAt(x, y);
        const coarse = awsTerrain(x, y);
        if (fine !== null && coarse !== null) diffs.push(fine - coarse);
      }
    }
    diffs.sort((a, b) => a - b);
    if (diffs.length) datumShift = diffs[Math.floor(diffs.length / 2)];
  }
  // ARGUS's grid gives way to the AWS terrain over its last 24 m, so the two meet without a step.
  const BLEND_M = 24;
  function terrain(x: number, y: number): number | null {
    const fine = gridAt(x, y);
    const coarse = awsTerrain(x, y);
    const far = coarse === null ? null : coarse + datumShift;
    if (fine === null || !grid) return far;
    if (far === null) return fine;
    const c = (x - grid.west_m) / grid.spacing_m;
    const r = (grid.north_m - y) / grid.spacing_m;
    const inside = Math.min(c, grid.cols - 1 - c, r, grid.rows - 1 - r) * grid.spacing_m;
    const w = Math.min(1, Math.max(0, inside / BLEND_M));
    return fine * w + far * (1 - w);
  }
  const H0 = terrain(0, 0);
  // Flat where the terrain did not load: the house still stands, on level ground.
  const baseGround = (x: number, y: number) => (H0 === null ? 0 : (terrain(x, y) ?? H0) - H0);
  // The terrain is coarser than ARGUS's model (a height every 2 m, smoothed: a hilltop rounded off): round
  // the model it is bent to meet the model's edge (set once the model is levelled), so the model neither
  // stands on air over it nor sinks into it.
  let bend: (x: number, y: number) => number = () => 0;
  const ground = (x: number, y: number) => baseGround(x, y) + bend(x, y);

  // ARGUS's model, lowered with the ground (whose height 0 is the terrain at the origin). Its floor is
  // the lowest point of the model in each half-metre cell: inside a room, the floor; by a wall, the
  // floor at its foot (sensors stand at ARGUS's height above it).
  let CELL = 0.5;
  let floorAt: (x: number, y: number) => number | null = () => null;
  let topAt: (x: number, y: number) => number | null = () => null;
  let lowestNear: (x: number, y: number, r: number) => number | null = () => null;
  const footprint = new THREE.Box3();
  const tops: THREE.Vector3[] = []; // wall tops, where plants root
  const flats: THREE.Vector3[] = []; // level floors, every metre or so (visitors walk there)
  const wallCells: XY[] = []; // [x, z] of the cells where the model stands as a wall, near the damage
  // Where the model stands up from its own ground (walls, rocks, buildings): every metre or so, its
  // foot and top, so a place can be seen whole from its long side.
  const standing: { x: number; z: number; low: number; high: number }[] = [];
  // The model's lowest point in each cell where it has a ground of its own: the ground is not drawn above
  // it (it would show through the model's own ground, or stand over its sunken floors).
  let lows: { data: Float32Array; nx: number; nz: number; minX: number; minZ: number; cell: number } | null = null;
  // The floor the cut above the walls is measured from (the House of the Masks' shelters over its mosaics).
  let cutBase = 0;
  // Within the model, away from its ragged edge (holes in its floors included).
  let insideModel: (x: number, y: number) => boolean = () => false;
  // The cellars under Baltanás's hill: ARGUS's model has them as shells of their own, each in one flat
  // colour (lime, cyan, magenta), not photographed. Found by that colour (an attribute `cellar` on each
  // point, 1 in a cellar), they get a plain earth-and-stone surface, are left out of the ground's height,
  // and are where a cellar caving in is shown ("See it happen", weather.ts).
  const CELLAR_COLOURS = [[0.4, 1, 0.2], [0.4, 1, 1], [1, 0.4, 1]];
  let anyCellar = false;
  model?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    const col = mesh.geometry.getAttribute("color");
    const flag = new Float32Array(pos.count);
    for (let i = 0; col && i < pos.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      if (CELLAR_COLOURS.some(([cr, cg, cb]) => Math.abs(r - cr) < 0.12 && Math.abs(g - cg) < 0.12 && Math.abs(b - cb) < 0.12)) {
        flag[i] = 1;
        anyCellar = true;
      }
    }
    mesh.geometry.setAttribute("cellar", new THREE.BufferAttribute(flag, 1));
  });
  // the cellars' floor and ceiling (lowest and highest point) in each cell, and every cell with a cellar
  let cellarAt: (x: number, z: number) => { low: number; high: number } | null = () => null;
  const cellarCells: { x: number; z: number; low: number; high: number }[] = [];
  if (model) {
    let nx = 0;
    let nz = 0;
    let cells = new Float32Array(0);
    let highs = new Float32Array(0);
    let cLows = new Float32Array(0);
    let cHighs = new Float32Array(0);
    const measure = () => {
      model.updateMatrixWorld(true);
      footprint.setFromObject(model);
      // half-metre cells; coarser over a big place, so the grid stays about a million cells at most
      CELL = Math.max(0.5, Math.max(footprint.max.x - footprint.min.x, footprint.max.z - footprint.min.z) / 1000);
      nx = Math.ceil((footprint.max.x - footprint.min.x) / CELL) + 1;
      nz = Math.ceil((footprint.max.z - footprint.min.z) / CELL) + 1;
      cells = new Float32Array(nx * nz).fill(Infinity);
      highs = new Float32Array(nx * nz).fill(-Infinity);
      cLows = new Float32Array(nx * nz).fill(Infinity);
      cHighs = new Float32Array(nx * nz).fill(-Infinity);
      const v = new THREE.Vector3();
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
        if (!pos) return;
        mesh.castShadow = mesh.receiveShadow = true;
        const inCellar = mesh.geometry.getAttribute("cellar");
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          const k = Math.floor((v.z - footprint.min.z) / CELL) * nx + Math.floor((v.x - footprint.min.x) / CELL);
          if (inCellar && inCellar.getX(i) > 0.5) {
            // underground: not the ground's height (the hill above it is)
            if (v.y < cLows[k]) cLows[k] = v.y;
            if (v.y > cHighs[k]) cHighs[k] = v.y;
            continue;
          }
          if (v.y < cells[k]) cells[k] = v.y;
          if (v.y > highs[k]) highs[k] = v.y;
        }
      });
    };
    // The group is shared between views (preload.ts keeps it): each view measures the model at
    // ARGUS's own placement, never at the matrix the last view levelled it with (a second view
    // would take that for ARGUS's placement, level "again", and sink the model under the terrain).
    model.matrixAutoUpdate = false;
    model.matrix.makeTranslation(0, -(H0 ?? 0), 0);
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
    topAt = (x, y) => {
      const col = Math.floor((x - footprint.min.x) / CELL);
      const row = Math.floor((-y - footprint.min.z) / CELL);
      if (col < 0 || row < 0 || col >= nx || row >= nz) return null;
      const h = highs[row * nx + col];
      return h === -Infinity ? null : h;
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
    // The model has a ground of its own in cells where it is flat (a floor, a street, a roof) and a metre
    // round them (the walls between floors), and wherever its floor lies below the terrain (rooms dug out, a
    // sunken courtyard, a floor under a shelter's roof); not in the middle of a cliff or a facade (no surface
    // facing up there: the ground's hole would show the sky), nor at its ragged edge (the ground fills the
    // gaps there).
    const R = Math.max(1, Math.round(1 / CELL));
    const has = (r: number, c: number) => r >= 0 && c >= 0 && r < nz && c < nx && cells[r * nx + c] !== Infinity;
    const flat = (r: number, c: number) => has(r, c) && highs[r * nx + c] - cells[r * nx + c] < 1;
    // Empty cells outside the model (reached from the grid's border through empty cells) are not the holes
    // in it (a floor the photographs missed): the model's ragged edge is next to the first, not the second.
    const outside = new Uint8Array(nx * nz);
    const queue: number[] = [];
    const seed = (k: number) => {
      if (!outside[k] && cells[k] === Infinity) {
        outside[k] = 1;
        queue.push(k);
      }
    };
    for (let c = 0; c < nx; c++) {
      seed(c);
      seed((nz - 1) * nx + c);
    }
    for (let r = 0; r < nz; r++) {
      seed(r * nx);
      seed(r * nx + nx - 1);
    }
    while (queue.length) {
      const k = queue.pop()!;
      const c = k % nx;
      if (c > 0) seed(k - 1);
      if (c < nx - 1) seed(k + 1);
      if (k >= nx) seed(k - nx);
      if (k < (nz - 1) * nx) seed(k + nx);
    }
    // The terrain bent to the model's edge (bendToEdge): along the edge (its cells next to the outside),
    // the model's lowest point in every 2 m is how far above (or below) the terrain the edge stands there.
    const bins = new Map<number, [number, number, number]>();
    for (let r = 0; r < nz; r++) {
      for (let c = 0; c < nx; c++) {
        const k = r * nx + c;
        if (cells[k] === Infinity) continue;
        const edge = c === 0 || r === 0 || c === nx - 1 || r === nz - 1 || outside[k - 1] || outside[k + 1] || outside[k - nx] || outside[k + nx];
        if (!edge) continue;
        const x = footprint.min.x + (c + 0.5) * CELL;
        const y = -(footprint.min.z + (r + 0.5) * CELL);
        const key = Math.floor(x / 2) * 100003 + Math.floor(y / 2);
        const was = bins.get(key);
        if (!was || cells[k] < was[2]) bins.set(key, [x, y, cells[k]]);
      }
    }
    bend = bendToEdge(
      [...bins.values()].map(([x, y, h]): [number, number, number] => [x, y, h - 0.1 - baseGround(x, y)]), // a little under: it hides the seam
      { west: footprint.min.x, east: footprint.max.x, south: -footprint.max.z, north: -footprint.min.z },
    );
    // within a metre of the outside (the ragged edge), or outside
    const nearOut = new Uint8Array(nx * nz);
    const lowData = new Float32Array(nx * nz).fill(1e6);
    for (let r = 0; r < nz; r++) {
      for (let c = 0; c < nx; c++) {
        let edge = false;
        let nearFlat = false;
        for (let dr = -R; dr <= R; dr++) {
          for (let dc = -R; dc <= R; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= nz || cc >= nx || outside[rr * nx + cc]) edge = true;
            else if (flat(rr, cc)) nearFlat = true;
          }
        }
        if (edge) nearOut[r * nx + c] = 1;
        if (!has(r, c)) continue;
        const sunken = cells[r * nx + c] < ground(footprint.min.x + (c + 0.5) * CELL, -(footprint.min.z + (r + 0.5) * CELL)) - 0.3;
        if (!edge && (nearFlat || sunken)) lowData[r * nx + c] = cells[r * nx + c];
      }
    }
    lows = { data: lowData, nx, nz, minX: footprint.min.x, minZ: footprint.min.z, cell: CELL };
    if (anyCellar) {
      for (let k = 0; k < cLows.length; k++) {
        if (cLows[k] === Infinity) continue;
        cellarCells.push({ x: footprint.min.x + ((k % nx) + 0.5) * CELL, z: footprint.min.z + (Math.floor(k / nx) + 0.5) * CELL, low: cLows[k], high: cHighs[k] });
      }
      cellarAt = (x, z) => {
        const col = Math.floor((x - footprint.min.x) / CELL);
        const row = Math.floor((z - footprint.min.z) / CELL);
        if (col < 0 || row < 0 || col >= nx || row >= nz) return null;
        const k = row * nx + col;
        return cLows[k] === Infinity ? null : { low: cLows[k], high: cHighs[k] };
      };
    }
    insideModel = (x, y) => {
      const c = Math.floor((x - footprint.min.x) / CELL);
      const r = Math.floor((-y - footprint.min.z) / CELL);
      return c >= 0 && r >= 0 && c < nx && r < nz && !nearOut[r * nx + c];
    };
    // The cut is measured from the floor at the damage: in the mosaics' rooms it takes the shelters' roof
    // off, so the damage to the mosaics shows; from outside the house (the wind) the roof stays.
    cutBase = floorAt(focusXY[0], focusXY[1]) ?? 0;
    // Wall tops: cells where the model stands more than 1.2 m above its own ground, under the cut where
    // there is one, every metre or so, so the plants spread along them. A wall's top drops away on both
    // sides across it and runs on along it: not a column or a post (which drops away all round), nor a
    // roof or a tower (more than 6 m above its own ground).
    const cutY = data.cut_above_m != null ? cutBase + data.cut_above_m : Infinity;
    const step = Math.max(1, Math.round(1 / CELL));
    const side = Math.max(1, Math.round(1.2 / CELL));
    const highAt = (row: number, col: number) => (row < 0 || col < 0 || row >= nz || col >= nx ? -Infinity : highs[row * nx + col]);
    const across: [number, number][] = [[side, 0], [0, side], [side, side], [side, -side]];
    const cx0 = (col: number) => footprint.min.x + (col + 0.5) * CELL;
    const cz0 = (row: number) => footprint.min.z + (row + 0.5) * CELL;
    for (let row = 0; row < nz; row += step) {
      for (let col = 0; col < nx; col += step) {
        const k = row * nx + col;
        const tall = highs[k] - cells[k];
        // a level floor (not a roof high above the ground, nor what the cut leaves out), where people walk
        if (tall < 0.25 && cells[k] < cutY - 1 && cells[k] < ground(cx0(col), -cz0(row)) + 1.5) flats.push(new THREE.Vector3(cx0(col), cells[k], cz0(row)));
        if (!(tall > 1.2)) continue;
        const cx = footprint.min.x + (col + 0.5) * CELL;
        const cz = footprint.min.z + (row + 0.5) * CELL;
        standing.push({ x: cx, z: cz, low: cells[k], high: highs[k] });
        if (Math.hypot(cx - focusXY[0], -cz - focusXY[1]) < 5) wallCells.push([cx, cz]);
        const drop = (r: number, c: number) => highAt(r, c) < highs[k] - 1;
        const drops = across.map(([dr, dc]) => drop(row - dr, col - dc) && drop(row + dr, col + dc));
        const ridge = drops.some(Boolean) && !drops.every(Boolean);
        if (ridge && tall < 6 && highs[k] < cutY - 0.2) tops.push(new THREE.Vector3(cx, highs[k] + 0.02, cz));
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
  // The sensors' pins are buttons, so their layer is not hidden from screen readers like the labels'; its
  // own small scene holds only them.
  const pins = options.sensorPin ? new CSS2DRenderer() : null;
  const pinScene = new THREE.Scene();
  if (pins) {
    pins.domElement.className = "view3d-pins";
    host.appendChild(pins.domElement);
  }

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

  // ground: the satellite picture, lifted onto the terrain; its points closer together round the model
  // (about every 1.5 m there, 6 m far off), so the ground follows the model's edge
  const SEG = 200;
  const groundGeo = new THREE.PlaneGeometry(imagery.east - imagery.west, imagery.north - imagery.south, SEG, SEG);
  const gp = groundGeo.attributes.position;
  const guv = groundGeo.attributes.uv;
  const gx0 = (imagery.west + imagery.east) / 2;
  const gy0 = (imagery.north + imagery.south) / 2;
  const [mx0, my0] = model ? [(footprint.min.x + footprint.max.x) / 2, -(footprint.min.z + footprint.max.z) / 2] : houseCentre;
  const sigma = (model ? Math.max(footprint.max.x - footprint.min.x, footprint.max.z - footprint.min.z) / 2 : 30) + 40;
  /** SEG + 1 positions from a to b, denser round m. */
  const spread = (a: number, b: number, m: number): number[] => {
    const N = 2000;
    const cdf = [0];
    for (let i = 1; i <= N; i++) {
      const x = a + ((i - 0.5) / N) * (b - a);
      cdf.push(cdf[i - 1] + 1 + 4 * Math.exp(-(((x - m) / sigma) ** 2)));
    }
    const out: number[] = [];
    let i = 0;
    for (let k = 0; k <= SEG; k++) {
      const want = (k / SEG) * cdf[N];
      while (i < N - 1 && cdf[i + 1] < want) i++;
      const t = (want - cdf[i]) / (cdf[i + 1] - cdf[i] || 1);
      out.push(a + ((i + Math.min(1, Math.max(0, t))) / N) * (b - a));
    }
    return out;
  };
  const xs = spread(imagery.west, imagery.east, mx0);
  const ys = spread(imagery.south, imagery.north, my0).reverse(); // the plane's rows run from the north
  // The terrain everywhere. Inside the model the ground stays under it (under its lowest point a few
  // metres round), so it fills what is seen through a gap under the model's edge or a hole in its
  // floors, and never stands over a floor where the photographs left a hole; never at the model's edge,
  // where a step would show (the bent terrain meets the edge there). Where it still stands over the
  // model, it is not drawn (the model's lowest point in each cell), so it never covers the model's own
  // ground or its sunken floors.
  const reach = (Math.max(imagery.east - imagery.west, imagery.north - imagery.south) / 128) * 0.75;
  for (let i = 0; i < gp.count; i++) {
    const x = xs[i % (SEG + 1)];
    const y = ys[Math.floor(i / (SEG + 1))];
    gp.setXY(i, x - gx0, y - gy0);
    guv.setXY(i, (x - imagery.west) / (imagery.east - imagery.west), (y - imagery.south) / (imagery.north - imagery.south));
    const g = ground(x, y);
    const inside = model && insideModel(x, y);
    const low = inside ? lowestNear(x, y, reach) : null;
    gp.setZ(i, low === null ? g : Math.min(g, low - 0.3));
  }
  groundGeo.computeVertexNormals();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const groundTex = new THREE.CanvasTexture(imagery.canvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = anisotropy;
  // A photograph, with the day's own light in it: shown as it is, not lit a second time.
  // (Drawn a little behind: where it meets the model's own ground, the model's shows.)
  const groundMat = new THREE.MeshBasicMaterial({ map: groundTex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
  const mask = lows ? new THREE.DataTexture(lows.data, lows.nx, lows.nz, THREE.RedFormat, THREE.FloatType) : null;
  if (mask) mask.needsUpdate = true; // (nearest: a float texture is not filtered everywhere)
  const maskMin = new THREE.Vector2(lows?.minX ?? 0, lows?.minZ ?? 0);
  const maskSize = new THREE.Vector2(lows ? lows.nx * lows.cell : 1, lows ? lows.nz * lows.cell : 1);
  // (the weather on the ground too: wet, frost, soot, heat, a storm's light; compiled once the scene is made)
  groundMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uMask: { value: mask }, uMaskMin: { value: maskMin }, uMaskSize: { value: maskSize }, uHasMask: { value: mask ? 1 : 0 },
      uEnvWet: env.wet, uEnvFrost: env.frost, uEnvSoot: env.soot, uEnvHeat: env.heat, uEnvDim: env.dim, uEnvFlash: env.flash,
      uEnvCreep: env.creep, uEnvSink: env.sink, uGeoCentre: env.geoCentre, uGeoDir: env.geoDir, uGeoR: env.geoR, uGround: { value: floorY },
    });
    // the ground moves with the model where it creeps or sinks
    shader.vertexShader = shader.vertexShader
      .replace(...WORLD_VARYING)
      .replace(...WORLD_POSITION)
      .replace("#include <common>", "#include <common>\nuniform float uGround;" + GEO_GLSL)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        if (uEnvCreep > 0.0 || uEnvSink > 0.0) {
          vec4 wg = modelMatrix * vec4(transformed, 1.0);
          transformed += inverse(mat3(modelMatrix)) * geoShift(wg.xyz, uGround);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWorld;\nuniform sampler2D uMask;\nuniform vec2 uMaskMin, uMaskSize;\nuniform float uHasMask, uEnvWet, uEnvFrost, uEnvSoot, uEnvHeat, uEnvDim, uEnvFlash;",
      )
      .replace(
        "void main() {",
        `void main() {
        vec2 maskUv = (vWorld.xz - uMaskMin) / uMaskSize;
        if (uHasMask > 0.5 && all(greaterThan(maskUv, vec2(0.0))) && all(lessThan(maskUv, vec2(1.0))) && vWorld.y > texture2D(uMask, maskUv).r + 0.02) discard;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec3 g = diffuseColor.rgb;
        float lumG = dot(g, vec3(0.299, 0.587, 0.114));
        g *= 1.0 - 0.35 * uEnvWet;
        g = mix(g, vec3(0.93, 0.95, 0.98), uEnvFrost * 0.85);
        g = mix(g, g * vec3(0.5, 0.46, 0.4), uEnvSoot);
        g = mix(g, vec3(1.0, 0.94, 0.84) * (0.55 + 0.55 * lumG), uEnvHeat * 0.45);
        diffuseColor.rgb = g * (1.0 - uEnvDim) + uEnvFlash * 0.5;`,
      );
  };
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
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
  let wallLine = 1; // how far the model by the sensor is from a straight wall: 0 a line, 1 a blob (a rock)
  if (wallCells.length >= 4) {
    const mx = wallCells.reduce((a, c) => a + c[0], 0) / wallCells.length;
    const mz = wallCells.reduce((a, c) => a + c[1], 0) / wallCells.length;
    let sxx = 0, sxz = 0, szz = 0;
    for (const [x, z] of wallCells) {
      sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2;
    }
    const spread = Math.hypot((sxx - szz) / 2, sxz);
    wallLine = (sxx + szz) / 2 + spread > 0 ? ((sxx + szz) / 2 - spread) / ((sxx + szz) / 2 + spread) : 1;
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    along.set(Math.cos(angle), Math.sin(angle));
    const out = new THREE.Vector2(-along.y, along.x);
    // Out in the open: on a slope or a cliff, the side where the ground falls away (inside a building,
    // its roof stands in for the ground); on level ground, away from the middle of the place.
    const rise = surface(src.x + out.x * 4, -(src.z + out.y * 4)) - surface(src.x - out.x * 4, -(src.z - out.y * 4));
    if (Math.abs(rise) > 1.5) away.copy(rise < 0 ? out : out.negate());
    else away.copy(out.dot(away) < 0 ? out.negate() : out);
  }
  // A crack or a lean is in the wall itself: at the wall cell nearest the sensor.
  const wallAt =
    (kind === "crack" || kind === "lean") && wallCells.length
      ? wallCells.reduce((best, c) => (Math.hypot(c[0] - src.x, c[1] - src.z) < Math.hypot(best[0] - src.x, best[1] - src.z) ? c : best))
      : null;
  const floorY = floorAt(focusXY[0], focusXY[1]) ?? ground(focusXY[0], focusXY[1]);
  // A crack or a lean is on the wall's face, seen from outside: from 15 m out on each side in turn (the
  // open side first), the first surface a level ray meets near the wall by the sensor. (The wall cell's
  // middle can be inside a thick wall or a tower, and the camera then ended up inside it.)
  const crackBase = wallAt ? new THREE.Vector3(wallAt[0], Math.max(src.y, surface(focusXY[0], focusXY[1]) + 1), wallAt[1]) : null;
  let crackAt: THREE.Vector3 | null = crackBase?.clone() ?? null;
  // The face, and which way it faces (its own normal, level): the crack runs along it, the wall leans
  // out of it and the camera looks at it from there.
  function snapCrack() {
    if (!model || !crackBase) return;
    const probe = new THREE.Raycaster();
    const out0 = Math.atan2(away.y, away.x);
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const a = out0 + (k * Math.PI) / 4;
      const d = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const start = crackBase.clone().add(new THREE.Vector3(d.x * 15, 0, d.y * 15));
      if (start.y < surface(start.x, -start.z) + 0.5) continue; // inside the hill on that side
      probe.set(start, new THREE.Vector3(-d.x, 0, -d.y));
      probe.far = 18;
      const hit = probe.intersectObject(model, true)[0];
      if (!hit || Math.hypot(hit.point.x - crackBase.x, hit.point.z - crackBase.z) > 4) continue;
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
      const face = n && Math.hypot(n.x, n.z) > 0.3 ? new THREE.Vector2(n.x, n.z).normalize() : d.clone();
      if (face.dot(d) < 0) face.negate();
      crackAt = hit.point.clone().add(new THREE.Vector3(face.x * 0.02, 0, face.y * 0.02));
      away.copy(face);
      along.set(face.y, -face.x);
      return;
    }
  }
  snapCrack();
  // The stone the weather wears: the walls from the lowest floor up, and (where the modern shelters are
  // cut off) not the shelters above the walls.
  const floors = [floorY, ...data.rooms.map((r) => floorAt(r.xy[0], r.xy[1]))].filter((v): v is number => v !== null);
  const stoneLow = Math.min(...floors);
  const stoneTop = data.cut_above_m != null && data.rooms.length ? stoneLow + data.cut_above_m : stoneLow + 40;
  // What the weather does to every surface ("See it happen", weather.ts).
  const env = makeEnv();
  // A shaft cut away above an alarm's sensor that ARGUS's model covers from every side (Schenkenberg's
  // crack meter, under the castle's masonry): what of the model stands above `y` within `r` metres of
  // `centre` (wider higher up) is not drawn, so the camera can see down to the sensor. Off (r 0) else.
  const shaft = { centre: { value: new THREE.Vector2() }, r: { value: 0 }, y: { value: 0 } };
  const inShaft = (pt: THREE.Vector3) =>
    shaft.r.value > 0 && pt.y > shaft.y.value && Math.hypot(pt.x - shaft.centre.value.x, pt.z - shaft.centre.value.y) < shaft.r.value + (pt.y - shaft.y.value) * 0.35;
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
    show: { value: 1 },
    pulse: { value: 0.5 },
    source: { value: crackAt ? new THREE.Vector2(crackAt.x, crackAt.z) : new THREE.Vector2(src.x, src.z) },
    sourceY: { value: crackAt ? crackAt.y : src.y },
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
    // ARGUS's model is photographs: their light is the day's own, so they are shown as they are. Lit a
    // second time by the scene's sun and shadows, every side away from it went dark (Ranverso's church
    // almost black); unlit, each place is as bright as it was photographed.
    const asPhoto = new Map<THREE.Material, THREE.MeshBasicMaterial>();
    const photoOf = (m: THREE.Material) => {
      let u = asPhoto.get(m);
      if (!u) {
        const lit = m as THREE.MeshStandardMaterial;
        u = new THREE.MeshBasicMaterial({
          map: lit.map ?? null,
          color: lit.color ? lit.color.clone() : 0xffffff,
          vertexColors: lit.vertexColors,
          // both sides: from low down, through a gap under the model's ragged edge, its ground is seen from
          // below (some of ARGUS's models are one-sided, and the sky showed through them there)
          side: THREE.DoubleSide,
          transparent: lit.transparent,
          opacity: lit.opacity,
          alphaTest: lit.alphaTest,
          toneMapped: false,
        });
        asPhoto.set(m, u);
        m.dispose();
      }
      return u;
    };
    const patched = new Set<THREE.Material>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(photoOf) : photoOf(mesh.material);
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
            uShow: damage.show, uPulse: damage.pulse, uMarkWeather: { value: kind === "stone" ? 1 : 0 },
            uEnvWet: env.wet, uEnvFrost: env.frost, uEnvSoot: env.soot, uEnvHeat: env.heat, uEnvFade: env.fade,
            uEnvDampLow: env.dampLow, uEnvDim: env.dim, uEnvFlash: env.flash,
            uEnvCreep: env.creep, uEnvSink: env.sink, uGeoCentre: env.geoCentre, uGeoDir: env.geoDir, uGeoR: env.geoR,
            uShaftC: shaft.centre, uShaftR: shaft.r, uShaftY: shaft.y,
            uCave: env.cave, uCaveC: env.caveC, uCaveR: env.caveR, uHollow: env.hollow, uInCellar: env.inCellar,
            uStoneReach: { value: Math.max(20, dist(focusXY, houseCentre) + 25) },
            uStoneLow: { value: stoneLow },
            uStoneTop: { value: stoneTop },
          });
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vWorld;\nuniform float uLean, uGround;\nuniform vec2 uSource, uLeanDir;" + GEO_GLSL + CAVE_VERTEX,
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
              }
              if (uEnvCreep > 0.0 || uEnvSink > 0.0) {
                vec4 wg = modelMatrix * vec4(transformed, 1.0);
                transformed += inverse(mat3(modelMatrix)) * geoShift(wg.xyz, uGround);
              }
              ${anyCellar ? CAVE_BEGIN : ""}`,
            )
            .replace(
              "#include <worldpos_vertex>",
              "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>\nvarying vec3 vWorld;\nuniform float uWet, uLoss, uSalt, uDamp, uGround, uFlake, uWear, uWeather, uCrack, uCrackW, uSourceY, uReach, uLean, uShow, uPulse, uMarkWeather, uStoneReach, uStoneLow, uStoneTop, uEnvWet, uEnvFrost, uEnvSoot, uEnvHeat, uEnvFade, uEnvDampLow, uEnvDim, uEnvFlash, uEnvCreep, uEnvSink, uGeoR, uShaftR, uShaftY, uInCellar, uCaveR, uHollow; uniform vec3 uCaveC; uniform vec2 uGeoCentre, uGeoDir, uShaftC;\nuniform vec2 uSource, uWallDir, uLeanDir;\nvarying float vCellar;\n${NOISE}`,
            )
            .replace("#include <color_fragment>", `#include <color_fragment>
${anyCellar ? CAVE_FRAGMENT : ""}`)
            .replace(
              "#include <map_fragment>",
              `#include <map_fragment>
              if (uShaftR > 0.0 && vWorld.y > uShaftY && distance(vWorld.xz, uShaftC) < uShaftR + (vWorld.y - uShaftY) * 0.35) discard;
              vec3 base0 = diffuseColor.rgb;
              vec3 col = base0;
              ${damageGlsl(false)}
              // which way the surface faces, from the model's shape itself (one of ARGUS's models has no
              // normals), turned towards the camera
              vec3 nW = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
              if (dot(nW, cameraPosition - vWorld) < 0.0) nW = -nW;
              float flatUp = smoothstep(0.80, 0.95, nW.y);
              float wall = 1.0 - flatUp;
              // the stain is on the floors at the damp floor's level, never on a roof above it
              float nearFloor = 1.0 - smoothstep(0.6, 1.6, abs(vWorld.y - uGround));
              diffuseColor.rgb = mix(base0, diffuseColor.rgb, flatUp * nearFloor);
              vec3 c = diffuseColor.rgb;
              // where the damage is, from 0 to 1: marked in red when the player asks
              float harm = wet * flatUp * nearFloor;
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
                harm = max(harm, wetWall * smoothstep(0.05, 0.3, damp));
                c *= mix(vec3(1.0), vec3(0.58, 0.56, 0.52), wetWall);
                float band = smoothstep(0.08, 0.0, abs(y - edge - 0.04)) * uSalt * step(-0.3, y);
                c = mix(c, vec3(0.95, 0.94, 0.91), band * (0.5 + 0.4 * vnoise(vWorld.xz * 11.0 + vWorld.y * 9.0)));
              }
              if (uFlake > 0.0) {
                // paint and plaster pushed off by the salt where the damp wall dries: around and below the tide
                // line, the stone under it showing
                float zone = (1.0 - smoothstep(edge + 0.1, edge + 0.4, y)) * step(-0.3, y);
                float fl = uFlake * near * wall * zone;
                harm = max(harm, zone * near * wall * smoothstep(0.0, 0.1, uFlake));
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
                harm = max(harm, worn);
                float lum = dot(c, vec3(0.299, 0.587, 0.114));
                c = mix(c, vec3(min(1.0, lum * 1.3 + 0.06)) * vec3(1.02, 1.0, 0.94), worn * 0.7);
              }
              if (uWeather > 0.0) {
                // weathered stone: a few millimetres of its surface gone (uWeather 1 = 5 mm): paler, rain-
                // streaked, its surface pitted and flaking in places
                float w = uWeather * (0.55 + 0.45 * near);
                // marked on the stone the wind wears: walls and wall tops near the weather station, not
                // the ground, nor anything higher up (the House of the Masks' shelter roof is not stone)
                float stoneUp = wall * smoothstep(uStoneLow + 0.1, uStoneLow + 0.4, vWorld.y) * (1.0 - smoothstep(uStoneTop - 0.8, uStoneTop, vWorld.y));
                // (the whole house the wind blows on, not only what stands by the station)
                float nearS = 1.0 - smoothstep(uStoneReach * 0.7, uStoneReach, dist0);
                harm = max(harm, uMarkWeather * smoothstep(0.0, 0.5, uWeather) * nearS * stoneUp);
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
                harm = max(harm, onWall * (1.0 - smoothstep(0.12, 0.45, d)));
                // a shadowed edge either side, then the open crack itself
                c *= 1.0 - 0.35 * (1.0 - smoothstep(width * 1.5, width * 6.0, d)) * onWall;
                c = mix(c, vec3(0.04, 0.035, 0.03), (1.0 - smoothstep(width * 0.5, width, d)) * onWall);
              }
              // the leaning wall itself: a few metres of it either side of the tiltmeter, not everything near
              if (uLean > 0.0) harm = max(harm, wall * (1.0 - smoothstep(3.0, 6.0, abs(along))) * (1.0 - smoothstep(0.8, 1.8, across)) * smoothstep(0.2, 0.8, y) * (1.0 - smoothstep(4.0, 6.0, abs(vWorld.y - uSourceY))) * smoothstep(0.0, 0.004, uLean));
              // the weather (weather.ts): wet surfaces darker, frost and snow white on what faces up, soot,
              // heat bleaching warm, strong sun fading the colours, damp rising from the floor, a storm's
              // dark light and its lightning
              float lumE = dot(c, vec3(0.299, 0.587, 0.114));
              c *= 1.0 - 0.4 * uEnvWet;
              c = mix(c, vec3(0.93, 0.95, 0.98), uEnvFrost * (0.2 * wall + 0.85 * flatUp));
              c = mix(c, c * vec3(0.5, 0.46, 0.4), uEnvSoot);
              c = mix(c, vec3(1.0, 0.94, 0.84) * (0.55 + 0.55 * lumE), uEnvHeat * 0.45);
              c = mix(c, vec3(lumE) * 1.08 + 0.07, uEnvFade);
              c *= 1.0 - 0.38 * uEnvDampLow * (1.0 - smoothstep(uGround + 0.4, uGround + 1.4, vWorld.y)) * step(uGround - 0.5, vWorld.y);
              c = c * (1.0 - uEnvDim) + uEnvFlash * 0.55;
              if (uEnvCreep > 0.0) {
                // the tear across the slope, opening as the ground below it slides away
                vec2 relC = vWorld.xz - uGeoCentre;
                float inC = 1.0 - smoothstep(uGeoR * 0.7, uGeoR, length(relC));
                float acrossC = dot(relC, uGeoDir) + (vnoise(vec2(dot(relC, vec2(-uGeoDir.y, uGeoDir.x)) * 0.7, 2.0)) - 0.5) * 1.2;
                float tear = (1.0 - smoothstep(0.0, 0.04 + uEnvCreep * 0.3, abs(acrossC))) * inC;
                c = mix(c, vec3(0.06, 0.05, 0.04), tear);
                harm = max(harm, max(tear, 0.2 * inC * smoothstep(-1.5, 1.5, dot(relC, uGeoDir))) * smoothstep(0.0, 0.08, uEnvCreep));
              }
              if (uEnvSink > 0.0) {
                // cracks in a ring where the ground bends most, wider as it sinks
                float rS = length(vWorld.xz - uGeoCentre);
                float ringS = abs(rS - uGeoR * 0.55 + (vnoise(vWorld.xz * 0.8) - 0.5) * 1.6);
                float crS = (1.0 - smoothstep(0.0, 0.03 + uEnvSink * 0.2, ringS)) * smoothstep(0.0, 0.05, uEnvSink);
                c = mix(c, vec3(0.06, 0.05, 0.04), crS);
                harm = max(harm, max(crS, 0.18 * (1.0 - smoothstep(uGeoR * 0.25, uGeoR * 0.7, rS))) * smoothstep(0.0, 0.08, uEnvSink));
              }
              c = mix(c, vec3(1.0, 0.12, 0.3), clamp(harm, 0.0, 1.0) * uShow * (0.35 + 0.3 * uPulse));
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
    for (let t = 0; t < 1; t += 0.7 / Math.max(len, 0.7)) tops.push(a.clone().lerp(b, t).setY(base + WALL_H + 0.02));
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
  // Each sensor a pin to press, over it: it opens a card of what the sensor is, above it (or below, near the
  // top), kept inside the picture. Pins that come within a pin's width of one another in the picture (sensors
  // at one spot, or far away) become one pin with their number, and its card tells of them all; they part
  // as the camera comes nearer. One card at a time; it closes with a second press, Escape, a press anywhere
  // in the picture, or when the camera flies off.
  interface PinMade {
    el: HTMLElement;
    object: CSS2DObject;
    button: HTMLButtonElement;
    card: HTMLElement;
    at: THREE.Vector3;
    sensors: HouseSensor[];
    /** which pins it stands for now (their indexes), to see when that changes */
    stands: string;
  }
  const made: PinMade[] = [];
  let openPin: PinMade | null = null;
  const closePin = () => {
    if (!openPin) return;
    openPin.card.hidden = true;
    openPin.button.setAttribute("aria-expanded", "false");
    openPin.button.classList.remove("is-open");
    openPin = null;
  };
  const cardSpot = new THREE.Vector3();
  /** Keeps all of the open card in the free part of the picture, between the title and the panel
   *  (placeCardIn): beside its pin where it fits, scrolling inside itself where nothing is big enough. */
  function placeCard() {
    if (!openPin) return;
    const { el, card, at: pos } = openPin;
    cardSpot.copy(pos).project(camera);
    const x = (cardSpot.x * 0.5 + 0.5) * size.width;
    const y = (-cardSpot.y * 0.5 + 0.5) * size.height;
    // (the card's whole height, also when it is cut and scrolls: its content and its border)
    const height = card.scrollHeight + card.offsetHeight - card.clientHeight;
    const box = placeCardIn({ x, y }, el.offsetHeight / 2 + 10, { width: card.offsetWidth, height }, { left: 0, top: insetTop, right: size.width, bottom: size.height - insetBottom });
    // (from the pin's corner: CSS2DRenderer centres the pin on its point)
    card.style.left = `${box.left - (x - el.offsetWidth / 2)}px`;
    card.style.top = `${box.top - (y - el.offsetHeight / 2)}px`;
    card.style.maxWidth = `min(17rem, ${box.maxWidth}px)`;
    card.style.maxHeight = `${box.maxHeight}px`;
    // a cut card takes the pointer, to be scrolled; a whole one lets the pins under it be pressed
    card.classList.toggle("is-cut", card.scrollHeight > card.clientHeight + 1);
  }
  const PIN_PX = 32;
  const spots: { x: number; y: number; ok: boolean }[] = [];
  /** Which pins stand alone and which stand for others near them (in the picture, as the camera is now). */
  function mergePins() {
    spots.length = 0;
    for (const m of made) {
      cardSpot.copy(m.at).project(camera);
      spots.push({ x: (cardSpot.x * 0.5 + 0.5) * size.width, y: (-cardSpot.y * 0.5 + 0.5) * size.height, ok: cardSpot.z >= -1 && cardSpot.z <= 1 });
    }
    const taken = new Set<number>();
    made.forEach((m, i) => {
      const lead = spots[i].ok && !taken.has(i);
      m.object.visible = lead;
      if (!lead) return;
      const into = [i];
      made.forEach((_, j) => {
        if (j === i || taken.has(j) || !spots[j].ok || Math.hypot(spots[j].x - spots[i].x, spots[j].y - spots[i].y) >= PIN_PX) return;
        taken.add(j);
        into.push(j);
      });
      const stands = into.join(",");
      if (stands === m.stands) return;
      m.stands = stands;
      if (openPin === m) closePin();
      const list = into.flatMap((j) => made[j].sensors);
      const face = makeFace(list.map((x) => ({ kind: x.kind, type: x.type ?? null, where: x.where ?? x.room_name ?? null, room: x.room, serial: x.serial ?? null, alarm: x === focusSensor })));
      m.button.innerHTML = face.icon;
      m.button.setAttribute("aria-label", face.name);
      m.button.classList.toggle("is-alarm", list.some((x) => x === focusSensor));
      m.card.replaceChildren(face.card);
    });
    for (const m of made) if (!m.object.visible) m.stands = "";
    if (openPin && !openPin.object.visible) closePin();
  }
  const makeFace = options.sensorPin ?? (() => ({ icon: "", name: "", card: document.createElement("div") }));
  if (pins && options.sensorPin) {
    // (sensors at one spot, ARGUS's several instruments on one device, start as one)
    const groups: { at: THREE.Vector3; list: HouseSensor[] }[] = [];
    for (const s of data.sensors3d) {
      const p = sensorAt(s);
      const g = groups.find((x) => x.at.distanceTo(p) < 0.5);
      if (g) g.list.push(s);
      else groups.push({ at: p.clone(), list: [s] });
    }
    groups.forEach((g, i) => {
      const el = document.createElement("div");
      el.className = "view3d-pin";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pin pin-argus view3d-pin-btn";
      button.setAttribute("aria-expanded", "false");
      const card = document.createElement("div");
      card.className = "view3d-pin-card";
      card.id = `view3d-sensor-${i}`;
      card.hidden = true;
      button.setAttribute("aria-controls", card.id);
      el.append(button, card);
      const object = new CSS2DObject(el);
      object.position.copy(g.at);
      pinScene.add(object);
      const pin: PinMade = { el, object, button, card, at: g.at, sensors: g.list, stands: "" };
      made.push(pin);
      button.addEventListener("click", () => {
        const was = openPin === pin;
        closePin();
        if (was) return;
        card.hidden = false;
        button.setAttribute("aria-expanded", "true");
        button.classList.add("is-open");
        openPin = pin;
        placeCard();
      });
      // Escape closes the card first (and only then the view, on the next press)
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !openPin) return;
        e.preventDefault();
        e.stopPropagation();
        const focusBack = openPin.button;
        closePin();
        focusBack.focus();
      });
    });
    canvas.addEventListener("pointerdown", closePin);
  }

  // Plants rooting in the wall tops when nobody looks after them: tufts of weeds (bushes for the
  // "trees" danger), blades and leaves drawn on three crossed cards, standing on the wall tops. Where
  // the day's damage feeds them (damp), they start there and spread out from it (the nearest tops
  // first); on a place only looked at, anywhere. Marked in red with the rest of the damage.
  const rnd = seeded(11);
  const fromDamage = kind !== null && kind !== "tree";
  const order = tops.map((p) => ({ p, d: fromDamage ? Math.hypot(p.x - src.x, p.z - src.z) + rnd() * 4 : rnd() }));
  order.sort((a, b) => a.d - b.d);
  order.forEach((o, i) => (tops[i] = o.p));
  const tuftCanvas = document.createElement("canvas");
  tuftCanvas.width = tuftCanvas.height = 128;
  const brush = tuftCanvas.getContext("2d")!;
  const rb = seeded(5);
  brush.lineCap = "round";
  for (let i = 0; i < 30; i++) {
    const x0 = 64 + (rb() - 0.5) * 60;
    const h = 40 + rb() * 82;
    const lean = (rb() - 0.5) * 64;
    brush.strokeStyle = `hsl(${78 + rb() * 50}, ${38 + rb() * 32}%, ${18 + rb() * 26}%)`;
    brush.lineWidth = 3 + rb() * 5;
    brush.beginPath();
    brush.moveTo(x0, 128);
    brush.quadraticCurveTo(x0 + lean * 0.2, 128 - h * 0.55, x0 + lean, 128 - h);
    brush.stroke();
  }
  const tuftTex = new THREE.CanvasTexture(tuftCanvas);
  tuftTex.colorSpace = THREE.SRGBColorSpace;
  const tuft = mergeGeometries([0, 1, 2].map((i) => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY((i * Math.PI) / 3)));
  const plantMat = new THREE.MeshLambertMaterial({ map: tuftTex, alphaTest: 0.35, side: THREE.DoubleSide });
  // how big they have grown (1: as drawn) and how the wind sways them ("See it happen", weather.ts)
  const plantGrow = { value: 1 };
  const plantSway = { value: 0 };
  const plantTime = { value: 0 };
  plantMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uShow: damage.show, uPulse: damage.pulse, uGrow: plantGrow, uSway: plantSway, uTime: plantTime });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uGrow, uSway, uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed *= uGrow;
        float swayK = uSway * transformed.y * (0.6 + 0.4 * sin(uTime * 1.3 + float(gl_InstanceID) * 2.1));
        transformed.x += swayK * sin(uTime * 3.1 + float(gl_InstanceID)) * 0.35;
        transformed.z += swayK * 0.25;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uShow, uPulse;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.12, 0.3), uShow * (0.35 + 0.3 * uPulse));");
  };
  const plants = new THREE.InstancedMesh(tuft, plantMat, Math.max(tops.length, 1));
  const m4 = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  // a weed tuft about half a metre high; for the "trees" danger, shrubs over the walls
  const tall = (model ? 0.55 : 0.4) * (kind === "tree" ? 3 : 1);
  tops.forEach((p, i) => {
    const k = tall * (0.7 + rnd() * 0.6);
    scale.set(k * (0.8 + rnd() * 0.4), k, k * (0.8 + rnd() * 0.4));
    turn.setFromAxisAngle(SKY, rnd() * Math.PI);
    plants.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x + rnd() * 0.16 - 0.08, p.y - 0.03, p.z + rnd() * 0.16 - 0.08), turn, scale));
  });
  plants.count = 0;
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


  // Labels at the damage, a picture sign and a few words a child can read ("💧 The water rises"),
  // shown once there is damage to see: one for the day's danger, one for the plants on the walls.
  const onModel = (xy: XY) => !model || floorAt(xy[0], xy[1]) !== null;
  function kidTag(text: string, pos: THREE.Vector3): CSS2DObject {
    const tag = document.createElement("div");
    tag.className = "view3d-tag view3d-kid";
    tag.textContent = text;
    const label = new CSS2DObject(tag);
    label.position.copy(pos);
    label.visible = false;
    scene.add(label);
    return label;
  }
  const kidMain =
    options.damageLabel && kind && kind !== "tree"
      ? kidTag(
          options.damageLabel(kind),
          (kind === "crack" || kind === "lean") && crackAt
            ? crackAt.clone().add(new THREE.Vector3(away.x * 0.5, 1.2, away.y * 0.5))
            : kind === "mosaic" && dampRoom
              ? at(dampRoom.xy, 3.4) // above the room's own label
              : kind === "stone"
                ? at(onModel(houseCentre) ? houseCentre : focusXY, 4)
                : src.clone().setY(Math.max(src.y, surface(focusXY[0], focusXY[1])) + 1.6),
        )
      : null;
  // the wall top nearest the damage, away from the rooms' labels so the two never cover each other
  // The plants' label stands over one of the first plants to grow (never over a wall top where no plant
  // is), away from the rooms' labels so the two never cover each other.
  const firstGrown = Math.max(1, Math.ceil(tops.length * 0.1));
  const freeAt = tops.findIndex((p, i) => i < firstGrown && data.rooms.every((r) => Math.hypot(p.x - r.xy[0], -p.z - r.xy[1]) > 4));
  const plantAt = tops.length ? Math.max(0, freeAt) : -1;
  const kidPlants =
    options.damageLabel && plantAt >= 0
      ? kidTag(options.damageLabel(kind === "tree" ? "tree" : "plants"), tops[plantAt].clone().setY(tops[plantAt].y + tall + 0.6))
      : null;

  // ---------------------------------------------------------------- the alarm going off at its sensor
  // Red waves spreading over the ground from the sensor, one after another (as on the map), and a beam of
  // light standing over it that fades upwards. Hidden until setAlarm(true).
  const alarmGroup = new THREE.Group();
  alarmGroup.visible = false;
  const alarmFoot = at(focusSensor ? focusXY : [src.x, -src.z], 0.12);
  alarmGroup.position.copy(alarmFoot);
  const ALARM_RED = new THREE.Color("#ff2a3d");
  const waveReach = 4 + 2 * VIEW; // metres the waves spread to
  const waves = [0, 1, 2].map(() => {
    const wave = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ALARM_RED, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    wave.renderOrder = 5;
    alarmGroup.add(wave);
    return wave;
  });
  const beamHeight = Math.max(18, 14 * VIEW);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * VIEW, 0.35 * VIEW, beamHeight, 24, 1, true).translate(0, beamHeight / 2, 0),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ALARM_RED }, uPulse: { value: 1 }, uHeight: { value: beamHeight } },
      vertexShader: "varying float vUp; uniform float uHeight; void main() { vUp = position.y / uHeight; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "varying float vUp; uniform vec3 uColor; uniform float uPulse; void main() { gl_FragColor = vec4(uColor, (1.0 - vUp) * (1.0 - vUp) * 0.55 * uPulse); }",
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.renderOrder = 6;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28 * Math.min(VIEW, 2), 20, 14),
    new THREE.MeshBasicMaterial({ color: ALARM_RED, toneMapped: false }),
  );
  core.position.y = Math.max(0.3, src.y - alarmFoot.y);
  alarmGroup.add(beam, core);
  scene.add(alarmGroup);
  function alarmFrame(now: number) {
    if (!alarmGroup.visible) return;
    const still = !!options.still;
    waves.forEach((wave, i) => {
      // each wave 1.8 s from the sensor out to its reach, a third of that after the one before; held
      // at three sizes when the player asked for less motion
      const t = still ? (i + 1) / 3.5 : (now / 1800 + i / 3) % 1;
      wave.scale.setScalar(0.6 + t * waveReach);
      (wave.material as THREE.MeshBasicMaterial).opacity = still ? 0.7 : 0.9 * (1 - t) ** 1.5;
    });
    const pulse = still ? 1 : 0.75 + 0.25 * Math.sin(now / 220);
    (beam.material as THREE.ShaderMaterial).uniforms.uPulse.value = pulse;
    core.scale.setScalar(still ? 1 : 0.85 + 0.3 * pulse);
  }

  // ---------------------------------------------------------------- the camera: from straight above down to the rooms
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 2;
  controls.maxDistance = 400;
  controls.listenToKeyEvents(canvas); // arrow keys move the view while the canvas has the focus
  controls.autoRotateSpeed = -0.8; // orbit(): once round in about 75 s
  controls.addEventListener("start", () => (controls.autoRotate = false)); // the player has it now
  // The camera comes to rest looking at the damage: between the two rooms nearest it where ARGUS names
  // rooms, else at the alarm's sensor (or the middle of the place).
  // rooms, else at the alarm's sensor where the damage is on the building by it (and ARGUS's model is
  // there); for damage all over (weathered stone, plants) or a sensor off the model, at the building.
  const modelMiddle: XY = model ? [(footprint.min.x + footprint.max.x) / 2, -(footprint.min.z + footprint.max.z) / 2] : houseCentre;
  const local = kind === "mosaic" || kind === "fresco" || kind === "floor" || kind === "crack" || kind === "lean";
  // On ARGUS's model of the House of the Masks, straight to the room of the damage (from above, over
  // the cut walls, to see its floor).
  const roomView = kind === "mosaic" && !!dampRoom && !!model;
  const onSensor = local && !!(focusSensor || at0) && onModel(focusXY);
  // A place only looked at, or whose damage is all over it, or whose alarm's sensor is not on ARGUS's
  // model, is seen whole: from its long side (the main axis of where the model stands up from its
  // ground), from the side where the ground falls away (out in the open, not from inside the hill behind
  // it), and far enough back to fit it on the screen. The House of the Masks, with its rooms, keeps its
  // own view down into them.
  const alarmView = !!options.alarm && !!(focusSensor || at0);
  const wholePlace = !!model && !data.rooms.length && !onSensor && !alarmView && standing.length >= 8;
  let placeLook: THREE.Vector3 | null = null;
  const placeSide = new THREE.Vector2(-14, 18.5).normalize(); // scene x and z: from the south-west
  const placeSpan = { width: 0, depth: 0, height: 0 };
  const placeKnown = !!model && standing.length >= 8;
  if (placeKnown) {
    const n = standing.length;
    const mx = standing.reduce((a, c) => a + c.x, 0) / n;
    const mz = standing.reduce((a, c) => a + c.z, 0) / n;
    let sxx = 0, sxz = 0, szz = 0;
    for (const c of standing) {
      sxx += (c.x - mx) ** 2; sxz += (c.x - mx) * (c.z - mz); szz += (c.z - mz) ** 2;
    }
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const axis = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
    const normal = new THREE.Vector2(-axis.y, axis.x);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, low = Infinity, high = -Infinity;
    for (const c of standing) {
      const a = (c.x - mx) * axis.x + (c.z - mz) * axis.y;
      const b = (c.x - mx) * normal.x + (c.z - mz) * normal.y;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      low = Math.min(low, c.low); high = Math.max(high, c.high);
    }
    const cx = mx + axis.x * ((a0 + a1) / 2) + normal.x * ((b0 + b1) / 2);
    const cz = mz + axis.y * ((a0 + a1) / 2) + normal.y * ((b0 + b1) / 2);
    Object.assign(placeSpan, { width: a1 - a0, depth: b1 - b0, height: high - low });
    placeLook = new THREE.Vector3(cx, low + (high - low) * 0.4, cz);
    const out = (b1 - b0) / 2 + 15;
    const groundOn = (s: number) => surface(cx + s * normal.x * out, -(cz + s * normal.y * out));
    placeSide.copy(normal).multiplyScalar(groundOn(1) <= groundOn(-1) ? 1 : -1);
  }
  // The wind and the weather wear the stone all over: the camera goes to the weather station and looks
  // back from beyond it at the walls nearest it (where the wear is marked).
  const atStation = kind === "stone" && !!focusSensor;
  // By the sensor the model is no clear wall (a rock face, a corner): the face seen from the place's own
  // open side instead, the side the whole place is best seen from (and the wall leans out that way).
  if (((wallAt && (kind === "crack" || kind === "lean")) || (kind === "fresco" && onSensor)) && wallCells.length >= 4 && wallLine > 0.35 && placeKnown) {
    away.copy(placeSide);
    along.set(away.y, -away.x);
    snapCrack();
    if (crackAt) {
      damage.source.value.set(crackAt.x, crackAt.z);
      damage.sourceY.value = crackAt.y;
    }
  }
  const endLook = alarmView
    ? src.clone().setY(Math.max(src.y, surface(focusXY[0], focusXY[1]) + 0.4))
    : roomView
    ? at(dampRoom!.xy, 0.2)
    : atStation
      ? at([(focusXY[0] + houseCentre[0]) / 2, (focusXY[1] + houseCentre[1]) / 2], 1)
      : dampRoom && nextRoom
      ? at([(dampRoom.xy[0] + nextRoom.xy[0]) / 2, (dampRoom.xy[1] + nextRoom.xy[1]) / 2], 0.4)
      : (kind === "crack" || kind === "lean") && crackAt
        ? crackAt.clone()
        : onSensor
          ? src.clone().setY(Math.max(src.y, surface(focusXY[0], focusXY[1]) + 0.4))
          : ((wholePlace ? placeLook : null) ?? at(onModel(houseCentre) ? houseCentre : modelMiddle, 0.4));
  // How far away the camera comes to rest: a crack is millimetres wide, so about 8 m; a lean is a whole
  // wall a few degrees off true, about 14 m; for damp, paint or a worn floor at the sensor, about 17 m;
  // else about 28 m (further over a bigger place); a place seen whole, as far as it takes to fit it.
  const close = (kind === "crack" || kind === "lean") && !!crackAt;
  const restAt = alarmView
    ? 26 * VIEW
    : close
    ? kind === "lean" ? 14 : 8
    : atStation
      ? 20 + dist(focusXY, houseCentre) / 2
      : (kind === "mosaic" || kind === "fresco" || kind === "floor") && focusSensor && onModel(focusXY) ? Math.max(17, 14 * VIEW) : 28 * VIEW;
  // From which side: in front of the damaged wall where the damage is in a wall (a crack, a lean, damp
  // paint), out from its long side for a place seen whole, else from the south-west; looking down at
  // 20-34 degrees. Then the first of these from which nothing of ARGUS's model stands between the camera
  // and the damage (a building, a wall, a roof; never what the cut leaves out) and the camera is not
  // under the ground: that side, then the others, then higher up.
  const cutTop = model && data.cut_above_m != null ? floorY + data.cut_above_m : Infinity;
  const faceWall = (close || (kind === "fresco" && onSensor)) && wallCells.length >= 4;
  // (an alarm: from out beyond its sensor, away from the middle of ARGUS's model, looking back at it with
  // the place behind it)
  const outward = new THREE.Vector2(focusXY[0] - modelMiddle[0], -(focusXY[1] - modelMiddle[1]));
  // (on a cliff, over 40 degrees, as the Conventillo's on Monte Morra, from the downhill side, facing the
  // cliff: from along it the ground is seen at a grazing angle, stretched, and from above nothing of the
  // face. Schenkenberg's hill, 20 degrees, is no cliff.)
  const G = 6;
  const slopeX = (ground(focusXY[0] + G, focusXY[1]) - ground(focusXY[0] - G, focusXY[1])) / (2 * G);
  const slopeY = (ground(focusXY[0], focusXY[1] + G) - ground(focusXY[0], focusXY[1] - G)) / (2 * G);
  const steepAlarm = alarmView && Math.hypot(slopeX, slopeY) > 0.85;
  if (steepAlarm) outward.set(-slopeX, slopeY).setLength(10);
  const first =
    alarmView && outward.lengthSq() > 1
      ? Math.atan2(outward.y, outward.x)
      : faceWall || atStation || alarmView
      ? Math.atan2(away.y, away.x)
      : wholePlace
        ? Math.atan2(placeSide.y, placeSide.x)
        : Math.atan2(18.5, -14);
  // (on a steep slope only the downhill side and the two next to it: from the others the slope is seen
  // along or from above)
  const sides = (steepAlarm ? [0, 1, -1] : [0, 1, -1, 2, -2, 3, -3, 4]).map((k) => first + (k * Math.PI) / 4);
  // (an alarm's sensor in a narrow gap between walls, as Schenkenberg's crack meter, is clear only from
  // high up: from there the camera keeps its distance and its way down stays above the walls)
  const heights = alarmView ? [26, 38, 50, 65, 78, 88] : roomView ? [55, 70] : close ? [20, 35, 50, 70] : faceWall || atStation ? [32, 45, 60, 70] : wholePlace ? [30, 45, 60] : [34, 50, 70];
  const ray = new THREE.Raycaster();
  // How far the camera can go back that way before something of the model stands in between.
  // `near`: what of the model stands within that many metres of the damage does not count.
  const openFor = (dir: THREE.Vector3, near = 0.6) => {
    if (!model || wholePlace) return Infinity; // a place seen whole is seen from outside it: its front walls may stand in front
    ray.set(endLook, dir);
    ray.far = restAt;
    const hit = ray.intersectObject(model, true).find((h) => h.distance > near && h.point.y < cutTop);
    return hit ? hit.distance : Infinity;
  };
  const aboveGround = (dir: THREE.Vector3, d: number) => {
    const p = endLook.clone().addScaledVector(dir, d);
    return p.y > surface(p.x, -p.z) + 1.5;
  };
  // The first side that is open all the way; where none is, the one open furthest, and the camera stops
  // in front of what stands in the way (before, it took the last side tried, wherever that was).
  const END_DIR = new THREE.Vector3(-14, 15.5, 18.5).normalize();
  let restCap = Infinity;
  let best = { dir: END_DIR.clone(), open: -1 };
  let found = false;
  search: for (const h of heights) {
    for (const az of sides) {
      const e = (h * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az));
      if (!aboveGround(dir, wholePlace ? 40 : Math.min(restAt, 12))) continue;
      const open = openFor(dir);
      if (open === Infinity) {
        END_DIR.copy(dir);
        found = true;
        break search;
      }
      if (open > best.open) best = { dir, open };
    }
  }
  // An alarm's sensor seen from no side: on a cliff (the Conventillo's tilt meter, three floors up inside
  // the rock-cut building), the building it is in seen from downhill, the beam rising out of it (its walls,
  // within 6 m of the sensor, may stand in front); elsewhere (Schenkenberg's crack meter, in a narrow gap
  // between walls), down a shaft cut away above it.
  if (!found && alarmView && model && steepAlarm) {
    for (const h of heights) {
      for (const az of sides) {
        const e = (h * Math.PI) / 180;
        const dir = new THREE.Vector3(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az));
        if (aboveGround(dir, Math.min(restAt, 12)) && openFor(dir, 6) === Infinity) {
          END_DIR.copy(dir);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  if (!found && alarmView && model) {
    // covered from every side: down a shaft cut away above it, from high up and nearly straight above
    shaft.centre.value.set(endLook.x, endLook.z);
    shaft.r.value = 2.5;
    shaft.y.value = endLook.y + 2;
    const e = (84 * Math.PI) / 180;
    END_DIR.set(Math.cos(e) * Math.cos(first), Math.sin(e), Math.cos(e) * Math.sin(first));
  } else if (!found && best.open > 0) {
    END_DIR.copy(best.dir);
    restCap = Math.max(3, best.open - 1);
  }
  /** How far back the camera comes to rest on a screen of this shape: a place seen whole, as far as it
   *  takes to fit it across and up the screen; else restAt, further back on an upright screen so the
   *  damage's surroundings still fit across it. */
  const restDistance = (aspect: number) => {
    if (!wholePlace) return Math.min(restCap, restAt * Math.max(1, 0.95 / aspect));
    const vHalf = (camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const e = Math.asin(END_DIR.y);
    const across = placeSpan.width / 2 + 3;
    const up = (placeSpan.height * Math.cos(e) + placeSpan.depth * Math.sin(e)) / 2 + 3;
    return Math.min(220, Math.max(20, Math.max(across / Math.tan(hHalf), up / Math.tan(vHalf)) * 1.15));
  };

  // A magnifier for a crack, millimetres wide: a second camera 2.2 m from it, drawn in a square at the
  // top right, without the red sign. Closer, not bigger: the crack stays its true size. (Not for the
  // stone's surface: millimetres of it are finer than ARGUS's model, at any distance.)
  let magTarget: THREE.Vector3 | null = null;
  let magFrom: THREE.Vector3 | null = null;
  if (model && kind === "crack" && crackAt) {
    magTarget = crackAt.clone();
    magFrom = magTarget.clone().add(new THREE.Vector3(away.x * 2.2, 0.3, away.y * 2.2));
    // nothing between the magnifier and the crack (else a little closer)
    const toMag = magFrom.clone().sub(magTarget);
    ray.set(magTarget.clone().addScaledVector(toMag.clone().normalize(), 0.05), toMag.clone().normalize());
    ray.far = toMag.length();
    const inWay = ray.intersectObject(model, true)[0];
    if (inWay) magFrom = magTarget.clone().addScaledVector(toMag.normalize(), Math.max(0.6, inWay.distance - 0.2));
  }
  const magCam = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  if (magTarget && magFrom) {
    magCam.position.copy(magFrom);
    magCam.lookAt(magTarget);
  }
  const magTimes = magTarget ? Math.max(2, Math.round(restAt / 2.2)) : 0;
  const magFrame = document.createElement("div");
  magFrame.className = "view3d-magnifier";
  magFrame.setAttribute("aria-hidden", "true");
  if (options.magnifierLabel && magTimes) magFrame.appendChild(document.createElement("span")).textContent = options.magnifierLabel(magTimes);
  magFrame.hidden = true;
  host.appendChild(magFrame);
  let insetTop = 0;
  let insetBottom = 0; // (what the panel covers, from the bottom)
  const magRect = () => {
    const side = Math.round(Math.min(0.36 * Math.min(size.width, size.height), 260));
    return { x: size.width - side - 12, y: insetTop + 12, side };
  };
  const endPos = new THREE.Vector3();
  const topLook = at(houseCentre);
  const topPos = topLook.clone().setY(topLook.y + 200);
  const look = topLook.clone();
  let size = { width: 1, height: 1 };
  let lastView: MapView | null = null;
  let above = true; // looking straight down (before flyIn, after flyOut)

  // Where a cellar can be seen caving in (Baltanás): the roomiest stretch well inside a cellar (2.2-6 m
  // between its floor and its ceiling, with room all round it), and a place 2.5-5.5 m along the cellar from
  // it, with nothing of the model in between, where the camera stands to watch.
  let cellarPlan: { floor: THREE.Vector3; ceiling: number; eye: THREE.Vector3; above: THREE.Vector3; radius: number } | null = null;
  if (model && cellarCells.length > 40) {
    const roomy = (x: number, z: number, min: number) => {
      const c = cellarAt(x, z);
      return !!c && c.high - c.low >= min && c.high - c.low <= 6;
    };
    let best: { c: (typeof cellarCells)[number]; score: number } | null = null;
    for (const c of cellarCells) {
      if (!roomy(c.x, c.z, 2.2)) continue;
      let score = 0;
      for (let a = 0; a < 12; a++) {
        for (const d of [0.8, 1.6, 2.4]) if (roomy(c.x + Math.cos((a * Math.PI) / 6) * d, c.z + Math.sin((a * Math.PI) / 6) * d, 1.6)) score++;
      }
      if (!best || score > best.score) best = { c, score };
    }
    if (best) {
      const c = best.c;
      const lookAt = new THREE.Vector3(c.x, c.low + (c.high - c.low) * 0.7, c.z);
      const probe = new THREE.Raycaster();
      let eye: THREE.Vector3 | null = null;
      let reach = 0;
      for (let a = 0; a < 16; a++) {
        const dx = Math.cos((a * Math.PI) / 8);
        const dz = Math.sin((a * Math.PI) / 8);
        let d = 0;
        while (d < 6 && roomy(c.x + dx * (d + 0.5), c.z + dz * (d + 0.5), 1.8)) d += 0.5;
        const dist = Math.min(d - 0.3, 5.5);
        if (dist < 2.5 || dist <= reach) continue;
        const at = cellarAt(c.x + dx * dist, c.z + dz * dist);
        if (!at) continue;
        const e = new THREE.Vector3(c.x + dx * dist, Math.min(at.low + 1.4, at.high - 0.4), c.z + dz * dist);
        const to = lookAt.clone().sub(e);
        probe.set(e, to.clone().normalize());
        probe.far = to.length() - 0.3;
        if (probe.intersectObject(model, true).length) continue;
        eye = e;
        reach = dist;
      }
      if (eye) {
        cellarPlan = { floor: new THREE.Vector3(c.x, c.low, c.z), ceiling: c.high, eye, above: new THREE.Vector3(c.x, surface(c.x, -c.z), c.z), radius: 2.6 };
      }
    }
  }
  // The camera, for an effect that takes it somewhere (a cellar caving in): where it was when it began.
  let savedPose: { pos: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3 } | null = null;

  // "See it happen" (weather.ts): the weather and the dangers here, around what the camera looks at.
  const fx = document.createElement("div");
  fx.className = "view3d-fx";
  fx.setAttribute("aria-hidden", "true");
  host.insertBefore(fx, labels.domElement);
  let plantsFromDamage = 0;
  let effectNow: Effect | null = null;
  const between = new THREE.Raycaster();
  const weather: Weather = createWeather({
    scene,
    target: () => look,
    radius: wholePlace ? Math.max(placeSpan.width, placeSpan.depth) * 0.7 + 10 : Math.max(20, restAt * 1.4),
    surface: (x, z) => surface(x, -z),
    topAt: (x, z) => topAt(x, -z) ?? surface(x, -z),
    base: floorY,
    tops,
    flats,
    blocked: (a, b) => {
      if (!model) return false;
      const d = b.clone().sub(a);
      between.set(a, d.clone().normalize());
      between.far = d.length();
      return between.intersectObject(model, true).length > 0;
    },
    env,
    plants: {
      show(fraction, grow) {
        plants.count = Math.round(fraction * tops.length);
        plantGrow.value = grow;
      },
      sway: plantSway,
      restore() {
        plantGrow.value = 1;
        plants.count = plantsFromDamage;
      },
      count: tops.length,
    },
    overlay: fx,
    cellar: cellarPlan,
    director: {
      fly: (pos, lookAt, ms) => fly({ pos: pos.clone(), look: lookAt.clone(), up: SKY.clone() }, ms),
      cut: (pos, lookAt) => {
        flight = null;
        controls.enabled = false;
        pose({ pos: pos.clone(), look: lookAt.clone(), up: SKY.clone() });
      },
      fade: (v) => fx.style.setProperty("--dark", String(v)),
      save: () => {
        savedPose = { pos: camera.position.clone(), look: look.clone(), up: camera.up.clone() };
      },
      home: (ms) => {
        const back = savedPose;
        if (!back) return Promise.resolve();
        return fly(back, ms).then(() => {
          controls.target.copy(back.look);
          controls.enabled = true;
          savedPose = null;
        });
      },
    },
    pixelScale: () => (size.height * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360)),
    still: !!options.still,
  });
  let lastFrame = 0;

  type Pose = { pos: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3 };
  function pose(p: Pose) {
    camera.position.copy(p.pos);
    camera.up.copy(p.up);
    look.copy(p.look);
    camera.lookAt(look);
  }
  pose({ pos: topPos, look: topLook, up: NORTH });

  // A flight, told as what the camera looks at, how far out from it and how high above it the camera is,
  // and from which side (its heading, round the sky): the camera always looks straight at what it looks
  // at and the picture never leans (no roll). Straight above, where the side means nothing, the heading
  // still says which way is up in the picture: north, as on the map.
  type Way = {
    from: Pose;
    to: Pose;
    /** the side the camera is on at the end, and how far round it turns on the way there */
    heading: number;
    turn: number;
    /** how much of the turn is done (from the progress along the way) */
    turnAt: (e: number) => number;
    spin: number;
    out: [number, number];
    up: [number, number];
  };
  let flight: (Way & { elapsed: number; ms: number; done: () => void }) | null = null;
  /** The side of `look` the camera is on (0: south of it, looking north); straight above, the side
   *  opposite the top of the picture. */
  const headingOf = (p: Pose) => {
    const x = p.pos.x - p.look.x;
    const z = p.pos.z - p.look.z;
    return Math.hypot(x, z) > 1e-3 * p.pos.distanceTo(p.look) ? Math.atan2(x, z) : Math.atan2(-p.up.x, -p.up.z);
  };
  /** -pi..pi */
  const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  function way(from: Pose, to: Pose, turnAt: (e: number) => number, spin: number): Way {
    const heading = headingOf(to);
    // turning round what it looks at by `spin` on the way (a spiral), and the rest of the way round from
    // the side it starts on, the shorter way
    const turn = wrap(headingOf(from) - heading - spin);
    const out = (p: Pose) => Math.hypot(p.pos.x - p.look.x, p.pos.z - p.look.z);
    return { from, to, heading, turn, turnAt, spin, out: [out(from), out(to)], up: [from.pos.y - from.look.y, to.pos.y - to.look.y] };
  }
  /** Where the camera is at `e` (0..1) along `w`, and what it looks at; returns its heading. */
  function flown(w: Way, e: number, pos: THREE.Vector3, at: THREE.Vector3): number {
    at.lerpVectors(w.from.look, w.to.look, e);
    const heading = w.heading + w.spin * (1 - e) + w.turn * (1 - w.turnAt(e));
    const out = w.out[0] + (w.out[1] - w.out[0]) * e;
    pos.set(at.x + Math.sin(heading) * out, at.y + w.up[0] + (w.up[1] - w.up[0]) * e, at.z + Math.cos(heading) * out);
    return heading;
  }
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  function fly(to: Pose, ms: number, turnAt: (e: number) => number = (e) => e, spin = 0): Promise<void> {
    closePin();
    controls.enabled = false;
    flight = null;
    if (ms <= 0) {
      pose(to);
      return Promise.resolve();
    }
    const from = { pos: camera.position.clone(), look: look.clone(), up: camera.up.clone() };
    return new Promise((done) => {
      flight = { ...way(from, to, turnAt, spin), elapsed: 0, ms, done };
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
    camera.position.add(weather.shake); // an earthquake shakes the camera, this frame only
    renderer.render(scene, camera);
    labels.render(scene, camera);
    if (pins) {
      mergePins();
      pins.render(pinScene, camera);
      if (openPin) {
        openPin.el.style.zIndex = "100000"; // the open card over every other pin
        placeCard();
      }
    }
    camera.position.sub(weather.shake);
    const showMag = !!magTarget && !above && !flight;
    if (magFrame.hidden === showMag) magFrame.hidden = !showMag;
    if (showMag) {
      const r = magRect();
      Object.assign(magFrame.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.side}px`, height: `${r.side}px` });
      const y = size.height - r.y - r.side; // the renderer counts from the bottom
      renderer.setScissorTest(true);
      renderer.setScissor(r.x, y, r.side, r.side);
      renderer.setViewport(r.x, y, r.side, r.side);
      const sign = damage.show.value;
      damage.show.value = 0; // in the magnifier, the crack as it is
      renderer.render(scene, magCam);
      damage.show.value = sign;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.width, size.height);
    }
  }
  let raf = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    damage.pulse.value = options.still ? 0.6 : 0.5 + 0.5 * Math.sin(now / 280);
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    plantTime.value = now / 1000;
    alarmFrame(now);
    if (!above) weather.update(dt, now);
    if (shift !== shiftTo) {
      shift += (shiftTo - shift) * 0.12;
      if (Math.abs(shiftTo - shift) < 0.5) shift = shiftTo;
      applyShift();
    }
    if (flight) {
      // on by the frame's time, at most a 20th of a second: a frame the computer was slow to draw (the
      // place's pictures still going to the graphics card) is a short pause, never a jump ahead
      flight.elapsed += Math.min(50, dt * 1000);
      const t = Math.min(1, flight.elapsed / flight.ms);
      const heading = flown(flight, ease(t), camera.position, look);
      // facing what it looks at from its side, tipped down to it, never leaning (straight above too,
      // where looking at it would not say which way is up)
      const x = camera.position.x - look.x;
      const z = camera.position.z - look.z;
      camera.rotation.set(-Math.atan2(camera.position.y - look.y, Math.hypot(x, z)), heading, 0, "YXZ");
      if (t >= 1) {
        const done = flight.done;
        pose(flight.to); // the sky up again (north, straight above), for the player's turning
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
    flyIn(ms, spin = 0) {
      above = false;
      // A narrow (upright) screen sees less from side to side: the camera stays further back there,
      // so the rooms still fit across it.
      endPos.copy(endLook).addScaledVector(END_DIR, restDistance(size.width / size.height));
      // never under the ground (a slope rising behind the camera)
      endPos.y = Math.max(endPos.y, surface(endPos.x, -endPos.z) + 2);
      // The way down never through ARGUS's model (Schenkenberg's tower beside its crack meter): where a
      // spiral would pass through a wall, the camera comes down without turning; where even that would,
      // the fewer walls the better.
      const from = { pos: camera.position.clone(), look: look.clone(), up: camera.up.clone() };
      const to = { pos: endPos, look: endLook, up: SKY };
      // Turning from north (the map's) to the side it comes to rest on early, while the camera still looks
      // almost straight down.
      const turnAt = (e: number) => smooth(Math.min(1, e * 1.6));
      const passes = (turn: number) => {
        if (!model) return 0;
        const w = way(from, to, turnAt, turn);
        const p = new THREE.Vector3();
        const l = new THREE.Vector3();
        let hits = 0;
        for (let i = 1; i < 20; i++) {
          flown(w, ease(i / 20), p, l);
          const d = p.clone().sub(l);
          ray.set(l, d.clone().normalize());
          ray.far = d.length();
          if (ray.intersectObject(model, true).some((h) => h.distance > 0.6 && h.point.y < cutTop && !inShaft(h.point))) hits++;
        }
        return hits;
      };
      if (spin && ms > 0 && passes(spin) > 0) spin = passes(0) <= passes(spin) ? 0 : spin;
      return fly(to, ms, turnAt, spin).then(() => {
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
      return fly({ pos: topPos, look: topLook, up: NORTH }, ms).then(() => {
        above = true;
      });
    },
    setInsets(top, bottom) {
      insetTop = top;
      insetBottom = bottom;
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
      plantsFromDamage = Math.round(d.plants * tops.length);
      if (effectNow !== "plants") plants.count = plantsFromDamage;
      if (kidMain) kidMain.visible = d.damp + d.wet + d.flake + d.wear + d.surfaceMm + d.crackM + d.lean > 0;
      if (kidPlants) kidPlants.visible = plants.count > plantAt;
    },
    setWeather(e) {
      // a cellar caving in stopped before it was over: the camera back where it was, out of the cellar
      if (effectNow === "cellar" && savedPose) {
        const back = savedPose;
        flight = null;
        pose(back);
        controls.target.copy(back.look);
        controls.enabled = true;
        savedPose = null;
        fx.style.setProperty("--dark", "0");
      }
      effectNow = e;
      // what the effect needs seen up close (people, a building on fire, walls shaking): the camera comes
      // to some 26 m from it, from where it is looking now
      const near = e ? weather.focusFor(e) : null;
      if (near && !above && camera.position.distanceTo(near) > 34) {
        const dir = camera.position.clone().sub(look).normalize();
        if (dir.y < 0.35) dir.setY(0.35).normalize();
        const to = { pos: near.clone().addScaledVector(dir, 26), look: near.clone(), up: SKY };
        to.pos.y = Math.max(to.pos.y, surface(to.pos.x, -to.pos.z) + 2);
        if (options.still) {
          pose(to);
          controls.target.copy(near);
          controls.update();
        } else {
          void fly(to, 1400).then(() => {
            controls.target.copy(near);
            controls.enabled = true;
          });
        }
        look.copy(near);
      }
      weather.set(e);
      if (!raf) render();
    },
    canWeather: (e) => weather.can(e),
    setHighlight(on) {
      damage.show.value = on ? 1 : 0;
    },
    setAlarm(on) {
      alarmGroup.visible = on;
    },
    orbit(on) {
      controls.autoRotate = on && !options.still;
    },
    resize(width, height) {
      if (width < 1 || height < 1) return;
      size = { width, height };
      renderer.setSize(width, height);
      labels.setSize(width, height);
      pins?.setSize(width, height);
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
      weather.dispose();
      fx.remove();
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
      pins?.domElement.remove();
      magFrame.remove();
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
