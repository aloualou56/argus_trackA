// The accessibility menu's settings (A11yMenu.tsx): text size, high contrast, less motion and wider
// text spacing. They are remembered on this device and applied to the whole page as a root font
// size and classes on <html> (styles.css, "accessibility settings"). Sound and vibration have
// their own switches (audio/sounds.ts, audio/haptics.ts); the menu shows those too.
import { useEffect, useState } from "react";

export type TextSize = 100 | 125 | 150;

export interface A11ySettings {
  textSize: TextSize;
  contrast: boolean;
  lessMotion: boolean;
  spacing: boolean;
}

const KEY = "guardian.a11y";
export const DEFAULTS: A11ySettings = { textSize: 100, contrast: false, lessMotion: false, spacing: false };
export const TEXT_SIZES: TextSize[] = [100, 125, 150];

function load(): A11ySettings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<A11ySettings>;
    return {
      textSize: TEXT_SIZES.includes(saved.textSize as TextSize) ? (saved.textSize as TextSize) : DEFAULTS.textSize,
      contrast: saved.contrast === true,
      lessMotion: saved.lessMotion === true,
      spacing: saved.spacing === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: A11ySettings = typeof window === "undefined" ? { ...DEFAULTS } : load();
const listeners = new Set<(s: A11ySettings) => void>();

/** Puts the settings on the page: the root font size (everything in rem grows) and three classes. */
export function applySettings(s: A11ySettings = current): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.fontSize = s.textSize === 100 ? "" : `${s.textSize}%`;
  root.classList.toggle("a11y-contrast", s.contrast);
  root.classList.toggle("a11y-motion", s.lessMotion);
  root.classList.toggle("a11y-spacing", s.spacing);
}

export function getSettings(): A11ySettings {
  return current;
}

export function setSettings(change: Partial<A11ySettings>): void {
  current = { ...current, ...change };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // not remembered, still applies to this visit
  }
  applySettings(current);
  listeners.forEach((listener) => listener(current));
}

/** The device asks for less motion (its own setting, which the menu cannot turn off). */
export function systemReducesMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Less motion: from the menu or from the device. Read it when moving something, not once. */
export function motionReduced(): boolean {
  return current.lessMotion || systemReducesMotion();
}

/** The current settings, kept up to date in a component. */
export function useA11ySettings(): A11ySettings {
  const [settings, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    return () => void listeners.delete(setState);
  }, []);
  return settings;
}
