import { describe, expect, it } from "vitest";
import {
  LocalCommunityStore,
  quizSummaryOf,
  SharedWithFallback,
  summarize,
  summarizeQuiz,
  summaryOf,
  SupabaseCommunityStore,
  topCard,
  type PlayRecord,
  type QuizRecord,
} from "../src/community/store";
import { classCodeFromUrl, newClassCode, normalizeClassCode } from "../src/community/classCode";

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
}

class BrokenStorage {
  getItem = () => {
    throw new Error("blocked");
  };
  setItem = () => {
    throw new Error("blocked");
  };
}

const play = (picks: Record<string, number>, extra: Partial<PlayRecord> = {}): PlayRecord => ({
  v: 1,
  monument: "ranverso",
  level: "extreme",
  picks,
  score: 50,
  detected: false,
  day: "2026-10-11",
  ...extra,
});

describe("community store", () => {
  it("summarises the share of games that used each card", () => {
    const s = summarize([play({ humidity: 2 }), play({ humidity: 1, rain_gauge: 1 }), play({ crackmeter: 1 })]);
    expect(s.games).toBe(3);
    expect(s.cardShare.humidity).toBeCloseTo(2 / 3);
    expect(topCard(s)).toEqual({ card: "humidity", share: 2 / 3 });
  });

  it("can skip cards with no ARGUS count, such as the human observer", () => {
    const s = summarize([play({ observer: 1, humidity: 1 }), play({ observer: 1 })]);
    expect(topCard(s)).toEqual({ card: "observer", share: 1 });
    expect(topCard(s, new Set(["observer"]))).toEqual({ card: "humidity", share: 0.5 });
  });

  it("filters by monument, level and class code", async () => {
    const store = new LocalCommunityStore(new MemoryStorage() as unknown as Storage);
    await store.submit(play({ humidity: 1 }));
    await store.submit(play({ humidity: 1 }, { level: "low" }));
    await store.submit(play({ rain_gauge: 1 }, { classCode: "ABC123" }));
    expect((await summaryOf(store, { monument: "ranverso", level: "extreme" })).games).toBe(2);
    expect((await summaryOf(store, { monument: "ranverso", level: "extreme", classCode: "ABC123" })).games).toBe(1);
    expect((await summaryOf(store, { monument: "delos", level: "extreme" })).games).toBe(0);
  });

  it("keeps at most `max` records", async () => {
    const store = new LocalCommunityStore(new MemoryStorage() as unknown as Storage, 3);
    for (let i = 0; i < 5; i++) await store.submit(play({ humidity: 1 }, { score: i }));
    const s = await summaryOf(store, { monument: "ranverso", level: "extreme" });
    expect(s.games).toBe(3);
    expect(s.averageScore).toBe(3);
  });

  it("still works in memory when storage is blocked", async () => {
    const store = new LocalCommunityStore(new BrokenStorage() as unknown as Storage);
    await store.submit(play({ humidity: 1 }));
    expect((await summaryOf(store, { monument: "ranverso", level: "extreme" })).games).toBe(1);
  });

  it("stores no names or times", async () => {
    const storage = new MemoryStorage();
    await new LocalCommunityStore(storage as unknown as Storage).submit(play({ humidity: 1 }));
    const saved = JSON.parse(storage.getItem("guardian.plays.v1")!)[0];
    expect(Object.keys(saved).sort()).toEqual(["day", "detected", "level", "monument", "picks", "score", "v"]);
  });
});

describe("quiz store", () => {
  const quiz = (pre: boolean[] | null, post: boolean[], classCode?: string): QuizRecord => ({
    v: 1,
    monument: "ranverso",
    pre,
    post,
    day: "2026-10-11",
    ...(classCode ? { classCode } : {}),
  });

  it("averages before and after over games that have both", () => {
    const s = summarizeQuiz([
      quiz([true, false, false], [true, true, false]),
      quiz([false, false, false], [true, true, true]),
      quiz(null, [true, false, false]),
    ]);
    expect(s).toEqual({ games: 3, withPre: 2, averagePre: 0.5, averagePost: 2.5 });
  });

  it("keeps quiz records apart from play records and filters by class", async () => {
    const store = new LocalCommunityStore(new MemoryStorage() as unknown as Storage);
    await store.submitQuiz(quiz([false], [true], "ABC123"));
    await store.submitQuiz(quiz([true], [true]));
    expect((await quizSummaryOf(store, "ABC123")).games).toBe(1);
    expect((await quizSummaryOf(store)).games).toBe(2);
    expect((await summaryOf(store, { monument: "ranverso", level: "extreme" })).games).toBe(0);
  });
});

