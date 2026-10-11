import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  autoPrompts,
  canAdd,
  cardById,
  coinsLeft,
  compareMix,
  clusterPoints,
  countPicks,
  coverage,
  distanceMeters,
  nearestToArgus,
  placeNear,
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

describe("map", () => {
  const at = (card: string, lat: number | null, lng: number | null, id = card) => ({ id, card, lat, lng });

  it("counts placements per card, including cards without a pin", () => {
    expect(countPicks([at("humidity", 45, 7), at("humidity", 45, 7, "h2"), at("satellite", null, null)])).toEqual({
      humidity: 2,
      satellite: 1,
    });
  });

  it("measures metres between points", () => {
    expect(distanceMeters([45, 7], [45.001, 7])).toBeCloseTo(111.3, 0);
    expect(distanceMeters([45, 7], [45, 7.001])).toBeCloseTo(78.7, 0);
  });

  it("never stacks a new pin exactly on another one", () => {
    const base: [number, number] = [45.0812, 7.4497];
    expect(placeNear(base, [])).toEqual(base);
    const first = placeNear(base, [at("humidity", ...base)]);
    expect(distanceMeters(base, first)).toBeCloseTo(3.5, 1);
    const second = placeNear(base, [at("humidity", ...base), at("crackmeter", ...first, "c")]);
    expect(distanceMeters(first, second)).toBeGreaterThan(1);
  });

  it("finds the distance to the nearest ARGUS sensor of the same card", () => {
    const rain = ranverso.installed.points.find((p) => p.instruments.some((i) => i.card === "rain_gauge"))!;
    const d = nearestToArgus(ranverso, [at("rain_gauge", rain.lat + 10 / 111_320, rain.lon), at("crackmeter", 45, 7)]);
    expect(d.get("rain_gauge")).toBeCloseTo(10, 0);
    expect(d.has("crackmeter")).toBe(false); // ARGUS has no crack meter at Ranverso
  });

  it("puts a distance prompt first when a card is on both maps", () => {
    const rows = compareMix(ranverso, { humidity: 1 });
    const prompts = autoPrompts(rows, new Map([["humidity", 12.4]]));
    expect(prompts[0]).toEqual({ kind: "distance", card: "humidity", n: 12 });
  });

  it("merges ARGUS points closer than 2.5 m into one marker without losing instruments", () => {
    const clusters = clusterPoints(ranverso.installed.points);
    expect(clusters.length).toBeLessThan(ranverso.installed.points.length);
    expect(clusters.flatMap((c) => c.instruments)).toHaveLength(
      ranverso.installed.points.reduce((n, p) => n + p.instruments.length, 0),
    );
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++)
        expect(distanceMeters([clusters[i].lat, clusters[i].lon], [clusters[j].lat, clusters[j].lon])).toBeGreaterThan(2.5);
  });

  it("has a map view and real sensor positions for the playable monument", () => {
    expect(ranverso.map).not.toBeNull();
    expect(ranverso.installed.points.length).toBeGreaterThan(0);
    for (const alarm of ranverso.alarms) expect(alarm.instruments.some((i) => i.lat !== null)).toBe(true);
  });
});
