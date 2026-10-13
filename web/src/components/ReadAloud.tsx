import { useEffect, useRef, useState } from "react";
import { clipUrl, loadNarration, narrationParts, type NarrationManifest } from "../audio/narration";
import { speak, speechAvailable, voiceFor } from "../audio/speech";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";

/**
 * "Read aloud": reads `text` line by line. A line with a recording (Greek and English, recorded with
 * ElevenLabs) plays that; any other line uses the device's voice for the game's language. Stops on a
 * second press, on leaving the screen or when the text changes (a new chapter). Not shown when a
 * line could be neither played nor spoken.
 */
export function ReadAloud({ text }: { text: string }) {
  const { t, lang, locale } = useI18n();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (speechAvailable() ? window.speechSynthesis.getVoices() : []));
  const [manifest, setManifest] = useState<NarrationManifest | null>(null);
  const [reading, setReading] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    loadNarration().then((m) => alive && setManifest(m));
    return () => {
      alive = false;
    };
  }, []);

  // Voices often arrive a moment after the page loads.
  useEffect(() => {
    if (!speechAvailable()) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  // A new text, another language or leaving the screen ends the reading.
  useEffect(
    () => () => {
      stop.current?.();
      stop.current = null;
      setReading(false);
    },
    [text, lang],
  );

  const voice = voiceFor(voices, lang, locale);
  const lines = narrationParts(text);
  const clips = lines.map((line) => clipUrl(manifest, lang, line));
  if (!voice && clips.some((clip) => !clip)) return null;

  const toggle = () => {
    if (reading) {
      stop.current?.();
      stop.current = null;
      setReading(false);
      return;
    }
    setReading(true);
    stop.current = play(lines, clips, voice, () => {
      stop.current = null;
      setReading(false);
    });
  };

  return (
    <button type="button" className="btn btn-quiet read-aloud" onClick={toggle} aria-pressed={reading}>
      <Icon name={reading ? "stop" : "sound"} size={18} />
      {t(reading ? "speech.stop" : "speech.read")}
    </button>
  );
}

/**
 * Plays the lines one after another: the recording when there is one, else the device's voice (also
 * when a recording fails to load, e.g. offline before it was ever played). Returns the way to stop.
 */
function play(lines: string[], clips: (string | null)[], voice: SpeechSynthesisVoice | null, onEnd: () => void): () => void {
  let stopped = false;
  let cancel: (() => void) | null = null;
  let objectUrl: string | null = null;
  const audio = new Audio();
  const release = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const next = (i: number): void => {
    if (stopped) return;
    if (i >= lines.length) {
      onEnd();
      return;
    }
    const speakLine = (): void => {
      if (!voice) return next(i + 1);
      cancel = speak(lines[i], voice, () => next(i + 1));
    };
    const clip = clips[i];
    if (!clip) return speakLine();
    // A failed clip reports both an error event and a rejected play(): fall back only once.
    let done = false;
    const once = (then: () => void) => () => {
      if (done || stopped) return;
      done = true;
      then();
    };
    audio.onended = once(() => {
      release();
      next(i + 1);
    });
    audio.onerror = once(() => {
      release();
      speakLine();
    });
    cancel = () => audio.pause();
    // Fetched whole (not in ranges as <audio> would), so the service worker can keep it for offline use.
    fetch(clip)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (stopped) return;
        objectUrl = URL.createObjectURL(blob);
        audio.src = objectUrl;
        return audio.play();
      })
      .catch(once(speakLine));
  };

  next(0);
  return () => {
    stopped = true;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    cancel?.();
    release();
  };
}