describe("class codes", () => {
  it("are six characters without look-alikes", () => {
    for (let i = 0; i < 50; i++) expect(newClassCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(newClassCode(() => new Uint8Array([0, 31, 32, 255, 8, 23]))).toBe("A9A9JZ");
  });

  it("accept what people type, and refuse what cannot be a code", () => {
    expect(normalizeClassCode(" abc-234 ")).toBe("ABC234");
    expect(normalizeClassCode("ABC10O")).toBeNull(); // 1, 0 and O are not in the alphabet
    expect(normalizeClassCode("ABC23")).toBeNull();
    expect(classCodeFromUrl("?class=xyz789&review")).toBe("XYZ789");
    expect(classCodeFromUrl("?review")).toBeNull();
  });
});

/** A fake Supabase REST endpoint: keeps rows per table and applies eq. filters. */
function fakeSupabase() {
  const tables: Record<string, Record<string, unknown>[]> = { plays: [], quizzes: [] };
  const calls: { url: string; init?: RequestInit }[] = [];
  let online = true;
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!online) throw new TypeError("Failed to fetch");
    const u = new URL(url);
    const table = u.pathname.split("/").pop()!;
    if (init?.method === "POST") {
      tables[table].push(JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    const filters = [...u.searchParams].filter(([k]) => !["select", "order", "limit"].includes(k));
    const rows = tables[table].filter((row) => filters.every(([k, v]) => `eq.${row[k]}` === v));
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  return { tables, calls, fetcher, setOnline: (v: boolean) => (online = v) };
}

describe("shared store (Supabase REST)", () => {
  it("sends anonymous rows with the anon key and reads them back filtered", async () => {
    const api = fakeSupabase();
    const store = new SupabaseCommunityStore("https://x.supabase.co", "anon-key", api.fetcher);
    await store.submit(play({ humidity: 1 }, { classCode: "ABC234" }));
    await store.submit(play({ rain_gauge: 1 }));
    expect(api.tables.plays[0]).toEqual({
      monument: "ranverso",
      level: "extreme",
      picks: { humidity: 1 },
      score: 50,
      detected: false,
      day: "2026-10-11",
      class_code: "ABC234",
    });
    const headers = api.calls[0].init!.headers as Record<string, string>;
    expect(headers.apikey).toBe("anon-key");
    expect((await store.plays({ classCode: "ABC234" })).map((r) => r.classCode)).toEqual(["ABC234"]);
    expect(await store.plays({ monument: "ranverso", level: "extreme" })).toHaveLength(2);
  });

  it("falls back to this device when offline and sends the queue later", async () => {
    const api = fakeSupabase();
    const local = new LocalCommunityStore(new MemoryStorage() as unknown as Storage);
    const store = new SharedWithFallback(new SupabaseCommunityStore("https://x.supabase.co", "k", api.fetcher), local);
    api.setOnline(false);
    await store.submit(play({ humidity: 1 }));
    await store.submitQuiz({ v: 1, monument: "ranverso", pre: null, post: [true], day: "2026-10-11" });
    expect((await store.plays()).length).toBe(1); // read from this device
    expect(store.kind).toBe("local");
    expect(local.pending()).toHaveLength(2);
    api.setOnline(true);
    await store.submit(play({ rain_gauge: 1 }));
    expect(api.tables.plays).toHaveLength(2);
    expect(api.tables.quizzes).toHaveLength(1);
    expect(local.pending()).toHaveLength(0);
    expect((await store.plays()).length).toBe(2);
    expect(store.kind).toBe("shared");
  });
});
