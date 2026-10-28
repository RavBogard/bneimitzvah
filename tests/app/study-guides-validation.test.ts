import { expect, test } from "vitest";
import { LIMITS, validateGuideBody, validateVoice } from "../../src/server/study-guides/validation";
import { additions, guide, note, source, theme } from "../helpers/study-guide-fixture";

const ok = (body: unknown, allowOverview = true) => validateGuideBody(body, { allowOverview }).ok;
const exactBytes = (n: number, unit = "a") => unit.repeat(n);

test("accepts a body at every limit", () => {
  expect(ok(guide())).toBe(true);
  expect(ok(guide({ overview: exactBytes(LIMITS.overview) }))).toBe(true);
  expect(ok(guide({ themes: Array.from({ length: LIMITS.themes }, (_, i) => theme(`t-${i}`)) }))).toBe(true);
  expect(ok(guide({ themes: [theme("t", { title: "ש".repeat(LIMITS.title) })] }))).toBe(true);
  expect(ok(guide({ themes: [theme("t", { intro: exactBytes(LIMITS.intro) })] }))).toBe(true);
  expect(ok(guide({ themes: [theme("t", { notes: Array.from({ length: LIMITS.notes }, () => note()) })] }))).toBe(true);
  expect(ok(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { body: exactBytes(LIMITS.note), sources: [source("a"), source("b"), source("c")] })] })] }))).toBe(true);
  expect(ok(guide({ themes: [] }))).toBe(true);
  // Hebrew quotation and lists are part of the allowed subset.
  expect(ok(guide({ overview: "The cloud, *ענן*, fills the tent.\n\n- one\n- two" }))).toBe(true);
});

test("rejects every limit plus one", () => {
  expect(ok(guide({ overview: exactBytes(LIMITS.overview + 1) }))).toBe(false);
  expect(ok(guide({ themes: Array.from({ length: LIMITS.themes + 1 }, (_, i) => theme(`t-${i}`)) }))).toBe(false);
  expect(ok(guide({ themes: [theme("t", { title: "x".repeat(LIMITS.title + 1) })] }))).toBe(false);
  expect(ok(guide({ themes: [theme("t", { intro: exactBytes(LIMITS.intro + 1) })] }))).toBe(false);
  expect(ok(guide({ themes: [theme("t", { notes: Array.from({ length: LIMITS.notes + 1 }, () => note()) })] }))).toBe(false);
  // Size is counted in bytes: 2049 Hebrew letters are 4098 bytes.
  expect(ok(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { body: "ש".repeat(2049) })] })] }))).toBe(false);
});

