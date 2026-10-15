import { describe, expect, it } from "vitest";
import { gridHeight, gridHeights, type TerrainGrid } from "../src/view3d/house";

/** A 3 x 3 grid, 2 m apart, centred on the origin, as tools/fetch_argus_3d.py writes it. */
function grid(cm: number[]): TerrainGrid {
  const bytes = new Uint8Array(cm.length * 2);
  const view = new DataView(bytes.buffer);
  cm.forEach((v, i) => view.setInt16(i * 2, v, true));
  return {
    spacing_m: 2,
    cols: 3,
    rows: 3,
    west_m: -2,
    north_m: 2,
    base_m: 30,
    heights_cm_int16_b64: btoa(String.fromCharCode(...bytes)),
  };
}

describe("ARGUS terrain grid in the 3D view", () => {
  const g = grid([0, 100, 200, 0, 100, 200, 0, 100, 200]); // rises 1 m every 2 m eastwards
  const h = gridHeights(g);

  it("reads the heights back from the file", () => {
    expect(Array.from(h)).toEqual([0, 100, 200, 0, 100, 200, 0, 100, 200]);
  });

  it("interpolates between the grid points, in metres above ARGUS's datum", () => {
    expect(gridHeight(g, h, 0, 0)).toBeCloseTo(31);
    expect(gridHeight(g, h, 1, 0)).toBeCloseTo(31.5);
    expect(gridHeight(g, h, -2, 2)).toBeCloseTo(30);
  });

  it("says nothing outside the grid or where no tile covered it", () => {
    expect(gridHeight(g, h, 50, 0)).toBeNull();
    const holed = grid([0, 100, 200, 0, -32768, 200, 0, 100, 200]);
    expect(gridHeight(holed, gridHeights(holed), 0, 0)).toBeNull();
  });
});
