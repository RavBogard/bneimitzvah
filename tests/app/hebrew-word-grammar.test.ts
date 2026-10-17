import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decodeStepMorphology } from "../../src/server/study/lexical/morphology";
import { parseTahot, parseTbesh, alignStepVerse, STEP_LIMITS, StepSourceUnavailable } from "../../src/server/study/lexical/step";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { normalizeHebrew } from "../../src/server/study/normalize";
const ready = (input: string, book: string) => parseTahot(input, book).map(v => { if (v.status !== "ready") throw new StepSourceUnavailable(); return v; });
const row = (id: string, he = "בָּג", code = "HNcmsa", extra: Partial<{ gloss: string; lemma: string; meaning: string; spelling: string }> = {}) => [id, he, "IGNORED_TRANSLITERATION", extra.gloss ?? "Synthetic noun", extra.lemma ?? "{H0001}", code, extra.meaning ?? "", extra.spelling ?? ""].join("\t");
const lex = (id = "H0001", code = "HNcmsa") => ["H0001#1", id, "H0001", "בָּג", "IGNORED_PRONUNCIATION", code, "Synthetic dictionary sense", "IGNORED_LONG_MEANING"].join("\t");
const expected = (text: string, ref = "Genesis 1:1") => { const p = projectStudyVerse(ref, normalizeHebrew(text)); if (p.status !== "ready") throw new Error("Synthetic projection failed"); return { ref, words: p.projection.words.map(w => w.text) }; };
const unavailable = { status: "unavailable", reason: "correspondence" };
it("uses Hebrew-number overrides even when English chapter is outside Hebrew bounds, excluding LXX", () => {
  const values = ready([row("Mal.4.1(3.19)#1=L"), row("Mal.4.1(3.19)#2=Q(k)", "דָּג", "HNcmsa", { spelling: "L= ignored ¦ ;K= זָח" }), row("Mal.4.1(3.19)#1501=X", "not retained")].join("\n"), "Mal");
  expect(values).toHaveLength(1); expect(values[0].ref).toBe("Malachi 3:19"); expect(values[0].words.map(w => w.number)).toEqual([1, 2]); expect(values[0].words[1]).toMatchObject({ qere: true, ketiv: "זָח" });
  expect(JSON.stringify(values)).not.toMatch(/IGNORED|ignored|not retained/);
  expect(ready(row("Gen.1.1#01=L"), "Gen")[0].words[0].number).toBe(1);
  expect(() => ready(row("Gen.1.1#01=L") + "\n" + row("Gen.1.1#1=L"), "Gen")).toThrow(StepSourceUnavailable);
});
it("retains qere Hebrew and only bounded ketiv metadata from recognized variants", () => {
  const values = ready(row("Gen.1.1#1=Q(K)", "בָּ/גָד", "HTd/Ncmsa", { lemma: "H9009/{H0001}", meaning: "K= IGNORED_K_PRONUNCIATION (זָ/חָ) remainder" }), "Gen");
  expect(values[0].words[0]).toMatchObject({ hebrew: "בָּ/גָד", qere: true, ketiv: "זָ/חָ", lemmas: [{ id: "H9009", lexical: false }, { id: "H0001", lexical: true }] });
  expect(JSON.stringify(values)).not.toContain("IGNORED");
  expect(() => ready(row("Gen.1.1#1=Q(K)", "בָּג", "HNcmsa", { meaning: "K= x (זָח)", spelling: "K= דָה" }), "Gen")).toThrow(StepSourceUnavailable);
});
it("decodes independent expected verb/noun/pronoun/affix facts, not tense interpretations or roots", () => {
  expect(decodeStepMorphology("Hc/Vqw3ms")).toEqual({ status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "conjunction", variant: "c" }, { partOfSpeech: "verb", stem: "Qal", form: "wayyiqtol", person: 3, gender: "masculine", number: "singular" }] });
  expect(decodeStepMorphology("HNcmsc/Sp2ms")).toEqual({ status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "noun", variant: "c", gender: "masculine", number: "singular", state: "construct" }, { partOfSpeech: "suffix", variant: "p", person: 2, gender: "masculine", number: "singular" }] });
  expect(decodeStepMorphology("HPp1bs")).toEqual({ status: "ready", language: "hebrew", morphemes: [{ partOfSpeech: "pronoun", variant: "p", person: 1, gender: "either", number: "singular" }] });
  expect(decodeStepMorphology("HVqc1cp")).toMatchObject({ status: "ready", morphemes: [{ partOfSpeech: "verb", form: "cohortative", person: 1, number: "plural" }] });
  expect(decodeStepMorphology("HVqcc")).toMatchObject({ status: "ready", morphemes: [{ form: "infinitive-construct" }] });
});
it("rejects incomplete/unknown/trailing morphology instead of guessing; Aramaic is not mislabeled Hebrew", () => {
  for (const code of ["", "H", "HNcmsaEXTRA", "HNcms", "HVqp", "HV?p3ms", "HPp", "HZunknown", "Hc/", "AVqp3ms", "H" + Array(17).fill("c").join("/"), "H" + "c".repeat(257)]) expect(decodeStepMorphology(code)).toEqual({ status: "unavailable", reason: "unrecognized-code" });
  expect(ready(row("Gen.1.1#1=L", "בָּג", "HZunknown"), "Gen")[0].words[0].morphology.status).toBe("unavailable");
});
it("parses immutable TBESH dictionary senses with lettered lemma IDs, discarding pronunciation/long meaning", () => {
  const parsed = parseTbesh(lex("H0001a")); expect(parsed).toEqual([{ lemma: "H0001a", status: "ready", hebrew: "בָּג", dictionaryGloss: "Synthetic dictionary sense", morphology: decodeStepMorphology("HNcmsa") }]);
  expect(JSON.stringify(parsed)).not.toMatch(/IGNORED|Translit|Pronunciation/); if (parsed[0].status !== "ready") throw new Error("Synthetic entry held"); expect(Object.isFrozen(parsed) && Object.isFrozen(parsed[0]) && Object.isFrozen(parsed[0].morphology)).toBe(true);
  expect(parseTbesh(lex() + "\n" + lex())).toEqual([{ lemma: "H0001", status: "unavailable", reason: "source-format" }]);
  for (const text of [lex("H0001 H0002"), lex("bad"), "H0001\tincomplete"]) expect(() => parseTbesh(text)).toThrow("Lexical source unavailable");
});
it("full ordered canonical correspondence handles affixes, maqaf and qere without changing text", () => {
  const src = ready([row("Gen.1.1#2=L", "דָּג"), row("Gen.1.1#1=L", "וְ/בָּג\\־", "Hc/Ncmsa", { lemma: "H9002/{H0001}" })].join("\n"), "Gen")[0];
  const target = expected("וְבָּ֑ג־דָּ֖ג"), before = structuredClone(src), result = alignStepVerse(src, target);
  expect(result.status).toBe("ready"); if (result.status !== "ready") throw 0;
  expect(result.matches.map(m => [m.index, m.source.number])).toEqual([[0, 1], [1, 2]]); expect(src).toEqual(before); expect(result.matches[0].source).not.toBe(src.words[0]);
  expect(Object.isFrozen(result) && Object.isFrozen(result.matches) && Object.isFrozen(result.matches[0].source.lemmas)).toBe(true);
  const qere = normalizeHebrew('<span class="mam-kq"><span class="mam-kq-k">זָח</span><span class="mam-kq-q">[בָּ֑ג]</span></span>'); const p = projectStudyVerse("Genesis 1:1", qere); if (p.status !== "ready") throw 0;
  expect(alignStepVerse(ready(row("Gen.1.1#1=Q(K)", "בָּג", "HNcmsa", { meaning: "K= ignored (זָח)" }), "Gen")[0], { ref: "Genesis 1:1", words: p.projection.words.map(w => w.text) }).status).toBe("ready");
});
it("withholds all partial/repeated-word alignments instead of picking an arbitrary LCS tie", () => {
  const src = ready([row("Gen.1.1#1=L", "בָּג"), row("Gen.1.1#2=L", "בָּג")].join("\n"), "Gen")[0];
  expect(alignStepVerse(src, expected("בָּ֑ג"))).toEqual(unavailable); expect(alignStepVerse(src, expected("בָּ֑ג דָּ֖ג"))).toEqual(unavailable);
  expect(alignStepVerse(src, expected("בָּ֑ג בָּ֖ג")).status).toBe("ready");
  expect(alignStepVerse(src, expected("בָּ֑ג בָּ֖ג", "Genesis 1:2"))).toEqual(unavailable);
  expect(alignStepVerse(ready(row("Gen.1.1#1=L", "יְהוָה"), "Gen")[0], expected("אֲדֹנָ֑י"))).toEqual(unavailable);
});
it("rejects invalid, duplicate, nonconsecutive or ambiguous source identities and unsafe fields", () => {
  for (const text of [row("Gen.0.1#1=L"), row("Gen.1.999#1=L"), row("Gen.1.1#0=L"), row("Gen.1.1#513=L"), row("Gen.1.1#2=L"), row("Gen.1.1#1=L") + "\n" + row("Gen.1.1#1=L"), row("Gen.1.1#1=unknown"), row("Gen.1.1#1=L", "<b>בג</b>"), row("Gen.1.1#1=L", "/בג"), row("Gen.1.1#1=L", "בג", "HNcmsa", { lemma: "{H0001}/{H0002}" }), row("Gen.1.1#1=L", "בג", "HNcmsa", { gloss: "x".repeat(STEP_LIMITS.glossBytes + 1) }), "Gen.broken", row("Gen.1.1#1=L") + "\ud800"]) expect(() => ready(text, "Gen")).toThrow("Lexical source unavailable");
});
it("bounds lines/morphemes/canonical words, rejecting Latin/HTML and sparse or accessor expectations", () => {
  expect(() => ready("x".repeat(STEP_LIMITS.lineBytes + 1), "Gen")).toThrow(StepSourceUnavailable);
  expect(() => ready(row("Gen.1.1#1=L", Array(17).fill("בג").join("/")), "Gen")).toThrow(StepSourceUnavailable);
  const src = ready(row("Gen.1.1#1=L"), "Gen")[0];
  for (const words of [["<i>בג</i>"], ["bg"], ["ב ג"], ["ב/ג"], ["ב".repeat(8193)], new Array(1), Array(513).fill("בג")]) expect(alignStepVerse(src, { ref: src.ref, words })).toEqual(unavailable);
  const words = ["בג"]; Object.defineProperty(words, "0", { get: () => { throw new Error("must not read"); } }); expect(alignStepVerse(src, { ref: src.ref, words })).toEqual(unavailable);
});
it("bounds whole-file bytes and total source rows including excluded rows, with fixed errors", () => {
  expect(() => parseTbesh("x".repeat(STEP_LIMITS.fileBytes + 1))).toThrow("Lexical source unavailable");
  const excluded = row("Gen.1.1#1=X") + "\n";
  expect(() => ready(row("Gen.0.1#01=X"), "Gen")).toThrow("Lexical source unavailable");
  expect(() => ready(excluded.repeat(STEP_LIMITS.rows + 1), "Gen")).toThrow("Lexical source unavailable");
  const grammar = decodeStepMorphology("HNcmsa");
  expect(Object.isFrozen(grammar) && (grammar.status !== "ready" || Object.isFrozen(grammar.morphemes) && grammar.morphemes.every(Object.isFrozen))).toBe(true);
});

