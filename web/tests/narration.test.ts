/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allNarrations,
  eventNarration,
  linesToRecord,
  narrationKey,
  narrationParts,
  NARRATED_LANGS,
  type NarrationManifest,
} from "../src/audio/narration";
import { cardById, detects, isPlayable, ruleFor } from "../src/game/logic";
import type { GameData } from "../src/game/types";
import { isBaseLang, makeI18n, type ContentPack } from "../src/i18n";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;

/** The words of a language as the game has them, with the translated content for it, es and de. */
function wordsFor(lang: (typeof NARRATED_LANGS)[number]) {
  if (isBaseLang(lang)) return makeI18n(lang);
  const pack = JSON.parse(readFileSync(new URL(`../public/data/i18n/${lang}.json`, import.meta.url), "utf8")) as {
    strings: ContentPack;
  };
  return makeI18n(lang, pack.strings);
}

describe("narration texts", () => {
  it("are read line by line", () => {
    expect(narrationParts("One.\n\n  Two   words.\n")).toEqual(["One.", "Two words."]);
  });

  it("name each clip by language and words", () => {
    expect(narrationKey("el", "Γεια")).toBe(narrationKey("el", "Γεια"));
    expect(narrationKey("el", "Γεια")).not.toBe(narrationKey("en", "Γεια"));
    expect(narrationKey("en", "Hello")).toMatch(/^[0-9a-z]{11}$/);
  });

  for (const lang of NARRATED_LANGS) {
    it(`cover every monument in ${lang}, with no unfilled placeholder`, () => {
      const w = wordsFor(lang);
      const lines = linesToRecord(w, data);
      for (const mon of data.monuments.filter(isPlayable)) {
        expect(lines, mon.pilot_key).toContain(narrationParts(w.pick(mon.story.text))[0]);
      }
      for (const line of lines) {
        expect(line).not.toMatch(/\{\w+\}/);
        expect(line.length).toBeLessThan(2500); // well within one ElevenLabs request
      }
    });

    it(`include what the alarm screen says for any network the player can build (${lang})`, () => {
      const w = wordsFor(lang);
      const lines = new Set(linesToRecord(w, data));
      const ids = [...cardById(data).keys()];
      let seed = 7;
      const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      for (const mon of data.monuments.filter(isPlayable)) {
        for (const alarm of mon.alarms) {
          const rule = ruleFor(data, mon, alarm);
          if (!rule) continue;
          for (let n = 0; n < 25; n++) {
            const picks = Object.fromEntries(ids.filter(() => random() < 0.3).map((c) => [c, 1]));
            for (const line of narrationParts(eventNarration(w, data, alarm, rule, detects(rule, picks)))) {
              expect(lines.has(line), `${alarm.id}: ${line}`).toBe(true);
            }
          }
        }
      }
    });
  }

  it("are translated, not English, in Italian, Spanish and German", () => {
    const english = new Set(linesToRecord(makeI18n("en"), data));
    for (const lang of ["it", "es", "de"] as const) {
      const lines = linesToRecord(wordsFor(lang), data);
      const same = lines.filter((line) => english.has(line)).length;
      expect(same / lines.length, lang).toBeLessThan(0.1);
    }
  });

  it("are the same words for the screens and the recordings", () => {
    const w = makeI18n("el");
    expect(allNarrations(w, data).length).toBeGreaterThan(data.monuments.length);
  });
});

describe("recorded narration", () => {
  const path = new URL("../public/audio/manifest.json", import.meta.url);
  const manifest = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as NarrationManifest) : null;

  it.skipIf(!manifest)("has a file for every clip, named by its words", () => {
    for (const lang of NARRATED_LANGS) {
      for (const [key, line] of Object.entries(manifest!.clips[lang] ?? {})) {
        expect(narrationKey(lang, line), line).toBe(key);
        expect(existsSync(new URL(`../public/audio/${lang}/${key}.mp3`, import.meta.url)), key).toBe(true);
      }
    }
  });
});
