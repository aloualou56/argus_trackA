// The 3D view of a house (README, "3D view"), built only from data the game may use:
//   ground      the game's satellite picture (Esri) on real terrain: ARGUS's own terrain around the
//               house where tools/fetch_argus_3d.py has taken it (<scene>-terrain.json), else AWS
//               Terrain Tiles
//   walls       the ruin's outline from OpenStreetMap (historic=ruins), height assumed
//   rooms       ARGUS's own 3D sensor placements, which name the mosaic rooms
//   mosaics     photos from Wikimedia Commons where a straight-down one exists; the other floors
//               are a plain pattern, an illustration
//   sensors     ARGUS's 3D placements (position and height)
//   damage      an illustration, not a prediction (math.ts, damageAfter)
// The data file is written by tools/build_preview_3d.py. ARGUS's own 3D models would replace the
// walls and floors; everything else stays. This file and three.js load only when a player asks for
// the view (view3d/preload.ts), so they never weigh on the game itself.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { cameraHeightFor, seeded, terrarium, tileLonLat, tileXY, type Damage } from "./math";

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
  origin: { lat: number; lon: number };
  metres_per_degree: XY;
  shapes: { kind: "ruin" | "site"; ring: XY[] }[];
  sensors3d: { xy: XY; h: number; kind: string; room: string | null }[];
  rooms: HouseRoom[];
  dangers: HouseDanger[];
  risk_checked_at: string | null;
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

/** The grid's heights (little-endian int16 in base64). */
export function gridHeights(grid: TerrainGrid): Int16Array {
  const bytes = Uint8Array.from(atob(grid.heights_cm_int16_b64), (ch) => ch.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Int16Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true));
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
  const ruin = data.shapes.find((s) => s.kind === "ruin");
  if (!ruin) throw new Error(`${dataUrl}: no ruin outline`);
  const [ground, dem, grid, photos] = await Promise.all([
    mosaic(data, IMAGERY_ZOOM, imagery, 2, false),
    mosaic(data, TERRAIN_ZOOM, TERRAIN, 1, true),
    loadGrid(dataUrl.replace(/\.json$/, "-terrain.json")),
    Promise.all(data.rooms.map(async (r) => [r.room, r.photo ? await loadImage(r.photo.url) : null] as const)),
  ]);
  if (!ground.loaded) throw new Error("no satellite pictures (offline?)");
  const [cx, cy] = centroid(ruin.ring);
  const [kx, ky] = data.metres_per_degree;
  return {
    data,
    centre: [data.origin.lat + cy / ky, data.origin.lon + cx / kx],
    imagery: ground,
    dem,
    grid,
    photos: new Map(photos.filter((p): p is readonly [string, HTMLImageElement] => !!p[1])),
  };
}

export interface HouseOptions {
  /** The words on a room's label, in the game's language. */
  roomLabel: (room: HouseRoom) => string;
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
  const { lat: LAT0, lon: LON0 } = data.origin;
  const [KX, KY] = data.metres_per_degree;
  const ruin = data.shapes.find((s) => s.kind === "ruin")!;
  const sites = data.shapes.filter((s) => s.kind === "site");
  const rooms = new Map(data.rooms.map((r) => [r.room, r]));
  const houseCentre = centroid(ruin.ring);
  // The damp comes up where ARGUS's soil probes are (Room 215, under the Theatrical Masks mosaic).
  const probe = data.sensors3d.find((s) => s.kind === "soil_moisture" && s.room && rooms.has(s.room));
  const dampRoom = (probe?.room && rooms.get(probe.room)) || data.rooms[0];
  const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const nextRoom = data.rooms.filter((r) => r !== dampRoom).sort((a, b) => dist(a.xy, dampRoom.xy) - dist(b.xy, dampRoom.xy))[0] ?? dampRoom;

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
  const at = ([x, y]: XY, up = 0) => new THREE.Vector3(x, ground(x, y) + up, -y); // metres east/north -> scene

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
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 250 });
  scene.add(sun, sun.target);

  const SEG = 128; // ground: the satellite picture, lifted onto the terrain
  const groundGeo = new THREE.PlaneGeometry(imagery.east - imagery.west, imagery.north - imagery.south, SEG, SEG);
  const gp = groundGeo.attributes.position;
  const gx0 = (imagery.west + imagery.east) / 2;
  const gy0 = (imagery.north + imagery.south) / 2;
  for (let i = 0; i < gp.count; i++) gp.setZ(i, ground(gp.getX(i) + gx0, gp.getY(i) + gy0));
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

  const src = at(dampRoom.xy);
  const damage = {
    damp: { value: 0 },
    wet: { value: 0 },
    loss: { value: 0 },
    salt: { value: 0 },
    source: { value: new THREE.Vector2(src.x, src.z) },
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
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < ruin.ring.length - 1; i++) {
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
  for (let i = 0; i < ruin.ring.length - 1; i++) {
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
  const rnd = seeded(11);
  for (let i = tops.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [tops[i], tops[j]] = [tops[j], tops[i]];
  }
  const plants = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: "#56703a", roughness: 1, flatShading: true }),
    Math.max(tops.length, 1),
  );
  const m4 = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  tops.forEach((p, i) => {
    const k = 0.6 + rnd() * 0.9;
    scale.set(k * 1.3, k * 0.8, k * 1.1);
    plants.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x + rnd() * 0.24 - 0.12, p.y - 0.05, p.z + rnd() * 0.24 - 0.12), turn, scale));
  });
  plants.count = 0;
  plants.castShadow = true;
  // Its bounds are measured once, at the first frame, when no plant grows yet: never culled instead.
  plants.frustumCulled = false;
  scene.add(plants);

  // ---------------------------------------------------------------- the camera: from straight above down to the rooms
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 2;
  controls.maxDistance = 400;
  controls.listenToKeyEvents(canvas); // arrow keys move the view while the canvas has the focus
  const endLook = at([(dampRoom.xy[0] + nextRoom.xy[0]) / 2, (dampRoom.xy[1] + nextRoom.xy[1]) / 2], 0.4);
  const END_OFFSET = new THREE.Vector3(-14, 15.5, 18.5); // about 28 m away, looking down at 34 degrees
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
