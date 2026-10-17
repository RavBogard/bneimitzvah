import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseTahot, parseTbesh, alignStepVerse, StepSourceUnavailable } from "../../src/server/study/lexical/step";
import { decodeStepMorphology } from "../../src/server/study/lexical/morphology";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
const row = (identity: string, hebrew = "בָּג", morph = "HNcmsa", lemma = "{H0001}") => [identity, hebrew, "DISCARDED_ROMANIZATION", "Synthetic short sense", lemma, morph, "DISCARDED_SOURCE_NOTES", ""].join("\t");
const lex = (lemma: string, head = "בָּג", morph = "HNcmsa") => ["H0001#1", lemma, "H0001", head, "DISCARDED_PRONUNCIATION", morph, "Synthetic dictionary sense", "DISCARDED_LONG_PROSE"].join("\t");
const target = (text: string, ref = "Genesis 1:1") => { const p = projectStudyVerse(ref, normalizeHebrew(text)); if (p.status !== "ready") throw new Error("Synthetic fixture unavailable"); return { ref, words: p.projection.words.map(w => w.text) }; };
const held = { status: "unavailable", reason: "correspondence" };

it("review requires known empty retained reading identities to hold the whole verse, not disappear at its tail", () => {
  const input = [row("Gen.1.1#1=L"), row("Gen.1.1#2=L", ""), row("Gen.1.2#1=L")].join("\n");
  expect(parseTahot(input, "Gen")).toMatchObject([{ ref: "Genesis 1:1", status: "unavailable", reason: "source-format" }, { ref: "Genesis 1:2", status: "ready" }]);
});

it("review proves Hebrew override/reading order under BOM/CRLF and discards all opaque columns", () => {
  const input = "\ufeff# Synthetic header\r\n" + [row("Mal.4.1(3.19)#2=L", "דָּג"), row("Mal.4.1(3.19)#9999=X", "not a retained word"), row("Mal.4.1(3.19)#1=LBH(a+C)", "וְ/בָּג\\־", "Hc/Ncmsa", "H9002/{H0001}+")].join("\r\n");
  const values = parseTahot(input, "Mal"), value = values[0]; expect(value.status).toBe("ready");
  if (value.status !== "ready") throw 0;
  expect(value.ref).toBe("Malachi 3:19"); expect(value.words.map(w => w.number)).toEqual([1, 2]); expect(value.words[0].lemmas).toEqual([{ id: "H9002", lexical: false }, { id: "H0001", lexical: true }]);
  expect(alignStepVerse(value, target("וְבָּ֑ג־דָּ֖ג", "Malachi 3:19")).status).toBe("ready");
  expect(JSON.stringify(values)).not.toMatch(/DISCARDED|retained word/);
});

it("review malformed retained annotations/duplicate and gap holds remain permanent across later good rows", () => {
  const values = parseTahot([row("Gen.1.1#1=L(UNKNOWN)"), row("Gen.1.1#2=L"), row("Gen.1.1#1=L"), row("Gen.1.2#1=L"), row("Gen.1.2#01=L"), row("Gen.1.3#2=L"), row("Gen.1.4#1=L")].join("\n"), "Gen");
  expect(values.map(v => [v.ref, v.status])).toEqual([["Genesis 1:1", "unavailable"], ["Genesis 1:2", "unavailable"], ["Genesis 1:3", "unavailable"], ["Genesis 1:4", "ready"]]);
  expect(values.slice(0, 3).every(v => !Object.hasOwn(v, "words"))).toBe(true);
  for (const bad of ["Gen.1.1#00000=X", "Gen.1.1#0=X", "Gen.1.1#9999=L", "Gen.0.1#1=L", "Gen.1.1#1=L\ud800"]) expect(() => parseTahot(row(bad), "Gen")).toThrow(StepSourceUnavailable);
});

it("review full correspondence never adopts one repeated source occurrence, another ref or divine replacement", () => {
  const source = parseTahot([row("Gen.1.1#1=L"), row("Gen.1.1#2=L")].join("\n"), "Gen")[0];
  for (const expected of [target("בָּ֑ג"), target("בָּ֑ג דָּ֖ג"), target("בָּ֑ג בָּ֖ג בָּ֑ג"), target("בָּ֑ג בָּ֖ג", "Genesis 1:2")]) expect(alignStepVerse(source, expected)).toEqual(held);
  const result = alignStepVerse(source, target("בָּ֑ג בָּ֖ג")); expect(result.status).toBe("ready");
  if (result.status === "ready") expect(result.matches.map(v => [v.index, v.source.number])).toEqual([[0, 1], [1, 2]]);
  expect(alignStepVerse(parseTahot(row("Gen.1.1#1=L", "יְהוָה"), "Gen")[0], target("אֲדֹנָ֑י"))).toEqual(held);
});

