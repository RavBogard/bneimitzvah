import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const seam = vi.hoisted(() => ({ mutate: null as null | ((result: any) => unknown), calls: 0 }));
vi.mock("../../trope/text.mjs", async original => {
  const actual = await original<typeof import("../../trope/text.mjs")>();
  return { ...actual, verseUnits: (text: string, options: { ref?: string | null }) => { seam.calls++; const result = actual.verseUnits(text, options); return seam.mutate ? seam.mutate(result) : result; } };
});
import { createStudyWordAids } from "../../src/server/study/word-aids";
import { parseStudyWordAids, WORD_AID_SCHEMA } from "../../src/lib/hebrew/word-aids";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import type { StudyVerse } from "../../src/server/study/types";
const verse = (text: string, ref = "Genesis 1:1"): StudyVerse => ({ ref, hebrew: normalizeHebrew(text), english: null });
function binding(v: StudyVerse) { const p = projectStudyVerse(v.ref, v.hebrew); if (p.status !== "ready") throw new Error("Synthetic fixture unavailable"); return { ref: v.ref, readingTextSha256: createHash("sha256").update(p.projection.readingText.normalize("NFC")).digest("hex"), words: p.projection.words.map(w => w.text) }; }
function ready(v: StudyVerse) { const value = createStudyWordAids(v); if (!value || value.status !== "ready") throw new Error("Synthetic fixture unavailable"); return value; }
afterEach(() => { seam.mutate = null; seam.calls = 0; vi.restoreAllMocks(); });

it("review binds qere-plus-maqaf to reading identity while written ketiv changes cannot shift indices", () => {
  const make = (written: string) => verse(`<span class="mam-kq"><span class="mam-kq-k">${written}</span><span class="mam-kq-q">[בָּג]</span></span>־דָּ֑ג בָּ֖ג`);
  const first = make("זָ"), second = make("זָזָ"), a = ready(first), b = ready(second), expected = binding(first);
  expect(a).toEqual(b); expect(a.readingTextSha256).toBe(expected.readingTextSha256); expect(a.wordCount).toBe(3);
  expect(a.words.map(w => [w.index, w.status, w.status === "ready" ? w.syllables.map(s => s.stress) : w.reason])).toEqual([[0, "ready", [null]], [1, "ready", ["tonic"]], [2, "ready", ["tonic"]]]);
  expect(parseStudyWordAids(a, { ...expected, words: [...expected.words].reverse() })).toBeNull();
  expect(createStudyWordAids(verse(first.hebrew.readingText.normalize("NFD")))).toEqual(a);
});

it("review holds all members of a special-reading maqaf chain but leaves independent stress usable", () => {
  const value = ready(verse("בָּג־יְהוָ֑ה דָּ֖ג"));
  expect(value.words.map(w => w.status === "unavailable" ? w.reason : w.syllables.map(s => s.stress))).toEqual(["special-reading", "special-reading", ["tonic"]]);
  const jerusalem = ready(verse("יְרוּשָׁלַ֑͏ִם דָּ֖ג"));
  expect(jerusalem.words[0]).toEqual({ index: 0, status: "unavailable", reason: "special-reading" }); expect(jerusalem.words[1].status).toBe("ready");
});

it("review cannot infer silluq from nonfinal meteg or punctuation alone", () => {
  const value = ready(verse("בָּֽג דָּ֑ג׃"));
  expect(value.words[0]).toEqual({ index: 0, status: "unavailable", reason: "unaccented" });
  expect(ready(verse("בָּג׃")).words[0]).toEqual({ index: 0, status: "unavailable", reason: "unaccented" });
  expect(ready(verse("בָּֽג׃")).words[0].status).toBe("ready");
  expect(ready(verse("בָּ֑֖ג־דָּג")).words.every(w => w.status === "unavailable")).toBe(true);
});

