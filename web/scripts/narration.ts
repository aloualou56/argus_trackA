// Records the game's narration in all five languages, with Microsoft Azure Speech (default) or ElevenLabs.
//
//   npm run narration -- --dry-run              what would be recorded, and how many characters (no key needed)
//   npm run narration -- --voices --lang el     the voices the service offers for a language (needs the key)
//   npm run narration -- --lang el --limit 5    a few Greek lines first, to listen before recording all
//   npm run narration                           record every line that has no recording yet
//   npm run narration -- --redo                 record everything again (after changing a voice or settings)
//   npm run narration -- --redo-list scripts/narration-redo.txt
//                                               record again only the clips listed (one "lang/key" per line,
//                                               e.g. clips a listening check found garbled)
//   npm run narration -- --prune                delete recordings no text uses any more
//   npm run narration -- --sample "Κείμενο" --lang el [--provider elevenlabs] [--voice <id>]
//                                               one test clip, to compare voices (web/narration-samples/)
//   npm run narration -- --library --lang el [--gender female] [--search "name"]
//                                               ElevenLabs: the most used library voices of a language (or
//                                               those matching a name), with a free preview link (no credits)
//   npm run narration -- --add <owner>:<voice> --name "Greek narrator"
//                                               ElevenLabs: add a library voice to your account (prints its id)
//   npm run narration -- --lang it,es,de --auto-voice [--choice 2]
//                                               ElevenLabs: for each language without a voice, pick a calm male
//                                               narrator from the library, add it, save it in content/narration.json,
//                                               then record. --choice N takes the N-th best instead (and replaces
//                                               a voice already set). With --dry-run: pick and save, record nothing.
//
// Before recording, ElevenLabs credits are checked: the run stops if the account has too few left
// (--force records anyway, as far as the credits go).
//
// Keys come from environment variables only; never put them in a file in this repository:
//   Azure:      AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (e.g. westeurope); AZURE_SPEECH_ENDPOINT optional
//   ElevenLabs: ELEVENLABS_API_KEY
// Service, voices and settings: content/narration.json. Output: web/public/audio/<lang>/<key>.mp3 and
// web/public/audio/manifest.json, which the game reads. The texts are built by src/audio/narration.ts,
// the same code the screens use, so the recordings always match the words on screen.
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  linesToRecord,
  narrationKey,
  NARRATED_LANGS,
  type NarratedLang,
  type NarrationManifest,
} from "../src/audio/narration";
import type { GameData } from "../src/game/types";
import { isBaseLang, LANGS, makeI18n, type ContentPack } from "../src/i18n";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const AUDIO = join(web, "public", "audio");
const MANIFEST = join(AUDIO, "manifest.json");

