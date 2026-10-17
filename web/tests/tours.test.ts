import { describe, expect, it } from "vitest";
import { markTourSeen, resetTours, tourSeen } from "../src/game/tours";

/** A small Storage kept in memory, as the browser's localStorage. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

describe("walkthroughs", () => {
  it("are shown once per screen, until they are asked for again", () => {
    const storage = memoryStorage();
    resetTours(storage);
    expect(tourSeen("mission", storage)).toBe(false);
    markTourSeen("mission", storage);
    markTourSeen("mission", storage);
    expect(tourSeen("mission", storage)).toBe(true);
    expect(tourSeen("home", storage)).toBe(false);
    expect(JSON.parse(storage.getItem("guardian.tours.v1")!)).toEqual(["mission"]);
    resetTours(storage);
    expect(tourSeen("mission", storage)).toBe(false);
  });

  it("are not shown twice in one visit where nothing can be stored", () => {
    resetTours(null);
    markTourSeen("story", null);
    expect(tourSeen("story", null)).toBe(true);
    resetTours(null);
  });
});
