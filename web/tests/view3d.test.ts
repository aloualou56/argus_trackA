/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlayable } from "../src/game/logic";
import type { GameData } from "../src/game/types";
import { cameraHeightFor, damageAfter, effectOf, EFFECTS, RATES, MAP_ZOOM, metresPerPixel, placeCardIn, seeded, terrarium, tileLonLat, tileXY } from "../src/view3d/math";

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
    expect(effectOf("delos-masks.seismic.site")).toBe("quake");
    // unroofed walls giving way, and traffic's exhaust: not earthquakes
    expect(effectOf("delos-masks.architectural-stability.site")).toBe("walls");
    expect(effectOf("ranverso.pollutants.overloading-road-traffic")).toBe("smog");
    // rocks coming down only where ARGUS rates the slope's danger high or worse; else a slow creep
    expect(effectOf("lucretili-montefalco.landslide.castle", "extreme")).toBe("slide");
    expect(effectOf("lucretili-conventillo.landslide.site", "catastrophic")).toBe("slide");
    expect(effectOf("delos-masks.gravitational-slope-movements.site", "low")).toBe("creep");
    expect(effectOf("delos-fournoi.gravitational-slope-movements.site", "low")).toBe("creep");
    // the ground settling under the buildings, at any level
    expect(effectOf("baltanas.subsidence.cellar-ensemble", "extreme")).toBe("cellar"); // the cellars themselves
    expect(effectOf("delos-masks.subsidence.site", "low")).toBe("sink");
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
      const place = JSON.parse(readFileSync(new URL(`../public/data/view3d/${s.id}.json`, import.meta.url), "utf8")) as { dangers: { key: string; level: string }[] };
      const shown = new Set(place.dangers.map((d) => effectOf(d.key, d.level)).filter(Boolean));
      expect(shown.size, s.id).toBeGreaterThanOrEqual(1);
      for (const e of shown) expect(EFFECTS).toContain(e);
      // no landslide at Delos: ARGUS rates its slopes low there
      if (s.id.startsWith("delos")) expect(shown.has("slide"), s.id).toBe(false);
    }
  });

  it("keeps an open pin's card all inside the free part of the picture, wherever the pin stands", () => {
    const rnd = seeded(7);
    for (let i = 0; i < 5000; i++) {
      // pictures from a phone on its side to a big screen, a title and a panel covering some of them
      const width = 280 + rnd() * 1700;
      const height = 240 + rnd() * 1000;
      const free = { left: 0, top: rnd() * height * 0.4, right: width, bottom: height - rnd() * height * 0.4 };
      if (free.bottom - free.top < 40) continue;
      // (a pin may stand under the title or the panel, or just outside the picture)
      const at = { x: -40 + rnd() * (width + 80), y: -40 + rnd() * (height + 80) };
      const card = { width: 80 + rnd() * 300, height: 30 + rnd() * 900 };
      const box = placeCardIn(at, 26, card, free);
      const w = Math.min(card.width, box.maxWidth);
      const h = Math.min(card.height, box.maxHeight);
      const where = JSON.stringify({ at, card, free, box });
      // (8 pixels of margin all round)
      expect(box.left, where).toBeGreaterThanOrEqual(free.left + 8 - 1e-9);
      expect(box.left + w, where).toBeLessThanOrEqual(free.right - 8 + 1e-9);
      expect(box.top, where).toBeGreaterThanOrEqual(free.top + 8 - 1e-9);
      expect(box.top + h, where).toBeLessThanOrEqual(free.bottom - 8 + 1e-9);
    }
  });

  it("puts the card beside its pin when it fits, never over it", () => {
    const free = { left: 0, top: 120, right: 400, bottom: 700 };
    const card = { width: 200, height: 150 };
    // room above: above it
    expect(placeCardIn({ x: 200, y: 500 }, 26, card, free).top).toBe(500 - 26 - 150);
    // just under the title, as the sensor at Conventillo was: below it
    expect(placeCardIn({ x: 200, y: 140 }, 26, card, free).top).toBe(140 + 26);
    // too tall for either side: on the bigger one, cut to it, ending at the pin
    const tall = placeCardIn({ x: 200, y: 300 }, 26, { width: 200, height: 900 }, free);
    expect(tall.top + tall.maxHeight).toBeLessThanOrEqual(700 - 8);
    expect(tall.top).toBe(300 + 26);
    // at the edge of the picture: nudged sideways into it
    expect(placeCardIn({ x: 5, y: 500 }, 26, card, free).left).toBe(8);
    expect(placeCardIn({ x: 395, y: 500 }, 26, card, free).left).toBe(400 - 8 - 200);
    // a phone on its side, a low strip of picture left: beside the pin, on the side with room
    const low = { left: 0, top: 70, right: 844, bottom: 200 };
    expect(placeCardIn({ x: 400, y: 130 }, 26, card, low).left).toBe(400 + 26);
    expect(placeCardIn({ x: 700, y: 130 }, 26, card, low).left).toBe(700 - 26 - 200);
  });
});
