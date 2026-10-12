/// <reference types="node" />
// A week on duty (several real alarms in a row, with the chance to improve the network in between)
// and the challenge link.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { challengeFromUrl, challengeOutcome, challengeQuery } from "../src/game/challenge";
import {
  cardById,
  earlierRules,
  featuredAlarm,
  isPlayable,
  missionPool,
  missionScenarios,
  ruleFor,
  score,
  usefulCards,
  WEEK_DAYS,
  weekAlarms,
} from "../src/game/logic";
import type { GameData, Monument } from "../src/game/types";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;
const monuments = data.monuments.filter(isPlayable);
const monument = (pilot: string) => monuments.find((m) => m.pilot_key === pilot) as Monument;
const cards = cardById(data);

describe("a week on duty", () => {
  it("starts with the level's own alarm and never repeats one", () => {
    for (const mon of monuments) {
      for (const level of mon.levels.filter((l) => l.available)) {
        const week = weekAlarms(mon, level.id);
        const first = featuredAlarm(mon, level.id);
        if (!first) {
          expect(week, `${mon.pilot_key} ${level.id}`).toEqual([]);
          continue;
        }
        expect(week[0].id).toBe(first.id);
        expect(new Set(week.map((a) => a.id)).size).toBe(week.length);
        expect(week.length).toBe(Math.min(WEEK_DAYS, mon.alarms.length));
        for (const alarm of week) expect(ruleFor(data, mon, alarm), alarm.id).not.toBeNull();
      }
    }
  });

  it("has no week where nothing can be replayed (Baltanás), and a full one elsewhere", () => {
    expect(weekAlarms(monument("baltanas"), "high")).toEqual([]);
    for (const pilot of ["delos", "lucretili", "ranverso", "schenkenberg"]) {
      const mon = monument(pilot);
      const level = mon.levels.find((l) => l.available)!;
      expect(weekAlarms(mon, level.id).length, pilot).toBe(WEEK_DAYS);
    }
  });

  it("brings a different kind of alarm on day 2 wherever the monument has one", () => {
    for (const mon of monuments.filter((m) => m.alarms.length)) {
      const kinds = new Set(mon.alarms.map((a) => a.rule)).size;
      for (const level of mon.levels.filter((l) => l.available)) {
        const week = weekAlarms(mon, level.id);
        if (kinds > 1) expect(week[1].rule, `${mon.pilot_key} ${level.id}`).not.toBe(week[0].rule);
      }
    }
    // Monti Lucretili: six kinds of alarm, so the first six days are all different.
    const lucretili = weekAlarms(monument("lucretili"), "extreme");
    expect(new Set(lucretili.slice(0, 6).map((a) => a.rule)).size).toBe(6);
  });

  it("is the same for everyone, and shorter when asked", () => {
    const ranverso = monument("ranverso");
    expect(weekAlarms(ranverso, "extreme").map((a) => a.id)).toEqual(weekAlarms(ranverso, "extreme").map((a) => a.id));
    expect(weekAlarms(ranverso, "extreme", 3)).toHaveLength(3);
  });

  it("includes the alarms of a probably stuck sensor, which day 1 never is", () => {
    const ranverso = monument("ranverso");
    const week = weekAlarms(ranverso, "extreme");
    expect(week[0].quality_flags).not.toContain("flat_signal");
    expect(week.slice(1).some((a) => a.quality_flags.includes("flat_signal"))).toBe(true);
  });

  it("does not count a sensor kept for an earlier day's alarm as wasted coins", () => {
    const ranverso = monument("ranverso");
    const week = weekAlarms(ranverso, "extreme");
    const threats = missionScenarios(ranverso, "extreme");
    const rain = ruleFor(data, ranverso, week[0])!; // day 1: rain over seven days
    const soilDay = week.findIndex((a) => a.rule !== week[0].rule);
    const today = ruleFor(data, ranverso, week[soilDay])!;
    const picks = { rain_gauge: 1, soil_moisture: 1, observer: 1, humidity: 1 };

    expect(earlierRules(data, ranverso, week, 0)).toEqual([]);
    expect(earlierRules(data, ranverso, week, soilDay)).toContain(rain);
    expect(usefulCards(threats, today).has("rain_gauge")).toBe(false);
    expect(usefulCards(threats, today, [rain]).has("rain_gauge")).toBe(true);

    const alone = score(threats, today, picks, cards);
    const inWeek = score(threats, today, picks, cards, earlierRules(data, ranverso, week, soilDay));
    expect(inWeek.usefulCoins).toBe(alone.usefulCoins + cards.get("rain_gauge")!.cost);
    expect(inWeek.total).toBeGreaterThan(alone.total);
    expect(inWeek.total).toBe(100);
  });

  it("leaves day 1's score exactly as it was before there was a week", () => {
    for (const mon of monuments) {
      for (const level of mon.levels.filter((l) => l.available)) {
        const week = weekAlarms(mon, level.id);
        const rule = week[0] ? ruleFor(data, mon, week[0]) : null;
        const threats = missionScenarios(mon, level.id);
        const picks = { humidity: 2, weather_station: 1, camera: 1 };
        expect(score(threats, rule, picks, cards, earlierRules(data, mon, week, 0))).toEqual(score(threats, rule, picks, cards));
      }
    }
  });

  it("rewards improving the network: the same mission scores higher once the missing sensor is added", () => {
    const ranverso = monument("ranverso");
    const threats = missionScenarios(ranverso, "extreme");
    const rule = ruleFor(data, ranverso, weekAlarms(ranverso, "extreme")[0])!;
    const before = score(threats, rule, { soil_moisture: 1, observer: 1, humidity: 1, camera: 1 }, cards);
    const after = score(threats, rule, { soil_moisture: 1, observer: 1, humidity: 1, rain_gauge: 1 }, cards);
    expect(before.alarm?.detected).toBe(false);
    expect(after.alarm?.detected).toBe(true);
    expect(after.total).toBeGreaterThan(before.total);
  });
});

