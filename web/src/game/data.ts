import { runtimeConfig } from "../runtime";
import { withoutOnlineMaps } from "./logic";
import type { GameData } from "./types";

export const SCHEMA_VERSION = 3;

const RELOAD_KEY = "guardian.staleReload";

/** Loads the data pack built by tools/build_game_data.py (never the raw ARGUS snapshot). */
export async function loadGameData(): Promise<GameData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/game_data.json`);
  if (!res.ok) throw new Error(`game_data.json: HTTP ${res.status}`);
  const data = (await res.json()) as GameData;
  if (data.schema_version !== SCHEMA_VERSION) {
    // An offline copy from an earlier version answered (its service worker kept the old data):
    // drop it and load the page once more from the network.
    if (await dropOfflineCopy()) {
      window.location.reload();
      return new Promise<GameData>(() => {}); // the page is going away
    }
    throw new Error(`game_data.json: schema ${data.schema_version}, expected ${SCHEMA_VERSION}`);
  }
  try {
    window.sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    // storage blocked: nothing to clear
  }
  return runtimeConfig().localOnly ? withoutOnlineMaps(data) : data;
}

/** Removes the game's service worker and stored files, once per tab; false if already tried. */
async function dropOfflineCopy(): Promise<boolean> {
  try {
    if (window.sessionStorage.getItem(RELOAD_KEY)) return false;
    window.sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return false; // without storage a reload could repeat forever: show the error instead
  }
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
    const keys = "caches" in window ? await caches.keys() : [];
    await Promise.all(keys.filter((k) => k.startsWith("guardian-")).map((k) => caches.delete(k)));
  } catch {
    // e.g. storage blocked: the reload still fetches the page and data again
  }
  return true;
}
