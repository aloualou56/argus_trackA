// Game sounds, made in the browser with the Web Audio API: no audio files to load, license or
// cache, so they work offline too. Every sound answers something the player did (browsers allow
// sound only after a tap) and says nothing the screen does not show as well, so the game is the
// same with sound off. Phones also vibrate with each sound (haptics.ts, its own switch). Sound is
// turned on or off in the accessibility menu; this device remembers it.
import { buzz, buzzReplay } from "./haptics";

export type SoundName = "place" | "drop" | "remove" | "deny" | "complete";

const STORAGE_KEY = "guardian.sound";
const VOLUME = 0.55;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = savedEnabled();
const listeners = new Set<(on: boolean) => void>();

function savedEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true; // no storage (or no browser): on, for this visit
  }
}

export function soundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // not remembered, still applies to this visit
  }
  if (!on && master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
  if (on && master && ctx) master.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.02);
  listeners.forEach((listener) => listener(on));
}

/** Calls `listener` whenever sound is turned on or off; returns the way to stop listening. */
export function onSoundChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The audio output, made on the first sound (after a tap); null when sound is off or unavailable. */
function output(): { ctx: AudioContext; out: AudioNode } | null {
  if (!enabled || typeof window === "undefined") return null;
  if (!ctx) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    try {
      ctx = new Context();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return { ctx, out: master! };
}

// ---------------------------------------------------------------- the two building blocks

interface Tone {
  freq: number;
  /** Glide to this frequency over the tone. */
  to?: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  dur: number;
  /** Low-pass filter (Hz): takes the edge off square and saw waves. */
  soften?: number;
}

function tone(c: BaseAudioContext, out: AudioNode, t: number, { freq, to, type = "sine", gain = 0.5, attack = 0.005, dur, soften }: Tone) {
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (soften) {
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = soften;
    osc.connect(filter).connect(env);
  } else {
    osc.connect(env);
  }
  env.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** A breath of filtered noise whose colour sweeps from `from` to `to` Hz: wind, a whoosh. */
function noise(c: BaseAudioContext, out: AudioNode, t: number, { dur, from, to, gain = 0.25, attack = 0.3 }: { dur: number; from: number; to: number; gain?: number; attack?: number }) {
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const source = c.createBufferSource();
  source.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  source.connect(filter).connect(env).connect(out);
  source.start(t);
  source.stop(t + dur);
}

// ---------------------------------------------------------------- the sounds

const NOTE = { C4: 261.63, E4: 329.63, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5 };

export const SOUNDS: Record<SoundName, (c: BaseAudioContext, out: AudioNode, t: number) => void> = {
  // A sensor goes on the map: the tick of a coin, then two light rising notes.
  place: (c, out, t) => {
    tone(c, out, t, { freq: 2600, type: "triangle", gain: 0.1, dur: 0.035 });
    tone(c, out, t + 0.01, { freq: NOTE.E5, gain: 0.42, dur: 0.1 });
    tone(c, out, t + 0.075, { freq: 987.77, gain: 0.36, dur: 0.18 });
  },
  // Dropped where the finger or mouse let go: a soft landing first.
  drop: (c, out, t) => {
    tone(c, out, t, { freq: 190, to: 80, gain: 0.5, dur: 0.14 });
    SOUNDS.place(c, out, t + 0.05);
  },
  // A sensor taken away: one note sliding down.
  remove: (c, out, t) => tone(c, out, t, { freq: 520, to: 260, type: "triangle", gain: 0.32, dur: 0.17 }),
  // Not enough coins, or nothing placed yet: a muted double buzz, never harsh.
  deny: (c, out, t) => {
    tone(c, out, t, { freq: 150, type: "square", gain: 0.28, dur: 0.1, soften: 800 });
    tone(c, out, t + 0.13, { freq: 140, type: "square", gain: 0.28, dur: 0.14, soften: 800 });
  },
  // The score: a soft major chord.
  complete: (c, out, t) => {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((freq, i) => tone(c, out, t + i * 0.035, { freq, gain: 0.16, attack: 0.04, dur: 1.1 }));
  },
};

export function play(name: SoundName): void {
  buzz(name); // vibration has its own switch
  if (!enabled) return;
  const audio = output();
  if (audio) SOUNDS[name](audio.ctx, audio.out, audio.ctx.currentTime + 0.01);
}

// ---------------------------------------------------------------- the real alarm playing on the map

/** A sonar ping, one for each wave spreading from the alarm. */
function ping(c: BaseAudioContext, out: AudioNode, t: number) {
  tone(c, out, t, { freq: NOTE.E6, to: 1244.5, gain: 0.26, dur: 0.75 });
  tone(c, out, t, { freq: NOTE.E5, gain: 0.1, dur: 0.5 });
}

/**
 * The sound of the replay after "Done", on the times of its picture (styles.css: the waves start at
 * 0.3, 0.9 and 1.5 s, the sensors answer at 2.3 s): a whoosh as the view flies to the alarm, a ping
 * per wave, then a rising chime if the sensors caught it or two falling notes if they missed it.
 * Without motion (`still`) the picture is final at once, and so is the sound: only the answer.
 */
export function renderReplay(c: BaseAudioContext, out: AudioNode, t: number, caught: boolean, still: boolean): void {
  if (!still) {
    noise(c, out, t, { dur: 1.1, from: 250, to: 1800, gain: 0.2, attack: 0.45 });
    for (const at of [0.3, 0.9, 1.5]) ping(c, out, t + at);
  }
  const answer = t + (still ? 0.3 : 2.3);
  if (caught) {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((freq, i) =>
      tone(c, out, answer + i * 0.085, { freq, type: "triangle", gain: 0.3, dur: 0.3 }),
    );
  } else {
    tone(c, out, answer, { freq: NOTE.E4, type: "triangle", gain: 0.34, dur: 0.32 });
    tone(c, out, answer + 0.3, { freq: NOTE.C4, type: "triangle", gain: 0.34, dur: 0.65 });
  }
}

/** Plays the replay's sound; the returned function silences it (for "Skip"). */
/** Plays the replay's sound and vibration; the returned function silences both (for "See the answer"). */
export function playReplay(caught: boolean, still: boolean): () => void {
  const stopBuzz = buzzReplay(caught, still);
  const audio = output(); // null with sound off
  if (!audio) return stopBuzz;
  const bus = audio.ctx.createGain();
  bus.connect(audio.out);
  renderReplay(audio.ctx, bus, audio.ctx.currentTime + 0.02, caught, still);
  return () => {
    stopBuzz();
    bus.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
    window.setTimeout(() => bus.disconnect(), 400);
  };
}
