// Loads the 3D view (README, "3D view") before the player asks for it, so that once they do,
// nothing waits: the 3D engine (three.js, a file of its own), the house's data, its satellite and
// terrain tiles and the mosaic photos. Score.tsx starts it when "Display in 3D" comes into view.
import type { GameData } from "../game/types";
import type { Assets } from "./house";
import type { DamageKind } from "./math";

/** What a 3D view opened from the score screen is about: the day's danger (its damage, and its
 *  alarm's sensor: serial number and [lat, lon]), or nothing in particular (kind null). */
export interface Focus3d {
  kind: DamageKind;
  serial: string | null;
  at: [number, number] | null;
}

export interface Loaded {
  house: typeof import("./house");
  assets: Assets;
}

const loads = new Map<string, Promise<Loaded>>();

/** The tile address of the game's satellite map: the 3D ground uses the very tiles the map shows
 *  once it has flown down, so those are loaded too before anything moves. */
export function imageryTemplate(data: GameData): string | null {
  const raster = data.basemaps.layers.filter((l) => l.type !== "vector" && l.url);
  return (raster.find((l) => l.id === "satellite") ?? raster[0])?.url ?? null;
}

let webgl: boolean | null = null;
/** Whether this device can draw in 3D at all; where it cannot, the game does not offer the view. */
export function canShow3d(): boolean {
  if (webgl === null) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      webgl = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext(); // only a test: give the context back
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/** Everything the scene `scene` (data/view3d/<scene>.json) needs; started once, shared by every caller.
 *  A failed load (offline) is tried again the next time. */
export function preload3d(scene: string, data: GameData): Promise<Loaded> {
  let load = loads.get(scene);
  if (!load) {
    const imagery = imageryTemplate(data);
    load = imagery
      ? import("./house").then(async (house) => ({
          house,
          assets: await house.loadAssets(`${import.meta.env.BASE_URL}data/view3d/${scene}.json`, imagery),
        }))
      : Promise.reject(new Error("no satellite map to build the ground from"));
    load.catch(() => loads.delete(scene));
    loads.set(scene, load);
  }
  return load;
}
