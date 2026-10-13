// Vibration that follows the game's sounds, for phones (Android browsers; iPhones have no
// vibration in the browser). It helps players who cannot hear the sounds, or play with them off
// in class. Like the sounds, it never says anything the screen does not show as well. It has its
// own switch in the accessibility menu, remembered on this device.

import type { SoundName } from "./sounds";

/** Vibrate, pause, vibrate, ... in milliseconds, as navigator.vibrate takes it. */
const PATTERNS: Record<SoundName, number[]> = {
  place: [18],
  drop: [30],
  remove: [12],
  deny: [40, 70, 40],
  complete: [30, 70, 30, 70, 60],
};

// The real alarm playing on the map (the times of its picture, styles.css): a pulse for each of
// the three waves, then the answer: three quick pulses if the sensors caught it, one long one if not.
const CAUGHT = [50, 70, 50, 70, 120];
const MISSED = [350];

const STORAGE_KEY = "guardian.vibrate";
let enabled = savedEnabled();
const listeners = new Set<(on: boolean) => void>();

function savedEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function vibrationOn(): boolean {
  return enabled;
}

export function setVibrationOn(on: boolean): void {
  enabled = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // not remembered, still applies to this visit
  }
  if (!on) buzzStop();
  listeners.forEach((listener) => listener(on));
}

/** Calls `listener` whenever vibration is turned on or off; returns the way to stop listening. */
export function onVibrationChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Phones and tablets: a vibration motor is likely, so the sound button names it too. */
export function vibrationLikely(): boolean {
  if (!canVibrate()) return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function run(pattern: number[]): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // some browsers refuse before the first tap: nothing to do
  }
}

/** Stops a vibration under way (sound and vibration turned off mid-pattern). */
export function buzzStop(): void {
  run([0]);
}

export function buzz(name: SoundName): void {
  if (enabled) run(PATTERNS[name]);
}

/** The replay's pulses; the returned function stops them (for "See the answer" before the end). */
export function buzzReplay(caught: boolean, still: boolean): () => void {
  if (!enabled) return () => {};
  const answer = caught ? CAUGHT : MISSED;
  // starts with a pause ([0 ms on, 300 ms off, 25 on, 575 off, ...]): the waves at 0.3, 0.9 and 1.5 s,
  // the answer at 2.3 s, as in the sound
  run(still ? [0, 300, ...answer] : [0, 300, 25, 575, 25, 575, 25, 775, ...answer]);
  return buzzStop;
}
