/// <reference types="node" />
// Tests for the decision step, the per-question class results, the class server's store and
// local-only mode, and the translated languages.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classLink } from "../src/community/classCode";
import {
  decisionCounts,
  LanCommunityStore,
  LocalCommunityStore,
  quizByQuestion,
  SharedWithFallback,
  type PlayRecord,
  type QuizRecord,
} from "../src/community/store";
import { featuredAlarm, isPlayable, judgeDecision, STRONG_ALARM, withoutOnlineMaps } from "../src/game/logic";
import type { Alarm, DecisionOption, GameData, Lang } from "../src/game/types";
import { browserLang, isLang, LANGS, makeI18n } from "../src/i18n";
import de from "../src/i18n/de.json";
import en from "../src/i18n/en.json";
import es from "../src/i18n/es.json";
import it_ from "../src/i18n/it.json";
import { readRuntime } from "../src/runtime";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../public/data/game_data.json") as GameData;
const option = (id: string) => data.decisions.options.find((o) => o.id === id) as DecisionOption;
const alarmOf = (pilot: string, level: "low" | "extreme") =>
  featuredAlarm(data.monuments.filter(isPlayable).find((m) => m.pilot_key === pilot)!, level) as Alarm;

describe("what would you do next?", () => {
  it("offers a look-first, a wait and an act-now choice, in both authored languages", () => {
    expect(new Set(data.decisions.options.map((o) => o.stance))).toEqual(new Set(["review", "wait", "act"]));
    for (const o of data.decisions.options) {
      for (const text of [o.label, o.feedback, ...(o.feedback_risky ? [o.feedback_risky] : [])]) {
        expect(text.en.trim(), o.id).not.toBe("");
        expect(text.el.trim(), o.id).not.toBe("");
      }
    }
  });

  it("starts where the ARGUS record starts: looking first, whatever the alarm", () => {
    const rain = alarmOf("ranverso", "extreme");
    expect(judgeDecision(option("inspect"), rain)).toBe("first");
    expect(judgeDecision(option("check_data"), rain)).toBe("first");
    expect(judgeDecision(option("inspect"), null)).toBe("first");
    expect(judgeDecision(option("close"), rain)).toBe("early");
  });

  it("judges waiting by the real alarm: risky when it came back or was strong, fair for a small one-off", () => {
    const rain = alarmOf("ranverso", "extreme"); // 7 alarms in six days, 4.8 times the limit
    expect(rain.episode.alarm_count).toBeGreaterThan(1);
    expect(judgeDecision(option("wait"), rain)).toBe("risky");

    const crack = alarmOf("schenkenberg", "extreme"); // a single alarm, but 4.75 times the limit
    expect(crack.episode.alarm_count).toBe(1);
    expect(crack.times_threshold).toBeGreaterThanOrEqual(STRONG_ALARM);
    expect(judgeDecision(option("wait"), crack)).toBe("risky");

    const wind = alarmOf("delos", "extreme"); // one alarm, wind just over its limit
    expect(wind.episode.alarm_count).toBe(1);
    expect(wind.times_threshold).toBeLessThan(STRONG_ALARM);
    expect(judgeDecision(option("wait"), wind)).toBe("fair");
    expect(judgeDecision(option("wait"), null)).toBe("fair"); // no alarm to replay (Baltanás)
  });

  it("quotes the ARGUS decision record on expert-rule alarms and has none for AI alarms", () => {
    for (const mon of data.monuments.filter(isPlayable)) {
      for (const alarm of mon.alarms) {
        if (alarm.type === "DL") expect(alarm.decision, alarm.id).toBeNull();
        else if (alarm.decision) expect(alarm.decision.text, alarm.id).toMatch(/before intervention/);
      }
    }
    expect(alarmOf("ranverso", "extreme").decision?.text).toBe(
      "Review alarm evidence and affected asset context before intervention.",
    );
    expect(alarmOf("delos", "low").decision).toBeNull(); // an AI alarm
  });
});

