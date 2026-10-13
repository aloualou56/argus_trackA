// Records the game's narration in all five languages, with Microsoft Azure Speech (default) or ElevenLabs.
//
//   npm run narration -- --dry-run              what would be recorded, and how many characters (no key needed)
//   npm run narration -- --voices --lang el     the voices the service offers for a language (needs the key)
//   npm run narration -- --lang el --limit 5    a few Greek lines first, to listen before recording all
//   npm run narration                           record every line that has no recording yet
//   npm run narration -- --redo                 record everything again (after changing a voice or settings)
//   npm run narration -- --prune                delete recordings no text uses any more
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
const locale = (lang: NarratedLang) => LANGS.find((l) => l.id === lang)!.locale;

// ---------------------------------------------------------------- the services

interface Service {
  /** Short description of the voice, stored in the manifest; a change means "record again". */
  voice(lang: NarratedLang): string | null;
  /** Throws with a clear message when a key is missing. */
  check(): void;
  record(lang: NarratedLang, text: string): Promise<Buffer>;
  listVoices(lang: NarratedLang): Promise<void>;
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
  };
}

/** ElevenLabs, through the REST API. */
function elevenlabs(): Service {
  const cfg = settings.elevenlabs;
  const key = process.env.ELEVENLABS_API_KEY ?? "";
  const api = "https://api.elevenlabs.io";
  return {
    voice: (lang) => (cfg.voices[lang] ? `${cfg.voices[lang]} ${cfg.model_id}` : null),
    check() {
      if (!key) throw new Error("Set ELEVENLABS_API_KEY (or use --dry-run).");
    },
    async record(lang, text) {
      const res = await request(`${api}/v1/text-to-speech/${cfg.voices[lang]}?output_format=${cfg.output_format}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: cfg.model_id, voice_settings: cfg.voice_settings }),
      });
      return Buffer.from(await res.arrayBuffer());
    },
    async listVoices() {
      const res = await request(`${api}/v2/voices?page_size=100`, { headers: { "xi-api-key": key } });
      const body = (await res.json()) as {
        voices: { voice_id: string; name: string; verified_languages?: { language: string; accent?: string }[] }[];
      };
      for (const v of body.voices) {
        const languages = (v.verified_languages ?? []).map((l) => (l.accent ? `${l.language} (${l.accent})` : l.language));
        console.log(`${v.voice_id}  ${v.name}${languages.length ? `  [${languages.join(", ")}]` : ""}`);
      }
    },
  };
}

const service = settings.provider === "elevenlabs" ? elevenlabs() : azure();

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
  const plain = line.replace(/[­​-‍⁠]/g, "").replace(/\s+·\s+/g, ", ");
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

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (flag("voices")) {
    service.check();
    for (const lang of langs) await service.listVoices(lang);
    return;
  }

  const manifest = readManifest();
  let failures = 0;
  let total = 0;
  for (const lang of langs) {
    const lines = linesToRecord(wordsFor(lang), data);
    const wanted = new Map(lines.map((line) => [narrationKey(lang, line), line]));
    if (flag("prune")) {
      prune(manifest, lang, wanted);
      writeManifest(manifest);
    }
    const clips = manifest.clips[lang] ?? {};
    const voice = service.voice(lang);
    const sameVoice = manifest.voices[lang]?.provider === settings.provider && manifest.voices[lang]?.voice === voice;
    const missing = [...wanted].filter(([k, line]) => flag("redo") || !sameVoice || clips[k] !== line);
    const todo = missing.slice(0, limit);
    const chars = todo.reduce((n, [, line]) => n + sayAs(lang, line).length, 0);
    total += chars;
    console.log(
      `${lang}: ${lines.length} lines, ${lines.length - missing.length} already recorded, ${todo.length} to record now (${chars} characters)` +
        (Object.keys(clips).length && !sameVoice ? " - the service or voice changed, so everything is recorded again" : ""),
    );
    if (flag("dry-run")) {
      if (flag("verbose")) todo.forEach(([k, line]) => console.log(`  ${k}  ${sayAs(lang, line)}`));
      continue;
    }
    if (!todo.length) continue;
    service.check();
    if (!voice) throw new Error(`No ${settings.provider} voice for ${lang} in content/narration.json (see --voices).`);

    if (!sameVoice) {
      manifest.clips[lang] = {};
      manifest.voices[lang] = { provider: settings.provider, voice };
    }
    const target = (manifest.clips[lang] ??= {});
    mkdirSync(join(AUDIO, lang), { recursive: true });
    // Two at a time: within the limits of the free tiers of both services.
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const [k, line] = todo[next++];
        try {
          writeFileSync(join(AUDIO, lang, `${k}.mp3`), await service.record(lang, sayAs(lang, line)));
          target[k] = line;
          writeManifest(manifest); // progress is kept if the run stops
          console.log(`  ${lang} ${Object.keys(target).length}/${lines.length}  ${line.slice(0, 70)}`);
        } catch (e) {
          failures++;
          console.error(`  failed: ${line.slice(0, 70)}\n    ${(e as Error).message}`);
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
  if (langs.length > 1) console.log(`total: ${total} characters`);
  if (failures) {
    console.error(`${failures} line(s) failed; run again to retry them.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
