import { describe, expect, it } from "vitest";
import { speechChunks, voiceFor } from "../src/audio/speech";

const voice = (lang: string, localService = true, name = lang) => ({ lang, localService, name }) as SpeechSynthesisVoice;

describe("read aloud", () => {
  it("uses only a voice of the game's language, the device's own first", () => {
    const voices = [voice("en-US"), voice("el-GR", false, "online"), voice("el-GR", true, "local"), voice("de-DE")];
    expect(voiceFor(voices, "el", "el-GR")?.name).toBe("local");
    expect(voiceFor(voices, "en", "en-GB")?.lang).toBe("en-US"); // another English is fine
    expect(voiceFor(voices, "it", "it-IT")).toBeNull(); // never Italian with another language's voice
    expect(voiceFor([voice("el_GR")], "el", "el-GR")).not.toBeNull(); // Android writes el_GR
  });

  it("cuts long texts at the ends of sentences, Greek ones too", () => {
    const greek = "Τι είναι η Δήλος; Ένα νησί. ".repeat(12);
    const chunks = speechChunks(greek, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.every((c) => /[.;]$/.test(c))).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(greek.trim().replace(/\s+/g, " "));
    expect(speechChunks("One.\n\nTwo")).toEqual(["One. Two"]);
  });
});
