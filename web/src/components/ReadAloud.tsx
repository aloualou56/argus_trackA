import { useEffect, useRef, useState } from "react";
import { speak, speechAvailable, voiceFor } from "../audio/speech";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";

/**
 * "Read aloud": reads `text` with a voice of the game's language, and stops on a second press, on
 * leaving the screen or when the text changes (a new chapter). Not shown when the device has no
 * voice for the language.
 */
export function ReadAloud({ text }: { text: string }) {
  const { t, lang, locale } = useI18n();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (speechAvailable() ? window.speechSynthesis.getVoices() : []));
  const [reading, setReading] = useState(false);
  const stop = useRef<(() => void) | null>(null);

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
  if (!voice) return null;

  const toggle = () => {
    if (reading) {
      stop.current?.();
      stop.current = null;
      setReading(false);
      return;
    }
    setReading(true);
    stop.current = speak(text, voice, () => {
      stop.current = null;
      setReading(false);
    });
  };

  return (
    <button type="button" className="btn btn-quiet read-aloud" onClick={toggle}>
      <Icon name={reading ? "stop" : "sound"} size={18} />
      {t(reading ? "speech.stop" : "speech.read")}
    </button>
  );
}
