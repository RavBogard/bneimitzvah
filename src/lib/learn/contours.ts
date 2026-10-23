import type { FamilyId } from "../trope/chart-catalog";
import type { Melody } from "./course";

/**
 * Each family's contour mark: the notes of its closing cell in the current melody table
 * (trope/cells/torah.json and haftarah.json), upbeats first, as [scale degree, beats]. Copied, not
 * imported, so the public bundle carries no melody table; tests/app/learn-contours.test.ts checks
 * them against the cells. Upbeats are always included (plan, Decided 7): without them tevir and
 * telisha ketana, and zakef and segol, draw the same shape at 16 px.
 */
type Note = readonly [degree: number, beats: number];
export const CONTOUR_CELLS: Readonly<Record<Melody, Readonly<Partial<Record<FamilyId, string>>>>> = Object.freeze({
  torah: Object.freeze({ "sof-pasuk": "silluq", etnachta: "etnachta", zakef: "zakef-katan", revia: "revia", tevir: "tevir", azla: "azla", segol: "segol",
    "telisha-ketana": "telisha-ketana", pazer: "pazer", "zakef-gadol": "zakef-gadol" }),
  haftarah: Object.freeze({ "sof-pasuk": "silluq", etnachta: "etnachta", zakef: "zakef-katan", revia: "revia", tevir: "tevir", azla: "azla", segol: "segol",
    "telisha-ketana": "telisha-ketana", pazer: "pazer", "zakef-gadol": "zakef-gadol", "sof-haftarah": "end:silluq" }),
});
export const CONTOURS: Readonly<Record<Melody, Readonly<Partial<Record<FamilyId, readonly Note[]>>>>> = {
  torah: {
    "sof-pasuk": [[2, 0.5], [1, 0.5], [-2, 1.5]], etnachta: [[-2, 0.5], [2, 1.5]], zakef: [[3, 0.5], [5, 0.5], [2, 1.5]],
    revia: [[3, 0.5], [2, 0.5], [1, 0.5], [0, 0.5], [-1, 1.5]], tevir: [[2, 0.5], [1, 0.5], [0, 0.5], [1, 0.5], [2, 1.5]],
    azla: [[1, 0.5], [3, 0.5], [5, 0.5], [3, 0.5], [6, 0.5], [5, 1.5]], segol: [[2, 0.5], [3, 0.5], [2, 1.5]],
    "telisha-ketana": [[1, 0.5], [1, 0.5], [0, 0.5], [1, 0.5], [2, 1.5], [1, 1.5]],
    pazer: [[1, 0.5], [1, 0.5], [2, 0.5], [3, 0.5], [4, 0.5], [5, 0.5], [6, 0.5], [5, 0.5], [3, 0.5], [2, 1.5]],
    "zakef-gadol": [[1, 0.5], [1, 0.5], [3, 0.5], [5, 1.5], [6, 0.5], [5, 0.5], [3, 1.5], [2, 1.5]],
  },
  haftarah: {
    "sof-pasuk": [[0, 0.5], [1, 0.5], [3, 0.5], [1, 1.5]], etnachta: [[1, 0.5], [3, 0.5], [1, 0.5], [3, 0.5], [5, 0.5], [4, 1.5]],
    zakef: [[4, 0.5], [5, 0.5], [3, 0.5]], revia: [[4, 0.5], [4, 0.5], [3, 0.5], [2, 0.5], [1, 0.5], [3, 0.5], [1, 1.5]],
    tevir: [[4, 0.5], [1, 0.5], [0, 0.5], [1, 0.5], [3, 1.5]], azla: [[5, 0.5], [6, 0.5], [5, 0.5], [4, 0.5], [8, 0.5], [4, 0.5]],
    segol: [[3, 0.5], [5, 1.5], [4, 0.5]], "telisha-ketana": [[1, 0.5], [4, 1.5], [3, 0.5], [4, 0.5], [5, 0.5], [3, 0.5], [1, 0.5]],
    pazer: [[1, 0.5], [4, 0.5], [5, 0.5], [6, 0.5], [7, 0.5], [8, 0.5], [7, 0.5], [6, 0.5], [5, 0.5], [4, 0.5], [5, 0.5], [4, 0.5]],
    "zakef-gadol": [[1, 0.5], [5, 0.5], [3, 0.5], [1, 0.5], [4, 0.5], [3, 1.5]], "sof-haftarah": [[4, 0.5], [5, 0.5], [7, 0.5], [8, 0.5], [7, 0.5], [6, 2]],
  },
};
export const CONTOUR_BOX = Object.freeze({ width: 30, height: 16, pad: 2 });

/** The mark as polyline points in a 30 by 16 box: each note a flat run as long as its beats, joined by slopes. */
export function contourPoints(family: FamilyId, melody: Melody): [number, number][] {
  const notes = CONTOURS[melody][family] ?? CONTOURS.haftarah[family] ?? [];
  if (!notes.length) return [];
  const total = notes.reduce((sum, [, beats]) => sum + beats, 0), low = Math.min(...notes.map(([d]) => d)), high = Math.max(...notes.map(([d]) => d));
  const { width, height, pad } = CONTOUR_BOX, span = Math.max(1, high - low);
  const points: [number, number][] = [];
  let at = 0;
  for (const [degree, beats] of notes) {
    const y = pad + (high - degree) / span * (height - 2 * pad), x0 = pad + at / total * (width - 2 * pad), x1 = pad + (at + beats * 0.7) / total * (width - 2 * pad);
    points.push([round(x0), round(y)], [round(x1), round(y)]); at += beats;
  }
  return points;
}
const round = (value: number) => Math.round(value * 10) / 10;
export const contourPath = (family: FamilyId, melody: Melody) => contourPoints(family, melody).map(([x, y]) => `${x},${y}`).join(" ");
