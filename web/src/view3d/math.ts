// The 3D view's arithmetic (README, "3D view"), kept apart from three.js so the game and its tests
// can use it without loading the 3D engine.

/** How far the game's map zooms in before the 3D view takes over: one step past Delos's real
 *  satellite pictures (18), as close as the map goes without turning to blur. */
export const MAP_ZOOM = 19;

/** Web Mercator tile coordinates (with fractions) of a point at zoom `z`. */
export function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/** The north-west corner of tile (x, y) at zoom `z`, as [lon, lat]. */
export function tileLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI];
}

/** Metres per screen pixel of a Web Mercator map (256-pixel tiles) at this latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** How high above the ground a camera with this vertical field of view must look straight down to
 *  show `pixels` screen pixels of a map at `mpp` metres per pixel, top to bottom: the same picture. */
export function cameraHeightFor(pixels: number, mpp: number, fovDegrees: number): number {
  return (pixels * mpp) / (2 * Math.tan((fovDegrees * Math.PI) / 360));
}

/** One pixel of AWS Terrain Tiles' "terrarium" pictures, in metres above sea level. */
export function terrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** A small fixed pseudo-random sequence, so the plants grow in the same places on every visit. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** What the illustration shows, each from 0 (nothing) upwards: how high damp has risen in the walls
 *  (metres), the radius of the stain in the floors (metres), the share of tesserae lost in it, how
 *  much salt has come out, and the share of the wall tops where plants have rooted. */
export interface Damage {
  damp: number;
  wet: number;
  loss: number;
  salt: number;
  plants: number;
}

/** The damage after `years` in which nobody noticed the damp. With ARGUS watching, the soil probes
 *  under the masks mosaic show it within months and it is treated: never more than a year's worth.
 *  An illustration, not a prediction (README, "3D view"). */
export function damageAfter(years: number, watched: boolean): Damage {
  const y = watched ? Math.min(years, 1) : years;
  return {
    damp: y > 0 ? 0.1 + 1.1 * (1 - Math.exp(-y / 15)) : 0, // up to about 1.2 m up the walls
    wet: y > 0 ? 0.4 + 2.6 * (1 - Math.exp(-y / 18)) : 0, // a stain up to about 3 m across the floor
    loss: Math.min(0.85, Math.max(0, (y - 3) / 40)),
    salt: Math.min(1, Math.max(0, (y - 1) / 10)),
    plants: y < 15 ? 0 : ((y - 15) / 35) * 0.45,
  };
}
