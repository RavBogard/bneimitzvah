import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse, type HebrewSource, type StudyProjection } from "../../src/lib/hebrew/study-tokens";
import { colorStudyVerse, type AssignmentEnding } from "../../src/lib/hebrew/study-annotations";
import { PHRASE_FAMILIES } from "../../src/lib/trope/chart-catalog";
vi.mock("server-only", () => ({}));
const lib = createRequire(import.meta.url)("../../trope/lib-trope.cjs");
const assignment = { kind: "haftarah" as const, confirmed: true, verses: ["Isaiah 1:1", "Isaiah 1:2"] };
function projected(source: HebrewSource) {
  const r = projectStudyVerse("Isaiah 1:1", source);
  expect(r.status).toBe("ready");
  if (r.status !== "ready") throw Error("Synthetic projection unavailable");
  return r.projection;
}
const plain = (s: string) => normalizeHebrew(s);
const colors = (s: string, ref = "Isaiah 1:1", a: AssignmentEnding = assignment) => colorStudyVerse(ref, plain(s), a);
const combine = (p: StudyProjection, read: boolean) => p.runs.map(r => r.kind === "text" ? r.parts.map(s => s.text).join("") : r.kind === "alternative" ? read ? r.read.map(s => s.text).join("") : r.written : r.kind === "gap" ? " " : "").join("").normalize("NFC").replace(/ +/g, " ").trim();

