// Challenge link: "play the same monument, level and three dangers, and beat my score".
// Pure: tested in tests/week.test.ts. The link carries no names and nothing about the sender but
// the score: ?m=delos&l=high&d=65.69.82&s=68 (d = ARGUS threat ids of the three dangers).
import { missionPool } from "./logic";
import type { GameData, LevelId, Monument } from "./types";

export interface Challenge {
  pilot: string;
  level: LevelId;
  /** Scenario keys of the three dangers. */
  mission: string[];
  /** The score to beat, if the link carried one. */
  score: number | null;
}

export type ChallengeOutcome = "won" | "tied" | "lost";

/** The query string of a challenge link (without "?"). */
export function challengeQuery(mon: Monument, level: LevelId, mission: string[], score: number): string {
  const ids = mission.map((key) => mon.scenarios.find((s) => s.scenario_key === key)?.threat_id);
  const params = new URLSearchParams({ m: mon.pilot_key, l: level });
  if (ids.every((id) => id !== undefined)) params.set("d", ids.join("."));
  params.set("s", String(Math.round(score)));
  return params.toString();
}

/**
 * The challenge in a page address, or null. Only a mission the game itself could have dealt is
 * accepted (the level's own, or one from its pool), so an edited link cannot build an unfair game.
 */
export function challengeFromUrl(search: string, data: GameData): Challenge | null {
  const params = new URLSearchParams(search);
  const mon = data.monuments.find((m) => m.pilot_key === params.get("m"));
  if (!mon || !mon.playable) return null;
  const level = mon.levels.find((l) => l.id === params.get("l"));
  if (!level || !level.available) return null;

  const own = level.mission ?? [];
  let mission = own;
  const wanted = params.get("d");
  if (wanted !== null) {
    const allowed = new Set([...own, ...missionPool(mon, level.id).map((s) => s.scenario_key)]);
    const keys = wanted.split(".").map((id) => mon.scenarios.find((s) => String(s.threat_id) === id)?.scenario_key);
    const valid = keys.every((key): key is string => key !== undefined && allowed.has(key));
    if (!valid || keys.length !== data.mission_size || new Set(keys).size !== keys.length) return null;
    mission = keys as string[];
  }
  if (mission.length !== data.mission_size) return null;

  const raw = params.get("s");
  const score = raw !== null && /^\d{1,3}$/.test(raw) && Number(raw) <= 100 ? Number(raw) : null;
  return { pilot: mon.pilot_key, level: level.id, mission, score };
}

export function challengeOutcome(mine: number, toBeat: number): ChallengeOutcome {
  return mine > toBeat ? "won" : mine === toBeat ? "tied" : "lost";
}