interface Settings {
  provider: "azure" | "elevenlabs";
  azure: { output_format: string; rate: string; voices: Record<NarratedLang, string | null> };
  elevenlabs: {
    model_id: string;
    /** A cheaper or different model for some languages (e.g. Flash v2.5 costs half a credit per character). */
    models?: Partial<Record<NarratedLang, string>>;
    output_format: string;
    voice_settings: Record<string, number | boolean>;
    voices: Record<NarratedLang, string | null>;
  };
  say_as: Record<NarratedLang, Record<string, string>>;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const settings = JSON.parse(readFileSync(join(web, "..", "content", "narration.json"), "utf8")) as Settings;
const data = JSON.parse(readFileSync(join(web, "public", "data", "game_data.json"), "utf8")) as GameData;
const langs = (option("lang")?.split(",") ?? [...NARRATED_LANGS]) as NarratedLang[];
const limit = Number(option("limit") ?? Infinity);
/** --redo-list: clips to record again, as "lang/key" lines (anything after the key is a comment). */
const redoList = new Set(
  option("redo-list")
    ? readFileSync(resolve(option("redo-list")!), "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim().split(/\s+/)[0])
        .filter((l) => /^\w+\/\w+$/.test(l))
    : [],
);
const locale = (lang: NarratedLang) => LANGS.find((l) => l.id === lang)!.locale;

// ---------------------------------------------------------------- the services

interface Service {
  /** Short description of the voice, stored in the manifest; a change means "record again". */
  voice(lang: NarratedLang): string | null;
  /** Throws with a clear message when a key is missing. */
  check(): void;
  record(lang: NarratedLang, text: string): Promise<Buffer>;
  listVoices(lang: NarratedLang): Promise<void>;
  /** Credits the service charges for these characters in this language. */
  cost(lang: NarratedLang, characters: number): number;
  /** Credits left in the account, when the service tells. */
  balance(): Promise<number | null>;
  /** Library voices of a language, most used first (ElevenLabs only). */
  library?(lang: NarratedLang, gender?: string, search?: string): Promise<void>;
  /** Adds a library voice to the account and returns its id (ElevenLabs only). */
  addVoice?(owner: string, voiceId: string, name: string): Promise<string>;
  /** Library narrators of a language that suit the game, best first (ElevenLabs only). */
  narrators?(lang: NarratedLang): Promise<Narrator[]>;
}

interface Narrator {
  owner: string;
  id: string;
  name: string;
  about: string;
  preview: string;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    // Busy or rate-limited: wait and try again (2, 4, 8, 16 s).
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Microsoft Azure Speech, neural voices through the REST API (no SDK). */
function azure(): Service {
  const cfg = settings.azure;
  const key = process.env.AZURE_SPEECH_KEY ?? "";
  const region = process.env.AZURE_SPEECH_REGION ?? "";
  // AZURE_SPEECH_ENDPOINT (optional): a custom or private endpoint instead of the region's public one.
  const base = process.env.AZURE_SPEECH_ENDPOINT ?? `https://${region}.tts.speech.microsoft.com/cognitiveservices`;
  const headers = { "Ocp-Apim-Subscription-Key": key, "User-Agent": "guardian-for-a-day-narration" };
  return {
    voice: (lang) => (cfg.voices[lang] ? `${cfg.voices[lang]} ${cfg.rate}` : null),
    check() {
      if (!key || !region) throw new Error("Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (or use --dry-run).");
    },
    async record(lang, text) {
      const ssml =
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale(lang)}">` +
        `<voice name="${cfg.voices[lang]}"><prosody rate="${cfg.rate}">${xml(text)}</prosody></voice></speak>`;
      const res = await request(`${base}/v1`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": cfg.output_format },
        body: ssml,
      });
      return Buffer.from(await res.arrayBuffer());
    },
    async listVoices(lang) {
      const res = await request(`${base}/voices/list`, { headers });
      const voices = (await res.json()) as { ShortName: string; Locale: string; Gender: string; VoiceType: string }[];
      for (const v of voices.filter((v) => v.Locale.toLowerCase().startsWith(lang))) {
        console.log(`${v.ShortName}  ${v.Locale}  ${v.Gender}  ${v.VoiceType}`);
      }
    },
    cost: (_lang, characters) => characters,
    balance: async () => null,
  };
}

/** ElevenLabs, through the REST API. */
function elevenlabs(): Service {
  const cfg = settings.elevenlabs;
  const key = process.env.ELEVENLABS_API_KEY ?? "";
  // ELEVENLABS_API_URL (optional): another endpoint, e.g. a regional one.
  const api = process.env.ELEVENLABS_API_URL ?? "https://api.elevenlabs.io";
  const headers = { "xi-api-key": key };
  const modelFor = (lang: NarratedLang) => cfg.models?.[lang] ?? cfg.model_id;
  // Flash and Turbo cost half a credit per character; the v2.5 and v3 models accept the language.
  const cheap = (model: string) => /flash|turbo/.test(model);
  const takesLanguage = (model: string) => /v2_5|v3/.test(model);
  return {
    voice: (lang) => (cfg.voices[lang] ? `${cfg.voices[lang]} ${modelFor(lang)}` : null),
    check() {
      if (!key) throw new Error("Set ELEVENLABS_API_KEY (or use --dry-run).");
    },
    async record(lang, text) {
      const model = modelFor(lang);
      const res = await request(`${api}/v1/text-to-speech/${cfg.voices[lang]}?output_format=${cfg.output_format}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: cfg.voice_settings,
          ...(takesLanguage(model) ? { language_code: lang } : {}),
        }),
      });
      return Buffer.from(await res.arrayBuffer());
    },
    async listVoices() {
      const res = await request(`${api}/v2/voices?page_size=100`, { headers });
      const body = (await res.json()) as {
        voices: { voice_id: string; name: string; category?: string; verified_languages?: { language: string; accent?: string }[] }[];
      };
      for (const v of body.voices) {
        const languages = (v.verified_languages ?? []).map((l) => (l.accent ? `${l.language} (${l.accent})` : l.language));
        console.log(`${v.voice_id}  ${v.name}${v.category ? ` (${v.category})` : ""}${languages.length ? `  [${languages.join(", ")}]` : ""}`);
      }
    },
    cost: (lang, characters) => Math.ceil(characters * (cheap(modelFor(lang)) ? 0.5 : 1)),
    async balance() {
      const res = await request(`${api}/v1/user/subscription`, { headers });
      const sub = (await res.json()) as { character_count?: number; character_limit?: number };
      return typeof sub.character_limit === "number" ? sub.character_limit - (sub.character_count ?? 0) : null;
    },
    async library(lang, gender, search) {
      const params = new URLSearchParams({ page_size: "100", language: lang, ...(gender ? { gender } : {}), ...(search ? { search } : {}) });
      const res = await request(`${api}/v1/shared-voices?${params}`, { headers });
      type Shared = {
        public_owner_id: string;
        voice_id: string;
        name: string;
        gender?: string;
        age?: string;
        accent?: string;
        descriptive?: string;
        use_case?: string;
        cloned_by_count?: number;
        usage_character_count_1y?: number;
        preview_url?: string;
      };
      const voices = ((await res.json()) as { voices: Shared[] }).voices ?? [];
      // Most used first: a rough sign of a clean, reliable voice. The ear decides.
      voices.sort(
        (a, b) => (b.usage_character_count_1y ?? 0) - (a.usage_character_count_1y ?? 0) || (b.cloned_by_count ?? 0) - (a.cloned_by_count ?? 0),
      );
      console.log(`${lang}${search ? ` "${search}"` : ""}: ${voices.length} library voices; the 12 most used:`);
      for (const v of voices.slice(0, 12)) {
        const about = [v.gender, v.age, v.accent, v.descriptive, v.use_case].filter(Boolean).join(", ");
        console.log(`\n  ${v.name}  (${about})  used by ${v.cloned_by_count ?? 0}`);
        console.log(`    listen: ${v.preview_url ?? "-"}`);
        console.log(`    add:    npm run narration -- --add ${v.public_owner_id}:${v.voice_id} --name "${v.name}"`);
      }
    },
    async addVoice(owner, voiceId, name) {
      try {
        const res = await request(`${api}/v1/voices/add/${owner}/${voiceId}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ new_name: name }),
        });
        return ((await res.json()) as { voice_id: string }).voice_id;
      } catch (e) {
        // Already in the account (e.g. added on an earlier run): use that one.
        const res = await request(`${api}/v1/voices`, { headers });
        const mine = ((await res.json()) as { voices: { voice_id: string; name: string; sharing?: { original_voice_id?: string } }[] }).voices;
        const found = mine.find((v) => v.sharing?.original_voice_id === voiceId || v.name === name);
        if (found) return found.voice_id;
        throw e;
      }
    },
    async narrators(lang) {
      type Shared = {
        public_owner_id: string;
        voice_id: string;
        name: string;
        gender?: string;
        age?: string;
        accent?: string;
        descriptive?: string;
        use_case?: string;
        language?: string;
        locale?: string;
        verified_languages?: { language: string; locale?: string; accent?: string; preview_url?: string }[];
        usage_character_count_1y?: number;
        cloned_by_count?: number;
        preview_url?: string;
      };
      const searches: Record<string, string>[] = [
        { use_cases: "informative_educational" },
        { use_cases: "narrative_story" },
        {},
        ...(NARRATOR_NAMES[lang] ?? []).map((search) => ({ search })),
      ];
      const found = new Map<string, Shared>();
      for (const extra of searches) {
        const params = new URLSearchParams({ page_size: "100", language: lang, gender: "male", ...extra });
        const res = await request(`${api}/v1/shared-voices?${params}`, { headers });
        for (const v of ((await res.json()) as { voices?: Shared[] }).voices ?? []) found.set(v.voice_id, v);
      }
      const native = NATIVE_LOCALE[lang];
      const score = (v: Shared): number | null => {
        const verified = v.verified_languages?.find((l) => l.language === lang);
        // A native speaker of the language, reading calmly: no characters, adverts or shouting.
        if ((v.language ?? verified?.language) !== lang || v.gender !== "male") return null;
        const words = `${v.name} ${v.descriptive ?? ""} ${v.accent ?? ""}`.toLowerCase();
        if (/intense|excited|aggressive|intimidat|horror|sports|commentat|asmr|whisper|child|hyped|sassy|villain/.test(words)) return null;
        if (!["informative_educational", "narrative_story", "conversational"].includes(v.use_case ?? "")) return null;
        const voiceLocale = verified?.locale ?? v.locale ?? "";
        let s = { informative_educational: 3, narrative_story: 2, conversational: 0 }[v.use_case as string] ?? 0;
        if (/calm|professional|warm|pleasant|confident|wise|formal|clear|relaxed/.test(words)) s += 1;
        if (v.age === "middle_aged") s += 1;
        if (voiceLocale === native) s += 2;
        else if (voiceLocale && !voiceLocale.startsWith(lang)) s -= 1;
        if (lang === "es" && /latin|mexic|argentin|colombia|venezuel|chile/.test(`${words} ${voiceLocale.toLowerCase()}`) && !/es-es/i.test(voiceLocale)) s -= 3;
        if ((NARRATOR_NAMES[lang] ?? []).some((n) => v.name.toLowerCase().startsWith(n.toLowerCase()))) s += 2;
        return s + Math.log10((v.usage_character_count_1y ?? 0) + 1) / 10;
      };
      return [...found.values()]
        .map((v) => ({ v, s: score(v) }))
        .filter((x): x is { v: Shared; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .map(({ v }) => ({
          owner: v.public_owner_id,
          id: v.voice_id,
          name: v.name,
          about: [v.age, v.accent, v.descriptive, v.use_case, v.verified_languages?.find((l) => l.language === lang)?.locale ?? v.locale]
            .filter(Boolean)
            .join(", "),
          preview: v.verified_languages?.find((l) => l.language === lang)?.preview_url ?? v.preview_url ?? "-",
        }));
    },
  };
}

