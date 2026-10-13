/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { endingNarration, guardianBack, storyNarration, NARRATED_LANGS } from "../src/audio/narration";
import { CONSEQUENCE_PICTURES } from "../src/components/Consequence";
import { isPlayable } from "../src/game/logic";
import type { GameData } from "../src/game/types";
import { isBaseLang, makeI18n, type ContentPack } from "../src/i18n";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;
const monuments = data.monuments.filter(isPlayable);

function wordsFor(lang: (typeof NARRATED_LANGS)[number]) {
  if (isBaseLang(lang)) return makeI18n(lang);
  const pack = JSON.parse(readFileSync(new URL(`../public/data/i18n/${lang}.json`, import.meta.url), "utf8")) as {
    strings: ContentPack;
  };
  return makeI18n(lang, pack.strings);
}

describe("the guardian and the consequences", () => {
  it("every monument has a guardian who hands over the watch, and thanks the player where an alarm can be caught", () => {
    for (const mon of monuments) {
      expect(mon.guardian, mon.pilot_key).toBeTruthy();
      expect(mon.guardian!.handover.el && mon.guardian!.handover.en).toBeTruthy();
      if (mon.alarms.length) expect(mon.guardian!.back_caught?.el, mon.pilot_key).toBeTruthy();
    }
  });

  it("every replayable alarm says what would happen if nobody noticed, with a drawing the game has", () => {
    for (const mon of monuments) {
      for (const alarm of mon.alarms) {
        const c = alarm.context?.consequence;
        expect(c, `${mon.pilot_key} ${alarm.rule}`).toBeTruthy();
        expect(CONSEQUENCE_PICTURES).toContain(c!.picture);
        expect(c!.text.el && c!.text.en).toBeTruthy();
      }
    }
  });

  for (const lang of NARRATED_LANGS) {
    it(`the guardian speaks ${lang} (no English left in a translated language)`, () => {
      const w = wordsFor(lang);
      for (const mon of monuments) {
        const handover = w.pick(mon.guardian!.handover);
        expect(storyNarration(w, mon, undefined).split("\n")[0]).toBe(handover);
        if (!isBaseLang(lang)) expect(handover).not.toBe(mon.guardian!.handover.en);
        for (const alarm of mon.alarms) {
          const consequence = w.pick(alarm.context!.consequence!.text);
          if (!isBaseLang(lang)) expect(consequence).not.toBe(alarm.context!.consequence!.text.en);
        }
      }
    });
  }

  it("comes back with thanks, comfort or a quiet day, and only on the first day", () => {
    const w = makeI18n("en");
    const delos = monuments.find((m) => m.pilot_key === "delos")!;
    const alarm = delos.alarms[0];
    expect(guardianBack(w, delos, alarm, true)).toBe(delos.guardian!.back_caught!.en);
    expect(guardianBack(w, delos, alarm, false)).toBe(w.t("guardian.backMissed"));
    expect(guardianBack(w, delos, null, false)).toBe(w.t("guardian.backQuiet"));
    const first = endingNarration(w, delos, alarm, true, true).split("\n");
    expect(first).toEqual([delos.guardian!.back_caught!.en, w.t("consequence.caught"), alarm.context!.consequence!.text.en]);
    const later = endingNarration(w, delos, alarm, false, false).split("\n");
    expect(later).toEqual([w.t("consequence.missed"), alarm.context!.consequence!.text.en]);
    expect(endingNarration(w, delos, null, false, true)).toBe(w.t("guardian.backQuiet"));
  });
});