describe("class results", () => {
  const quiz = (pre: boolean[] | null, post: boolean[]): QuizRecord => ({ v: 1, monument: "delos", pre, post, day: "2026-10-12" });
  const play = (decision?: string): PlayRecord => ({
    v: 1,
    monument: "delos",
    level: "low",
    picks: { humidity: 1 },
    score: 50,
    detected: false,
    day: "2026-10-12",
    ...(decision ? { decision } : {}),
  });

  it("shows per question how many were right before and after, over the same games", () => {
    const result = quizByQuestion(
      [
        quiz([true, false, false], [true, true, false]),
        quiz([false, false, false], [true, true, true]),
        quiz(null, [true, true, true]), // skipped the first quiz: not counted
        quiz([true], [true]), // another quiz length: not counted
      ],
      3,
    );
    expect(result.games).toBe(2);
    expect(result.questions).toEqual([
      { pre: 0.5, post: 1 },
      { pre: 0, post: 1 },
      { pre: 0, post: 0.5 },
    ]);
  });

  it("is empty, not broken, when nobody did both quizzes", () => {
    expect(quizByQuestion([quiz(null, [true, true])], 2)).toEqual({ games: 0, questions: [{ pre: 0, post: 0 }, { pre: 0, post: 0 }] });
  });

  it("counts what the class would do first, leaving out games without a choice", () => {
    expect(decisionCounts([play("inspect"), play("inspect"), play("wait"), play()])).toEqual({ inspect: 2, wait: 1 });
  });
});

/** A fake class server (tools/class_server.py): keeps records and applies the filters. */
function fakeClassServer() {
  const kept: Record<string, Record<string, unknown>[]> = { plays: [], quizzes: [] };
  const calls: { url: string; init?: RequestInit }[] = [];
  let online = true;
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!online) throw new TypeError("Failed to fetch");
    const u = new URL(url);
    const kind = u.pathname.split("/").pop()!;
    if (init?.method === "POST") {
      kept[kind].push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }
    const field: Record<string, string> = { class: "classCode", monument: "monument", level: "level" };
    const records = kept[kind].filter((r) => [...u.searchParams].every(([k, v]) => r[field[k]] === v));
    return new Response(JSON.stringify({ records }), { status: 200 });
  };
  return { kept, calls, fetcher, setOnline: (v: boolean) => (online = v) };
}

