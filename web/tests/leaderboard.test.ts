import { describe, expect, it } from "vitest";
import { leaderboard, standing } from "../src/community/leaderboard";
import { signIn } from "../src/community/account";
import { isNick, nickParts, playerKey, userName, userNick } from "../src/community/nickname";
import type { PlayRecord } from "../src/community/store";

const play = (nick: string | undefined, score: number, day = "2026-10-16", monument = "delos", level = "medium"): PlayRecord => ({
  v: 1, monument, level, picks: {}, score, detected: true, day, ...(nick ? { nick } : {}),
});

describe("leaderboard names", () => {
  it("are, from older games, an animal of the list and a number", () => {
    expect(isNick("owl-27")).toBe(true);
    expect(isNick("maria-27")).toBe(false); // not an animal of the list
    expect(isNick("owl-7")).toBe(false);
    expect(isNick("owl-27 <b>")).toBe(false);
    expect(nickParts("fox-58")).toEqual({ animal: "fox", number: "58", emoji: "🦊" });
  });

  it("are, for an account, the name and six characters made from it and the password, never the password", () => {
    const maria = userNick("  Μαρία  ", "1234");
    expect(maria).toMatch(/^u:Μαρία#[0-9a-z]{6}$/);
    expect(maria).not.toContain("1234");
    expect(userName(maria)).toBe("Μαρία");
    expect(isNick(maria)).toBe(true);
    expect(userNick("Μαρία", "1234")).toBe(maria); // the same on every device
    expect(userNick("Μαρία", "4321")).not.toBe(maria);
    expect(userNick("Μαρία", "")).toMatch(/^u:Μαρία#/); // an empty password is a password
    expect(playerKey(userNick("μαρία", "1234"))).toBe(playerKey(maria)); // capitals do not matter
    expect(playerKey(userNick("ΜΑΡΙΑ", "1234"))).toBe(playerKey(maria)); // nor accents
    for (const bad of ["M", "x".repeat(21), "-maria", "maria<b>", "a/b", "   "]) expect(() => userNick(bad, "")).toThrow();
    expect(userName(userNick(" Άννα \n Μ. ", ""))).toBe("Άννα Μ."); // spaces tidied, not refused
    expect(isNick("u:Maria#ABC")).toBe(false);
  });
});

describe("saving a score under an account", () => {
  const saved = [play(userNick("Μαρία", "1234"), 70), play("owl-27", 50)];

  it("makes a new account for a free name, signs in with the right password, refuses another", () => {
    expect(signIn(saved, "Νίκος", "")).toMatchObject({ kind: "new", name: "Νίκος" });
    expect(signIn(saved, "μαρία", "1234")).toMatchObject({ kind: "known" });
    expect(signIn(saved, "Μαρία", "0000")).toEqual({ kind: "taken", name: "Μαρία" });
    expect(signIn(saved, "!", "")).toEqual({ kind: "bad" });
  });

  it("puts an account on the board once, whatever capitals were typed", () => {
    const rows = leaderboard([...saved, play(userNick("μαρία", "1234"), 90)], { monument: "delos" });
    expect(rows.map((r) => [userName(r.nick) ?? r.nick, r.score, r.games])).toEqual([
      ["Μαρία", 90, 2],
      ["owl-27", 50, 1],
    ]);
    expect(standing(rows, userNick("ΜΑΡΙΑ", "1234")).rank).toBe(1);
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
