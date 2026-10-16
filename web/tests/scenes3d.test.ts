/// <reference types="node" />
// The 3D scenes of every monument (tools/build_scenes_3d.py, tools/build_game_data.py): each day's
// danger opens the scene where its alarm's sensor stands, and the 3D view finds that very sensor.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameData, Monument } from "../src/game/types";
import type { HouseData } from "../src/view3d/house";
import { serialOf } from "../src/view3d/math";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;
const playable = data.monuments.filter((m) => m.playable) as Monument[];
const scene = (name: string) =>
  JSON.parse(readFileSync(new URL(`../public/data/view3d/${name}.json`, import.meta.url), "utf8")) as HouseData;

describe("the 3D scenes of the missions", () => {
  it("reads an instrument's serial number from its name", () => {
    expect(serialOf("Installed Instrument Soil Moisture - 149368 (Room 215 - Theatrical Masks mosaic)")).toBe("149368");
    expect(serialOf("Installed Instrument Water pottential - WP1-130432 (Cellar 88 - Paso1)")).toBe("WP1-130432");
    expect(serialOf("Installed Instrument Rain Gauge - 177315")).toBe("177315");
    expect(serialOf("Rain gauge")).toBeNull();
  });

  it("opens each day's danger where its alarm's sensor stands, and finds that sensor there", () => {
    let checked = 0;
    for (const mon of playable) {
      for (const [rule, c] of Object.entries(mon.consequences ?? {})) {
        if (!c.view_3d) continue;
        expect(existsSync(new URL(`../public/data/view3d/${c.view_3d}.json`, import.meta.url))).toBe(true);
        expect(mon.scenes_3d?.map((s) => s.scene)).toContain(c.view_3d);
        const serials = new Set(scene(c.view_3d).sensors3d.map((s) => s.serial));
        for (const alarm of mon.alarms.filter((a) => a.rule === rule)) {
          for (const i of alarm.instruments) {
            expect(serials, `${mon.pilot_key} ${rule}: ${i.name}`).toContain(serialOf(i.name));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("says what each of ARGUS's sensors is: its type, which the game's cards name, or ARGUS's own name for it", () => {
    const cardOf = (type: string) => data.cards.cards.find((c) => c.instrument_types.includes(type));
    const unnamed = new Set<string>();
    let sensors = 0;
    for (const mon of playable) {
      for (const s of mon.scenes_3d ?? []) {
        for (const x of scene(s.scene).sensors3d) {
          sensors += 1;
          expect(x.type, `${s.scene} ${x.serial}`).toBeTruthy();
          if (!cardOf(x.type!)) unnamed.add(x.type!);
        }
      }
    }
    expect(sensors).toBeGreaterThan(50);
    // the types the pins name as ARGUS does (no card of the game is of them): a new one is a reason to look
    expect([...unnamed].sort()).toEqual(["Composite sensor 2 Sensor"]);
  });

  it("offers a scene only where ARGUS's model was taken or the walls can be drawn", () => {
    for (const mon of playable) {
      for (const s of mon.scenes_3d ?? []) {
        const model = existsSync(new URL(`../public/data/view3d/${s.scene}-model.json`, import.meta.url));
        expect(model || scene(s.scene).shapes.some((x) => x.kind === "ruin"), s.scene).toBe(true);
        if (s.place) expect(mon.places.map((p) => p.id)).toContain(s.place);
      }
    }
  });
});