it("recognizes pinned annotated row types and plus markers without retaining discarded syntax", () => {
  for (const type of ["LAH(b)", "L(abh)", "LA(bh)", "LBH(a+C)", "L(AH+B)"]) {
    const verse = ready(row(`Gen.1.1#1=${type}`, "בָּג", "HNcmsa", { lemma: "{H0001}+" }), "Gen")[0];
    expect(verse.words[0].lemmas).toEqual([{ id: "H0001", lexical: true }]);
  }
  expect(parseTahot(row("Gen.1.1#1=L(UNKNOWN)"), "Gen")).toEqual([{ ref: "Genesis 1:1", status: "unavailable", reason: "source-format" }]);
});
it("holds identified malformed, duplicate and gapped verses permanently without poisoning valid neighbors", () => {
  const text = [row("Gen.1.1#1=L"), row("Gen.1.1#01=L"), row("Gen.1.1#2=L"), row("Gen.1.2#1=L", "בָּג", "HNcmsa", { lemma: "{H0001}//{H0002}" }), row("Gen.1.3#2=L"), row("Gen.1.4#1=L")].join("\n");
  const parsed = parseTahot(text, "Gen");
  expect(parsed.map(v => [v.ref, v.status])).toEqual([["Genesis 1:1", "unavailable"], ["Genesis 1:2", "unavailable"], ["Genesis 1:3", "unavailable"], ["Genesis 1:4", "ready"]]);
  expect(parsed.slice(0, 3).every(v => !Object.hasOwn(v, "words"))).toBe(true);
  expect(alignStepVerse(parsed[0], expected("בָּ֑ג"))).toEqual(unavailable);
});
it("parses only exact TBESH relationship metadata and holds ambiguous headwords or duplicate IDs", () => {
  for (const relation of ["", "a Part of", "in Aramaic of", "a Name of", "combination of", "a group of", "a Spelling of", "a Meaning of", "a form of", "in Hebrew of"]) {
    const entries = parseTbesh(lex(`H0001 = ${relation}`));
    expect(entries[0]).toMatchObject({ lemma: "H0001", status: "ready" }); expect(JSON.stringify(entries)).not.toContain("IGNORED");
  }
  const ambiguous = lex().replace("בָּג", "בָּג, דָּג");
  const entries = parseTbesh([ambiguous, lex("H0001"), lex("H0002 = unknown relationship"), lex("H0003 = a Name of")].join("\n"));
  expect(entries.map(e => [e.lemma, e.status])).toEqual([["H0001", "unavailable"], ["H0002", "unavailable"], ["H0003", "ready"]]);
  expect(Object.isFrozen(entries) && entries.every(Object.isFrozen)).toBe(true);
});

it("permanently holds any identified retained blank read row, even a trailing row", () => {
  for (const type of ["L", "Q(K)", "Q(k)"]) {
    const parsed = parseTahot([row("Gen.1.1#1=L"), row(`Gen.1.1#2=${type}`, ""), row("Gen.1.2#1=L")].join("\n"), "Gen");
    expect(parsed[0]).toEqual({ ref: "Genesis 1:1", status: "unavailable", reason: "source-format" });
    expect(parsed[1].status).toBe("ready"); expect(alignStepVerse(parsed[0], expected("בָּ֑ג"))).toEqual(unavailable);
  }
});
