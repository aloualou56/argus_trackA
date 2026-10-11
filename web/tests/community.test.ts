import { describe, expect, it } from "vitest";
import { LocalCommunityStore, summarize, summarizeQuiz, topCard, type PlayRecord, type QuizRecord } from "../src/community/store";

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
    expect((await store.summary("ranverso", "extreme")).games).toBe(2);
    expect((await store.summary("ranverso", "extreme", "ABC123")).games).toBe(1);
    expect((await store.summary("delos", "extreme")).games).toBe(0);
  });

  it("keeps at most `max` records", async () => {
    const store = new LocalCommunityStore(new MemoryStorage() as unknown as Storage, 3);
    for (let i = 0; i < 5; i++) await store.submit(play({ humidity: 1 }, { score: i }));
    const s = await store.summary("ranverso", "extreme");
    expect(s.games).toBe(3);
    expect(s.averageScore).toBe(3);
  });

  it("still works in memory when storage is blocked", async () => {
    const store = new LocalCommunityStore(new BrokenStorage() as unknown as Storage);
    await store.submit(play({ humidity: 1 }));
    expect((await store.summary("ranverso", "extreme")).games).toBe(1);
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
    expect((await store.quizSummary("ABC123")).games).toBe(1);
    expect((await store.quizSummary()).games).toBe(2);
    expect((await store.summary("ranverso", "extreme")).games).toBe(0);
  });
});
