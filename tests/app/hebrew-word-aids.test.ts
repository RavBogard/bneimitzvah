import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const seam = vi.hoisted(() => ({ analyze: null as null | ((text: string) => unknown) }));
vi.mock("../../trope/text.mjs", async original => {
  const actual = await original<typeof import("../../trope/text.mjs")>();
  return { ...actual, verseUnits: (text: string, options: { ref?: string | null }) => seam.analyze ? seam.analyze(text) : actual.verseUnits(text, options) };
});
import { createStudyWordAids } from "../../src/server/study/word-aids";
import { parseStudyWordAids, WORD_AID_SCHEMA, WORD_AID_LIMITS, type StudyWordAids } from "../../src/lib/hebrew/word-aids";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import type { StudyVerse } from "../../src/server/study/types";
const verse = (text: string, ref = "Genesis 1:1"): StudyVerse => ({ ref, hebrew: normalizeHebrew(text), english: null });
const one = (index: number, text: string, stress: "tonic" | "secondary" | null) => ({ index, status: "ready", syllables: [{ start: 0, end: text.normalize("NFC").length, stress }] });
function binding(v: StudyVerse) { const p = projectStudyVerse(v.ref, v.hebrew); if (p.status !== "ready") throw new Error("Synthetic projection failed"); return { ref: v.ref, words: p.projection.words.map(w => w.text), readingTextSha256: createHash("sha256").update(p.projection.readingText.normalize("NFC")).digest("hex") }; }
function output(v: StudyVerse) { const value = createStudyWordAids(v); expect(value?.status).toBe("ready"); if (!value || value.status !== "ready") throw new Error("Synthetic guide unavailable"); return value; }
afterEach(() => { seam.analyze = null; });

