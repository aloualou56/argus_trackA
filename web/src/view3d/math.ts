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
 *  much salt has come out, and the share of the wall tops where plants have rooted. Then, for the
 *  other dangers: paint flaking off the walls (share), the radius of the path worn into a floor
 *  (metres), the stone's surface worn by weather (share), how long the crack has grown (metres) and
 *  how far the wall has leaned (degrees). */
export interface Damage {
  damp: number;
  wet: number;
  loss: number;
  salt: number;
  plants: number;
  flake: number;
  wear: number;
  weather: number;
  crack: number;
  lean: number;
}

/** Which damage a 3D scene shows: the drawing of the day's danger (Consequence.tsx), or none when
 *  the scene is only looked at (the years then only weather it and bring plants). */
export type DamageKind = "mosaic" | "floor" | "stone" | "lean" | "tree" | "fresco" | "crack" | null;

const grow = (y: number, years: number) => (y > 0 ? 1 - Math.exp(-y / years) : 0);

/** The damage after `years` in which nobody noticed. With ARGUS watching, the sensors show it within
 *  months and it is treated: never more than a year's worth. An illustration, not a prediction
 *  (README, "3D view"). "mosaic" is the House of the Masks: damp rising under its floors. */
export function damageAfter(years: number, watched: boolean, kind: DamageKind = "mosaic"): Damage {
  const y = watched ? Math.min(years, 1) : years;
  const none = { damp: 0, wet: 0, loss: 0, salt: 0, plants: 0, flake: 0, wear: 0, weather: 0, crack: 0, lean: 0 };
  const plants = y < 15 ? 0 : ((y - 15) / 35) * 0.45;
  const weather = Math.min(0.35, y / 140); // every place weathers a little
  switch (kind) {
    case "mosaic":
      return {
        ...none,
        damp: y > 0 ? 0.1 + 1.1 * grow(y, 15) : 0, // up to about 1.2 m up the walls
        wet: y > 0 ? 0.4 + 2.6 * grow(y, 18) : 0, // a stain up to about 3 m across the floor
        loss: Math.min(0.85, Math.max(0, (y - 3) / 40)),
        salt: Math.min(1, Math.max(0, (y - 1) / 10)),
        plants,
      };
    case "fresco": // damp climbing the painted walls, salt at its edge, the paint coming away
      return {
        ...none,
        damp: y > 0 ? 0.15 + 1.6 * grow(y, 15) : 0,
        salt: Math.min(1, Math.max(0, (y - 1) / 10)),
        flake: Math.min(0.9, Math.max(0, (y - 2) / 40)),
        plants,
        weather,
      };
    case "floor": // feet wearing a path: smooth and low, then stones loosening
      return { ...none, wear: y > 0 ? 0.6 + 3.4 * grow(y, 20) : 0, loss: Math.min(0.5, Math.max(0, (y - 10) / 60)), plants, weather };
    case "stone": // wind, salt and heat wearing the stone's surface
      return { ...none, weather: Math.min(1, y / 40), plants };
    case "crack": // a crack growing every winter, stones loosening along it
      return { ...none, crack: y > 0 ? 0.3 + 5.7 * grow(y, 25) : 0, plants, weather };
    case "lean": // the wall leaning a little more each year, then cracking
      return { ...none, lean: Math.min(6, y * 0.12), crack: y > 10 ? 4 * grow(y - 10, 25) : 0, plants, weather };
    case "tree": // trees and plants growing over the walls
      return { ...none, plants: y < 3 ? 0 : Math.min(0.9, ((y - 3) / 40) * 0.9), weather };
    default:
      return { ...none, plants, weather };
  }
}

/** An instrument's serial number from its name ("Installed Instrument Soil Moisture - 149368 (Room
 *  215 ...)" -> "149368"), as ARGUS's 3D placements of its sensors name them too: the 3D view finds
 *  the sensor of the day's alarm by it. */
export function serialOf(name: string): string | null {
  const i = name.indexOf(" - ");
  if (i < 0) return null;
  return name.slice(i + 3).split(" (")[0].trim() || null;
}
