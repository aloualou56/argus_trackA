// Records the game's narration with ElevenLabs, in Greek and English.
//
//   npm run narration -- --dry-run          what would be recorded, and how many characters (no API calls)
//   npm run narration -- --voices           the voices in your ElevenLabs account (needs the key)
//   npm run narration                       record every line that has no recording yet
//   npm run narration -- --lang el --limit 5   a few Greek lines first, to listen before recording all
//   npm run narration -- --redo             record everything again (after changing a voice or settings)
//   npm run narration -- --prune            delete recordings no text uses any more
//
// The API key is read from the ELEVENLABS_API_KEY environment variable only; never put it in a file in
// this repository. Voices and settings: content/narration.json. Output: web/public/audio/<lang>/<key>.mp3
// and web/public/audio/manifest.json, which the game reads. The texts are built by src/audio/narration.ts,
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
import { makeI18n } from "../src/i18n";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const AUDIO = join(web, "public", "audio");
const MANIFEST = join(AUDIO, "manifest.json");
const API = "https://api.elevenlabs.io";

interface Settings {
  model_id: string;
  output_format: string;
  voice_settings: Record<string, number | boolean>;
  voices: Record<NarratedLang, { voice_id: string | null; name: string | null }>;
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
const key = process.env.ELEVENLABS_API_KEY ?? "";

function readManifest(): NarrationManifest {
  if (existsSync(MANIFEST)) return JSON.parse(readFileSync(MANIFEST, "utf8")) as NarrationManifest;
  return { version: 1, voices: {}, model: settings.model_id, clips: {} };
}

function writeManifest(m: NarrationManifest): void {
  mkdirSync(AUDIO, { recursive: true });
  // Stable order, so a re-run only changes what really changed.
  const clips = Object.fromEntries(
    Object.entries(m.clips).map(([lang, c]) => [lang, Object.fromEntries(Object.entries(c ?? {}).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  writeFileSync(MANIFEST, `${JSON.stringify({ ...m, clips }, null, 1)}\n`);
}

/**
 * The words the voice reads: the line without the invisible hyphenation marks the screen uses
 * (soft hyphens, zero-width spaces), " · " as a pause, and the pronunciation fixes of
 * content/narration.json. The clip's name still comes from the line as shown.
 */
function sayAs(lang: NarratedLang, line: string): string {
  const plain = line.replace(/[\u00AD\u200B-\u200D\u2060]/g, "").replace(/\s+·\s+/g, ", ");
  return Object.entries(settings.say_as[lang] ?? {}).reduce((text, [word, spoken]) => text.split(word).join(spoken), plain);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": key, ...(init.headers ?? {}) } });
    // Busy or rate-limited: wait and try again (2, 4, 8, 16 s).
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`ElevenLabs ${path.split("?")[0]}: HTTP ${res.status} ${await res.text()}`);
    return res;
  }
}

async function listVoices(): Promise<void> {
  const res = await api("/v2/voices?page_size=100");
  const body = (await res.json()) as {
    voices: { voice_id: string; name: string; labels?: Record<string, string>; verified_languages?: { language: string; accent?: string }[] }[];
  };
  for (const v of body.voices) {
    const languages = (v.verified_languages ?? []).map((l) => (l.accent ? `${l.language} (${l.accent})` : l.language)).join(", ");
    const labels = Object.entries(v.labels ?? {}).map(([k, val]) => `${k}: ${val}`).join(", ");
    console.log(`${v.voice_id}  ${v.name}${languages ? `  [${languages}]` : ""}${labels ? `  {${labels}}` : ""}`);
  }
}

async function record(lang: NarratedLang, line: string, voiceId: string): Promise<Buffer> {
  const res = await api(`/v1/text-to-speech/${voiceId}?output_format=${settings.output_format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: sayAs(lang, line), model_id: settings.model_id, voice_settings: settings.voice_settings }),
  });
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  if (flag("voices")) {
    if (!key) throw new Error("Set ELEVENLABS_API_KEY to list your voices.");
    return listVoices();
  }

  const manifest = readManifest();
  let failures = 0;
  for (const lang of langs) {
    const w = makeI18n(lang);
    const lines = linesToRecord(w, data);
    const wanted = new Map(lines.map((line) => [narrationKey(lang, line), line]));
    const clips = (manifest.clips[lang] ??= {});
    const voice = settings.voices[lang];

    if (flag("prune")) {
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
      writeManifest(manifest);
    }

    const sameVoice = manifest.voices[lang]?.voice_id === voice.voice_id && manifest.model === settings.model_id;
    const todo = [...wanted].filter(([k, line]) => flag("redo") || !sameVoice || clips[k] !== line).slice(0, limit);
    const chars = todo.reduce((n, [, line]) => n + sayAs(lang, line).length, 0);
    console.log(
      `${lang}: ${lines.length} lines, ${lines.length - todo.length} already recorded, ${todo.length} to record (${chars} characters)` +
        (Object.keys(clips).length && !sameVoice ? " - the voice or model changed, so everything is recorded again" : ""),
    );
    if (flag("dry-run")) {
      if (flag("verbose")) todo.forEach(([k, line]) => console.log(`  ${k}  ${sayAs(lang, line)}`));
      continue;
    }
    if (!todo.length) continue;
    if (!key) throw new Error("Set ELEVENLABS_API_KEY (or use --dry-run).");
    if (!voice.voice_id) throw new Error(`No voice for ${lang} in content/narration.json (see --voices).`);

    if (!sameVoice) {
      manifest.clips[lang] = {};
      manifest.voices[lang] = { voice_id: voice.voice_id, name: voice.name ?? voice.voice_id };
      manifest.model = settings.model_id;
    }
    const target = manifest.clips[lang]!;
    mkdirSync(join(AUDIO, lang), { recursive: true });
    // Two at a time: within the concurrency of every ElevenLabs plan.
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const [k, line] = todo[next++];
        try {
          writeFileSync(join(AUDIO, lang, `${k}.mp3`), await record(lang, line, voice.voice_id!));
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
  if (failures) {
    console.error(`${failures} line(s) failed; run again to retry them.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