test("rejects 9 themes", () => expect(ok(guide({ themes: Array.from({ length: 9 }, (_, i) => theme(`t-${i}`)) }))).toBe(false));
test("rejects a 4097-byte note", () => expect(ok(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { body: exactBytes(4097) })] })] }))).toBe(false));
test("rejects 4 sources on a note", () => expect(ok(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: ["a", "b", "c", "d"].map(id => source(id)) })] })] }))).toBe(false));
test("rejects raw HTML in a note", () => {
  expect(ok(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { body: "a <b>bold</b> claim" })] })] }))).toBe(false);
  expect(ok(guide({ overview: "x > y" }))).toBe(false);
});
test("rejects links and URLs; sources are the only references", () => {
  for (const text of ["see [this](https://example.test)", "https://example.test", "visit www.example.test"]) expect(ok(guide({ overview: text }))).toBe(false);
});
test("rejects a verseRef not matching /^[A-Za-z ]+ \\d+:\\d+$/", () => {
  for (const ref of ["Exodus 40", "Exodus 40:0", "Exodus 40:34-35", "<b> 1:1", "1 Kings 8:1", ""]) expect(ok(guide({ themes: [theme("t", { notes: [note(ref)] })] })), ref).toBe(false);
  expect(ok(guide({ themes: [theme("t", { notes: [note("I Kings 8:1")] })] }))).toBe(true);
});
test("student body rejects an overview", () => {
  expect(ok(additions(), false)).toBe(true);
  expect(ok(guide(), false)).toBe(false);
  expect(ok(additions([]), false)).toBe(false);
});
test("rejects duplicate theme ids, duplicate sources, unknown keys and hidden characters", () => {
  expect(ok(guide({ themes: [theme("same"), theme("same")] }))).toBe(false);
  expect(ok(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [source("a"), source("a")] })] })] }))).toBe(false);
  expect(ok({ ...guide(), extra: 1 })).toBe(false);
  expect(ok(guide({ themes: [{ ...theme(), color: "red" } as never] }))).toBe(false);
  expect(ok(guide({ overview: "hidden\u202emark" }))).toBe(false);
  expect(ok(guide({ overview: "carriage\r\nreturn" }))).toBe(false);
  expect(ok(guide({ themes: [theme("Bad Id")] }))).toBe(false);
  expect(ok(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [{ ...source(), readable: "yes" } as never] })] })] }))).toBe(false);
});
test("rejects a body over 131072 bytes even when every field is in bounds", () => {
  const big = Array.from({ length: 8 }, (_, i) => theme(`t-${i}`, { notes: Array.from({ length: 12 }, () => note("Exodus 40:34", { body: exactBytes(4000) })) }));
  const result = validateGuideBody(guide({ themes: big }), { allowOverview: true });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.problems.join(" ")).toContain("131072");
});
test("voice is bounded markdown text", () => {
  expect(validateVoice("Write for a twelve-year-old and an adult together.").ok).toBe(true);
  expect(validateVoice(exactBytes(LIMITS.voice)).ok).toBe(true);
  expect(validateVoice(exactBytes(LIMITS.voice + 1)).ok).toBe(false);
  expect(validateVoice("").ok).toBe(false);
  expect(validateVoice("<script>").ok).toBe(false);
  expect(validateVoice(7).ok).toBe(false);
});

test("rejects every link form a markdown renderer could honour, and disguising characters", () => {
  for (const text of [
    "[site][1]\n\n[1]: //evil.example", "[here]\n\n[here]: javascript:alert(1)", "write to someone@example.test", "mailto:a", "ftp://x", "see //evil.example",
    "![img][a]", "[a]: x", "tel:+15550100", "data:text/html,x", "arabic\u061cmark", "zero\u200bwidth", "line\u2028separator", "para\u2029separator", "\u200b", "word\u2060joiner",
  ]) expect(ok(guide({ overview: text })), JSON.stringify(text)).toBe(false);
  // Ordinary prose with a colon, brackets and Hebrew still passes.
  for (const text of ["Look at the data: the cloud stays.", "The cloud [ענן] rests on the tent.", "Rashi asks: why now?"]) expect(ok(guide({ overview: text })), text).toBe(true);
});

test("rejects every Unicode format character and blank look-alike; keeps ordinary glosses and paths of prose", () => {
  for (const code of [0x00ad, 0x034f, 0x0600, 0x115f, 0x180e, 0x2061, 0x2064, 0x206a, 0x3164, 0xfe0f, 0xffa0, 0xfff9, 0xe0041, 0xe0100])
    expect(ok(guide({ overview: `hidden${String.fromCodePoint(code)}mark` })), code.toString(16)).toBe(false);
  for (const text of ["Read more at evil.example/phish", "rabbi@例.example", "write@me"]) expect(ok(guide({ overview: text })), text).toBe(false);
  for (const text of ["The Mishkan [tabernacle] (from the root for dwelling).", "covered [it]: the tent", "[tabernacle] [lit. dwelling]", "the word [sic] (as written)", "Rashi [2]: he says", "a 1//2 split", "Tel Aviv: a city"])
    expect(ok(guide({ overview: text })), text).toBe(true);
});

test("a save request may cite a source by id alone; a stored body may not", () => {
  const byId = guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [{ id: "known-1" } as never] })] })] });
  expect(validateGuideBody(byId, { allowOverview: true, input: true }).ok).toBe(true);
  expect(validateGuideBody(byId, { allowOverview: true }).ok).toBe(false);
  expect(validateGuideBody(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [{ id: "not an id" } as never] })] })] }), { allowOverview: true, input: true }).ok).toBe(false);
  // A full object is still checked field by field in a request.
  expect(validateGuideBody(guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [{ ...source(), readable: "yes" } as never] })] })] }), { allowOverview: true, input: true }).ok).toBe(false);
});
