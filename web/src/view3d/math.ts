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

/** A rectangle on the screen, in pixels from the picture's top left corner. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a card opened from a point of the picture goes, so that all of it stays in the free part of
 *  the picture (`free`: the picture less what covers it, the title above and the panel below): above
 *  its point when it fits there, else below it; when it fits on neither side, on the side with more
 *  room, scrolling inside itself; when even that side is too small to read, beside its point; and
 *  only when there is no room beside it either, over it (`reach`: from the point to the card's edge). `maxHeight` and `maxWidth` are the most it may take:
 *  the card's own size within them is up to the page, so they are the bounds to keep. */
export function placeCardIn(
  at: { x: number; y: number },
  reach: number,
  card: { width: number; height: number },
  free: ScreenBox,
  margin = 8,
): { left: number; top: number; maxWidth: number; maxHeight: number } {
  const lo = free.top + margin;
  const hi = Math.max(lo, free.bottom - margin);
  const maxWidth = Math.max(0, free.right - free.left - 2 * margin);
  const width = Math.min(card.width, maxWidth);
  const left = Math.min(Math.max(at.x - width / 2, free.left + margin), Math.max(free.left + margin, free.right - margin - width));
  // (a point under what covers the picture still has its card in the free part: from its edge)
  const aboveEnd = Math.min(at.y - reach, hi);
  const belowStart = Math.max(at.y + reach, lo);
  const roomAbove = aboveEnd - lo;
  const roomBelow = hi - belowStart;
  if (card.height <= roomAbove) return { left, top: aboveEnd - card.height, maxWidth, maxHeight: roomAbove };
  if (card.height <= roomBelow) return { left, top: belowStart, maxWidth, maxHeight: roomBelow };
  // (a card cut to fewer than about five lines is hard to read)
  const readable = Math.min(card.height, 96);
  if (roomAbove >= readable && roomAbove >= roomBelow) return { left, top: lo, maxWidth, maxHeight: roomAbove };
  if (roomBelow >= readable) return { left, top: belowStart, maxWidth, maxHeight: roomBelow };
  // a low picture (a phone on its side): beside its point, on the side with room, else over it
  const maxHeight = hi - lo;
  const height = Math.min(card.height, maxHeight);
  const top = Math.min(Math.max(at.y - height / 2, lo), hi - height);
  const rightStart = Math.max(at.x + reach, free.left + margin);
  const leftEnd = Math.min(at.x - reach, free.right - margin);
  if (rightStart + width <= free.right - margin) return { left: rightStart, top, maxWidth, maxHeight };
  if (leftEnd - width >= free.left + margin) return { left: leftEnd - width, top, maxWidth, maxHeight };
  return { left, top, maxWidth, maxHeight };
}

/** What the illustration shows, each from 0 (nothing) upwards: how high damp has risen in the walls
 *  (metres), the radius of the stain in the floors (metres), the share of tesserae lost in it, how
 *  much salt has come out, and the share of the wall tops where plants have rooted. Then, for the
 *  other dangers: the share of the painted wall whose paint has come away, the radius of the path worn
 *  into a floor (metres), the stone's surface lost (millimetres), the crack's width (millimetres) and
 *  length (metres), and how much further the wall leans (degrees). */
export interface Damage {
  damp: number;
  wet: number;
  loss: number;
  salt: number;
  plants: number;
  flake: number;
  wear: number;
  surfaceMm: number;
  crackMm: number;
  crackM: number;
  lean: number;
}

/** Which damage a 3D scene shows: the drawing of the day's danger (Consequence.tsx), or none when
 *  the scene is only looked at (the years then only weather it and bring plants). */
export type DamageKind = "mosaic" | "floor" | "stone" | "lean" | "tree" | "fresco" | "crack" | null;

const grow = (y: number, years: number) => (y > 0 ? 1 - Math.exp(-y / years) : 0);

/** The rates behind the damage (README, "3D view: how big the damage is"). Measured where a source
 *  measured it; an assumption, said as one on the screen, where nothing measured it. */
export const RATES = {
  /** Rising damp stops at 0.5-1.5 m above the ground in most walls (heritage guidance; up to 2 m in
   *  stone masonry): it is drawn rising towards 1.5 m. */
  dampMaxM: 1.5,
  /** Marble and limestone lose about 0.5-5 mm of surface a century, more by the sea: the upper end,
   *  for stone in wind and salt. */
  surfaceMmPerYear: 0.05,
  /** ASSUMED: an active crack in a ruin, opened by frost every winter. ARGUS's crack readings have no
   *  confirmed unit yet; the Florence dome's cracks, in a cared-for building, grow about 6 mm a century. */
  crackMmPerYear: 0.5,
  crackMPerYear: 0.04,
  /** ASSUMED: no source gives a rate. A historic wall leaning 2-3 degrees has been judged dangerous. */
  leanDegPerYear: 0.05,
};

/** The damage after `years` in which nobody noticed. With ARGUS watching, the sensors show it within
 *  months and it is treated: never more than a year's worth. An illustration of how big it would be,
 *  at the rates above (README, "3D view"). "mosaic" is the House of the Masks: damp rising under its
 *  floors. Each danger shows its own damage: plants only where they are the point (trees and bushes
 *  over the walls), where damp feeds them (mosaic, fresco), and on a place only looked at (null),
 *  where the years only weather it and bring plants; never instead of a crack, a lean, worn stone or
 *  a worn floor. */
