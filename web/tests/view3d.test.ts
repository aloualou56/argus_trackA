/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlayable } from "../src/game/logic";
import type { GameData } from "../src/game/types";
import { cameraHeightFor, damageAfter, MAP_ZOOM, metresPerPixel, terrarium, tileLonLat, tileXY } from "../src/view3d/math";

const data = JSON.parse(readFileSync(new URL("../public/data/game_data.json", import.meta.url), "utf8")) as GameData;

describe("the 3D view", () => {
  it("only Delos's damp alarms open one, and its data is there", () => {
    const views = data.monuments.filter(isPlayable).flatMap((m) =>
      Object.entries(m.consequences ?? {})
        .filter(([, c]) => c.view_3d)
        .map(([rule, c]) => `${m.pilot_key} ${rule} ${c.view_3d}`),
    );
    expect(views).toEqual(["delos DL_soil_moisture delos-masks", "delos DL_humidity delos-masks"]);
    expect(existsSync(new URL("../public/data/view3d/delos-masks.json", import.meta.url))).toBe(true);
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
    expect(damageAfter(0, false)).toEqual({ damp: 0, wet: 0, loss: 0, salt: 0, plants: 0 });
    const later = damageAfter(50, false);
    expect(later.damp).toBeGreaterThan(1); // over a metre up the walls
    expect(later.plants).toBeCloseTo(0.45, 6);
    for (const k of ["damp", "wet", "loss", "salt", "plants"] as const) {
      expect(damageAfter(20, false)[k]).toBeLessThanOrEqual(later[k]);
    }
    expect(damageAfter(50, true)).toEqual(damageAfter(1, false));
  });
});