describe("lossless canonical study projection", () => {
  it("reconstructs both views with multiword qere, maqaf, source splits, gaps and inverted nun", () => {
    const source = plain('<span class="mam-spi-invnun">׆</span>אָ<b>ב</b>־גָ֣ ׀ <span class="mam-kq"><span class="mam-kq-k">כָ֔תָב</span><span class="mam-kq-q">[קָ֖רִי דָ֑בָר]</span></span><span class="mam-spi-samekh">{ס}</span>בָֽ׃<span class="mam-spi-pe">{פ}</span>');
    const before = JSON.stringify(source);
    const p = projected(source);
    expect(combine(p, false)).toBe(source.text);
    expect(combine(p, true)).toBe(source.readingText);
    expect(p.words.map(w => [w.index, w.text])).toEqual(["אָב", "גָ֣", "קָ֖רִי", "דָ֑בָר", "בָֽ"].map((w, i) => [i, w.normalize("NFC")]));
    expect(p.words[0].spans).toHaveLength(2);
    const qere = p.runs.find(r => r.kind === "alternative");
    if (qere?.kind !== "alternative") throw Error("Missing synthetic alternative");
    expect(qere.written).toBe("כָ֔תָב");
    expect(qere.read.filter(p => p.wordIndex !== null).map(p => p.wordIndex)).toEqual([2, 3]);
    expect(p.tokens.find(t => t.words.includes(2))?.words).toEqual([2, 3]);
    expect(p.runs.filter(r => r.kind === "gap").length).toBe(2);
    expect(p.runs[0].kind).toBe("inverted-nun");
    for (const w of p.words) expect(w.spans.map(s => {
      const seg = source.segments[s.segment];
      return (seg.kind === "text" ? seg.text : seg.kind === "alternative" ? seg.read : "").slice(s.start, s.end);
    }).join("").normalize("NFC")).toBe(w.text);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("preserves NFC offsets and every literal source character without interpreting HTML text", () => {
    const source = plain('אָ֑ב\u034f &lt;img src=x&gt; גָֽ׃');
    const p = projected(source);
    expect(combine(p, true)).toBe(source.readingText);
    const c = colorStudyVerse("Isaiah 1:1", source, assignment);
    expect(c.status).toBe("ready");
    expect(p.runs.flatMap(r => r.kind === "text" ? r.parts : []).map(p => p.text).join("")).toContain("<img src=x>");
  });
  it("fails reconstruction without returning a plausible alternative mapping", () => {
    const source = plain("אָ֑ב גָֽ׃");
    expect(projectStudyVerse("Isaiah 1:1", { ...source, readingText: "בָֽ׃" })).toEqual({ status: "unavailable", reason: "reconstruction" });
    expect(projectStudyVerse("Isaiah 1:1", { ...source, paragraphAfter: "petuchah" })).toMatchObject({ status: "unavailable", reason: "reconstruction" });
    // Hebrew combining marks alone can already have identical NFC/NFD forms.
    // Include a composed literal so this actually tests non-NFC source spans.
    const composed = plain("אָ֑ב é גָֽ׃");
    expect(composed.text.normalize("NFD")).not.toBe(composed.text);
    expect(projectStudyVerse("Isaiah 1:1", { ...composed, segments: [{ kind: "text", text: composed.text.normalize("NFD") }] })).toMatchObject({ status: "unavailable", reason: "reconstruction" });
  });
  it("bounds raw whitespace/display and words before source-span mapping", () => {
    const short = plain("בָ֑");
    const whitespace = { ...short, segments: [...Array.from({ length: 100 }, () => ({ kind: "text" as const, text: " ".repeat(100) })), ...short.segments] };
    expect(projectStudyVerse("Isaiah 1:1", whitespace)).toMatchObject({ status: "unavailable", reason: "bounds" });
    const tooMany = colors("בָ ".repeat(513));
    expect(tooMany).toMatchObject({ status: "unavailable", reason: "bounds" });
    expect(colors("בָ ".repeat(512)).status).toBe("ready");
    expect(projectStudyVerse("Isaiah 1:1", { ...short, segments: [{ kind: "alternative", written: "בָ".repeat(2048), read: "בָ" }] })).toMatchObject({ status: "unavailable", reason: "bounds" });
  });
});

describe("typed phrase families", () => {
  it("matches lib-trope for every chart family and following-phrase/conjunctive accent", () => {
    const accents = ["֑", "֔", "֕", "֗", "֛", "֒", "֓", "֜", "֝", "֞", "֩", "֡", "֠", "֟", "֖", "֙", "֚", "֮", "֘", "֣", "֥"];
    const used = new Set<string>();
    for (const accent of accents) for (const final of [false, true]) {
      const text = `בָ֣ גָ${accent} דָֽ׃`.normalize("NFC");
      const a = { ...assignment, verses: final ? ["Isaiah 1:1"] : assignment.verses };
      const actual = colors(text, "Isaiah 1:1", a);
      if (actual.status !== "ready") throw Error("Synthetic colors unavailable");
      const expected = lib.tropePhrases(text, { final }).flatMap((p: { family: string; html: string }, phrase: number) => p.html.split(" ").map(() => ({ family: p.family, phrase })));
      expect(actual.words.map(({ family, phrase }) => ({ family, phrase }))).toEqual(expected);
      actual.words.forEach(w => { if (w.family) used.add(w.family); });
    }
    expect([...used].sort()).toEqual(PHRASE_FAMILIES.map(f => f.id).sort());
  });
  it("retains gap/sign separators, follows a closing phrase, and uses only Unicode paseq fallback", () => {
    const c = colors('בָ֣ ׀ גָ֖<span class="mam-spi-samekh">{ס}</span>דָ֔ <span class="mam-spi-invnun">׆</span> בָֽ׃');
    if (c.status !== "ready") throw Error("Synthetic colors unavailable");
    expect(c.words.map(w => w.family)).toEqual(["revia", "zakef", "zakef", "sof-pasuk"]);
    expect(c.tokens.filter(t => t.kind !== "text").every(t => t.family === null && t.phrase === null)).toBe(true);
    expect(colors("בָ֣ <b>׀</b> גָֽ׃")).toEqual(colors("בָ֣ <small>׀</small> גָֽ׃"));
    const qere = colors('<span class="mam-kq"><span class="mam-kq-k">בָ֔</span><span class="mam-kq-q">[גָ֖ דָ֑]</span></span> בָֽ׃');
    if (qere.status !== "ready") throw Error("Synthetic colors unavailable");
    expect(qere.words.map(w => w.family)).toEqual(["etnachta", "etnachta", "sof-pasuk"]);
  });
  it("uses the confirmed assignment's last canonical verse, including excerpts, never a page end or Torah", () => {
    const text = "בָֽ׃";
    for (const a of [assignment, { ...assignment, confirmed: false, verses: ["Isaiah 1:1"] }, { ...assignment, kind: "torah" as const, verses: ["Isaiah 1:1"] }]) {
      const r = colors(text, "Isaiah 1:1", a);
      expect(r.status === "ready" && r.words[0].family).toBe("sof-pasuk");
    }
    const excerpt = colors(text, "Isaiah 1:1", { ...assignment, verses: ["Isaiah 1:1"] });
    expect(excerpt.status === "ready" && excerpt.words[0].family).toBe("sof-haftarah");
  });
  it.each(["Psalms 1:1", "Proverbs 1:1", "Job 1:1"])("disables derived aids by book independently of shared accents: %s", ref => {
    const source = plain("בָ֣ גָ֑ דָֽ׃");
    const c = colorStudyVerse(ref, source, { ...assignment, verses: [ref] });
    expect(c).toMatchObject({ status: "unavailable", reason: "unsupported-system" });
    expect(projectStudyVerse(ref, source).status).toBe("ready");
  });
});
