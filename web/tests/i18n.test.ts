import { describe, expect, it } from "vitest";
import el from "../src/i18n/el.json";
import en from "../src/i18n/en.json";
import { format, makeI18n } from "../src/i18n";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n files", () => {
  it("have the same keys", () => {
    expect(Object.keys(el).sort()).toEqual(Object.keys(en).sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(el[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("have no empty strings", () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(el)]) expect(value.trim(), key).not.toBe("");
  });
});

describe("formatting", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(format("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("picks singular and plural", () => {
    expect(makeI18n("en").tn("unit.coins", 1)).toBe("1 coin");
    expect(makeI18n("en").tn("unit.coins", 3)).toBe("3 coins");
    expect(makeI18n("el").tn("unit.coins", 1)).toBe("1 νόμισμα");
    expect(makeI18n("el").tn("unit.coins", 10)).toBe("10 νομίσματα");
  });

  it("formats ARGUS dates without shifting the day", () => {
    expect(makeI18n("en").date("2026-09-10T20:30:00")).toBe("10 September 2026");
    expect(makeI18n("el").date("2026-09-10T20:30:00")).toBe("10 Σεπτεμβρίου 2026");
  });

  it("formats decimals per language", () => {
    expect(makeI18n("en").number(95.426)).toBe("95.4");
    expect(makeI18n("el").number(95.426)).toBe("95,4");
  });
});
