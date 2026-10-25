# Reviewed local Hebrew font assets

Recorded 2026-10-16. These assets are font software and its license, not scripture text. They are separate from the repository's MIT-licensed code. Noto Serif Hebrew is activated only for Hebrew content in assigned study text and the standalone public trope chart through `src/styles/hebrew-font.module.css`; system UI typography is unchanged. No audio or student content is included in these assets. Bounded rendering evidence does not establish full-corpus cantillation fidelity or student-release approval.

## Noto Serif Hebrew 2.004

- Font: `noto-serif-hebrew/NotoSerifHebrew.ttf`, 183,600 bytes, SHA-256 `93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165`.
- Complete adjacent license: `noto-serif-hebrew/OFL.txt`, 4,382 bytes, SHA-256 `9b9fe028b5ba74d231659a1bbaf0ed09b11e759d1ca6a070999e16d151616b47`.
- Primary font artifact: [Google Fonts NotoSerifHebrew variable TTF](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifhebrew/NotoSerifHebrew%5Bwdth%2Cwght%5D.ttf).
- Primary notice: [Google Fonts OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifhebrew/OFL.txt).
- Upstream project: [Noto Hebrew](https://github.com/notofonts/hebrew).

Copyright 2022 The Noto Project Authors. The complete supplied notice identifies SIL Open Font License 1.1 and contains its terms; retain that notice with the font. The repository code license does not replace it.

The local source was the read-only haftarah checkout's `template/fonts/NotoSerifHebrew[wdth,wght].ttf` and `OFL-notoserifhebrew.txt`. On the recorded date, both were independently compared byte-for-byte by SHA-256 to the primary artifacts linked above and matched. The copied font's internal family is Noto Serif Hebrew and its name-table version is 2.004. The destination filename is shorter; the font program, internal names, variable axes and complete license bytes are unchanged. No subsetting, transcoding, regeneration or glyph modification was performed.

`scripts/font-assets.mjs` fixes these exact paths, byte lengths and hashes. The repository guard requires the font and notice together in both candidate filesystem and index views. The two exact `.gitattributes` entries disable text conversion so checkout preserves both byte pins, including the license's original line endings. The primary URLs may change over time; a different download is not silently accepted as an update. Any changed artifact or registry entry requires fresh provenance and independent repository-protection review.

The existing Ezra SIL/SR and Literata files were not copied. Their appearance in earlier implementation plans does not make them active portal fonts; the Ezra normalization and notice findings remain in `docs/planning/2026-10-15-kickoff/FONTS-TROPE-CHART-PLAN.md`. Unicode cmap coverage alone does not establish browser shaping, cantillation fidelity, print legibility or student-release approval.

## Bricolage Grotesque 1.001 (UI and English text)

Recorded 2026-10-16 for the "Song session" student-surface redesign Daniel locked that day (`.impeccable/surfaces/src-app-workspace-page-tsx.md`). It is the interface and English typeface only; it has no Hebrew glyphs, and Hebrew stays on Noto Serif Hebrew.

- Font: `bricolage-grotesque/BricolageGrotesque.ttf`, 408,496 bytes, SHA-256 `413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682`. Variable axes: optical size 12–96, weight 200–800, width 75–100. Name-table version `1.001`.
- Complete adjacent license: `bricolage-grotesque/OFL.txt`, 4,403 bytes, SHA-256 `4b5a7d8f37f5602621c8a8d7358a6a2e71317e6c231c661e15aef0275d3e07ba`.
- Primary font artifact, pinned to google/fonts commit `6ce172f74aa355ea43eb964fa4a91570a4d3064d`: [BricolageGrotesque variable TTF](https://raw.githubusercontent.com/google/fonts/6ce172f74aa355ea43eb964fa4a91570a4d3064d/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf).
- Primary notice: [Google Fonts OFL.txt](https://raw.githubusercontent.com/google/fonts/6ce172f74aa355ea43eb964fa4a91570a4d3064d/ofl/bricolagegrotesque/OFL.txt).
- Upstream project: [Bricolage Grotesque](https://github.com/ateliertriay/bricolage).

Copyright 2022 The Bricolage Grotesque Project Authors. The complete supplied notice identifies SIL Open Font License 1.1; retain it with the font. The repository code license does not replace it. The bytes were downloaded from the `main` branch and again from the pinned commit; both matched the SHA-256 above. Only the filename was shortened; no subsetting, transcoding or glyph modification was performed. The registry now pairs each font with its own notice by family, so neither family's notice can stand in for the other's.

## Bricolage Grotesque 1.001, Latin WOFF2 subset (what the pages serve)

Recorded 2026-10-24 (release 1.8.2, P5). The interface and English text now load a Latin, width-100, weight 400-800 WOFF2 derived from the unchanged TTF above, about a quarter of its size. The original TTF stays: the server-side share card and the honoree landing page still read it, and it is the input this subset is regenerated from.

- Subset: `bricolage-grotesque/BricolageGrotesque-latin.woff2`, 109,576 bytes, SHA-256 `6a051c984a4fc560ee3045cbf604cd905396ce53cdc3b8ebe08cc11f44315d59`.
- Input: `bricolage-grotesque/BricolageGrotesque.ttf`, SHA-256 `413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682` (the entry above).
- Tools: fonttools 4.67.0 (`varLib.instancer` and `subset`) with brotli 1.2.1, Python 3.12, installed into a throwaway virtual environment outside the repository. Nothing was added to `package.json`.
- Exact commands (the environment variable fixes the head-table timestamp, so the output is byte-reproducible; two runs gave the same hash):

```
export SOURCE_DATE_EPOCH=1792800000
python -I -m fontTools varLib.instancer BricolageGrotesque.ttf wdth=100 wght=400:800 -o instanced.ttf
python -I -m fontTools.subset instanced.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0237,U+02B9-02BF,U+02C6-02C7,U+02D8-02DD,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2122,U+2190-2199,U+2212,U+2215,U+2260,U+2264-2265,U+25CA,U+FEFF,U+FFFD" --layout-features='*' --name-IDs='0,1,2,3,4,5,6,13,14' --flavor=woff2 --output-file=BricolageGrotesque-latin.woff2
```

- What changed: width axis fixed at 100 (the interface never sets `font-stretch`); weight axis limited to 400-800 (the interface uses 400-800, and the browser clamps anything lighter); the optical-size axis (12-96) is kept, because the page uses `font-optical-sizing: auto`. Glyphs outside the Unicode ranges above are dropped (494 code points remain of 527): Basic Latin, Latin-1, Latin Extended-A, Latin Extended Additional (transliteration), spacing and combining diacritics, general punctuation (curly quotes, en and em dashes, ellipsis, the space family), superscripts, currency, arrows, minus, a few operators. Every non-ASCII Latin-script character found in `src` that the font has is covered, including the middle dot, section sign, multiplication sign, guillemets and the right arrow. All layout features are kept (`kern`, `tnum`, `case`, fractions and the rest). Name IDs 0-6, 13 and 14 are kept, so the copyright notice and the licence statement and URL stay in the font's metadata. The internal and CSS family name stays "Bricolage Grotesque". Advance widths match the original within one unit per 1,000 em at sampled weights and optical sizes.
- Licence finding: the supplied notice reads "Copyright 2022 The Bricolage Grotesque Project Authors" and declares no Reserved Font Name (the notice has no "with Reserved Font Name" clause and the name table says nothing either; only the OFL's generic definition of the term appears). Deleting glyphs and changing format make this a Modified Version under the OFL 1.1 definition, and the OFL permits modifying, redistributing and embedding it (clause 1 and the permission grant). Clause 3, which forbids a Modified Version from using a Reserved Font Name, therefore has nothing to apply to, and keeping the name is allowed. The conditions that do apply are met: the copyright notice and licence travel with the font (`OFL.txt` beside it, name IDs 0, 13 and 14 inside it), it is not sold by itself, it stays under the OFL, and no author name is used to promote it.
- Serving: `src/app/globals.css` loads only the WOFF2. A "Bricolage Grotesque Fallback" face (local Arial, Helvetica or Liberation Sans, with `size-adjust` and ascent and descent overrides) keeps the layout still while the web font swaps in.

`scripts/font-assets.mjs` pins the subset's path, length and hash as a third member of the Bricolage family, and `.gitattributes` disables text conversion for it. A different subset, tool version or command is a changed artifact and needs fresh provenance and independent repository-protection review.

## Stam Ashkenaz CLM 0.110 (tikkun view and practice sheet)

Recorded 2026-10-21. Daniel chose this face that day for the tikkun view (asked to pick a STaM face, he answered "Stam Ashkenaz CLM"), under its GPL licence with the font exception. It is a Torah-scroll (STaM) display face for the consonant-only tikkun text in the reading's Tikkun view and the printable practice sheet, activated only through `src/styles/stam-font.module.css`. Vowelled text, cantillation and the interface keep their existing fonts.

- Font: `stam-ashkenaz-clm/StamAshkenazCLM.ttf`, 14,968 bytes, SHA-256 `18aec29cd0f3e2f31049224712e740468fc893344289ceb1c86b02b619854ca6`. Internal family `Stam Ashkenaz CLM`, subfamily `Medium`, name-table version `0.110`. Its cmap covers the Hebrew letters and final forms U+05D0–U+05EA, the Hebrew marks block U+0591–U+05C7 (which the tikkun text never uses), and U+0020–U+0040 and U+005B–U+005F (space, digits and punctuation).
- Complete adjacent license: `stam-ashkenaz-clm/LICENSE.txt`, 18,092 bytes, SHA-256 `8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643`. This is the release's `GNU-GPL` file (GNU General Public License version 2) byte for byte; only the filename was changed, so that the policy's reviewed licence-filename rule and plain-text serving apply.
- Primary artifact: the official Culmus project release [culmus-0.140.tar.gz on SourceForge](https://sourceforge.net/projects/culmus/files/culmus/0.140/culmus-0.140.tar.gz/download) (1,958,577 bytes, SHA-256 `6daed104481007752a76905000e71c0093c591c8ef3017d1b18222c277fc52e3`, matching the SHA-256 SourceForge publishes for that file). Both files were extracted unchanged from `culmus-0.140/`.
- Corresponding source: `stam-ashkenaz-clm/StamAshkenazCLM.sfd`, 59,723 bytes, SHA-256 `ff23748b1b9df2bb1f5e26b8928342eee87ead160bdff535a505aed0f7294c45`. This is the FontForge source the font is built from (font version `0.110`), extracted unchanged from the same release's [culmus-src-0.140.tar.gz](https://sourceforge.net/projects/culmus/files/culmus/0.140/culmus-src-0.140.tar.gz/download) (6,055,435 bytes, SHA-256 `ba7cb2c8bf7011e23cf37671a383a6a483903cffbdca4a327e85a8dbec4ec73a`, matching the SHA-256 SourceForge publishes). It ships in the repository and is served beside the font, so the corresponding source is offered from the same place as the font, as GPL version 2 section 3 provides.
- Upstream project: [Culmus](https://culmus.sourceforge.io/).

Stam Ashkenaz font is copyright 2007-2010 by Yoram Gnat, distributed under the terms of the GNU General Public License version 2. The release's `LICENSE` file and the font's own name-table copyright notice (name ID 0, unchanged inside the font file) carry this font exception, quoted exactly:

> As a special exception, if you create a document which uses this font, and embed this font or unaltered portions of this font into the document, this font does not by itself cause the resulting document to be covered by the GNU General Public License. This exception does not however invalidate any other reasons why the document might be covered by the GNU General Public License. If you modify this font, you may extend this exception to your version of the font, but you are not obligated to do so. If you do not wish to do so, delete this exception statement from your version.

The release's `LICENSE` file is not copied: it covers every Culmus family and lists the authors' contact addresses, which the repository's address guard refuses outside reviewed planning prose. The notice that travels with this font is therefore its unchanged embedded name-table notice, which includes the author's address, together with the complete GPL text beside it and this record. The repository code license does not replace either. No subsetting, transcoding, regeneration or glyph modification was performed; the web page serves the original TrueType file, as the other two families do.

`scripts/font-assets.mjs` pins all three paths, byte lengths and hashes, and `.gitattributes` disables text conversion for each. The font and its source are accepted only byte for byte; their embedded author notice is not re-scanned, while the licence text still receives every ordinary check. Any changed artifact requires fresh provenance and independent repository-protection review.