it("review range parser allows only complete consecutive base-letter cuts, never detached vowel/accent marks", () => {
  const v = verse("בְּגָ֑ד"), value = ready(v), expected = binding(v), word = expected.words[0];
  const valid = new Set(["בְּ".normalize("NFC").length, "בְּגָ֑".normalize("NFC").length]);
  for (let cut = 1; cut < word.length; cut++) {
    const result = parseStudyWordAids({ ...value, words: [{ index: 0, status: "ready", syllables: [{ start: 0, end: cut, stress: null }, { start: cut, end: word.length, stress: "tonic" }] }] }, expected);
    expect(result !== null).toBe(valid.has(cut));
  }
  const copied = parseStudyWordAids(value, expected); expect(copied).not.toBe(value); expect(copied).toEqual(value);
  const nfd = expected.words[0].normalize("NFD"); if (nfd !== word) expect(parseStudyWordAids(value, { ...expected, words: [nfd] })).toBeNull();
});

it("review parser rejects hidden array metadata/accessors and unbound or contradictory envelopes without invoking getters", () => {
  const v = verse("בָּ֑ג"), value = ready(v), expected = binding(v); let reads = 0;
  const accessor = [...value.words]; Object.defineProperty(accessor, "0", { get() { reads++; return value.words[0]; } });
  const symbol = [...value.words]; Object.defineProperty(symbol, Symbol("hidden"), { value: "extra" });
  for (const words of [accessor, symbol]) expect(parseStudyWordAids({ ...value, words }, expected)).toBeNull();
  const badBinding = { ...expected }; Object.defineProperty(badBinding, "words", { get() { reads++; return expected.words; } });
  expect(parseStudyWordAids(value, badBinding)).toBeNull(); expect(reads).toBe(0);
  for (const ref of ["Genesis 01:1", "Genesis 1:01", "Genesis 1:9999", "Unknown 1:1"]) expect(parseStudyWordAids({ ...value, ref }, { ...expected, ref })).toBeNull();
  expect(parseStudyWordAids({ ...value, status: "unavailable", reason: "analysis-unavailable" }, expected)).toBeNull();
  expect(parseStudyWordAids(value, { ref: v.ref, words: expected.words })).toBeNull();
});

it("review canonical bounds stop analysis and unsupported books cannot expose guessed ranges", () => {
  const value = createStudyWordAids(verse(Array(513).fill("בָּ֑ג").join(" ")));
  expect(value).toEqual({ schema: WORD_AID_SCHEMA, ref: "Genesis 1:1", status: "unavailable", reason: "reconstruction" }); expect(seam.calls).toBe(0);
  for (const ref of ["Psalms 1:1", "Proverbs 1:1", "Job 1:1"]) expect(createStudyWordAids(verse("בָּ֑ג", ref))).toEqual({ schema: WORD_AID_SCHEMA, ref, status: "unavailable", reason: "unsupported-system" });
  expect(seam.calls).toBe(0);
});

it("review forged engine boundaries/order or throwing objects cannot leak diagnostics or partially release ranges", () => {
  const v = verse("בָּ֑ג דָּ֖ג");
  const bad = [
    (r: any) => { r.units.reverse(); return r; },
    (r: any) => { r.units[0].syllables[0].word = 9; return r; },
    (r: any) => { r.units[0].syllables[0].he = "raw private detail"; return r; },
    (r: any) => { Object.defineProperty(r, "units", { get() { throw new Error("raw private detail"); } }); return r; },
  ];
  const log = vi.spyOn(console, "log").mockImplementation(() => {}), warn = vi.spyOn(console, "warn").mockImplementation(() => {}), error = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const mutate of bad) { seam.mutate = mutate; const result = createStudyWordAids(v); expect(result).toEqual({ schema: WORD_AID_SCHEMA, ref: v.ref, status: "unavailable", reason: "analysis-unavailable" }); expect(JSON.stringify(result)).not.toContain("raw private"); }
  expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
