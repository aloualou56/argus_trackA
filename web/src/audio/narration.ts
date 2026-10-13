// Recorded narration (ElevenLabs voices for Greek and English, made by scripts/narration.ts).
//
// What the game reads aloud is built here, by the same functions for the screens and for the script
// that records it, so a recording always matches the words on screen. Each line of a text is one
// clip, named by a hash of its language and words: when a text changes, its old clip is simply no
// longer found and "Read aloud" uses the device's voice for that line until it is recorded again.
import {
  argusCards,
  cardById,
  detects,
  isPlayable,
  ruleFor,
  type Detection,
} from "../game/logic";
import type { Alarm, GameData, HistoryChapter, Monument, RuleEntry, Scenario } from "../game/types";
import type { I18n } from "../i18n";

type Words = Pick<I18n, "lang" | "t" | "pick" | "list" | "date">;

/** Languages with recorded voices; the others use the device's voice. */
export const NARRATED_LANGS = ["el", "en"] as const;
export type NarratedLang = (typeof NARRATED_LANGS)[number];

/** The lines of a text, each read (and recorded) on its own. */
export function narrationParts(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** cyrb53: a small, fast 53-bit string hash (public domain, by bryc). Same result in the browser and in Node. */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** File name (without extension) of the clip for one line. */
export function narrationKey(lang: string, line: string): string {
  return cyrb53(`${lang}\n${line}`).toString(36).padStart(11, "0");
}

// ---------------------------------------------------------------- the texts read aloud

/** Story screen: the monument's story, then the danger shown on its card. */
export function storyNarration(w: Words, mon: Monument, hook: Scenario | undefined): string {
  return [mon.story.text && w.pick(mon.story.text), hook && `${w.t("story.dangerLabel")}: ${w.pick(hook.plain.title)}. ${w.pick(hook.plain.text)}`]
    .filter(Boolean)
    .join("\n");
}

/** One chapter of a monument's history. */
export function chapterNarration(w: Words, chapter: HistoryChapter): string {
  return `${w.pick(chapter.title)}.\n${w.pick(chapter.text)}`;
}

/** Alarm screen when the monument has no alarm to replay. */
export function noAlarmNarration(w: Words, mon: Monument): string {
  return `${mon.no_alarm_note ? w.pick(mon.no_alarm_note) : w.t("event.none")}\n${w.t("event.noneScore")}`;
}

/** Alarm screen: what ARGUS measured, the question, the player's answer, and what ARGUS used. */
export function eventNarration(w: Words, data: GameData, alarm: Alarm, rule: RuleEntry, detection: Detection): string {
  const cards = cardById(data);
  const names = (ids: string[], type: "conjunction" | "disjunction" = "conjunction") =>
    w.list(
      ids.map((id) => w.pick(cards.get(id)?.name)),
      type,
    );
  const missing = w.list(detection.missing.map((group) => names(group, "disjunction")));
  const caughtBy = argusCards(alarm);
  const ai = alarm.type === "DL";
  return [
    w.t(ai ? "event.whatAi" : "event.what", { date: w.date(alarm.timestamp), measures: w.pick(rule.measures) }),
    w.t("event.question"),
    detection.detected ? w.t("event.yes", { names: names(detection.matched) }) : w.t("event.no", { names: missing }),
    caughtBy.length > 0 ? w.t("event.argusCaught", { names: names(caughtBy) }) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Every answer a network can give to a rule: each way to catch it, and each set of missing groups. */
function possibleDetections(rule: RuleEntry): Detection[] {
  const subsets = <T,>(items: T[]): T[][] =>
    items.reduce<T[][]>((all, item) => [...all, ...all.map((s) => [...s, item])], [[]]).filter((s) => s.length > 0);
  const out = new Map<string, Detection>();
  // Caught: any non-empty choice of cards in every group (the matched list depends on which).
  const choices = rule.detect_with.reduce<string[][]>(
    (combos, group) => combos.flatMap((combo) => subsets(group).map((pick) => [...combo, ...pick])),
    [[]],
  );
  for (const choice of choices) {
    const d = detects(rule, Object.fromEntries(choice.map((c) => [c, 1])));
    out.set(JSON.stringify(d), d);
  }
  // Missed: the text names only the groups that are missing.
  for (const missingGroups of subsets(rule.detect_with)) {
    const picks = Object.fromEntries(
      rule.detect_with.filter((g) => !missingGroups.includes(g)).map((g) => [g[0], 1]),
    );
    const d = detects(rule, picks);
    out.set(JSON.stringify({ ...d, matched: [] }), d);
  }
  return [...out.values()];
}

/** Every text the game can read aloud in one language, for the recording script and its tests. */
export function allNarrations(w: Words, data: GameData): string[] {
  const texts: string[] = [];
  for (const mon of data.monuments.filter(isPlayable)) {
    // The story card shows a danger of the chosen mission; any scenario of the monument can be it.
    texts.push(storyNarration(w, mon, undefined));
    for (const s of mon.scenarios) texts.push(storyNarration(w, mon, s));
    for (const chapter of mon.history?.chapters ?? []) texts.push(chapterNarration(w, chapter));
    texts.push(noAlarmNarration(w, mon));
    for (const alarm of mon.alarms) {
      const rule = ruleFor(data, mon, alarm);
      if (!rule) continue;
      for (const detection of possibleDetections(rule)) texts.push(eventNarration(w, data, alarm, rule, detection));
    }
  }
  return texts;
}

/** The distinct lines to record, in a stable order. */
export function linesToRecord(w: Words, data: GameData): string[] {
  return [...new Set(allNarrations(w, data).flatMap(narrationParts))];
}

// ---------------------------------------------------------------- the recordings in the browser

export interface NarrationManifest {
  version: 1;
  /** Which voice read each language (shown in the credits). */
  voices: Partial<Record<NarratedLang, { name: string; voice_id: string }>>;
  model: string;
  /** Recorded lines per language: key -> the exact words (for review and pruning). */
  clips: Partial<Record<NarratedLang, Record<string, string>>>;
}

let manifest: Promise<NarrationManifest | null> | null = null;

/** The list of recordings, loaded once and only when "Read aloud" is first shown. */
export function loadNarration(): Promise<NarrationManifest | null> {
  manifest ??= fetch(`${import.meta.env.BASE_URL}audio/manifest.json`)
    .then((res) => (res.ok ? (res.json() as Promise<NarrationManifest>) : null))
    .catch(() => null);
  return manifest;
}

/** URL of the recording of one line, or null when there is none. */
export function clipUrl(m: NarrationManifest | null, lang: string, line: string): string | null {
  const key = narrationKey(lang, line);
  const clips = m?.clips[lang as NarratedLang];
  return clips && clips[key] === line ? `${import.meta.env.BASE_URL}audio/${lang}/${key}.mp3` : null;
}
