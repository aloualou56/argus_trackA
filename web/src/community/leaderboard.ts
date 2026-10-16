// The leaderboard: each guardian name once, with its best score (of the mission, or of all missions).
// Pure: built from the same anonymous play records as the rest of the community data.
import type { PlayRecord } from "./store";

export interface BoardRow {
  nick: string;
  /** Best score (0-100). */
  score: number;
  /** The day the best score was first reached. */
  day: string;
  games: number;
}

export interface Standing {
  /** 1 for the first; null when the player is not on the board yet. */
  rank: number | null;
  players: number;
  /** The row just above the player (a higher score), and how many points it would take to pass it. */
  next: { row: BoardRow; points: number } | null;
}

/** One row per guardian name with its best score; the highest first, and on equal scores who got there first. */
export function leaderboard(records: PlayRecord[], filter: { monument?: string; level?: string } = {}): BoardRow[] {
  const best = new Map<string, BoardRow>();
  for (const r of records) {
    if (!r.nick) continue;
    if (filter.monument !== undefined && r.monument !== filter.monument) continue;
    if (filter.level !== undefined && r.level !== filter.level) continue;
    const row = best.get(r.nick);
    if (!row) best.set(r.nick, { nick: r.nick, score: r.score, day: r.day, games: 1 });
    else {
      row.games += 1;
      if (r.score > row.score || (r.score === row.score && r.day < row.day)) Object.assign(row, { score: r.score, day: r.day });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.day.localeCompare(b.day) || a.nick.localeCompare(b.nick));
}

/** Where `nick` stands. Players with the same score share a rank. */
export function standing(rows: BoardRow[], nick: string): Standing {
  const i = rows.findIndex((r) => r.nick === nick);
  if (i < 0) return { rank: null, players: rows.length, next: null };
  const me = rows[i];
  const rank = rows.findIndex((r) => r.score === me.score) + 1;
  const above = rows.slice(0, rank - 1).reverse().find((r) => r.score > me.score) ?? null;
  return { rank, players: rows.length, next: above ? { row: above, points: above.score - me.score + 1 } : null };
}
