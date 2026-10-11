// Anonymous, aggregated player choices ("the community chose X, ARGUS installed Y").
// The game talks only to CommunityStore. LocalCommunityStore is the offline fallback;
// a remote store (Supabase, Firebase, a tiny API) can implement the same interface later.
import type { Picks } from "../game/types";

export interface PlayRecord {
  v: 1;
  monument: string;
  level: string;
  picks: Picks;
  score: number;
  detected: boolean;
  /** Date only (YYYY-MM-DD): no time, no names, no device id. */
  day: string;
  classCode?: string;
}

export interface Summary {
  games: number;
  /** Share of games (0..1) whose network included each card. */
  cardShare: Record<string, number>;
  averageScore: number;
  detectedShare: number;
}

export interface CommunityStore {
  readonly kind: "local" | "remote";
  submit(record: PlayRecord): Promise<void>;
  summary(monument: string, level: string, classCode?: string): Promise<Summary>;
}

export function summarize(records: PlayRecord[]): Summary {
  const games = records.length;
  const counts: Record<string, number> = {};
  for (const r of records) {
    for (const [card, n] of Object.entries(r.picks)) if (n > 0) counts[card] = (counts[card] ?? 0) + 1;
  }
  const cardShare = Object.fromEntries(Object.entries(counts).map(([c, n]) => [c, n / games]));
  return {
    games,
    cardShare,
    averageScore: games ? records.reduce((s, r) => s + r.score, 0) / games : 0,
    detectedShare: games ? records.filter((r) => r.detected).length / games : 0,
  };
}

/** Most chosen card, skipping `exclude` (e.g. the human observer, which has no ARGUS count to compare). */
export function topCard(summary: Summary, exclude: Set<string> = new Set()): { card: string; share: number } | null {
  const entries = Object.entries(summary.cardShare)
    .filter(([card]) => !exclude.has(card))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? { card: entries[0][0], share: entries[0][1] } : null;
}

const KEY = "guardian.plays.v1";

export class LocalCommunityStore implements CommunityStore {
  readonly kind = "local" as const;
  private memory: PlayRecord[] = [];

  constructor(private storage: Storage | null = safeLocalStorage(), private max = 500) {}

  private read(): PlayRecord[] {
    try {
      const raw = this.storage?.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) return parsed.filter((r) => r && r.v === 1);
    } catch {
      // storage blocked or corrupted: fall back to this session's memory
    }
    return this.memory;
  }

  private write(records: PlayRecord[]): void {
    this.memory = records;
    try {
      this.storage?.setItem(KEY, JSON.stringify(records));
    } catch {
      // quota or privacy mode: keep the in-memory copy
    }
  }

  async submit(record: PlayRecord): Promise<void> {
    const records = [...this.read(), record];
    this.write(records.slice(-this.max));
  }

  async summary(monument: string, level: string, classCode?: string): Promise<Summary> {
    return summarize(
      this.read().filter(
        (r) => r.monument === monument && r.level === level && (classCode === undefined || r.classCode === classCode),
      ),
    );
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
