/// <reference types="node" />
// Tests for the newest from ARGUS on the first screen (src/game/live.ts): which alarms it can explain
// (exactly the data build's choice, checked on the snapshot), what it shows and when it shows nothing.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explainAlarm, formatWhen, liveView, parseLive, type LiveAlarm, type LiveFile } from "../src/game/live";
import { formatReading, isPlayable } from "../src/game/logic";
import type { GameData, Monument } from "../src/game/types";
import { makeI18n } from "../src/i18n";

const repo = new URL("../../", import.meta.url);
const data = JSON.parse(readFileSync(new URL("web/public/data/game_data.json", repo), "utf8")) as GameData;
const monument = (pilot: string) => data.monuments.find((m) => m.pilot_key === pilot) as Monument;

/** The snapshot the data build reads: the one fetched last (tools/build_game_data.py, latest_snapshot). */
function latestSnapshot(): URL | null {
  const found = readdirSync(repo)
    .filter((name) => name.startsWith("snapshot") && existsSync(new URL(`${name}/assets.json`, repo)))
    .map((name) => ({ name, at: JSON.parse(readFileSync(new URL(`${name}/assets.json`, repo), "utf8")).fetched_at as string }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return found.length ? new URL(`${found[0].name}/`, repo) : null;
}

type RawAlarm = {
  site?: string;
  type?: string;
  rule?: string | null;
  timestamp?: string;
  variables?: { name?: string | null; value?: unknown; threshold?: unknown }[];
  score?: unknown;
  threshold?: unknown;
  top_feature_contributions?: Record<string, unknown>;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** An ARGUS alarm as the Pi publishes it (tools/pi/guardian_live.py, sensor_alarm). */
function asPublished(a: RawAlarm): LiveAlarm {
  const shares = Object.entries(a.top_feature_contributions ?? {}).filter(([, v]) => num(v) !== null) as [string, number][];
  const top = shares.reduce<[string, number] | null>((best, s) => (!best || s[1] > best[1] ? s : best), null);
  return {
    timestamp: a.timestamp!,
    type: a.type!,
    rule: a.rule ?? null,
    variables: (a.variables ?? []).slice(0, 3).map((v) => ({ name: v.name ?? null, value: num(v.value), threshold: num(v.threshold) })),
    score: num(a.score),
    threshold: num(a.threshold),
    top_feature: top && { name: top[0], share: top[1] },
  };
}

const snapshot = latestSnapshot();

describe.skipIf(!snapshot)("the newest alarms are explained as the data build explains them", () => {
  it("keeps, for every monument, exactly the snapshot alarms the build kept", () => {
    const records = (JSON.parse(readFileSync(new URL("events.json", snapshot!), "utf8")).records as { id: number; metadata: unknown }[])
      .slice()
      .sort((a, b) => a.id - b.id);
    for (const mon of data.monuments.filter(isPlayable)) {
      const unique = new Map<string, RawAlarm>();
      for (const record of records) {
        const m = (typeof record.metadata === "string" ? JSON.parse(record.metadata) : record.metadata) as { kind?: string; alarm?: RawAlarm } | null;
        const a = m?.alarm;
        if (m?.kind !== "ad_rt_event" || !a || a.site !== mon.pilot_key) continue;
        const names = (a.variables ?? []).map((v) => v.name ?? null);
        const key = JSON.stringify([a.type, a.rule, a.timestamp, names.length ? names : Object.keys(a.top_feature_contributions ?? {}).sort()]);
        if (!unique.has(key)) unique.set(key, a);
      }
      const kept = [...unique.values()].filter((a) => explainAlarm(asPublished(a), mon.pilot_key, data)).length;
      const funnel = (mon as Monument & { alarm_funnel: { unique: number; usable: number } }).alarm_funnel;
      expect(unique.size, mon.pilot_key).toBe(funnel.unique);
      expect(kept, mon.pilot_key).toBe(funnel.usable);
    }
  });
});

const alarm = (over: Partial<LiveAlarm>): LiveAlarm => ({
  timestamp: "2026-10-02T20:30:00",
  type: "EK",
  rule: "R2_wind",
  variables: [{ name: "300548_wind_speed_1", value: 12.4333, threshold: 12 }],
  score: 0.509,
  threshold: null,
  top_feature: null,
  ...over,
});

describe("explainAlarm", () => {
  it("explains an expert-rule alarm by its rule", () => {
    const found = explainAlarm(alarm({}), "delos", data);
    expect(found?.rule).toBe("R2_wind");
    expect(found?.value).toBe(12.4333);
    expect(found?.entry).toBe(data.rule_sensor_map["delos:R2_wind"]);
  });
  it("turns an AI alarm into the pseudo-rule of the signal that drove it, if it clearly did", () => {
    const ai = (share: number, name = "149368_h_masks_in_room215_2_soil_moisture") =>
      alarm({ type: "DL", rule: null, variables: [], score: 0.0326, threshold: 0.0241, top_feature: { name, share } });
    expect(explainAlarm(ai(0.6042), "delos", data)?.rule).toBe("DL_soil_moisture");
    expect(explainAlarm(ai(data.alarm_filter.dl_min_share - 0.01), "delos", data)).toBeNull();
    expect(explainAlarm(ai(0.9, "400212_wind_direction_1_cos"), "delos", data)).toBeNull(); // not mapped
  });
  it("leaves out what the game leaves out", () => {
    expect(explainAlarm(alarm({ rule: "R99_unknown" }), "delos", data)).toBeNull();
    expect(explainAlarm(alarm({ rule: null }), "delos", data)).toBeNull();
    expect(explainAlarm(alarm({ variables: [] }), "delos", data)).toBeNull();
    expect(explainAlarm(alarm({ variables: [{ name: "x", value: 3, threshold: 0 }] }), "delos", data)).toBeNull();
    // Ranverso, 29 September: humidity 143% and a soil probe at exactly 0 (a dropout)
    expect(explainAlarm(alarm({ rule: "R1_hum_inside", variables: [{ name: "168442_in_left_altar_hum", value: 143, threshold: 80 }] }), "ranverso", data)).toBeNull();
    expect(explainAlarm(alarm({ rule: "R4b_soil_low", variables: [{ name: "26680f_moisture", value: 0, threshold: 5 }] }), "ranverso", data)).toBeNull();
    // a rule's own range: a long-term temperature drift of 55 degrees is not believable
    expect(explainAlarm(alarm({ rule: "R9a_temp_lt", variables: [{ name: "300286_temp1", value: 54.9559, threshold: 20 }] }), "lucretili", data)).toBeNull();
  });
});

const NOW = new Date("2026-10-14T09:15:00Z");
const check = (key: string, probability: number, state = "inactive") => ({
  key,
  state,
  probability,
  thresholds: { watch: 0.1, active: 0.25, escalated: 0.5 },
  previous_state: "inactive",
  evaluated_at: "2026-10-13T21:00:33Z",
});
const file = (site: object): LiveFile => parseLive({ schema: 1, checked_at: "2026-10-14T09:00:00Z", sites: { delos: site } })!;
const delos = monument("delos");
const [first, second, third] = delos.scenarios.map((s) => s.scenario_key);

describe("liveView", () => {
  it("last night's check, all quiet: the danger nearest its watch level", () => {
    const view = liveView(
      file({ risk: { evaluated_at: "2026-10-13T21:00:33Z", scenarios: [check(first, 0.02), check(second, 0.0789), check(third, 0.001)] } }),
      data,
      delos,
      NOW,
    )!;
    expect(view.risk?.fresh).toBe(true);
    expect(view.risk?.checked).toBe(3);
    expect(view.risk?.raised).toEqual([]);
    expect(view.risk?.closest?.scenario.scenario_key).toBe(second);
    expect(view.risk?.closest?.watch).toBe(0.1);
    expect(view.alarm).toBeNull();
  });
  it("raised dangers, the most serious first, and no 'nearest' then", () => {
    const view = liveView(
      file({ risk: { evaluated_at: "2026-10-13T21:00:33Z", scenarios: [check(first, 0.12, "watch"), check(second, 0.6, "escalated"), check("not.in.the.game", 0.3, "active"), check(third, 0.01)] } }),
      data,
      delos,
      NOW,
    )!;
    expect(view.risk?.raised.map((r) => [r.state, r.scenario?.scenario_key ?? null])).toEqual([
      ["escalated", second],
      ["active", null],
      ["watch", first],
    ]);
    expect(view.risk?.closest).toBeNull();
  });
  it("an old check shows its date, not 'live'; a very old one is not shown", () => {
    const at = (iso: string) => liveView(file({ risk: { evaluated_at: iso, scenarios: [check(first, 0.02)] } }), data, delos, NOW);
    expect(at("2026-10-10T21:00:00Z")?.risk?.fresh).toBe(false);
    expect(at("2026-09-29T21:02:59Z")).toBeNull(); // Ranverso's checks stopped then
    expect(at("2026-10-14T12:00:00Z")).toBeNull(); // in the future: a clock is wrong somewhere
  });
  it("the newest alarm the game can explain, skipping the others", () => {
    const view = liveView(
      file({
        alarms: [
          alarm({ timestamp: "2026-10-03T20:30:00", rule: "R99_unknown" }),
          alarm({ timestamp: "2026-10-02T20:30:00" }),
          alarm({ timestamp: "2026-09-29T20:30:00", rule: "R1a_rain_1h" }),
        ],
      }),
      data,
      delos,
      NOW,
    )!;
    expect(view.risk).toBeNull();
    expect(view.alarm).toMatchObject({ timestamp: "2026-10-02T20:30:00", ai: false, value: 12.4333, threshold: 12 });
    expect(liveView(file({ alarms: [alarm({ timestamp: "2026-07-01T20:30:00" })] }), data, delos, NOW)).toBeNull(); // too old
  });
  it("nothing to show: no file, another monument, nothing usable", () => {
    expect(liveView(null, data, delos, NOW)).toBeNull();
    expect(liveView(file({ alarms: [alarm({})] }), data, monument("baltanas"), NOW)).toBeNull();
    expect(liveView(file({ risk: { evaluated_at: "2026-10-13T21:00:33Z", scenarios: [] } }), data, delos, NOW)).toBeNull();
  });
});

describe("parseLive", () => {
  it("refuses another kind of file, and drops what it cannot use", () => {
    expect(parseLive(null)).toBeNull();
    expect(parseLive({ schema: 2, sites: {} })).toBeNull();
    expect(parseLive("<html>")).toBeNull();
    const parsed = parseLive({
      schema: 1,
      checked_at: 5,
      sites: {
        delos: {
          risk: { evaluated_at: "2026-10-13T21:00:33Z", scenarios: [check(first, 0.02), { key: second, state: "watch", probability: "high" }, null] },
          alarms: [alarm({}), { timestamp: "2026-10-02T20:30:00" }, alarm({ variables: [{ name: null, value: Number.NaN, threshold: 2 }] })],
        },
      },
    })!;
    expect(parsed.checked_at).toBe("");
    expect(parsed.sites.delos.risk?.scenarios.map((s) => s.key)).toEqual([first]);
    expect(parsed.sites.delos.alarms).toHaveLength(2);
    expect(parsed.sites.delos.alarms?.[1].variables[0]).toEqual({ name: null, value: null, threshold: 2 });
  });
});

describe("formatWhen", () => {
  // (built from local times, so the visitor's time zone does not matter here)
  const now = new Date(2026, 9, 14, 9, 15);
  it("today and yesterday by name, other days by date, in the visitor's language", () => {
    expect(formatWhen(new Date(2026, 9, 14, 0, 0), now, "en-GB")).toBe("today, 00:00");
    expect(formatWhen(new Date(2026, 9, 13, 23, 2), now, "en-GB")).toBe("yesterday, 23:02");
    expect(formatWhen(new Date(2026, 8, 29, 23, 2), now, "en-GB")).toBe("29 September, 23:02");
    expect(formatWhen(new Date(2026, 9, 13, 23, 2), now, "el-GR")).toBe("χθες, 23:02");
  });
});

describe("formatReading", () => {
  const { number } = makeI18n("en");
  it("never rounds a value onto its limit, and keeps the unit with its number", () => {
    expect(formatReading(0.1292, null, number)).toBe("0.129"); // Schenkenberg's crack, limit 0.1
    expect(formatReading(0.1, null, number)).toBe("0.1");
    expect(formatReading(12.4333, "m/s", number)).toBe("12.4 m/s");
    expect(formatReading(2.5, "%", number)).toBe("2.5%");
    expect(formatReading(143, "%", number)).toBe("143%");
  });
});
