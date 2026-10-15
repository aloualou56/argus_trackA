/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlayable } from "../src/game/logic";
import type { GameData } from "../src/game/types";
import { cameraHeightFor, damageAfter, effectOf, EFFECTS, RATES, MAP_ZOOM, metresPerPixel, terrarium, tileLonLat, tileXY } from "../src/view3d/math";

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
    // plants only where they are the point, where damp feeds them, or on a place only looked at
    for (const d of ["stone", "crack", "lean", "floor"] as const) expect(damageAfter(50, false, d).plants).toBe(0);
    for (const d of ["tree", "mosaic", "fresco", null] as const) expect(damageAfter(50, false, d).plants).toBeGreaterThan(0);
  });
});

describe("see it happen: ARGUS's dangers played out in 3D", () => {
  it("matches each danger to the effect that shows it, and leaves out what cannot be shown properly", () => {
    expect(effectOf("delos-masks.rainfall.site")).toBe("rain");
    expect(effectOf("delos-masks.storm.site")).toBe("storm");
    expect(effectOf("schenkenberg.wind-storm.walls")).toBe("storm");
    expect(effectOf("ranverso.physical-forces.wind-erosion")).toBe("wind");
    expect(effectOf("baltanas.flooding.structural-wood")).toBe("flood");
    expect(effectOf("ranverso.pollutants.acid-rain")).toBe("acidrain");
    expect(effectOf("delos-fournoi.freeze-thaw-cycles.site")).toBe("frost");
    expect(effectOf("schenkenberg.temperature-variation.walls")).toBe("frost");
    expect(effectOf("delos-masks.heatwaves.site")).toBe("heat");
    expect(effectOf("ranverso.incorrect-rh.prolonged-dry-periods")).toBe("heat");
    expect(effectOf("lucretili-conventillo.uv.mural-paintings")).toBe("sun");
    expect(effectOf("ranverso.light-uv.solar-radiation-uv")).toBe("sun");
    expect(effectOf("schenkenberg.earthquake.475y")).toBe("quake");
    expect(effectOf("lucretili-montefalco.landslide.castle")).toBe("slide");
    expect(effectOf("baltanas.subsidence.cellar-ensemble")).toBe("slide");
    expect(effectOf("delos-masks.water-rise.site")).toBe("damp");
    expect(effectOf("lucretili-conventillo.relative-humidity.mural-paintings")).toBe("damp");
    expect(effectOf("ranverso.fire.building-fire")).toBe("fire");
    expect(effectOf("schenkenberg.fire.large-100y")).toBe("wildfire");
    expect(effectOf("ranverso.pollutants.air-pollution")).toBe("smog");
    expect(effectOf("schenkenberg.plant-growth.untreated-30y")).toBe("plants");
    expect(effectOf("lucretili-montefalco.forest-management.castle")).toBe("plants");
    expect(effectOf("ranverso.pollutants.visitors")).toBe("visitors");
    for (const k of ["ranverso.pests.woodworms", "ranverso.criminals.illegal-landfill", "ranverso.incorrect-rh.groundwater-pollution", "schenkenberg.vandalism.graffiti"]) {
      expect(effectOf(k)).toBeNull();
    }
  });

  it("every 3D place has dangers that can be played out", () => {
    const scenes = JSON.parse(readFileSync(new URL("../public/data/view3d/scenes.json", import.meta.url), "utf8")) as { scenes: { id: string }[] };
    for (const s of scenes.scenes) {
      const place = JSON.parse(readFileSync(new URL(`../public/data/view3d/${s.id}.json`, import.meta.url), "utf8")) as { dangers: { key: string }[] };
      const shown = new Set(place.dangers.map((d) => effectOf(d.key)).filter(Boolean));
      expect(shown.size, s.id).toBeGreaterThanOrEqual(1);
      for (const e of shown) expect(EFFECTS).toContain(e);
    }
  });
});
