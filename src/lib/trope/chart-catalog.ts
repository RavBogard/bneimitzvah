// Phrase labels/order: trope/lib-trope.cjs (haftarah 5b2530f).
// Colors: haftarah template/trope.css. Accent names/roles: trope/text.mjs.
// This small display catalog is checked against the engine without importing
// its HTML parser, phonetics or melody data into the public chart bundle.
export const PHRASE_FAMILIES = [
  { id: "zakef", label: "zakef", color: "#fff176" },
  { id: "etnachta", label: "etnachta", color: "#9ec5ff" },
  { id: "sof-pasuk", label: "sof pasuk", color: "#f59a9a" },
  { id: "revia", label: "revia", color: "#ffc078" },
  { id: "tevir", label: "tevir", color: "#9be29b" },
  { id: "segol", label: "segol", color: "#eaa0ea" },
  { id: "azla", label: "kadma v’azla", color: "#ffd2d2" },
  { id: "telisha-ketana", label: "telisha ketana", color: "#ffb3c6" },
  { id: "pazer", label: "pazer", color: "#d3c1ff" },
  { id: "zakef-gadol", label: "zakef gadol", color: "#ffd9a3" },
  { id: "sof-haftarah", label: "end of the haftarah", color: "#66c2c2" },
] as const;
export type FamilyId = typeof PHRASE_FAMILIES[number]["id"];
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
export const HEBREW_FONT_PROOF = [...CHART_ACCENTS.map(accentSample), ENDING_SAMPLE, LEGARMEH_SAMPLE].join(" ");