/** The accent the game speaks in each language (German: standard German, which Swiss schools teach too). */
const NATIVE_LOCALE: Record<NarratedLang, string> = { el: "el-GR", en: "en-GB", it: "it-IT", es: "es-ES", de: "de-DE" };
/** Narrators that voice reviews and the ElevenLabs language pages recommend; picked first when they fit. */
const NARRATOR_NAMES: Partial<Record<NarratedLang, string[]>> = {
  it: ["Adamo", "Giuseppe"],
  es: ["David Martin", "Alberto"],
  de: ["Otto", "Marc Weber"],
};

// --provider and --voice override content/narration.json for this run (e.g. to try a voice).
const provider = (option("provider") ?? settings.provider) as Settings["provider"];
if (option("voice")) for (const lang of langs) settings[provider].voices[lang] = option("voice")!;
const service = provider === "elevenlabs" ? elevenlabs() : azure();

// ---------------------------------------------------------------- texts and manifest

/** The words of one language, with its translated content for Italian, Spanish and German. */
function wordsFor(lang: NarratedLang) {
  if (isBaseLang(lang)) return makeI18n(lang);
  const file = join(web, "public", "data", "i18n", `${lang}.json`);
  const pack = existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { strings?: ContentPack }).strings ?? {}) : null;
  return makeI18n(lang, pack);
}