describe("class server store", () => {
  const record: PlayRecord = {
    v: 1,
    monument: "ranverso",
    level: "extreme",
    picks: { rain_gauge: 1 },
    score: 80,
    detected: true,
    day: "2026-10-12",
    classCode: "ABC234",
    decision: "inspect",
  };

  it("sends the same anonymous record as JSON and reads it back by class", async () => {
    const api = fakeClassServer();
    const store = new LanCommunityStore("http://192.168.1.20:8765/api/", api.fetcher);
    await store.submit(record);
    await store.submit({ ...record, classCode: "XYZ789" });
    expect(api.calls[0].url).toBe("http://192.168.1.20:8765/api/plays");
    expect((api.calls[0].init!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(api.kept.plays[0]).toEqual(record);
    expect(await store.plays({ classCode: "ABC234" })).toEqual([record]);
    expect(api.calls.at(-1)!.url).toBe("http://192.168.1.20:8765/api/plays?class=ABC234");
    expect(await store.plays({ monument: "ranverso", level: "extreme" })).toHaveLength(2);
  });

  it("keeps working on the device when the teacher's computer is out of reach, and sends later", async () => {
    const api = fakeClassServer();
    const memory = new Map<string, string>();
    const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
    const local = new LocalCommunityStore(storage as unknown as Storage);
    const store = new SharedWithFallback(new LanCommunityStore("http://192.168.1.20:8765/api/", api.fetcher), local);
    api.setOnline(false);
    await store.submit(record);
    expect(store.kind).toBe("shared"); // nothing read yet
    expect(await store.plays({ classCode: "ABC234" })).toHaveLength(1);
    expect(store.kind).toBe("local");
    api.setOnline(true);
    await store.submitQuiz({ v: 1, monument: "ranverso", pre: [true], post: [true], day: "2026-10-12", classCode: "ABC234" });
    expect(api.kept.plays).toEqual([record]);
    expect(await store.quizzes({ classCode: "ABC234" })).toHaveLength(1);
    expect(store.kind).toBe("shared");
  });

  it("hands out the address students can reach, not the teacher's localhost", () => {
    const here = { origin: "http://127.0.0.1:8765", pathname: "/" };
    expect(classLink("ABC234", here)).toBe("http://127.0.0.1:8765/?class=ABC234");
    expect(classLink("ABC234", here, "http://192.168.1.20:8765/")).toBe("http://192.168.1.20:8765/?class=ABC234");
  });
});

describe("local-only mode", () => {
  it("is off unless the server, the link or the build asks for it", () => {
    expect(readRuntime(undefined)).toEqual({ store: null, localOnly: false, publicUrl: null });
    expect(readRuntime(undefined, "?local").localOnly).toBe(true);
    expect(readRuntime(undefined, "?class=ABC234").localOnly).toBe(false);
    expect(readRuntime(undefined, "", "1").localOnly).toBe(true);
  });

  it("reads what the class server wrote into the page, and nothing it did not", () => {
    expect(readRuntime({ store: "lan", localOnly: true, publicUrl: "http://192.168.1.20:8765" })).toEqual({
      store: "lan",
      localOnly: true,
      publicUrl: "http://192.168.1.20:8765/",
    });
    expect(readRuntime({ store: "cloud", localOnly: "yes", publicUrl: "javascript:alert(1)" })).toEqual({
      store: null,
      localOnly: false,
      publicUrl: null,
    });
    expect(readRuntime("lan")).toEqual({ store: null, localOnly: false, publicUrl: null });
  });

  it("leaves only the drawn plan, which is shipped with the game", () => {
    expect(data.basemaps.layers.some((l) => l.url)).toBe(true); // the normal pack has online pictures
    const local = withoutOnlineMaps(data);
    expect(local.basemaps.layers.map((l) => l.type)).toEqual(["vector"]);
    expect(local.basemaps.layers.every((l) => !l.url)).toBe(true);
    expect(local.basemaps.default).toBe(local.basemaps.layers[0].id);
    expect(data.basemaps.layers.length).toBeGreaterThan(1); // the original pack is not changed
  });

  it("changes nothing when a pack has no drawn plan to fall back on", () => {
    const rasterOnly = { ...data, basemaps: { ...data.basemaps, layers: data.basemaps.layers.filter((l) => l.type !== "vector") } };
    expect(withoutOnlineMaps(rasterOnly)).toBe(rasterOnly);
  });
});

describe("translated languages", () => {
  const dicts: Record<string, Record<string, string>> = { it: it_, es, de };
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const texts: string[] = [];
  (function collect(node: unknown) {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.en === "string" && typeof o.el === "string") texts.push(o.en);
    Object.values(o).forEach(collect);
  })(data);

  it("are in the language menu under their own names", () => {
    expect(LANGS.map((l) => l.id)).toEqual(["el", "en", "it", "es", "de"]);
    expect(isLang("de")).toBe(true);
    expect(isLang("fr")).toBe(false);
  });

  it("start in the browser's language when the game speaks it, else leave the choice to the default", () => {
    expect(browserLang(["it-CH", "de"])).toBe("it");
    expect(browserLang(["fr-FR", "es-ES"])).toBe("es");
    expect(browserLang(["fr-FR", "pt"])).toBeNull();
  });

  for (const [lang, dict] of Object.entries(dicts)) {
    it(`${lang}: has every interface text, with the same placeholders and nothing empty`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(placeholders(dict[key]), key).toEqual(placeholders(en[key]));
        expect(dict[key].trim(), key).not.toBe("");
      }
    });

    // An edited English text loses its translation until it is redone (the game then shows the
    // English), so full coverage is reported by the build, not demanded here.
    it(`${lang}: its content pack holds translations of texts in the data pack, monument names included`, () => {
      const pack = read(`../public/data/i18n/${lang}.json`) as { lang: string; strings: Record<string, string> };
      expect(pack.lang).toBe(lang);
      const known = new Set(texts);
      expect(Object.keys(pack.strings).filter((text) => !known.has(text))).toEqual([]);
      expect(Object.values(pack.strings).every((value) => value.trim() !== "")).toBe(true);
      for (const mon of data.monuments.filter(isPlayable)) expect(pack.strings[mon.display_name.en], mon.pilot_key).toBeTruthy();
    });
  }

  it("show content from the pack, and the English text for anything the pack lacks", () => {
    const title = { en: "Flooding", el: "Πλημμύρα" };
    expect(makeI18n("el").pick(title)).toBe("Πλημμύρα");
    expect(makeI18n("it", { Flooding: "Allagamento" }).pick(title)).toBe("Allagamento");
    expect(makeI18n("it", {}).pick(title)).toBe("Flooding");
    expect(makeI18n("it").pick(title)).toBe("Flooding"); // pack still loading
    expect(makeI18n("it").pick(null)).toBe("");
  });

  it("count and format per language", () => {
    const one: Record<string, string> = { it: "1 moneta", es: "1 moneda", de: "1 Münze" };
    for (const lang of ["it", "es", "de"] as Lang[]) {
      const i18n = makeI18n(lang);
      expect(i18n.tn("unit.coins", 1)).toBe(one[lang]);
      expect(i18n.tn("unit.coins", 3)).not.toBe(one[lang]);
      expect(i18n.date("2026-09-10T20:30:00")).toMatch(/10\.? (de )?(settembre|septiembre|September)( de)? 2026/);
    }
  });
});
