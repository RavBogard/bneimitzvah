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