/**
 * The words the voice reads: the line without the invisible hyphenation marks the screen uses
 * (soft hyphens, zero-width spaces), " · " as a pause, and the pronunciation fixes of
 * content/narration.json. The clip's name still comes from the line as shown.
 */
function sayAs(lang: NarratedLang, line: string): string {
  const plain = line
    .replace(/[\u00AD\u200B-\u200D\u2060]/g, "")
    .replace(/([.;!?])\s+·\s+/g, "$1 ") // "Will the walls stand? · House of ..." needs no comma
    .replace(/\s+·\s+/g, ", ");
  return Object.entries(settings.say_as[lang] ?? {}).reduce((text, [word, spoken]) => text.split(word).join(spoken), plain);
}

function readManifest(): NarrationManifest {
  if (existsSync(MANIFEST)) return JSON.parse(readFileSync(MANIFEST, "utf8")) as NarrationManifest;
  return { version: 1, voices: {}, clips: {} };
}

function writeManifest(m: NarrationManifest): void {
  mkdirSync(AUDIO, { recursive: true });
  // Stable order, so a re-run only changes what really changed.
  const clips = Object.fromEntries(
    Object.entries(m.clips).map(([lang, c]) => [lang, Object.fromEntries(Object.entries(c ?? {}).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  writeFileSync(MANIFEST, `${JSON.stringify({ ...m, clips }, null, 1)}\n`);
}

function prune(manifest: NarrationManifest, lang: NarratedLang, wanted: Map<string, string>): void {
  const clips = (manifest.clips[lang] ??= {});
  for (const k of Object.keys(clips)) {
    if (wanted.get(k) === clips[k]) continue;
    delete clips[k];
    const file = join(AUDIO, lang, `${k}.mp3`);
    if (existsSync(file)) unlinkSync(file);
  }
  // Files without a manifest entry (e.g. from an interrupted run).
  if (existsSync(join(AUDIO, lang))) {
    for (const f of readdirSync(join(AUDIO, lang))) if (!clips[f.replace(/\.mp3$/, "")]) unlinkSync(join(AUDIO, lang, f));
  }
}

/**
 * The start of a line for the progress log, cut at a whole word with "…" and its full length: the whole
 * line is always what is recorded (see --dry-run --verbose for the full texts).
 */
function preview(line: string, max = 70): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40))}… (${line.length} characters, recorded in full)`;
}

// ---------------------------------------------------------------- main

/** One clip of any text, to listen to a voice before recording everything with it. */
async function sample(text: string): Promise<void> {
  service.check();
  const dir = join(web, "narration-samples");
  mkdirSync(dir, { recursive: true });
  for (const lang of option("lang") ? langs : (["el"] as NarratedLang[])) {
    const voice = settings[provider].voices[lang];
    if (!voice) throw new Error(`No ${provider} voice for ${lang}: add --voice <id> (see --voices).`);
    const file = join(dir, `${provider}-${lang}-${voice.replace(/[^\w.-]+/g, "_")}.mp3`);
    writeFileSync(file, await service.record(lang, sayAs(lang, text)));
    console.log(`wrote ${file}`);
  }
}

/** Writes one ElevenLabs voice into content/narration.json, leaving the rest of the file as it is. */
function saveVoice(lang: NarratedLang, voiceId: string): void {
  const file = join(web, "..", "content", "narration.json");
  const text = readFileSync(file, "utf8");
  const start = text.indexOf('"voices"', text.search(/"elevenlabs"\s*:\s*\{/));
  const end = text.indexOf("}", start);
  const block = text.slice(start, end).replace(new RegExp(`("${lang}"\\s*:\\s*)(null|"[^"]*")`), `$1"${voiceId}"`);
  writeFileSync(file, text.slice(0, start) + block + text.slice(end));
}

