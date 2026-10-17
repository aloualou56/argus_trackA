// Which screens' walkthroughs (components/Tour.tsx) this device has seen: each plays once, the first
// time its screen opens, until "Show me again how to play" on the first screen clears them all.

const KEY = "guardian.tours.v1";
/** Sent when the walkthroughs are cleared, so a screen that is open shows its own again. */
export const TOURS_RESET = "guardian:tours-reset";

function read(storage: Storage | null): string[] {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// Kept for this visit too, where storage is blocked: a walkthrough is not shown twice in one visit.
const seenThisVisit = new Set<string>();

export function tourSeen(id: string, storage: Storage | null = safeStorage()): boolean {
  return seenThisVisit.has(id) || read(storage).includes(id);
}

export function markTourSeen(id: string, storage: Storage | null = safeStorage()): void {
  seenThisVisit.add(id);
  try {
    const seen = read(storage);
    if (!seen.includes(id)) storage?.setItem(KEY, JSON.stringify([...seen, id]));
  } catch {
    // privacy mode: remembered for this visit only
  }
}

export function resetTours(storage: Storage | null = safeStorage()): void {
  seenThisVisit.clear();
  try {
    storage?.removeItem(KEY);
  } catch {
    // nothing kept to clear
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TOURS_RESET));
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
