/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fitPlane, levelFit, modelMatrix, sceneCentre, type HouseData, type ModelTile } from "../src/view3d/house";

const url = new URL("../public/data/view3d/delos-masks-model.json", import.meta.url);
const house = JSON.parse(readFileSync(new URL("../public/data/view3d/delos-masks.json", import.meta.url), "utf8")) as {
  origin: { lat: number; lon: number };
};

describe.runIf(existsSync(url))("ARGUS's model of the House of the Masks in the 3D view", () => {
  const manifest = JSON.parse(readFileSync(url, "utf8")) as { tiles: ModelTile[] };

  it("lands on the house, its floors at the height of ARGUS's terrain there", () => {
    // tile 00's own corners (glTF metres, as decoded from the Draco data)
    const m = modelMatrix(manifest.tiles[0], house.origin.lat, house.origin.lon);
    const centre = new THREE.Vector3((-11.23 + 41.62) / 2, (-6.3 + 49.36) / 2, 66.85).applyMatrix4(m);
    // within 15 m of the house's origin, and its lowest point about the floor height (ARGUS's terrain
    // around the house is 68-77 m above the ellipsoid)
    expect(Math.hypot(centre.x, centre.z)).toBeLessThan(15);
    expect(centre.y).toBeGreaterThan(64);
    expect(centre.y).toBeLessThan(76);
  });

  it("stands nearly upright: ARGUS's placement tilts it under 2 degrees (the game levels it on the terrain)", () => {
    const m = modelMatrix(manifest.tiles[0], house.origin.lat, house.origin.lon);
    const a = new THREE.Vector3(10, 10, 70).applyMatrix4(m);
    const b = new THREE.Vector3(10, 10, 75).applyMatrix4(m);
    expect(b.y - a.y).toBeCloseTo(5, 1);
    const tilt = (Math.atan2(Math.hypot(b.x - a.x, b.z - a.z), b.y - a.y) * 180) / Math.PI;
    expect(tilt).toBeLessThan(2);
  });
});

describe("levelling a model onto the terrain", () => {
  it("finds the tilt and offset of a plane", () => {
    const pts: [number, number, number][] = [];
    for (let x = -20; x <= 20; x += 5) for (let y = -20; y <= 20; y += 5) pts.push([x, y, 0.02 * x - 0.01 * y + 0.8]);
    const [a, b, c] = fitPlane(pts);
    expect(a).toBeCloseTo(0.02, 6);
    expect(b).toBeCloseTo(-0.01, 6);
    expect(c).toBeCloseTo(0.8, 6);
    expect(fitPlane([[0, 0, 1]])).toEqual([0, 0, 0]);
  });
});

describe("levelling a model onto the terrain, whatever else it has", () => {
  const grid = (z: (x: number, y: number) => number) => {
    const pts: [number, number, number][] = [];
    for (let x = -20; x <= 20; x += 2) for (let y = -20; y <= 20; y += 2) pts.push([x, y, z(x, y)]);
    return pts;
  };
  it("is not pulled down by cellars under the ground (Baltanás) nor up by wall tops", () => {
    const [a, b, c] = levelFit(grid((x, y) => (x > 8 ? -6 : y > 15 ? 4 : 0.02 * x - 0.01 * y + 0.8)));
    expect(a).toBeCloseTo(0.02, 3);
    expect(b).toBeCloseTo(-0.01, 3);
    expect(c).toBeCloseTo(0.8, 2);
  });
  it("takes a model placed far off its ground down onto it (Montefalco: placed 820 m low)", () => {
    expect(levelFit(grid(() => -820))[2]).toBeCloseTo(-820, 6);
  });
  it("never tilts it more than 3 degrees", () => {
    const [a] = levelFit(grid((x) => 0.2 * x));
    expect(Math.atan(a) * (180 / Math.PI)).toBeCloseTo(3, 6);
  });
});

describe("a place with no drawn walls", () => {
  it("is looked at in the middle of ARGUS's sensors there, else at ARGUS's placement", () => {
    const data = { shapes: [], sensors3d: [{ xy: [2, 4] }, { xy: [6, 0] }] } as unknown as HouseData;
    expect(sceneCentre(data)).toEqual([4, 2]);
    expect(sceneCentre({ ...data, sensors3d: [] })).toEqual([0, 0]);
  });
});

describe("a tileset's own up axis", () => {
  it("is read as Cesium reads it: glTF's y turned up, unless the tileset says z", () => {
    const up = (tile: ModelTile) => new THREE.Vector3(0, 1, 0).applyMatrix4(modelMatrix(tile, 0, 0)).sub(new THREE.Vector3().applyMatrix4(modelMatrix(tile, 0, 0)));
    // a tile in east-north-up at (0, 0): ECEF axes there are up = x, east = y, north = z
    const enu = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 6378137, 0, 0, 1];
    expect(up({ file: "", transform: enu, rtc_center: null }).y).toBeCloseTo(1, 6); // glTF y: up
    const z = { file: "", transform: enu, rtc_center: null, gltf_up_axis: "Z" as const };
    expect(up(z).z).toBeCloseTo(-1, 6); // glTF y: north (scene z is south)
  });
});
