import { describe, expect, it } from "vitest";
import { leaderboard, standing } from "../src/community/leaderboard";
import { isNick, newNick, nickParts } from "../src/community/nickname";
import type { PlayRecord } from "../src/community/store";

const play = (nick: string | undefined, score: number, day = "2026-10-16", monument = "delos", level = "medium"): PlayRecord => ({
  v: 1, monument, level, picks: {}, score, detected: true, day, ...(nick ? { nick } : {}),
});

describe("guardian names", () => {
  it("are an animal of the list and a number, never typed text", () => {
    for (let i = 0; i < 200; i++) expect(isNick(newNick())).toBe(true);
    expect(isNick("owl-27")).toBe(true);
    expect(isNick("maria-27")).toBe(false); // not an animal of the list
    expect(isNick("owl-7")).toBe(false);
    expect(isNick("owl-27 <b>")).toBe(false);
    expect(nickParts("fox-58")).toEqual({ animal: "fox", number: "58", emoji: "🦊" });
  });
});

describe("the leaderboard", () => {
  const records = [
    play("owl-27", 60, "2026-10-14"),
    play("owl-27", 82, "2026-10-15"),
    play("fox-58", 82, "2026-10-16"),
    play("bee-11", 45),
    play("bee-11", 90, "2026-10-16", "ranverso"),
    play(undefined, 99), // a game from before names: not on the board
  ];

  it("shows each guardian once, with their best score; on a tie, who got there first", () => {
    expect(leaderboard(records, { monument: "delos", level: "medium" }).map((r) => [r.nick, r.score, r.games])).toEqual([
      ["owl-27", 82, 2],
      ["fox-58", 82, 1],
      ["bee-11", 45, 1],
    ]);
    expect(leaderboard(records)[0]).toMatchObject({ nick: "bee-11", score: 90, games: 2 });
  });

  it("says where a player stands and how many points pass the next one", () => {
    const rows = leaderboard(records, { monument: "delos" });
    expect(standing(rows, "bee-11")).toMatchObject({ rank: 3, players: 3, next: { points: 38 } });
    expect(standing(rows, "fox-58")).toMatchObject({ rank: 1, next: null }); // same score as the first
    expect(standing(rows, "wolf-40")).toEqual({ rank: null, players: 3, next: null });
  });
});
