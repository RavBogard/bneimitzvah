import "server-only";

// Adapted from haftarah/scripts/words.mjs (33c04bcb). STEP source pin bd09545c:
// STEPBible/Tyndale House Cambridge, CC BY 4.0. Changes: closed factual subset,
// exact full-code consumption, immutable output, no hints/transliteration/I/O.
export type MorphFeatures = Readonly<{ partOfSpeech: "verb" | "noun" | "adjective" | "pronoun" | "suffix" | "particle" | "preposition" | "conjunction" | "adverb";
  variant?: string; stem?: string; form?: string; person?: 1 | 2 | 3; gender?: "masculine" | "feminine" | "common" | "either";
  number?: "singular" | "plural" | "dual"; state?: "absolute" | "construct" | "definite"; definite?: boolean }>;
export type Morphology = Readonly<{ status: "ready"; language: "hebrew" | "aramaic"; morphemes: readonly MorphFeatures[] }>
  | Readonly<{ status: "unavailable"; reason: "unrecognized-code" }>;
const unavailable: Morphology = Object.freeze({ status: "unavailable", reason: "unrecognized-code" });
const stems: Record<string, string> = { q: "Qal", N: "Niphal", p: "Piel", P: "Pual", h: "Hiphil", H: "Hophal", t: "Hithpael", o: "Polel", O: "Polal", r: "Hithpolel", m: "Poel", M: "Poal", k: "Palel", K: "Pulal", Q: "Qal passive", l: "Pilpel", L: "Polpal", f: "Hithpalpel", D: "Nithpael", j: "Pealal", i: "Pilel", u: "Hothpaal", c: "Tiphil", v: "Hishtaphel", w: "Nithpalel", y: "Nithpoel", z: "Hithpoel" };
const forms: Record<string, string> = { p: "perfect", q: "sequential-perfect", i: "imperfect", u: "conjunctive-imperfect", w: "wayyiqtol", h: "cohortative", j: "jussive", v: "imperative", r: "active-participle", s: "passive-participle", a: "infinitive-absolute", c: "infinitive-construct" };
const gender = { m: "masculine", f: "feminine", c: "common", b: "either" } as const;
const number = { s: "singular", p: "plural", d: "dual" } as const;
const state = { a: "absolute", c: "construct", d: "definite" } as const;
function tail(value: string, person: boolean): Partial<MorphFeatures> | null {
  const m = (person ? /^([123])([mfcb])([spd])$/ : /^([mfcb])([spd])([acd])$/).exec(value); if (!m) return null;
  return person ? { person: Number(m[1]) as 1 | 2 | 3, gender: gender[m[2] as keyof typeof gender], number: number[m[3] as keyof typeof number] }
    : { gender: gender[m[1] as keyof typeof gender], number: number[m[2] as keyof typeof number], state: state[m[3] as keyof typeof state] };
}
function feature(part: string): MorphFeatures | null {
  if (part === "c" || part === "C") return { partOfSpeech: "conjunction", variant: part };
  if (part === "D") return { partOfSpeech: "adverb" };
  if (part === "R" || part === "Rd") return { partOfSpeech: "preposition", definite: part === "Rd" };
  if (/^T[acdeijmnor]$/.test(part)) return { partOfSpeech: "particle", variant: part[1] };
  if (/^S[dhn]$/.test(part)) return { partOfSpeech: "suffix", variant: part[1] };
  if (/^Np(?:m)?$/.test(part)) return { partOfSpeech: "noun", variant: part.slice(1) };
  const m = /^([NAPSV])(.+)$/.exec(part); if (!m) return null;
  const rest = m[2]; let attrs: Partial<MorphFeatures> | null;
  if (m[1] === "V") {
    if (!Object.hasOwn(stems, rest[0]) || !Object.hasOwn(forms, rest[1])) return null;
    let form = rest[1], ending = rest.slice(2);
    if (form === "c" && /^[123]/.test(ending)) form = "h";
    if ((form === "a" || form === "c") && (ending === "" || ending === form)) attrs = {};
    else attrs = tail(ending, form !== "r" && form !== "s");
    return attrs ? { partOfSpeech: "verb", stem: stems[rest[0]], form: forms[form], ...attrs } : null;
  }
  if (m[1] === "N" && /^[cg]/.test(rest) || m[1] === "A" && /^[acgo]/.test(rest)) {
    attrs = tail(rest.slice(1), false);
    return attrs ? { partOfSpeech: m[1] === "N" ? "noun" : "adjective", variant: rest[0], ...attrs } : null;
  }
  if (m[1] === "P" && /^[dfipr]/.test(rest) || m[1] === "S" && rest[0] === "p") {
    attrs = rest.length === 1 && m[1] === "P" && rest[0] !== "p" ? {} : tail(rest.slice(1), true);
    return attrs ? { partOfSpeech: m[1] === "P" ? "pronoun" : "suffix", variant: rest[0], ...attrs } : null;
  }
  return null;
}
export function decodeStepMorphology(code: unknown): Morphology {
  // Aramaic stem names differ; do not relabel them using the Hebrew inventory.
  if (typeof code !== "string" || code.length > 256 || !/^H[A-Za-z0-9/]+$/.test(code)) return unavailable;
  const parts = code.slice(1).split("/"); if (!parts.length || parts.length > 16) return unavailable;
  const morphemes = parts.map(feature); if (morphemes.some(p => p === null)) return unavailable;
  return Object.freeze({ status: "ready", language: code[0] === "H" ? "hebrew" : "aramaic", morphemes: Object.freeze(morphemes.map(p => Object.freeze(p!))) });
}
