/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlayable } from "../src/game/logic";
import { mailtoLink, telLink } from "../src/game/report";
import type { GameData } from "../src/game/types";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;

describe("who to tell about an observation", () => {
  it("every monument names who is responsible, from an official https page, with a date it was checked", () => {
    for (const mon of data.monuments.filter(isPlayable)) {
      const to = mon.report_to;
      expect(to?.contacts.length, mon.pilot_key).toBeGreaterThan(0);
      expect(to!.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const c of to!.contacts) {
        expect(c.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
        expect(c.url.startsWith("https://") && c.source.startsWith("https://")).toBe(true);
        if (c.phone) expect(c.phone).toMatch(/^\+\d[\d ]+$/);
        expect(c.name.el && c.name.en && c.role.el && c.role.en).toBeTruthy();
      }
    }
  });

  it("opens the visitor's own email app with the card written in, Greek and line breaks intact", () => {
    const link = mailtoLink("efakyk@culture.gr", "Παρατήρηση: Δήλος (OBS-7K3Q9A)", ["Γεια σας & καλημέρα", "", "Θέση: 37.40, 25.27"]);
    expect(link.startsWith("mailto:efakyk@culture.gr?subject=")).toBe(true);
    const url = new URL(link);
    expect(url.searchParams.get("subject")).toBe("Παρατήρηση: Δήλος (OBS-7K3Q9A)");
    expect(url.searchParams.get("body")).toBe("Γεια σας & καλημέρα\r\n\r\nΘέση: 37.40, 25.27");
  });

  it("dials an international number", () => {
    expect(telLink("+30 210 3310966")).toBe("tel:+302103310966");
  });
});
