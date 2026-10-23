import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTOUR_CELLS, CONTOURS, contourPoints } from "../../src/lib/learn/contours";
import { MELODY_FAMILIES, MELODIES } from "../../src/lib/learn/course";

type Cell = { id: string; upbeats?: { deg: number; dur: number; alt?: number }[]; core: { deg: number; dur: number; alt?: number }[] };
const table = (melody: string) => JSON.parse(readFileSync(new URL(`../../trope/cells/${melody}.json`, import.meta.url), "utf8")) as { cells: Cell[] };
/** Resample a polyline to n heights so two marks can be compared at the size they are drawn. */
function profile(points: [number, number][], n = 24) {
  const x0 = points[0][0], x1 = points.at(-1)![0];
  return Array.from({ length: n }, (_, i) => {
    const x = x0 + (x1 - x0) * i / (n - 1), k = Math.max(1, points.findIndex(([px]) => px >= x));
    const [ax, ay] = points[k - 1], [bx, by] = points[k] ?? points[k - 1];
    return bx === ax ? by : ay + (by - ay) * (x - ax) / (bx - ax);
  });
}

describe("contour marks", () => {
  it("are the closing cells' notes, upbeats first, in both melody tables", () => {
    for (const melody of MELODIES) {
      const cells = table(melody).cells;
      for (const family of MELODY_FAMILIES[melody]) {
        const cell = cells.find(row => row.id === CONTOUR_CELLS[melody][family]);
        expect(cell, `${melody} ${family}`).toBeDefined();
        expect(CONTOURS[melody][family], `${melody} ${family}`).toEqual([...(cell!.upbeats ?? []), ...cell!.core].map(note => [note.deg + (note.alt ? 0.5 : 0), note.dur]));
      }
    }
  });
  it("draw eleven distinct shapes in each tune at 16 px", () => {
    for (const melody of MELODIES) {
      const families = MELODY_FAMILIES[melody], shapes = families.map(family => profile(contourPoints(family, melody)));
      for (let a = 0; a < families.length; a++) for (let b = a + 1; b < families.length; b++) {
        const distance = Math.sqrt(shapes[a].reduce((sum, y, i) => sum + (y - shapes[b][i]) ** 2, 0) / shapes[a].length);
        expect(distance, `${melody}: ${families[a]} and ${families[b]}`).toBeGreaterThan(1.2);
      }
    }
  });
  it("stay inside the 30 by 16 box", () => {
    for (const melody of MELODIES) for (const family of MELODY_FAMILIES[melody]) for (const [x, y] of contourPoints(family, melody)) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(30); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(16);
    }
  });
});
