// Anonymous, aggregated player choices ("the community chose X, ARGUS installed Y").
// The game talks only to CommunityStore:
//   LocalCommunityStore     this device only (localStorage, or memory when storage is blocked)
//   SupabaseCommunityStore  shared by everyone, through Supabase's REST API (no SDK)
//   SharedWithFallback      shared when online; keeps a local copy and queues what could not be sent
// Records hold no names, no times and no device ids, only the date and an optional class code.
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

/** Pre/post quiz answers of one game: right (true) or wrong per question. */
export interface QuizRecord {
  v: 1;
  monument: string;
  /** null when the player skipped the quiz before the game. */
  pre: boolean[] | null;
  post: boolean[];
  day: string;
  classCode?: string;
}

export interface QuizSummary {
  games: number;
  /** Games that also have a quiz before the game. */
  withPre: number;
  /** Average right answers, over games with a "before" quiz (both averages use the same games). */
  averagePre: number;
  averagePost: number;
}

export interface Summary {
  games: number;
  /** Share of games (0..1) whose network included each card. */
  cardShare: Record<string, number>;
  averageScore: number;
  detectedShare: number;
}

export interface PlayFilter {
  monument?: string;
  level?: string;
  classCode?: string;
}

export interface CommunityStore {
  /** "shared" while the last read came from the shared store; "local" otherwise. */
  readonly kind: "local" | "shared";
  submit(record: PlayRecord): Promise<void>;
  submitQuiz(record: QuizRecord): Promise<void>;
  plays(filter?: PlayFilter): Promise<PlayRecord[]>;
  quizzes(filter?: { classCode?: string }): Promise<QuizRecord[]>;
}

const matches = (r: PlayRecord, f: PlayFilter) =>
  (f.monument === undefined || r.monument === f.monument) &&
  (f.level === undefined || r.level === f.level) &&
  (f.classCode === undefined || r.classCode === f.classCode);

export async function summaryOf(store: CommunityStore, filter: PlayFilter): Promise<Summary> {
  return summarize(await store.plays(filter));
}

export async function quizSummaryOf(store: CommunityStore, classCode?: string): Promise<QuizSummary> {
  return summarizeQuiz(await store.quizzes({ classCode }));
}

export function summarizeQuiz(records: QuizRecord[]): QuizSummary {
  const right = (marks: boolean[]) => marks.filter(Boolean).length;
  const paired = records.filter((r): r is QuizRecord & { pre: boolean[] } => Array.isArray(r.pre));
  const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return {
    games: records.length,
    withPre: paired.length,
    averagePre: average(paired.map((r) => right(r.pre))),
    averagePost: average(paired.map((r) => right(r.post))),
  };
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

const PLAYS = "guardian.plays.v1";
const QUIZZES = "guardian.quiz.v1";

export class LocalCommunityStore implements CommunityStore {
  readonly kind = "local" as const;
  private memory = new Map<string, unknown[]>();

  constructor(private storage: Storage | null = safeLocalStorage(), private max = 500) {}

  private read<T extends { v: 1 }>(key: string): T[] {
    try {
      const raw = this.storage?.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) return parsed.filter((r) => r && r.v === 1);
    } catch {
      // storage blocked or corrupted: fall back to this session's memory
    }
    return (this.memory.get(key) ?? []) as T[];
  }

  private append<T extends { v: 1 }>(key: string, record: T): void {
    const records = [...this.read<T>(key), record].slice(-this.max);
    this.memory.set(key, records);
    try {
      this.storage?.setItem(key, JSON.stringify(records));
    } catch {
      // quota or privacy mode: keep the in-memory copy
    }
  }

  async submit(record: PlayRecord): Promise<void> {
    this.append(PLAYS, record);
  }

  async plays(filter: PlayFilter = {}): Promise<PlayRecord[]> {
    return this.read<PlayRecord>(PLAYS).filter((r) => matches(r, filter));
  }

  async submitQuiz(record: QuizRecord): Promise<void> {
    this.append(QUIZZES, record);
  }

  async quizzes(filter: { classCode?: string } = {}): Promise<QuizRecord[]> {
    return this.read<QuizRecord>(QUIZZES).filter((r) => filter.classCode === undefined || r.classCode === filter.classCode);
  }

  /** Records that could not reach the shared store yet (see SharedWithFallback). */
  pending(): Pending[] {
    return this.read<Pending>(PENDING);
  }

  setPending(items: Pending[]): void {
    this.memory.set(PENDING, items);
    try {
      this.storage?.setItem(PENDING, JSON.stringify(items));
    } catch {
      // keep the in-memory copy
    }
  }

  queue(item: Pending): void {
    this.append(PENDING, item);
  }
}

