/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fitPlane, modelMatrix, type ModelTile } from "../src/view3d/house";

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
