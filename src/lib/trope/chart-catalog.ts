// Phrase labels/order: trope/lib-trope.cjs (haftarah 5b2530f).
// Colors: 1.9 N8 (below; the engine template's 1.0 colors were not colour-blind safe). Accent names/roles: trope/text.mjs.
// This small display catalog is checked against the engine without importing
// its HTML parser, phonetics or melody data into the public chart bundle.
/**
 * The eleven phrase families. `color` is the day fill and `night` the dark-mode fill (1.9 N8, G18): both carry the app's dark ink
 * (#13202f) at 5.4:1 or better, and no two families, in either set, come within CIEDE2000 7 of each other for a reader with normal colour
 * vision, protanopia or deuteranopia (Machado et al. 2009, full severity); tests/phrase-colors.test.mjs measures it. The 1.0 day fills
 * were #fff176 #9ec5ff #f59a9a #ffc078 #9be29b #eaa0ea #ffd2d2 #ffb3c6 #d3c1ff #ffd9a3 #66c2c2 (etnachta and pazer were 0.8 apart for protanopia).
 */
export const PHRASE_FAMILIES = [
  { id: "zakef", label: "zakef", color: "#fff692", night: "#b29337" },
  { id: "etnachta", label: "etnachta", color: "#9ac5ff", night: "#57a8f7" },
  { id: "sof-pasuk", label: "sof pasuk", color: "#ff89ac", night: "#c0858c" },
  { id: "revia", label: "revia", color: "#fda66d", night: "#d2b157" },
  { id: "tevir", label: "tevir", color: "#d7ffca", night: "#8dc19b" },
  { id: "segol", label: "segol", color: "#b2a3d0", night: "#ee97c8" },
  { id: "azla", label: "kadma v’azla", color: "#4ac0ab", night: "#1eb29d" },
  { id: "telisha-ketana", label: "telisha ketana", color: "#f7ccd2", night: "#d9b0ba" },
  { id: "pazer", label: "pazer", color: "#d1bfd8", night: "#b385c8" },
  { id: "zakef-gadol", label: "zakef gadol", color: "#debb9b", night: "#d99373" },
  { id: "sof-haftarah", label: "end of the haftarah", color: "#aeffff", night: "#17ccf0" },
] as const;
export type FamilyId = typeof PHRASE_FAMILIES[number]["id"];
/** A family's fill as CSS: the custom property globals.css sets per theme (day, then night in dark mode), with the day fill as the fallback. */
export const phraseFill = (id: FamilyId): string => `var(--phrase-${id}, ${PHRASE_FAMILIES.find(family => family.id === id)!.color})`;
export type ChartAccent = { codepoint: string; name: string; role: "disjunctive" | "conjunctive"; family?: FamilyId; context?: "following" | "conjunctive" | "additional" };
export const CHART_ACCENTS: readonly ChartAccent[] = [
  { codepoint: "0591", name: "etnachta", role: "disjunctive", family: "etnachta" },
  { codepoint: "0592", name: "segol", role: "disjunctive", family: "segol" },
  { codepoint: "0593", name: "shalshelet", role: "disjunctive", family: "segol" },
  { codepoint: "0594", name: "zakef-katan", role: "disjunctive", family: "zakef" },
  { codepoint: "0595", name: "zakef-gadol", role: "disjunctive", family: "zakef-gadol" },
  { codepoint: "0596", name: "tipcha", role: "disjunctive", context: "following" },
  { codepoint: "0597", name: "revia", role: "disjunctive", family: "revia" },
  { codepoint: "0598", name: "zarka", role: "disjunctive", context: "following" },
  { codepoint: "0599", name: "pashta", role: "disjunctive", context: "following" },
  { codepoint: "059A", name: "yetiv", role: "disjunctive", context: "following" },
  { codepoint: "059B", name: "tevir", role: "disjunctive", family: "tevir" },
  { codepoint: "059C", name: "geresh", role: "disjunctive", family: "azla" },
  { codepoint: "059D", name: "geresh-muqdam", role: "disjunctive", family: "azla" },
  { codepoint: "059E", name: "gershayim", role: "disjunctive", family: "azla" },
  { codepoint: "059F", name: "karnei-para", role: "disjunctive", family: "pazer" },
  { codepoint: "05A0", name: "telisha-gedola", role: "disjunctive", family: "pazer" },
  { codepoint: "05A1", name: "pazer", role: "disjunctive", family: "pazer" },
  { codepoint: "05A2", name: "atnach-hafukh", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05A3", name: "munach", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05A4", name: "mahpach", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05A5", name: "merkha", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05A6", name: "merkha-kefula", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05A7", name: "darga", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05A8", name: "kadma", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05A9", name: "telisha-ketana", role: "conjunctive", family: "telisha-ketana" },
  { codepoint: "05AA", name: "yerach-ben-yomo", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05AB", name: "ole", role: "disjunctive", context: "additional" },
  { codepoint: "05AC", name: "iluy", role: "conjunctive", context: "conjunctive" },
  { codepoint: "05AD", name: "dehi", role: "disjunctive", context: "additional" },
  { codepoint: "05AE", name: "zarka", role: "disjunctive", context: "following" },
];
export const accentSample = (accent: ChartAccent) => `בָ${String.fromCodePoint(Number.parseInt(accent.codepoint, 16))}`;
export const accentLabel = (accent: ChartAccent) => accent.codepoint === "0598" ? "zarka (helper)" : accent.name.replaceAll("-", " ");
export const ENDING_SAMPLE = "בָֽ׃";
export const LEGARMEH_SAMPLE = "בָ֣ ׀";
/**
 * The chart's samples on a bare carrier (1.9 N8, G18): the letter and the sign alone, no vowel, so the sign is never drawn under or inside a
 * qamats. Set at 56 to 64 px on screen. The vowelled samples above stay for Learn and for the engine's own phrase checks.
 */
export const bareSample = (accent: ChartAccent) => `ב${String.fromCodePoint(Number.parseInt(accent.codepoint, 16))}`;
export const BARE_ENDING_SAMPLE = "ב\u05bd\u05c3";
export const BARE_LEGARMEH_SAMPLE = "ב\u05a3 \u05c0";
export const HEBREW_FONT_PROOF = [...CHART_ACCENTS.map(accentSample), ENDING_SAMPLE, LEGARMEH_SAMPLE, ...CHART_ACCENTS.map(bareSample), BARE_ENDING_SAMPLE, BARE_LEGARMEH_SAMPLE].join(" ");