const PENDING = "guardian.pending.v1";
type Pending = { v: 1; table: "plays"; record: PlayRecord } | { v: 1; table: "quizzes"; record: QuizRecord };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Shared store on Supabase (tables in supabase/schema.sql). Uses the public "anon" key, which row-level
 * security limits to inserting and reading anonymous records: nobody can change or delete them.
 */
export class SupabaseCommunityStore implements CommunityStore {
  readonly kind = "shared" as const;

  constructor(
    private url: string,
    private anonKey: string,
    private fetcher: Fetch = (u, i) => fetch(u, i),
    private limit = 2000,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, "Content-Type": "application/json", ...extra };
  }

  private async insert(table: string, row: Record<string, unknown>): Promise<void> {
    const res = await this.fetcher(`${this.url}/rest/v1/${table}`, {
      method: "POST",
      headers: this.headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  }

  private async select<T>(table: string, columns: string, eq: Record<string, string | undefined>): Promise<T[]> {
    const params = new URLSearchParams({ select: columns, order: "id.desc", limit: String(this.limit) });
    for (const [column, value] of Object.entries(eq)) if (value !== undefined) params.append(column, `eq.${value}`);
    const res = await this.fetcher(`${this.url}/rest/v1/${table}?${params}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    return (await res.json()) as T[];
  }

  async submit(r: PlayRecord): Promise<void> {
    await this.insert("plays", {
      monument: r.monument,
      level: r.level,
      picks: r.picks,
      score: r.score,
      detected: r.detected,
      day: r.day,
      class_code: r.classCode ?? null,
    });
  }

  async submitQuiz(r: QuizRecord): Promise<void> {
    await this.insert("quizzes", { monument: r.monument, pre: r.pre, post: r.post, day: r.day, class_code: r.classCode ?? null });
  }

  async plays(f: PlayFilter = {}): Promise<PlayRecord[]> {
    type Row = Omit<PlayRecord, "v" | "classCode"> & { class_code: string | null };
    const rows = await this.select<Row>("plays", "monument,level,picks,score,detected,day,class_code", {
      monument: f.monument,
      level: f.level,
      class_code: f.classCode,
    });
    return rows.map(({ class_code, ...r }) => ({ v: 1, ...r, ...(class_code ? { classCode: class_code } : {}) }));
  }

  async quizzes(f: { classCode?: string } = {}): Promise<QuizRecord[]> {
    type Row = Omit<QuizRecord, "v" | "classCode"> & { class_code: string | null };
    const rows = await this.select<Row>("quizzes", "monument,pre,post,day,class_code", { class_code: f.classCode });
    return rows.map(({ class_code, ...r }) => ({ v: 1, ...r, ...(class_code ? { classCode: class_code } : {}) }));
  }
}

/**
 * Shared when it can be, local when it cannot: every record is also kept on this device, records that
 * fail to send are queued and retried on the next write or read, and reads fall back to this device.
 */
export class SharedWithFallback implements CommunityStore {
  private lastReadShared = true;

  constructor(private shared: CommunityStore, private local: LocalCommunityStore) {}

  get kind(): "local" | "shared" {
    return this.lastReadShared ? "shared" : "local";
  }

  private async flush(): Promise<void> {
    const waiting = this.local.pending();
    if (!waiting.length) return;
    const left: Pending[] = [];
    for (const item of waiting) {
      try {
        if (item.table === "plays") await this.shared.submit(item.record);
        else await this.shared.submitQuiz(item.record);
      } catch {
        left.push(item);
      }
    }
    this.local.setPending(left);
  }

  async submit(record: PlayRecord): Promise<void> {
    await this.local.submit(record);
    await this.flush();
    try {
      await this.shared.submit(record);
    } catch {
      this.local.queue({ v: 1, table: "plays", record });
    }
  }

  async submitQuiz(record: QuizRecord): Promise<void> {
    await this.local.submitQuiz(record);
    await this.flush();
    try {
      await this.shared.submitQuiz(record);
    } catch {
      this.local.queue({ v: 1, table: "quizzes", record });
    }
  }

  private async read<T>(shared: () => Promise<T>, local: () => Promise<T>): Promise<T> {
    try {
      const result = await shared();
      this.lastReadShared = true;
      return result;
    } catch {
      this.lastReadShared = false;
      return local();
    }
  }

  plays(filter: PlayFilter = {}): Promise<PlayRecord[]> {
    return this.read(() => this.shared.plays(filter), () => this.local.plays(filter));
  }

  quizzes(filter: { classCode?: string } = {}): Promise<QuizRecord[]> {
    return this.read(() => this.shared.quizzes(filter), () => this.local.quizzes(filter));
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
