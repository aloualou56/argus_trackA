import type { GameData } from "./types";

export const SCHEMA_VERSION = 1;

/** Loads the data pack built by tools/build_game_data.py (never the raw ARGUS snapshot). */
export async function loadGameData(): Promise<GameData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/game_data.json`);
  if (!res.ok) throw new Error(`game_data.json: HTTP ${res.status}`);
  const data = (await res.json()) as GameData;
  if (data.schema_version !== SCHEMA_VERSION) throw new Error(`game_data.json: schema ${data.schema_version}`);
  return data;
}
