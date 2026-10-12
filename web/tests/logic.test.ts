/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  autoPrompts,
  canAdd,
  cardById,
  checklistFor,
  coinsLeft,
  compareMix,
  clusterPoints,
  nativeZoom,
  countPicks,
  coverage,
  distanceMeters,
  nearestToArgus,
  placeNear,
  detects,
  featuredAlarm,
  humanCards,
  isPlayable,
  markQuiz,
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
  it("has five playable monuments, each with a story and a budget", () => {
    expect(data.monuments.filter(isPlayable)).toHaveLength(5);
    for (const m of data.monuments.filter(isPlayable)) expect(m.budget, m.pilot_key).toBeGreaterThan(0);
  });

  it("lets every level of every monument reach a full score within the budget, but not buy everything", () => {
    for (const mon of data.monuments.filter(isPlayable)) {
      for (const lv of mon.levels.filter((l) => l.available)) {
        const threats = missionScenarios(mon, lv.id);
        const alarm = featuredAlarm(mon, lv.id);
        const rule = alarm && ruleFor(data, mon, alarm);
        // Cheapest set of cards (one of each) that gives 100: try every subset of the relevant cards.
        const relevant = [...new Set([...threats.flatMap((s) => s.primary_cards), ...(rule?.detect_with.flat() ?? [])])];
        let perfect = Infinity;
        for (let mask = 0; mask < 1 << relevant.length; mask++) {
          const picks = Object.fromEntries(relevant.filter((_, i) => mask & (1 << i)).map((c) => [c, 1]));
          const s = score(threats, rule, picks, cards);
          if (s.total === 100) perfect = Math.min(perfect, s.spentCoins);
        }
        expect(perfect, `${mon.pilot_key} ${lv.id}`).toBeLessThanOrEqual(mon.budget);
        // ...but buying every card that helps does not fit, so the player has to choose.
        const everything = new Set([...threats.flatMap((s) => s.capable_cards), ...(rule?.detect_with.flat() ?? [])]);
        const all = [...everything].reduce((sum, c) => sum + cards.get(c)!.cost, 0);
        expect(all, `${mon.pilot_key} ${lv.id}`).toBeGreaterThan(mon.budget);
      }
    }
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

  it("a full score fits the budget, but buying every helpful card does not", () => {
    for (const lv of ranverso.levels.filter((l) => l.available)) {
      const threats = missionScenarios(ranverso, lv.id);
      const rule = ruleFor(data, ranverso, featuredAlarm(ranverso, lv.id)!)!;
      // Upper bound for a perfect network: the cheapest primary card per threat plus the cheapest alarm card.
      const cheapest = (ids: string[]) => Math.min(...ids.map((c) => cards.get(c)!.cost));
      const perfect = threats.reduce((sum, s) => sum + cheapest(s.primary_cards), 0) + cheapest(rule.detect_with[0]);
      expect(perfect, lv.id).toBeLessThanOrEqual(ranverso.budget);
      const everything = new Set([...threats.flatMap((s) => s.capable_cards), ...rule.detect_with.flat()]);
      expect([...everything].reduce((sum, c) => sum + cards.get(c)!.cost, 0), lv.id).toBeGreaterThan(ranverso.budget);
    }
  });

  it("every threat that a card can help with has at least one primary card", () => {
    for (const s of ranverso.scenarios) {
      expect(s.primary_cards.every((c) => s.capable_cards.includes(c)), s.scenario_key).toBe(true);
      expect(s.primary_cards.length > 0, s.scenario_key).toBe(s.capable_cards.length > 0);
    }
  });

  it("never replays an alarm from a flat (probably stuck) sensor", () => {
    for (const lv of ranverso.levels.filter((l) => l.available)) {
      expect(featuredAlarm(ranverso, lv.id)!.quality_flags, lv.id).not.toContain("flat_signal");
    }
  });
});