it("has exact independently expected one-syllable Hebrew stress and no teaching text/phonemes in output", () => {
  const v = verse("בָּ֑ג דָּ֖ג"); const value = output(v);
  expect(value.words).toEqual([one(0, "בָּ֑ג", "tonic"), one(1, "דָּ֖ג", "tonic")]);
  expect(parseStudyWordAids(value, binding(v))).toEqual(value);
  expect(Object.keys(value).sort()).toEqual(["schema", "ref", "status", "readingTextSha256", "wordCount", "words"].sort());
  expect(JSON.stringify(value)).not.toMatch(/phoneme|ipa|warning|ב|ד|read"/);
});
it("keeps maqaf canonical words separate and explicit meteg secondary versus accented tonic", () => {
  const value = output(verse("בָּֽג־דָּ֑ג"));
  expect(value.words).toEqual([one(0, "בָּֽג", "secondary"), one(1, "דָּ֑ג", "tonic")]);
  expect(output(verse("בָּג־דָּ֑ג")).words).toEqual([one(0, "בָּג", null), one(1, "דָּ֑ג", "tonic")]);
});
it("tiles independently expected vocal-sheva syllables at Hebrew base-letter boundaries", () => {
  const text = "בְּגָ֑ד".normalize("NFC"), first = "בְּ".normalize("NFC").length;
  expect(output(verse(text)).words).toEqual([{ index: 0, status: "ready", syllables: [{ start: 0, end: first, stress: null }, { start: first, end: text.length, stress: "tonic" }] }]);
});
it("does not guess stress on unaccented units and proves final silluq only with actual verse terminator", () => {
  expect(output(verse("בָּג דָּֽג׃")).words).toEqual([{ index: 0, status: "unavailable", reason: "unaccented" }, one(1, "דָּֽג", "tonic")]);
  expect(output(verse("בָּג דָּֽג")).words).toEqual([{ index: 0, status: "unavailable", reason: "unaccented" }, { index: 1, status: "unavailable", reason: "unaccented" }]);
});
it("maps read qere instead of ketiv and preserves split display spans/NFC inputs without mutation", () => {
  const v = verse('בָּ֑ג <span class="mam-kq"><span class="mam-kq-k">זָ</span><span class="mam-kq-q">[דָּ֖ג]</span></span>');
  expect(output(v).words).toEqual([one(0, "בָּ֑ג", "tonic"), one(1, "דָּ֖ג", "tonic")]);
  const split = verse("בָּ֑ג"), raw = split.hebrew.segments[0]; if (raw.kind !== "text") throw 0;
  const input = { ...split, hebrew: { ...split.hebrew, segments: [{ kind: "text" as const, text: raw.text.slice(0, 2) }, { kind: "text" as const, text: raw.text.slice(2) }] } };
  const before = structuredClone(input); const value = output(input); expect(value.words).toEqual([one(0, "בָּ֑ג", "tonic")]); expect(input).toEqual(before);
  expect(Object.isFrozen(value.words) && value.words.every(w => Object.isFrozen(w) && (w.status !== "ready" || Object.isFrozen(w.syllables) && w.syllables.every(Object.isFrozen)))).toBe(true);
  expect(createStudyWordAids(verse("בָּ֑ג".normalize("NFD")))).toEqual(createStudyWordAids(split));
});
it("special spoken forms hold their entire unit without concealing independent guides", () => {
  const value = output(verse("יְהוָ֑ה בָּ֖ג")); expect(value.words[0]).toEqual({ index: 0, status: "unavailable", reason: "special-reading" }); expect(value.words[1]).toEqual(one(1, "בָּ֖ג", "tonic"));
});
it("poetic systems and failed canonical reconstruction have closed verse-only unavailable results", () => {
  expect(createStudyWordAids(verse("בָּ֑ג", "Psalms 1:1"))).toEqual({ schema: WORD_AID_SCHEMA, ref: "Psalms 1:1", status: "unavailable", reason: "unsupported-system" });
  const v = verse("בָּ֑ג"); expect(createStudyWordAids({ ...v, hebrew: { ...v.hebrew, readingText: "wrong" } })).toEqual({ schema: WORD_AID_SCHEMA, ref: v.ref, status: "unavailable", reason: "reconstruction" });
  expect(createStudyWordAids({ ...v, ref: "not-a-canonical-ref" })).toBeNull();
  const hostile = { ...v }; Object.defineProperty(hostile, "ref", { get() { throw new Error("PRIVATE_INPUT_DETAIL"); } }); expect(createStudyWordAids(hostile)).toBeNull();
  const nfd = v.hebrew.readingText.normalize("NFD");
  if (nfd !== v.hebrew.readingText) expect(createStudyWordAids({ ...v, hebrew: { text: nfd, readingText: nfd, segments: [{ kind: "text", text: nfd }], paragraphAfter: null } })?.status).toBe("unavailable");
});
it("escapes canonical reading text before whole-verse analysis instead of interpreting markup", () => {
  const v = verse("בָּ֑ג"), text = v.hebrew.readingText + " <x>&"; let received = "";
  seam.analyze = value => { received = value; return { warnings: ["held"], units: [], he: text }; };
  expect(createStudyWordAids({ ...v, hebrew: { ...v.hebrew, text, readingText: text, segments: [{ kind: "text", text }] } })?.status).toBe("unavailable");
  expect(received).toContain("&lt;x&gt;&amp;"); expect(received).not.toContain("<x>");
});
it("raw engine warnings/errors/mismatch and ambiguous accents stay sanitized and never mutate input", () => {
  for (const mode of ["warning", "throw", "mapping"]) {
    seam.analyze = () => { if (mode === "throw") throw new Error("PRIVATE_ENGINE_DETAIL"); return { he: "בָּ֑ג", warnings: mode === "warning" ? ["PRIVATE_ENGINE_DETAIL"] : [], units: [] }; };
    const value = createStudyWordAids(verse("בָּ֑ג")); expect(value).toEqual({ schema: WORD_AID_SCHEMA, ref: "Genesis 1:1", status: "unavailable", reason: "analysis-unavailable" }); expect(JSON.stringify(value)).not.toContain("PRIVATE_ENGINE_DETAIL");
  }
  seam.analyze = null; expect(output(verse("בָּ֑֖ג")).words[0]).toEqual({ index: 0, status: "unavailable", reason: "unproven" });
});
it("parser independently refuses stale/echoed hash, different word count/ref and accessor/extra shapes", () => {
  const v = verse("בָּ֑ג"), value = output(v), expected = binding(v);
  for (const bad of [{ ...expected, ref: "Genesis 1:2" }, { ...expected, readingTextSha256: "0".repeat(64) }, { ...expected, words: [...expected.words, "דָּג"] }, { ref: expected.ref }]) expect(parseStudyWordAids(value, bad)).toBeNull();
  expect(parseStudyWordAids({ ...value, ipa: "forbidden" }, expected)).toBeNull();
  expect(parseStudyWordAids({ ...value, wordCount: 1.2 }, expected)).toBeNull();
  expect(parseStudyWordAids({ ...value, ref: "Psalms 1:1" }, { ...expected, ref: "Psalms 1:1" })).toBeNull();
  const getter = { ...value }; Object.defineProperty(getter, "words", { get: () => { throw new Error("must not execute"); } }); expect(parseStudyWordAids(getter, expected)).toBeNull();
  const unavailable: StudyWordAids = { schema: WORD_AID_SCHEMA, ref: v.ref, status: "unavailable", reason: "reconstruction" };
  expect(parseStudyWordAids(unavailable, { ref: v.ref })).toEqual(unavailable); expect(parseStudyWordAids({ ...unavailable, words: [] }, expected)).toBeNull();
});
it("parser enforces consecutive full tiling, base-letter boundaries, exact indices and allowed stress", () => {
  const v = verse("בָּ֑ג"), value = output(v), expected = binding(v), length = expected.words[0].length;
  const parts = (syllables: unknown[]) => ({ ...value, words: [{ index: 0, status: "ready", syllables }] });
  for (const syllables of [[], [{ start: 1, end: length, stress: "tonic" }], [{ start: 0, end: length - 1, stress: "tonic" }], [{ start: 0, end: length, stress: "guessed" }], [{ start: 0, end: Infinity, stress: null }], [{ start: 0, end: 1, stress: null }, { start: 1, end: length, stress: "tonic" }], [{ start: 0, end: length, stress: null, text: "forbidden" }]]) expect(parseStudyWordAids(parts(syllables), expected)).toBeNull();
  expect(parseStudyWordAids({ ...value, words: [{ index: 1, status: "unavailable", reason: "unaccented" }] }, expected)).toBeNull();
  const sparse = new Array(1); expect(parseStudyWordAids({ ...value, words: sparse }, expected)).toBeNull();
  expect(parseStudyWordAids(value, { ...expected, words: Array(WORD_AID_LIMITS.words + 1).fill(expected.words[0]) })).toBeNull();
});
it("bounds total/per-word syllables independently of canonical word and source byte counts", () => {
  const make = (count: number, length: number) => {
    const words = Array.from({ length: count }, () => "ב".repeat(length)), hash = createHash("sha256").update(words.join(" ")).digest("hex");
    return { expected: { ref: "Genesis 1:1", readingTextSha256: hash, words }, value: { schema: WORD_AID_SCHEMA, ref: "Genesis 1:1", status: "ready", readingTextSha256: hash, wordCount: count,
      words: words.map((text, index) => ({ index, status: "ready", syllables: [...text].map((_, i) => ({ start: i, end: i + 1, stress: null })) })) } };
  };
  const at = make(WORD_AID_LIMITS.syllables / WORD_AID_LIMITS.perWord, WORD_AID_LIMITS.perWord); expect(parseStudyWordAids(at.value, at.expected)?.status).toBe("ready");
  const over = make(WORD_AID_LIMITS.syllables / WORD_AID_LIMITS.perWord + 1, WORD_AID_LIMITS.perWord); expect(parseStudyWordAids(over.value, over.expected)).toBeNull();
  const single = make(1, WORD_AID_LIMITS.perWord + 1); expect(parseStudyWordAids(single.value, single.expected)).toBeNull();
});
