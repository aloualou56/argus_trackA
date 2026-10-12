import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the Web Audio API that only counts what would sound.
function fakeAudio() {
  const started: string[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect: (next: unknown) => next, disconnect() {}, gain: param(), frequency: param(), Q: param(), type: "" });
  class FakeContext {
    state = "running";
    currentTime = 0;
    sampleRate = 8000;
    destination = node();
    createGain = node;
    createBiquadFilter = node;
    createOscillator = () => ({ ...node(), start: () => started.push("tone"), stop() {} });
    createBuffer = (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
    createBufferSource = () => ({ ...node(), buffer: null, start: () => started.push("noise"), stop() {} });
    resume = () => Promise.resolve();
  }
  return { started, FakeContext };
}

describe("sounds", () => {
  let audio: ReturnType<typeof fakeAudio>;
  beforeEach(() => {
    vi.resetModules();
    audio = fakeAudio();
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      AudioContext: audio.FakeContext,
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
      setTimeout: () => 0,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("plays each sound, and the replay with and without motion", async () => {
    const s = await import("../src/audio/sounds");
    for (const name of Object.keys(s.SOUNDS) as (keyof typeof s.SOUNDS)[]) {
      const before = audio.started.length;
      s.play(name);
      expect(audio.started.length, name).toBeGreaterThan(before);
    }
    const before = audio.started.length;
    s.playReplay(true, false);
    expect(audio.started).toContain("noise");
    const moving = audio.started.length - before;
    s.playReplay(false, true);
    expect(audio.started.length - before - moving).toBeLessThan(moving); // still: only the answer
  });

  it("is silent when turned off, and remembers it", async () => {
    let s = await import("../src/audio/sounds");
    const heard: boolean[] = [];
    s.onSoundChange((on) => heard.push(on));
    s.setSoundOn(false);
    s.play("place");
    s.playReplay(true, false)();
    expect(audio.started).toEqual([]);
    expect(heard).toEqual([false]);
    vi.resetModules();
    s = await import("../src/audio/sounds");
    expect(s.soundOn()).toBe(false);
  });

  it("does nothing without the Web Audio API", async () => {
    vi.stubGlobal("window", {});
    const s = await import("../src/audio/sounds");
    expect(() => s.play("place")).not.toThrow();
    expect(() => s.playReplay(true, false)()).not.toThrow();
  });
});
