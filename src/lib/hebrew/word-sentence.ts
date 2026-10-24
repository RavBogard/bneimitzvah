import type { WordGrammar, WordGrammarFeature } from "./word-details";

/**
 * The first line of the word card: one plain sentence built only from the grammar and the meaning in this verse
 * that the word details already carry (no new source). Modelled on the haftarah study sheet's word panel, which
 * puts plain language ahead of the grammatical term. Pure; the dictionary details stay in the card below it.
 */
const FORM_LAY: Readonly<Record<string, string>> = {
  perfect: "past tense (completed action)", "sequential-perfect": "sequential (carrying the story on)", imperfect: "future or ongoing",
  wayyiqtol: "narrative past", cohortative: "a wish (let me, let us)", "conjunctive-imperfect": "a wish or purpose (so that …, may …)",
  jussive: "a wish or command (let it)", imperative: "a command", "active-participle": "a participle (-ing; one who)",
  "passive-participle": "a passive participle (-ed)", "infinitive-absolute": "an infinitive, for emphasis", "infinitive-construct": "an infinitive (to …)",
};
const STEM_HINTS: Readonly<Record<string, string>> = {
  Qal: "simple action", Niphal: "passive or reflexive", Piel: "intensive", Pual: "intensive, passive", Hiphil: "causing", Hophal: "causing, passive",
  Hithpael: "reflexive", "Qal passive": "simple action, passive", Polel: "intensive", Polal: "intensive, passive", Hithpolel: "reflexive", Hishtaphel: "reflexive",
};
const PERSON = { 1: "1st person", 2: "2nd person", 3: "3rd person" } as const;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const said = (value: string | null | undefined) => { const text = (value ?? "").replace(/\s+/g, " ").trim(); return text ? `: ‘${text}’` : ""; };
const gender = (part: WordGrammarFeature) => part.gender && part.gender !== "either" ? part.gender : null;
const gn = (part: WordGrammarFeature) => [gender(part), part.number].filter(Boolean).join(" ");
const pgn = (part: WordGrammarFeature) => [part.person && PERSON[part.person], gender(part), part.number].filter(Boolean).join(" ");
const after = (text: string) => text ? `, ${text}` : "";

/** The part of speech the sentence is about: the word itself, not a prefix (and, the, in) or a suffix (his, her). */
export function mainMorpheme(parts: readonly WordGrammarFeature[]): WordGrammarFeature | null {
  return parts.find(part => ["verb", "noun", "adjective", "pronoun"].includes(part.partOfSpeech))
    ?? parts.find(part => part.partOfSpeech !== "suffix") ?? parts[0] ?? null;
}

/** The sentence for one word, or null when its grammar is not known. `meaning` is the occurrence gloss, if any. */
export function wordSentence(meaning: string | null | undefined, grammar: WordGrammar): string | null {
  if (grammar.status !== "ready") return null;
  const part = mainMorpheme(grammar.morphemes); if (!part) return null;
  const gloss = said(meaning);
  switch (part.partOfSpeech) {
    case "verb": {
      const stem = part.stem, hint = stem ? STEM_HINTS[stem] : undefined;
      const tail = stem ? ` ${cap(hint ?? stem)}${hint ? ` (${stem})` : ""}.` : "";
      return `A verb, ${FORM_LAY[part.form ?? ""] ?? "a verb form"}${gloss}.${tail}`;
    }
    case "noun": {
      const state = part.state === "construct" ? "in construct (‘… of’)" : part.state === "definite" || part.definite ? "definite" : "";
      return `A noun${after([gn(part), state].filter(Boolean).join(", "))}${gloss}.`;
    }
    case "adjective": return `An adjective${after(gn(part))}${gloss}.`;
    case "pronoun": return `A pronoun${after(pgn(part))}${gloss}.`;
    case "suffix": return `A pronoun suffix${after(pgn(part))}${gloss}.`;
    case "particle": return `A particle${gloss}.`;
    case "preposition": return `A preposition${gloss}.`;
    case "conjunction": return `A conjunction${gloss}.`;
    case "adverb": return `An adverb${gloss}.`;
  }
}