/** --auto-voice: a narrator for every language that has none (or the --choice-th best for each). */
async function autoVoices(): Promise<void> {
  if (provider !== "elevenlabs" || !service.narrators || !service.addVoice) throw new Error("--auto-voice is for ElevenLabs.");
  service.check();
  const choice = Number(option("choice") ?? 1);
  for (const lang of langs) {
    if (settings.elevenlabs.voices[lang] && !option("choice")) continue;
    const list = await service.narrators(lang);
    const pick = list[choice - 1];
    if (!pick) throw new Error(`${lang}: no fitting narrator found in the library (choose one with --library --lang ${lang}).`);
    const id = await service.addVoice(pick.owner, pick.id, pick.name);
    settings.elevenlabs.voices[lang] = id;
    saveVoice(lang, id);
    console.log(`${lang}: ${pick.name} (${pick.about})`);
    console.log(`    listen: ${pick.preview}`);
    console.log(`    saved in content/narration.json as ${id}`);
    const others = list.filter((v) => v !== pick).slice(0, 3);
    if (others.length) {
      console.log(`    others: ${others.map((v) => `${list.indexOf(v) + 1}. ${v.name}`).join(" | ")}  (--lang ${lang} --auto-voice --choice N)`);
    }
  }
}

async function main(): Promise<void> {
  const sampleText = option("sample");
  if (sampleText) return sample(sampleText);
  if (flag("voices")) {
    service.check();
    for (const lang of langs) await service.listVoices(lang);
    return;
  }
  if (flag("library")) {
    service.check();
    if (!service.library) throw new Error("--library is for ElevenLabs (add --provider elevenlabs).");
    for (const lang of option("lang") ? langs : (["el"] as NarratedLang[])) await service.library(lang, option("gender"), option("search"));
    return;
  }
  const add = option("add");
  if (add) {
    service.check();
    const [owner, voiceId] = add.split(":");
    if (!service.addVoice || !owner || !voiceId) throw new Error("Use --add <owner>:<voice> with ElevenLabs (see --library).");
    const id = await service.addVoice(owner, voiceId, option("name") ?? voiceId);
    console.log(`added; its voice_id is ${id} (put it in content/narration.json, elevenlabs.voices)`);
    return;
  }

  if (flag("auto-voice")) await autoVoices();

  // 1. What each language needs.
  const manifest = readManifest();
  const plans = langs.map((lang) => {
    const lines = linesToRecord(wordsFor(lang), data);
    const wanted = new Map(lines.map((line) => [narrationKey(lang, line), line]));
    if (flag("prune")) {
      prune(manifest, lang, wanted);
      writeManifest(manifest);
    }
    const clips = manifest.clips[lang] ?? {};
    const voice = service.voice(lang);
    const sameVoice = manifest.voices[lang]?.provider === provider && manifest.voices[lang]?.voice === voice;
    const missing = [...wanted].filter(([k, line]) => flag("redo") || redoList.has(`${lang}/${k}`) || !sameVoice || clips[k] !== line);
    const todo = missing.slice(0, limit);
    const chars = todo.reduce((n, [, line]) => n + sayAs(lang, line).length, 0);
    const credits = service.cost(lang, chars);
    console.log(
      `${lang}: ${lines.length} lines, ${lines.length - missing.length} already recorded, ${todo.length} to record now ` +
        `(${chars} characters, ${credits} credits)` +
        (Object.keys(clips).length && !sameVoice ? " - the service or voice changed, so everything is recorded again" : ""),
    );
    if (flag("verbose")) todo.forEach(([k, line]) => console.log(`  ${k}  ${sayAs(lang, line)}`));
    return { lang, lines, todo, voice, sameVoice, credits };
  });
  const needed = plans.reduce((n, p) => n + p.credits, 0);
  if (langs.length > 1) console.log(`total: ${needed} credits`);
  if (flag("dry-run") || !needed) return;

  // 2. Enough credits? (ElevenLabs tells; Azure's free tier is far larger than the game.)
  service.check();
  for (const p of plans) {
    if (p.todo.length && !p.voice) throw new Error(`No ${provider} voice for ${p.lang} in content/narration.json (see --voices).`);
  }
  const left = await service.balance();
  if (left !== null) {
    console.log(`credits left in the account: ${left}`);
    if (left < needed && !flag("force")) {
      throw new Error(`Not enough credits (${needed} needed). Record fewer languages with --lang, or use --force.`);
    }
  }

  // 3. Record.
  let failures = 0;
  for (const { lang, lines, todo, voice, sameVoice } of plans) {
    if (!todo.length) continue;
    if (!sameVoice) {
      manifest.clips[lang] = {};
      manifest.voices[lang] = { provider, voice: voice! };
    }
    const target = (manifest.clips[lang] ??= {});
    mkdirSync(join(AUDIO, lang), { recursive: true });
    // Two at a time: within the concurrency limits of every plan of both services.
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const [k, line] = todo[next++];
        try {
          writeFileSync(join(AUDIO, lang, `${k}.mp3`), await service.record(lang, sayAs(lang, line)));
          target[k] = line;
          writeManifest(manifest); // progress is kept if the run stops
          console.log(`  ${lang} ${Object.keys(target).length}/${lines.length}  ${preview(line)}`);
        } catch (e) {
          failures++;
          console.error(`  failed: ${preview(line)}\n    ${(e as Error).message}`);
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
  if (failures) {
    console.error(`${failures} line(s) failed; run again to retry them.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
