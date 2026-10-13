// Reading text aloud with the voices the device already has (the Web Speech API): no audio files,
// and on phones it works offline. Only a voice of the game's language is used; when the device has
// none (some computers have no Greek voice), the game offers no "Read aloud" rather than reading
// Greek with an English voice.

/** A voice for this language, the device's own first (they work without internet). */
export function voiceFor(voices: SpeechSynthesisVoice[], lang: string, locale: string): SpeechSynthesisVoice | null {
  const exact = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === locale.toLowerCase());
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
  const ranked = [...exact, ...same].sort((a, b) => Number(b.localService) - Number(a.localService));
  return ranked[0] ?? null;
}

/**
 * Pieces short enough to read in one go: long texts are cut at the ends of sentences (some
 * browsers stop reading a single long piece after about fifteen seconds). Greek ends questions
 * with ";" and uses "·" as a pause.
 */
export function speechChunks(text: string, max = 220): string[] {
  const sentences = text
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.match(/[^.!?;·]+[.!?;·]*\s*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + sentence.length + 1 <= max) chunks[chunks.length - 1] = `${last} ${sentence}`;
    else chunks.push(sentence);
  }
  return chunks;
}

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Reads `text` aloud; `onEnd` is called when it has all been read. The returned function stops it. */
export function speak(text: string, voice: SpeechSynthesisVoice, onEnd: () => void): () => void {
  const synth = window.speechSynthesis;
  synth.cancel(); // one reading at a time
  const chunks = speechChunks(text);
  let stopped = false;
  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 0.95; // a little slower than usual: the game is also for children
    if (i === chunks.length - 1) {
      utterance.onend = () => !stopped && onEnd();
      utterance.onerror = () => !stopped && onEnd();
    }
    synth.speak(utterance);
  });
  return () => {
    stopped = true;
    synth.cancel();
  };
}