describe("human observer", () => {
  const observer = cards.get("observer")!;

  it("is a human card without ARGUS instruments or a map pin", () => {
    expect(observer.kind).toBe("human");
    expect(observer.instrument_types).toEqual([]);
    expect(observer.on_map).toBe(false);
    expect(humanCards(data)).toEqual(new Set(["observer"]));
  });

  it("never detects an AD-RT alarm", () => {
    for (const rule of Object.values(data.rule_sensor_map)) expect(detects(rule, { observer: 5 }).detected).toBe(false);
  });

  it("watches woodworm directly", () => {
    const woodworm = missionScenarios(ranverso, "extreme").find((s) => s.scenario_key === "ranverso.pests.woodworms")!;
    expect(coverage(woodworm, { observer: 1 })).toMatchObject({ level: "full", by: ["observer"] });
  });

  it("is left out of the comparison with ARGUS", () => {
    const rows = compareMix(ranverso, { observer: 1, humidity: 1 }, humanCards(data));
    expect(rows.some((r) => r.card === "observer")).toBe(false);
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
  // Extreme: groundwater (primary soil moisture), woodworm (primary acoustic or observer),
  // long damp periods (primary humidity); replayed alarm: 7-day rain (rain gauge or weather station).
  const threats = missionScenarios(ranverso, "extreme");
  const rule = ruleFor(data, ranverso, featuredAlarm(ranverso, "extreme")!);
  const perfect = { soil_moisture: 1, observer: 1, humidity: 1, rain_gauge: 1 };

  it("gives full marks for watching every threat directly and catching the alarm", () => {
    const s = score(threats, rule, perfect, cards);
    expect([s.full, s.partial]).toEqual([3, 0]);
    expect(s.alarm).toEqual({ points: 25, max: 25, detected: true });
    expect(s.total).toBe(100);
    expect(s.verdict).toBe("excellent");
  });

  it("no longer gives full marks to one cheap sensor that only supports most threats", () => {
    const s = score(threats, rule, { humidity: 1 }, cards);
    expect([s.full, s.partial]).toEqual([1, 2]);
    expect(s.alarm?.detected).toBe(false);
    expect(s.total).toBeLessThan(60);
  });

  it("costs points when the network misses the real alarm", () => {
    const { rain_gauge: _, ...noRain } = perfect;
    const s = score(threats, rule, noRain, cards);
    expect(s.alarm?.points).toBe(0);
    expect(s.total).toBe(75);
  });

  it("counts coins spent on the replayed alarm's sensor as useful", () => {
    const s = score(threats, rule, { humidity: 1, rain_gauge: 1 }, cards);
    expect(s.usefulCoins).toBe(s.spentCoins);
  });

  it("lowers efficiency for sensors that help with none of the dangers", () => {
    const s = score(threats, rule, { ...perfect, crackmeter: 2 }, cards);
    expect(s.full).toBe(3);
    expect(s.efficiency.points).toBeLessThan(15);
    expect(s.total).toBeLessThan(100);
  });

  it("scales to 100 over the parts that apply when there is no alarm to replay", () => {
    const s = score(threats, null, { soil_moisture: 1, observer: 1, humidity: 1 }, cards);
    expect(s.alarm).toBeNull();
    expect(s.total).toBe(100);
  });

  it("scores zero for an empty network", () => {
    const s = score(threats, rule, {}, cards);
    expect(s.total).toBe(0);
    expect(s.verdict).toBe("start");
  });

  it("reports full, partial or no cover, primary cards first", () => {
    const groundwater = threats[0];
    expect(coverage(groundwater, { humidity: 1, soil_moisture: 1, crackmeter: 1 })).toMatchObject({
      level: "full",
      by: ["soil_moisture", "humidity"],
    });
    expect(coverage(groundwater, { humidity: 1 }).level).toBe("partial");
    expect(coverage(groundwater, { crackmeter: 1 })).toMatchObject({ level: "none", by: [] });
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

  it("never asks for satellite tiles deeper than the real imagery at a monument", () => {
    const satellite = data.basemaps.layers.find((l) => l.id === "satellite")!;
    for (const mon of data.monuments) {
      const measured = mon.map?.max_native_zoom?.satellite;
      expect(measured, mon.pilot_key).toBeDefined();
      expect(nativeZoom(satellite, mon)).toBe(measured);
    }
    const delos = data.monuments.find((m) => m.pilot_key === "delos")!;
    expect(nativeZoom(satellite, delos)).toBeLessThan(19); // Esri has no zoom-19 imagery there
    expect(nativeZoom(satellite, null)).toBe(satellite.max_native_zoom); // Europe overview
    expect(nativeZoom(satellite, { map: null })).toBe(satellite.max_native_zoom);
  });

  it("has a map view and real sensor positions for the playable monument", () => {
    expect(ranverso.map).not.toBeNull();
    expect(ranverso.installed.points.length).toBeGreaterThan(0);
    for (const alarm of ranverso.alarms) expect(alarm.instruments.some((i) => i.lat !== null)).toBe(true);
  });
});

describe("quiz", () => {
  const questions = data.quiz.questions;

  it("has five bilingual questions with a valid answer", () => {
    expect(questions).toHaveLength(5);
    for (const q of questions) {
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(q.options.length);
      for (const text of [q.question, q.explain, ...q.options]) expect(text.el && text.en).toBeTruthy();
    }
  });

  it("does not always put the right answer in the same place", () => {
    expect(new Set(questions.map((q) => q.correct)).size).toBeGreaterThan(1);
  });

  it("marks right, wrong and unanswered questions", () => {
    const answers = questions.map((q, i) => (i === 0 ? q.correct : i === 1 ? (q.correct + 1) % q.options.length : null));
    expect(markQuiz(questions, answers)).toEqual([true, false, false, false, false]);
  });
});

describe("citizen checklist", () => {
  it("puts the items about this mission's dangers first and marks them", () => {
    const threats = missionScenarios(ranverso, "extreme"); // water, pests, relative humidity
    const rows = checklistFor(data.checklist.items, threats);
    expect(rows).toHaveLength(data.checklist.items.length);
    const marked = rows.filter((r) => r.forMission).map((r) => r.item.id);
    expect(marked).toEqual(expect.arrayContaining(["damp", "insects"]));
    expect(rows.slice(0, marked.length).every((r) => r.forMission)).toBe(true);
  });
});
