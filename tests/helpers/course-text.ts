import { createHash } from "node:crypto";
import type { CourseTextPins } from "../../src/server/service-course/pin";

/**
 * A synthetic PUBLIC build of the Shabbat morning volume for the service course's tests (2.0 SC2). Its Hebrew is invented letter
 * strings, never prayer text; its transliteration and English are invented too, apart from the six transliterated words of the
 * Sh'ma line the A8 lesson names. The real pinned build lives only in the database; no feed is ever a file in this repository.
 */
const ALEF = 0x05d0;
/** An invented Hebrew word: letters only, from a seed, never a real word on purpose. */
export const syntheticWord = (seed: number, length = 3) => Array.from({ length }, (_, i) => String.fromCharCode(ALEF + ((seed * 7 + i * 5 + 3) % 22))).join("");
export const SYNTHETIC_NAME = "\u05D9\u05D9"; // two yods: how the volume prints the divine name
const line = (words: readonly string[]) => words.join(" ");

export const SHMA_WORDS = [syntheticWord(1), syntheticWord(2), SYNTHETIC_NAME, syntheticWord(4, 5), SYNTHETIC_NAME, syntheticWord(6, 4)];
export const SHMA_TR = "Sh’ma Yisra’el, Adonai Eloheinu, Adonai echad.";
type Block = Record<string, unknown>;
export type SyntheticFeed = Record<string, unknown> & { units: { id: string; name: string; section: number; blocks: Block[] }[]; front?: Block[] };

export function syntheticFeedValue(gitSha = "aaaaaaa"): SyntheticFeed {
  const words = (seed: number, n: number) => Array.from({ length: n }, (_, i) => syntheticWord(seed + i, 3 + (i % 3)));
  const transliterate = (n: number, stem: string) => Array.from({ length: n }, (_, i) => `${stem}${i}`).join(" ");
  return {
    schemaVersion: 1, volume: "shabbat-shacharit", title: { en: "Synthetic Morning", he: syntheticWord(40) },
    printing: { gitSha, pages: 12, builtAt: "2026-09-22T14:45:53Z", source: { gitSha, pages: 12, builtAt: "2026-09-22T14:45:53Z", lane: "public" } },
    license: { spdx: "CC-BY-NC-SA-4.0", attribution: "Synthetic attribution." },
    sections: [{ idx: 0, en: "Synthetic section" }], pageIndex: {}, blockGranularity: "stanza",
    front: [{ type: "stanza", he: line(words(50, 4)), tr: transliterate(4, "front"), folio: 1, phys: 8 }, { type: "english", en: "Synthetic front English.", translates: [0], folio: 1 }],
    units: [
      { id: "shma.the-shma@shabbat-shacharit", name: "Synthetic Sh’ma", section: 0, blocks: [
        { type: "display", he: line(SHMA_WORDS), tr: SHMA_TR, en: [{ t: "Synthetic first line" }, { t: "." }], folio: 3 },
        { type: "display", he: line(words(20, 6)), en: "Synthetic second line.", folio: 3 },
      ] },
      { id: "shma.barchu@shabbat-shacharit", name: "Synthetic Bar’chu", section: 0, blocks: [
        { type: "stanza", he: line(words(30, 4)), tr: transliterate(4, "bar"), folio: 2 },
        { type: "stanza", he: line(words(34, 5)), tr: transliterate(5, "baruch"), label: "All", verse: "All", folio: 2 },
        { type: "rubric", text: [{ t: "Synthetic rubric that is never a line." }], folio: 2 },
        { type: "english", en: "Synthetic English one.", translates: [0], folio: 2 },
        { type: "english", en: "Synthetic English two.", translates: [1], footnote: [{ t: "Synthetic footnote that never leaves the parser." }], folio: 2 },
      ] },
      { id: "torah.mi-shebeirach-healing@shabbat-shacharit", name: "Synthetic healing", section: 0, blocks: [
        { type: "stanza", he: line(words(60, 6)), tr: transliterate(6, "mixed"), folio: 9 },
        { type: "english", en: "Synthetic placeholder English.", translates: [0], folio: 9 },
      ] },
      { id: "amidah.avodah@shabbat-maariv", name: "Synthetic Avodah", section: 0, blocks: [{ type: "stanza", he: line(words(70, 5)), tr: transliterate(5, "avodah"), folio: 6 }] },
    ],
  };
}
export const feedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function syntheticPins(bytes: Uint8Array, overrides: Partial<Record<keyof CourseTextPins, string>> = {}): CourseTextPins {
  const commit = "a".repeat(40);
  return { volume: "shabbat-shacharit", lane: "public", feedSha256: sha256(bytes), artifactRepo: "Synthetic/producer", artifactCommit: commit, artifactRunId: "1",
    artifactName: `shabbat-shacharit-${commit.slice(0, 7)}`, sourceGitSha: commit.slice(0, 7), ...overrides } as CourseTextPins;
}
export function syntheticBuild(mutate: (feed: SyntheticFeed) => void = () => {}) {
  const value = syntheticFeedValue(); mutate(value);
  const bytes = feedBytes(value);
  return { value, bytes, pins: syntheticPins(bytes) };
}
