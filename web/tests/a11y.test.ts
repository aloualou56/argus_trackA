import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakePage(saved: Record<string, string> = {}) {
  const store = new Map(Object.entries(saved));
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const root = {
    style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
  };
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal("document", { documentElement: root });
  return { store, classes, root, props };
}

describe("accessibility settings", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("start from the defaults and put each change on the page", async () => {
    const page = fakePage();
    const a = await import("../src/a11y/settings");
    expect(a.getSettings()).toEqual(a.DEFAULTS);
    a.setSettings({ textSize: 150, contrast: true, spacing: true });
    expect(page.props.get("--text-size")).toBe("150%"); // the root font size (styles.css)
    expect([...page.classes].sort()).toEqual(["a11y-contrast", "a11y-spacing"]);
    expect(a.motionReduced()).toBe(false);
    a.setSettings({ lessMotion: true, textSize: 100 });
    expect(a.motionReduced()).toBe(true);
    expect(page.props.has("--text-size")).toBe(false);
  });

  it("are remembered, and anything odd that was saved is ignored", async () => {
    fakePage({ "guardian.a11y": JSON.stringify({ textSize: 125, contrast: true, lessMotion: "yes", spacing: false }) });
    let a = await import("../src/a11y/settings");
    expect(a.getSettings()).toEqual({ textSize: 125, contrast: true, lessMotion: false, spacing: false, fullScreen: true });
    vi.resetModules();
    fakePage({ "guardian.a11y": "{not json" });
    a = await import("../src/a11y/settings");
    expect(a.getSettings()).toEqual(a.DEFAULTS);
  });
});
