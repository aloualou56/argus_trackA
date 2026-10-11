import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  autoPrompts,
  canAdd,
  cardById,
  coinsLeft,
  compareMix,
  coverage,
  detects,
  featuredAlarm,
  isPlayable,
  missionScenarios,
  ruleFor,
  score,
  withChange,
} from "../src/game/logic";
import type { GameData, Monument, RuleEntry } from "../src/game/types";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;
const ranverso = data.monuments.find((m) => m.pilot_key === "ranverso") as Monument;
const cards = cardById(data);

describe("data pack", () => {
  it("has one playable monument with a story and a budget", () => {
    expect(data.monuments.filter(isPlayable).map((m) => m.pilot_key)).toEqual(["ranverso"]);
    expect(ranverso.budget).toBeGreaterThan(0);
  });

  it("offers every available level a 3-threat mission and a real alarm", () => {
    for (const lv of ranverso.levels.filter((l) => l.available)) {
      expect(missionScenarios(ranverso, lv.id)).toHaveLength(3);
      const alarm = featuredAlarm(ranverso, lv.id);
      expect(alarm).not.toBeNull();
      expect(ruleFor(data, ranverso, alarm!)).not.toBeNull();
    }
    expect(() => missionScenarios(ranverso, "catastrophic")).toThrow();
  });

  it("every mission threat can be covered within the budget", () => {
    for (const lv of ranverso.levels.filter((l) => l.available)) {
      const cheapest = missionScenarios(ranverso, lv.id).map((s) =>
        Math.min(...s.capable_cards.map((c) => cards.get(c)!.cost)),
      );
      expect(cheapest.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(ranverso.budget);
    }
  });
});

describe("budget", () => {
  it("adds and removes cards and never goes negative", () => {
    let picks = withChange({}, "humidity", 1);
    picks = withChange(picks, "humidity", 1);
    expect(picks).toEqual({ humidity: 2 });
    expect(coinsLeft(10, picks, cards)).toBe(10 - 2 * cards.get("humidity")!.cost);
    picks = withChange(withChange(picks, "humidity", -1), "humidity", -1);
    expect(picks).toEqual({});
    expect(withChange({}, "humidity", -1)).toEqual({});
  });

  it("blocks a card the player cannot afford", () => {
    const camera = cards.get("camera")!;
    const picks = { camera: 2 };
    expect(coinsLeft(10, picks, cards)).toBe(10 - 2 * camera.cost);
    expect(canAdd(camera, 10, picks, cards)).toBe(10 - 2 * camera.cost >= camera.cost);
    expect(canAdd(camera, camera.cost - 1, {}, cards)).toBe(false);
  });
});

describe("detection", () => {
  const rain: RuleEntry = data.rule_sensor_map["ranverso:R2_rain_7d"];
  const frost: RuleEntry = data.rule_sensor_map["schenkenberg:R1_temp_hum"];

  it("detects with any card of a single group", () => {
    expect(detects(rain, { rain_gauge: 1 }).detected).toBe(true);
    expect(detects(rain, { weather_station: 1 }).detected).toBe(true);
    expect(detects(rain, { humidity: 3 })).toEqual({ detected: false, matched: [], missing: [rain.detect_with[0]] });
  });

  it("needs one card from every group when a rule has several", () => {
    expect(detects(frost, { temperature: 1 }).detected).toBe(false);
    expect(detects(frost, { temperature: 1, humidity: 1 }).detected).toBe(true);
    expect(detects(frost, { weather_station: 1 }).detected).toBe(true);
  });
});

describe("score", () => {
  const threats = missionScenarios(ranverso, "extreme");
  const rule = ruleFor(data, ranverso, featuredAlarm(ranverso, "extreme")!);

  it("gives full marks for covering all threats with only useful cards", () => {
    const s = score(threats, rule, { humidity: 1, soil_moisture: 1 }, cards);
    expect(s.covered).toBe(3);
    expect(s.total).toBe(100);
    expect(s.verdict).toBe("excellent");
  });

  it("counts coins spent on the replayed alarm's sensor as useful", () => {
    const s = score(threats, rule, { humidity: 1, rain_gauge: 1 }, cards);
    expect(s.usefulCoins).toBe(s.spentCoins);
  });

  it("lowers efficiency for sensors that help with none of the dangers", () => {
    const s = score(threats, rule, { humidity: 1, crackmeter: 2 }, cards);
    expect(s.covered).toBe(3);
    expect(s.efficiencyPoints).toBeLessThan(25);
    expect(s.total).toBeLessThan(100);
  });

  it("scores zero for an empty network", () => {
    const s = score(threats, rule, {}, cards);
    expect(s.total).toBe(0);
    expect(s.verdict).toBe("start");
  });

  it("reports which of the player's cards cover a threat", () => {
    const groundwater = threats[0];
    expect(coverage(groundwater, { soil_moisture: 1, crackmeter: 1 })).toMatchObject({
      covered: true,
      by: ["soil_moisture"],
    });
  });
});

describe("reveal", () => {
  it("lists every card used by either side, ARGUS-heavy first", () => {
    const rows = compareMix(ranverso, { crackmeter: 1, humidity: 1 });
    expect(rows[0]).toMatchObject({ argus: 3 });
    expect(rows.find((r) => r.card === "crackmeter")).toEqual({ card: "crackmeter", player: 1, argus: 0 });
    const argusTotal = rows.reduce((a, r) => a + r.argus, 0) + ranverso.installed.other.reduce((a, o) => a + o.count, 0);
    expect(argusTotal).toBe(ranverso.installed.distinct_instruments);
  });

  it("turns differences into at most one prompt of each kind", () => {
    const prompts = autoPrompts(compareMix(ranverso, { crackmeter: 1 }));
    expect(prompts.map((p) => p.kind)).toEqual(["many", "onlyYou", "onlyArgus"]);
    expect(prompts.find((p) => p.kind === "onlyYou")?.card).toBe("crackmeter");
  });
});
