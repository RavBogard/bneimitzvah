import "server-only";

/** Public source metadata only. No corpus, derived records or authority facts. */
export const STEP_SOURCE_PIN = "bd09545c7a44b39ace20f16c0359915f2aa23a62";
export const STEP_SOURCE_ATTRIBUTION = "Data created by STEPBible.org based on work at Tyndale House Cambridge, CC BY 4.0. Adapted into bounded immutable records; source-format holds retained.";
const base = `https://raw.githubusercontent.com/STEPBible/STEPBible-Data/${STEP_SOURCE_PIN}/`;
const group = (name: string, bytes: number, sha256: string) => Object.freeze({ id: name, pin: STEP_SOURCE_PIN, bytes, sha256,
  url: `${base}Translators%20Amalgamated%20OT%2BNT/${encodeURIComponent(`TAHOT ${name} - Translators Amalgamated Hebrew OT - STEPBible.org CC BY.txt`)}` });
export const STEP_SOURCE_MANIFEST = Object.freeze({
  torah: group("Gen-Deu", 18190455, "e9b8546ee48fe0bfc57c3b70f5f40e98d96580e803526d19026224e31753368b"),
  former: group("Jos-Est", 24500317, "195fee1dc3653bab33701f170734eb894ed647c10cd08cc61749375fe8b73775"),
  latter: group("Isa-Mal", 17977518, "f3ded203d2a74d6368932c97ae550d1d0754b271af491dc0dedf36fe3ba0bcc5"),
  lexicon: Object.freeze({ id: "TBESH", pin: STEP_SOURCE_PIN, bytes: 3288045, sha256: "464dccadd95fd8620dd05fa0d7a4caba58ec3c4d5db3ebf38e43d046ca25b591",
    url: `${base}Lexicons/${encodeURIComponent("TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt")}` }),
});
/** Mirrors only the accepted parser's supported book codes, never poetic books. */
export const STEP_BOOK_GROUPS = Object.freeze({ Gen: "torah", Exo: "torah", Lev: "torah", Num: "torah", Deu: "torah",
  Jos: "former", Jdg: "former", "1Sa": "former", "2Sa": "former", "1Ki": "former", "2Ki": "former",
  Isa: "latter", Jer: "latter", Ezk: "latter", Hos: "latter", Jol: "latter", Amo: "latter", Oba: "latter", Jon: "latter", Mic: "latter", Nam: "latter", Hab: "latter", Zep: "latter", Hag: "latter", Zec: "latter", Mal: "latter" } as const);
