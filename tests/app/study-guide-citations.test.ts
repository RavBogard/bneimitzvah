import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createGuideChecker, readableInApp } from "../../src/server/study-guides/citations";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { guide, note, source, theme } from "../helpers/study-guide-fixture";

const rows = (verse: string) => parseRelatedMetadata([
  { _id: "known-1", sourceRef: "Invented Commentary on Exodus 40:34:1", index_title: "Invented Commentary on Exodus", category: "Commentary", anchorRef: verse },
  { _id: "known-2", sourceRef: "Invented Essays, Clouds", index_title: "Invented Essays", category: "Modern", anchorRef: verse },
], verse);
const verses = new Set(["Exodus 40:34", "Exodus 40:35", "Exodus 40:36"]);
const body = (ids: string[][]) => guide({ themes: [theme("t", { notes: ids.map((set, i) => note(`Exodus 40:${34 + i}`, { sources: set.map(id => ({ ...source(id), ref: "caller metadata", readable: true })) })) })] });

test("only ids Sefaria lists for that verse survive, with Sefaria's own metadata and readability", async () => {
  const related = vi.fn(async (verse: string) => rows(verse)), check = createGuideChecker({ related });
  const result = await check({ kind: "torah", readingKey: "pekudei", studentId: null, verses, body: body([["known-1", "known-2"]]) });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.body.themes[0].notes[0].sources.map(s => [s.id, s.ref, s.readable])).toEqual([["known-1", "Invented Commentary on Exodus 40:34:1", true], ["known-2", "Invented Essays, Clouds", false]]);
  expect(related).toHaveBeenCalledTimes(1);
  expect(readableInApp({ ref: "Invented Essays, Clouds", indexTitle: "Invented Essays" })).toBe(false);
});

test("one unknown id or one verse outside the reading refuses the whole body", async () => {
  const check = createGuideChecker({ related: async verse => rows(verse) });
  expect(await check({ kind: "torah", readingKey: "pekudei", studentId: null, verses, body: body([["known-1"], ["invented"]]) }))
    .toEqual({ ok: false, problems: ["themes[0].notes[1].sources[0]: invented is not a Sefaria source for Exodus 40:35"] });
  const outside = guide({ themes: [theme("t", { notes: [note("Genesis 1:1", { sources: [] })] })] });
  expect(await check({ kind: "torah", readingKey: "pekudei", studentId: null, verses, body: outside })).toMatchObject({ ok: false, problems: ["themes[0].notes[0]: Genesis 1:1 is not in this reading"] });
});

test("a failure aborts the remaining lookups and refuses as unavailable; concurrency stays bounded", async () => {
  let active = 0, peak = 0, calls = 0; const signals: AbortSignal[] = [];
  const related = async (verse: string, signal: AbortSignal) => {
    calls++; active++; peak = Math.max(peak, active); signals.push(signal);
    try { await new Promise(resolve => setTimeout(resolve, 5)); if (verse === "Exodus 40:3") throw new Error("offline"); return rows(verse); } finally { active--; }
  };
  const many = new Set(Array.from({ length: 40 }, (_, i) => `Exodus 40:${i + 1}`));
  const wide = guide({ themes: [theme("t", { notes: [...many].slice(0, 12).map(v => note(v, { sources: [source("known-1")] })) })] });
  const result = await createGuideChecker({ related, concurrency: 2 })({ kind: "torah", readingKey: "pekudei", studentId: null, verses: many, body: wide });
  expect(result).toMatchObject({ ok: false, problems: [expect.stringContaining("could not be checked")] });
  expect(peak).toBeLessThanOrEqual(2); expect(calls).toBeLessThan(12); expect(signals.every(s => s.aborted)).toBe(true);
});

test("a timeout never reads as an invented citation", async () => {
  const related = (_verse: string, signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const result = await createGuideChecker({ related, timeoutMs: 20 })({ kind: "torah", readingKey: "pekudei", studentId: null, verses, body: body([["known-1"]]) });
  expect(result).toMatchObject({ ok: false, problems: [expect.stringContaining("could not be checked")] });
});