it("review recognizes factual inflection inventory but does not guess unknown suffixes or Aramaic grammar", () => {
  const cases = [
    ["HVhp3fs", { partOfSpeech: "verb", stem: "Hiphil", form: "perfect", person: 3, gender: "feminine", number: "singular" }],
    ["HVti2mp", { partOfSpeech: "verb", stem: "Hithpael", form: "imperfect", person: 2, gender: "masculine", number: "plural" }],
    ["HVqsmsa", { partOfSpeech: "verb", stem: "Qal", form: "passive-participle", gender: "masculine", number: "singular", state: "absolute" }],
    ["HAomsa", { partOfSpeech: "adjective", variant: "o", gender: "masculine", number: "singular", state: "absolute" }],
    ["HPd", { partOfSpeech: "pronoun", variant: "d" }],
  ] as const;
  for (const [code, expected] of cases) expect(decodeStepMorphology(code)).toEqual({ status: "ready", language: "hebrew", morphemes: [expected] });
  for (const code of ["HVhp3fsx", "HVqsmsa/", "HNcmsa\n", "A", "ANcmsa", "Hc//Ncmsa", "HNcmsa/H", "Hc".repeat(130)]) expect(decodeStepMorphology(code)).toEqual({ status: "unavailable", reason: "unrecognized-code" });
});

it("review dictionary alternatives and unknown relationships hold canonical IDs permanently without leaking prose", () => {
  const values = parseTbesh([lex("H0001 = a Name of", "בָּג, דָּג"), lex("H0001"), lex("H0002 = unsupported"), lex("H0002 = a form of"), lex("H0003 = a Part of")].join("\n"));
  expect(values.map(v => [v.lemma, v.status])).toEqual([["H0001", "unavailable"], ["H0002", "unavailable"], ["H0003", "ready"]]);
  expect(JSON.stringify(values)).not.toContain("DISCARDED"); expect(values.every(Object.isFrozen)).toBe(true);
});

it("review copy/freeze boundaries prevent aligned caller mutation of nested grammar or lemma facts", () => {
  const source = parseTahot(row("Gen.1.1#1=L", "וְ/בָּג", "Hc/Ncmsc/Sp2ms", "H9002/{H0001}"), "Gen")[0];
  const before = structuredClone(source), result = alignStepVerse(source, target("וְבָּ֑ג")); expect(result.status).toBe("ready"); expect(source).toEqual(before);
  if (result.status !== "ready" || source.status !== "ready") throw 0;
  const copy = result.matches[0].source; expect(copy).not.toBe(source.words[0]); expect(copy.lemmas).not.toBe(source.words[0].lemmas); expect(Object.isFrozen(copy.morphology)).toBe(true);
  if (copy.morphology.status !== "ready" || source.words[0].morphology.status !== "ready") throw 0;
  expect(copy.morphology.morphemes).not.toBe(source.words[0].morphology.morphemes); expect(copy.morphology.morphemes.every(Object.isFrozen)).toBe(true); expect(copy.lemmas.every(Object.isFrozen)).toBe(true);
});

it("review unsafe retained fields hold only known units, invalid identities/file controls still refuse", () => {
  const values = parseTahot([row("Gen.1.1#1=L", "בָּג", "HNcmsa", "{H0001}//H9002"), row("Gen.1.2#1=L")].join("\n"), "Gen");
  expect(values.map(v => v.status)).toEqual(["unavailable", "ready"]);
  expect(() => parseTahot(row("Gen.1.1#1=L").replace("DISCARDED_ROMANIZATION", "discarded\u0000"), "Gen")).toThrow("Lexical source unavailable");
  expect(() => parseTbesh(lex("invalid"))).toThrow("Lexical source unavailable");
  const source = parseTahot(row("Gen.1.1#1=L"), "Gen")[0];
  for (const words of [["<i>בג</i>"], ["bg"], ["ב/ג"], ["ב ג"], ["בג".repeat(5000)]]) expect(alignStepVerse(source, { ref: "Genesis 1:1", words })).toEqual(held);
});
