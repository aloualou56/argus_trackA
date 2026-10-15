/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlayable } from "../src/game/logic";
import type { GameData } from "../src/game/types";
import { cameraHeightFor, damageAfter, RATES, MAP_ZOOM, metresPerPixel, terrarium, tileLonLat, tileXY } from "../src/view3d/math";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;

describe("the 3D view", () => {
  it("each danger opens the scene of its sensor, whose data is there", () => {
    const views = data.monuments.filter(isPlayable).flatMap((m) =>
      Object.entries(m.consequences ?? {})
        .filter(([, c]) => c.view_3d)
        .map(([rule, c]) => `${m.pilot_key} ${rule} ${c.view_3d}`),
    );
    // Delos's damp alarms and its wind (weathering the stone) at the House of the Masks; the other
    // monuments as soon as ARGUS's models of them are taken (tools/fetch_argus_3d.py all)
    expect(views).toEqual(expect.arrayContaining(["delos DL_soil_moisture delos-masks", "delos DL_humidity delos-masks", "delos R2_wind delos-masks"]));
    for (const v of views) {
      expect(existsSync(new URL(`../public/data/view3d/${v.split(" ")[2]}.json`, import.meta.url)), v).toBe(true);
    }
  });

  it("starts from the map's own picture: the camera height that shows the same ground", () => {
    const mpp = metresPerPixel(37.396, MAP_ZOOM); // Delos, the zoom the map flies down to
    expect(mpp).toBeCloseTo(0.237, 3);
    const height = cameraHeightFor(800, mpp, 45);
    // a 45-degree field of view from that height covers the map's 800 pixels of ground, no more, no less
    expect(2 * height * Math.tan((22.5 * Math.PI) / 180)).toBeCloseTo(800 * mpp, 6);
  });

  it("finds the tiles the map shows and reads the terrain", () => {
    const [x, y] = tileXY(25.26949, 37.39626, 18);
    const [west, north] = tileLonLat(Math.floor(x), Math.floor(y), 18);
    expect(west).toBeLessThanOrEqual(25.26949);
    expect(north).toBeGreaterThanOrEqual(37.39626);
    expect(tileLonLat(x, y, 18)[0]).toBeCloseTo(25.26949, 9);
    expect(terrarium(128, 37, 0)).toBe(37); // 128 x 256 + 37 - 32768 metres
  });

  it("the damage grows with the years nobody noticed, and stays a year's worth with ARGUS watching", () => {
    const nothing = { damp: 0, wet: 0, loss: 0, salt: 0, plants: 0, flake: 0, wear: 0, surfaceMm: 0, crackMm: 0, crackM: 0, lean: 0 };
    expect(damageAfter(0, false)).toEqual(nothing);
    const later = damageAfter(50, false);
    expect(later.damp).toBeGreaterThan(1); // over a metre up the walls
    expect(later.plants).toBeCloseTo(0.45, 6);
    for (const k of ["damp", "wet", "loss", "salt", "plants"] as const) {
      expect(damageAfter(20, false)[k]).toBeLessThanOrEqual(later[k]);
    }
    expect(damageAfter(50, true)).toEqual(damageAfter(1, false));
  });

  it("each danger shows its own damage, at its rate, a year's worth when watched", () => {
    const own = { fresco: "flake", floor: "wear", stone: "surfaceMm", crack: "crackMm", lean: "lean", tree: "plants" } as const;
    for (const [kind, k] of Object.entries(own)) {
      const d = kind as keyof typeof own;
      expect(damageAfter(0, false, d)[k]).toBe(0);
      expect(damageAfter(50, false, d)[k]).toBeGreaterThan(damageAfter(10, false, d)[k]);
      expect(damageAfter(10, false, d)[k]).toBeGreaterThan(damageAfter(50, true, d)[k]);
      expect(damageAfter(50, true, d)).toEqual(damageAfter(1, false, d));
    }
    // the sources' sizes: rising damp under 1.5 m; a few millimetres of stone; the assumed crack and lean
    expect(damageAfter(50, false).damp).toBeLessThanOrEqual(RATES.dampMaxM);
    expect(damageAfter(50, false, "stone").surfaceMm).toBeCloseTo(2.5, 6);
    expect(damageAfter(50, false, "crack").crackMm).toBeCloseTo(25, 6);
    expect(damageAfter(50, false, "lean").lean).toBeCloseTo(2.5, 6);
    expect(damageAfter(50, false, "stone").damp).toBe(0); // only the danger's own damage
  });
});