export function damageAfter(years: number, watched: boolean, kind: DamageKind = "mosaic"): Damage {
  const y = watched ? Math.min(years, 1) : years;
  const none = { damp: 0, wet: 0, loss: 0, salt: 0, plants: 0, flake: 0, wear: 0, surfaceMm: 0, crackMm: 0, crackM: 0, lean: 0 };
  const plants = y < 15 ? 0 : ((y - 15) / 35) * 0.45;
  const salt = Math.min(1, Math.max(0, (y - 1) / 10));
  const damp = y > 0 ? 0.1 + (RATES.dampMaxM - 0.1) * grow(y, 15) : 0;
  const surfaceMm = y * RATES.surfaceMmPerYear;
  switch (kind) {
    case "mosaic":
      return {
        ...none,
        damp,
        wet: y > 0 ? 0.4 + 2.6 * grow(y, 18) : 0, // a stain spreading across the room, about 3 m out
        loss: Math.min(0.85, Math.max(0, (y - 3) / 40)),
        salt,
        plants,
        surfaceMm,
      };
    case "fresco": // damp climbing the painted walls, salt at its edge, the paint coming away
      return { ...none, damp, salt, flake: Math.min(0.6, Math.max(0, (y - 2) / 60)), plants, surfaceMm };
    case "floor": // feet wearing a path: smooth and pale where people walk
      return { ...none, wear: y > 0 ? 0.6 + 2.4 * grow(y, 20) : 0, surfaceMm };
    case "stone": // wind, salt and heat wearing the stone's surface
      return { ...none, surfaceMm };
    case "crack": // a crack opening every winter
      return { ...none, crackMm: y * RATES.crackMmPerYear, crackM: y > 0 ? 0.5 + y * RATES.crackMPerYear : 0, surfaceMm };
    case "lean": // the wall leaning a little more each year; its crack opening with it
      return {
        ...none,
        lean: y * RATES.leanDegPerYear,
        crackMm: y > 10 ? (y - 10) * RATES.crackMmPerYear : 0,
        crackM: y > 10 ? 0.5 + (y - 10) * RATES.crackMPerYear : 0,
        surfaceMm,
      };
    case "tree": // trees and bushes growing over the walls
      return { ...none, plants: y < 3 ? 0 : Math.min(0.9, ((y - 3) / 40) * 0.9), surfaceMm };
    default:
      return { ...none, plants, surfaceMm };
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

/** What the 3D view can play out over a place ("See it happen", weather.ts): the weather and the
 *  dangers ARGUS rates there. An illustration of each, not a forecast. */
export type Effect =
  | "rain"
  | "acidrain"
  | "flood"
  | "storm"
  | "wind"
  | "heat"
  | "sun"
  | "frost"
  | "quake"
  | "walls"
  | "slide"
  | "creep"
  | "sink"
  | "cellar"
  | "damp"
  | "fire"
  | "wildfire"
  | "smog"
  | "plants"
  | "visitors";

/** Every effect, in the order they are offered. */
export const EFFECTS: readonly Effect[] = [
  "rain", "storm", "flood", "acidrain", "damp", "wind", "heat", "sun", "frost",
  "quake", "walls", "slide", "creep", "sink", "cellar", "fire", "wildfire", "smog", "plants", "visitors",
];

/** Which effect plays out one of ARGUS's dangers, from its scenario key ("delos-masks.rainfall.site",
 *  "schenkenberg.fire.large-100y") and, for a slope, ARGUS's level for it. Null where nothing can be
 *  shown properly (woodworm, insects, animals, vandalism, dumping, polluted groundwater). The first rule
 *  that matches wins. */
const EFFECT_RULES: [RegExp, Effect | null][] = [
  [/groundwater-pollution|biohazard|pests|criminals|vandalism|landfill/, null],
  [/fire\.(large|forest)|forest-fire|wildfire/, "wildfire"],
  [/fire/, "fire"],
  [/storm/, "storm"],
  [/wind/, "wind"],
  [/flood/, "flood"],
  [/acid-rain/, "acidrain"],
  [/rainfall|soil-erosion/, "rain"],
  [/freeze-thaw|low-temperature|frost|temperature-variation/, "frost"],
  [/heatwave|high-temperature|dry-periods|drought/, "heat"],
  [/(^|[.-])uv([.-]|$)|solar/, "sun"],
  // unroofed walls cracking, leaning, losing stones: not an earthquake
  [/architectural-stability/, "walls"],
  // heavy road traffic: ARGUS files it under pollutants (exhaust); its vibration is not an earthquake
  [/road-traffic/, "smog"],
  [/earthquake|seismic/, "quake"],
  // the ground settling under the buildings: nothing rolls anywhere
  // underground cellars caving in (Baltanás: ARGUS's model has the cellars themselves, under the hill)
  [/subsidence\.cellar/, "cellar"],
  [/subsidence/, "sink"],
  // a landslide (rocks coming down) where ARGUS rates the slope's danger high or worse; else the slow
  // creep it describes ("the ground on a slope can slowly slip downhill and pull walls with it")
  [/landslide|slope/, "slide"],
  [/water-rise|groundwater|relative-humidity|rh-fluctuations|incorrect-rh|wet-periods|salinity/, "damp"],
  [/air-pollution/, "smog"],
  [/plant-growth|forest-management|abandonment|dissociation/, "plants"],
  [/visitors/, "visitors"],
];

export function effectOf(scenarioKey: string, level?: string): Effect | null {
  const key = scenarioKey.toLowerCase();
  for (const [rule, effect] of EFFECT_RULES) {
    if (!rule.test(key)) continue;
    if (effect === "slide" && level && !["high", "extreme", "catastrophic"].includes(level)) return "creep";
    return effect;
  }
  return null;
}