describe("challenge link", () => {
  const delos = monument("delos");
  const own = delos.levels.find((l) => l.id === "high")!.mission!;

  it("carries the monument, the level, the three dangers and the score, and nothing else", () => {
    const query = challengeQuery(delos, "high", own, 68);
    const params = new URLSearchParams(query);
    expect([...params.keys()].sort()).toEqual(["d", "l", "m", "s"]);
    expect(params.get("m")).toBe("delos");
    expect(params.get("l")).toBe("high");
    expect(params.get("d")).toMatch(/^\d+\.\d+\.\d+$/);
    expect(params.get("s")).toBe("68");
    expect(challengeFromUrl(`?${query}`, data)).toEqual({ pilot: "delos", level: "high", mission: own, score: 68 });
  });

  it("round-trips a drawn mission and lives next to a class code", () => {
    const drawn = missionPool(delos, "low").slice(0, 3).map((s) => s.scenario_key);
    const link = `?class=ABC234&${challengeQuery(delos, "low", drawn, 100)}`;
    expect(challengeFromUrl(link, data)).toEqual({ pilot: "delos", level: "low", mission: drawn, score: 100 });
  });

  it("falls back to the level's own mission when the link names no dangers", () => {
    expect(challengeFromUrl("?m=delos&l=high", data)).toEqual({ pilot: "delos", level: "high", mission: own, score: null });
  });

  it("refuses links that are not a game the game could have dealt", () => {
    const ranverso = monument("ranverso");
    const foreign = ranverso.scenarios[0].threat_id;
    const ids = own.map((key) => delos.scenarios.find((s) => s.scenario_key === key)!.threat_id);
    const bad = [
      "",
      "?class=ABC234",
      "?m=atlantis&l=high",
      "?m=delos&l=impossible",
      "?m=ranverso&l=catastrophic", // Ranverso has no Catastrophic level
      `?m=delos&l=high&d=${ids[0]}.${ids[1]}`, // two dangers
      `?m=delos&l=high&d=${ids[0]}.${ids[0]}.${ids[1]}`, // the same danger twice
      `?m=delos&l=high&d=${ids[0]}.${ids[1]}.${foreign}`, // a danger of another monument
      "?m=delos&l=high&d=1.2.x",
    ];
    for (const link of bad) expect(challengeFromUrl(link, data), link).toBeNull();
    // A Catastrophic danger cannot be slipped into a Low game.
    const worst = delos.scenarios.find((s) => s.level === "catastrophic")!.threat_id;
    const low = missionPool(delos, "low").slice(0, 2).map((s) => s.threat_id);
    expect(challengeFromUrl(`?m=delos&l=low&d=${low[0]}.${low[1]}.${worst}`, data)).toBeNull();
  });

  it("ignores a score that is not a score", () => {
    for (const s of ["101", "-5", "abc", "6.5", ""]) expect(challengeFromUrl(`?m=delos&l=high&s=${s}`, data)?.score, s).toBeNull();
    expect(challengeFromUrl("?m=delos&l=high&s=0", data)?.score).toBe(0);
  });

  it("says who won", () => {
    expect(challengeOutcome(80, 68)).toBe("won");
    expect(challengeOutcome(68, 68)).toBe("tied");
    expect(challengeOutcome(55, 68)).toBe("lost");
  });
});
