# Local Hebrew font and printable trope chart — bounded proposal

2026-10-16. Astra approved Noto-only content hosting, omission of inactive Ezra/SR/Literata, static public `/trope-chart` with all 30 marks/contextual families, and the exact two-entry font/license manifest. Astra's guard source review found no blocker beyond exact-path byte-preserving Git attributes, which are now added. Astra subsequently authorized the two verified font/license assets and provenance; they are copied unchanged and pass real-byte worktree/index/tamper/autocrlf-checkout tests. Final independent guard acceptance is pending; no font activation or chart source has landed. See `FONTS-GUARD-RETURN.md`. The student-editor worker retains study/work/provider/CSS ownership. Haftarah was inspected read-only; no provider operation or checkout/index mutation was performed by this worker outside isolated test repositories.

## Proposed outcome

Use one locally hosted, licensed **Noto Serif Hebrew 2.004** font for Hebrew content, and provide a static, printable `/trope-chart` with existing phrase-family names/colors and the engine's accent names. Preserve Annotated score, all system UI/English typography, current Hebrew size/line-height and the unchanged first-phone-viewport requirement. Do not activate Ezra on the portal's NFC text. Do not bundle unused Ezra/SR/Literata simply because the older implementation outline listed them.

Authority: MISSION 14 and 16–17 carry the chart and generated-audio gates; PLAN Phase 3 steps 7–8 require a printable chart without audio and font notices. PLAN's file outline lists Ezra/Noto/Literata; omitting unused fonts in this slice is an explicit implementation amendment for Astra, not a removed product capability. The haftarah chant-integration section 5 records D1–D13; its section 4 proposes a one-page chart. Those rulings do not supply chart colors: the actual `template/trope.css` and portal `trope/lib-trope.cjs` do.

## Font provenance and the Ezra license gap

Read local `C:/Users/dsbog/haftarah/template/fonts/`, `template/sheet.css`, both existing OFL notices and the fonts' OpenType name/cmap tables. The directory contains Ezra SIL, Ezra SIL SR, Noto Serif Hebrew and regular/italic Literata; only Noto and Literata have adjacent standalone license files. No font asset or `public/` directory currently exists in this portal.

| Local asset | Verified identity and provenance | Proposed disposition |
| --- | --- | --- |
| `NotoSerifHebrew[wdth,wght].ttf` | 183,600 bytes; internal version 2.004, copyright 2022 The Noto Project Authors. SHA-256 `93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165`. Exact byte match to the current primary [Google Fonts artifact](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifhebrew/NotoSerifHebrew%5Bwdth%2Cwght%5D.ttf), verified in memory. | Copy unchanged bytes to the one canonical portal font path below; retain internal family names and accompanying OFL. |
| `OFL-notoserifhebrew.txt` | 4,382 bytes; SHA-256 `9b9fe028b5ba74d231659a1bbaf0ed09b11e759d1ca6a070999e16d151616b47`. Exact byte match to primary [Google Fonts OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifhebrew/OFL.txt). Copyright plus complete SIL OFL 1.1. | Copy unchanged as adjacent `OFL.txt`; do not replace it with the repository MIT license or a generic license link. |
| `EzraSIL.ttf` | 155,584 bytes; SHA-256 `53c98ab95d2b5bd615527cdd05da42d7dd77f2690b79c043e9f90753d4930dce`. Internal name/version records identify Ezra SIL 2.51. Exact byte match to official web package `SILEOT.ttf`. | No active face or unnecessary asset in this slice. License/provenance is recoverable, but normalized-text suitability is a separate unresolved rendering issue. |
| `EzraSIL-SR.ttf` | 153,260 bytes; SHA-256 `9794bf85dfe22ed7c87a3765b647987e1b87f11b6b082711d64567855ed61b35`. Exact match to official `SILEOTSR.ttf`; internal records contain old/version inconsistencies alongside 2.51 metadata. | Omit; do not silently choose its different cantillation style. |
| `Literata[opsz,wght].ttf`, italic counterpart and `OFL-literata.txt` | Local files and notice exist; neither current portal UI nor the proposed Hebrew-only change uses Literata. | Omit without copying or reinterpreting its typography as portal direction. |

The authoritative Ezra package is linked by [SIL's Ezra project page](https://software.sil.org/ezra/): [EzraSIL-2.51-web.zip](https://software.sil.org/downloads/r/ezra/EzraSIL-2.51-web.zip), archive SHA-256 `7c19544c173c91e6ac47f605dae2cfa7e61e428abdafe27cf3f225fec4406357`. It was fetched and inspected **in memory**, with no extraction into either checkout. Its adjacent `EzraSIL-2.51-web/Licenses.txt` is 5,693 bytes, SHA-256 `cd29dbb1528a3ce89e66e76c7287b0866e93c43d49a8cf8a1c73804109c28214`. This supplies the missing standalone notice: SIL copyright/OFL 1.1 with reserved names **SIL** and **Ezra**, plus Ralph Hancock/John Hudson copyright and MIT/X11 terms for Hebrew layout intelligence. Future Ezra inclusion must retain this complete combined notice; adding a generic OFL alone would omit part of the terms. No new permission request is needed to discover that notice, and no rights are inferred merely from haftarah's public files.

SIL explicitly warns that its noncanonical character-order assumptions make NFC/NFD-normalized text unsuitable for Ezra. The portal normalizes in `src/server/study/normalize.ts` and requires NFC in `study/api.ts`; changing this contract or reordering source characters to accommodate a font is outside scope. The exact upstream warning and differing SR mark behavior are documented on the [primary project page](https://software.sil.org/ezra/). Recommendation: Noto content font now; Ezra research remains inactive. The Noto candidate's cmap has nonzero glyphs for all **30** code points exported by `trope/text.mjs` `ACCENTS`, plus the inspected vowel/dagesh/shin/sin/meteg/paseq/sof-pasuq/inverted-nun/qamats-qatan points. Coverage does not prove correct shaping or teaching suitability.

## Repository guard prerequisite — dedicated approval/review

Current `scripts/repo-policy.mjs` decodes candidates and indexed blobs as UTF-8 and rejects NUL as unreviewed binary. Any normal TTF will fail. Font work therefore needs a narrow, separately reviewed guard addition **before assets land**; weakening the existing check or broadly exempting font extensions is unacceptable.

Propose `scripts/font-assets.mjs` as a canonical, reviewable manifest of exact path, byte length and SHA-256 for the font and its license. The two entries are:

- `public/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf` → 183,600 bytes, font hash above.
- `public/fonts/noto-serif-hebrew/OFL.txt` → 4,382 bytes, license hash above.

Both worktree candidates and indexed blobs must be read as raw bytes for those exact paths and match all pins. The license remains subject to normal textual privacy/credential checks. Only the verified font bytes bypass text/NUL scanning. Any `.ttf/.otf/.woff/.woff2` outside the manifest must be rejected by path, including empty or text-disguised files; no extension-wide allowance, case-insensitive alias, changed hash, symlink or renamed copy is accepted. `public/fonts/PROVENANCE.md` records source URLs, exact hashes/versions, unchanged copying, font-specific terms and scope. Do not transcode/subset the font or regenerate it in this slice; that would introduce different artifacts and notice/RFN review.

Required adversarial guard cases: changed font byte, truncated/empty file, wrong format at canonical path, renamed/case-changed/unlisted copy, changed or missing adjacent license, changed indexed blob hidden by a clean working file, staged-only font, symlink/non-file, text/credential payload at a purported font path, and unchanged valid font/license. Existing recording/model/credential/private-data regressions must continue to pass. Astra approves the concrete registry and independent repository-protection review; no Daniel interruption is currently needed.

## Chart catalog and exact source mapping

`trope/lib-trope.cjs` already carries the extracted, parity-tested `TROPE_FAMILIES`, `BLOCK_ENDING` behavior and haftarah source commit `5b2530f72c544a9dab028d73076d47744b8252dc`; `trope/text.mjs` exports the accent codepoint/name registry. The portal currently has no trope CSS or color consumer. Haftarah `template/trope.css` supplies these exact family backgrounds. Preserve registry order and labels rather than introducing another pedagogical grouping:

| Family ID / current label | Background | Closing mark names/code points or ending context |
| --- | --- | --- |
| `zakef` / zakef | `#fff176` | zakef-katan U+0594 |
| `etnachta` / etnachta | `#9ec5ff` | etnachta U+0591 |
| `sof-pasuk` / sof pasuk | `#f59a9a` | Verse-ending context; last meteg U+05BD functions as silluq, with sof pasuq U+05C3. Not a distinct new accent character. |
| `revia` / revia | `#ffc078` | revia U+0597; munach U+05A3 followed by standalone paseq U+05C0 is the lib's legarmeh case. |
| `tevir` / tevir | `#9be29b` | tevir U+059B |
| `segol` / segol | `#eaa0ea` | segol U+0592; shalshelet U+0593 |
| `azla` / kadma v’azla | `#ffd2d2` | geresh U+059C; geresh-muqdam U+059D; gershayim U+059E |
| `telisha-ketana` / telisha ketana | `#ffb3c6` | telisha-ketana U+05A9; engine labels this accent conjunctive but the phrase-color grouping still closes here. |
| `pazer` / pazer | `#d3c1ff` | pazer U+05A1; telisha-gedola U+05A0; karnei-para U+059F |
| `zakef-gadol` / zakef gadol | `#ffd9a3` | zakef-gadol U+0595 |
| `sof-haftarah` / end of the haftarah | `#66c2c2` | `final:true` ending context on the actual final haftarah verse; same ending signs, not another Unicode mark or every text-page ending. |

The chart also accounts for the other **16** accent codepoints without assigning misleading permanent family colors:

- Marks folded into the following phrase: tipcha U+0596, pashta U+0599, yetiv U+059A and the engine's two `zarka` entries U+0598/U+05AE. Both zarka codepoints are retained even though they share a teaching name.
- Other conjunctives: atnach-hafukh U+05A2, munach U+05A3, mahpach U+05A4, merkha U+05A5, merkha-kefula U+05A6, darga U+05A7, kadma U+05A8, yerach-ben-yomo U+05AA and iluy U+05AC.
- Remaining engine entries: ole U+05AB and dehi U+05AD, labeled as additional/poetic-system marks rather than silently claiming a separate Torah phrase color.

One explanatory line distinguishes **phrase color** from each accent's grammatical role or melody. In particular kadma is not always permanently azla-colored, subordinate/conjunctive marks follow context, and the end-of-haftarah color is an ending variant. Show every exported codepoint once in the mark inventory, with the two ending-context rows separately identified; no accent-ID alias is silently lost. English display names derive from existing engine labels (hyphens may become spaces); no unsupported Hebrew-name translation is invented. Glyph examples use an invented single-letter/vowel carrier, preserving codepoint identity and mark positioning, not copied verses or melody notation.

Implement a typed, browser-safe `src/lib/trope/chart-catalog.ts` with the small attributed catalog and explicit colors. Keep the engine dependency-free and unchanged; tests compare the catalog to engine exports and synthetic `tropePhrases` behavior, including final/non-final overrides and legarmeh. A closing-accent test needs a later synthetic word because the library always overrides the final word's family. This avoids importing HTML-string rendering, speech/renderer data or full melody tables into the chart's client bundle.

## Proposed route, font scope and print composition

- `/trope-chart` is a public static reference with no tenant/student data, proposed for Astra approval. It contains a title/short explanation, eleven family groups, the additional mark inventory, source/font notices and an explicit **Print chart** action. No player, audio URLs, disabled play placeholders, rendered motifs or generated-chant requests. A return link goes to `/workspace`; the page does not accept student/name/contact query payloads.
- Use an ordinary semantic list of family sections with headings, visible family names, pale color samples and dark text. Accent samples are real RTL text with `lang="he"`; English names and codepoint labels remain LTR. Color is supplementary to the family name and glyph, including grayscale/background-disabled printing. Screen layout is two columns when space permits and one column on a phone; no card/shadow redesign.
- Print targets one page on **US Letter and A4 portrait**, with approximately 12mm margins, two-column family groups and a compact additional-marks grid. Retain readable mark samples (initial target 20–24pt) and names (10–11pt); use break-inside avoidance and omit interactive navigation/buttons at print time. Do not shrink unreadably to claim one page: if both page formats cannot meet readability, return the measured tradeoff to Astra. Font/source attribution remains printed. Browser print settings may omit backgrounds; text/glyph labels still work.
- New `src/styles/hebrew-font.module.css` owns the single local `@font-face`, `font-display:swap`, explicit normal style/variable weight range, and a Hebrew-content-only class with sufficient specificity to override the incumbent `.study-hebrew` family. Only that class changes font family; preserve `2rem`, line-height `2`, mark/mkmk features and current spacing. No global body/font replacement or automatic character reordering. Load the face through the content component/chart, not a global UI-font switch or external font service.
- The assigned-text `Hebrew` renderer eventually receives that class in one narrow edit to `study/view.tsx`, **only after Astra releases/co-ordinates the student-editor worker's ownership**. `/trope-chart` samples use the same class. No provider, editor, root layout or global CSS change is necessary. Chart-local module rules own its print layout; a chart link in reading tools is a separately coordinated integration edit, not permission to alter that worker's files now.

## Proposed implementation ownership

1. **Guard prerequisite, separately approved/reviewed:** new `scripts/font-assets.mjs`; narrow `scripts/repo-policy.mjs`; `tests/repo-policy.test.mjs` / `tests/repo-policy-review.test.mjs` additions. Astra owns final repository-protection review and Git publication.
2. **Font/chart worker after approval:** new `public/fonts/noto-serif-hebrew/{NotoSerifHebrew.ttf,OFL.txt}`, `public/fonts/PROVENANCE.md`, `src/styles/hebrew-font.module.css`, `src/lib/trope/chart-catalog.ts`, `src/app/trope-chart/page.tsx`, `src/app/trope-chart/chart.module.css`, and a tiny client `src/components/portal/trope-chart/print.tsx` for the explicit print action after font readiness. A failed/pending font load has an honest wait/retry state before scripted print; ordinary browser printing remains available.
3. **Focused checks:** `tests/trope-chart-catalog.test.mjs` (Node 24's built-in type stripping can import the small typed catalog), `e2e/trope-chart.spec.ts` (the actual `playwright.config.ts` testDir is `./e2e`), and a focused actual-SDK study font assertion in the existing study browser test **only by ownership coordination**. Tests do not fetch upstream fonts.
4. **Later integration only:** the one `study/view.tsx` content-class edit and reading-tools chart link; no simultaneous modifications to current editor/work/provider/global CSS ownership. Finish documentation updates the existing workspace brief and new `.impeccable/surfaces/src-app-trope-chart-page-tsx.md`; DESIGN/seed/sidecar stay unchanged unless Astra explicitly approves a durable system change.

## Verification and limits

Before assets enter the checkout: pin registry/license/provenance, pass tamper/rename/index guard cases, then obtain independent adversarial approval. Verify font bytes and adjacent notices against those pinned hashes offline. The font is not a licensed scripture payload and does not relax the never-in-repo rule for any other binary or text.

Catalog tests must cover all eleven families, exact colors/order/labels, all 30 accent codepoints, folding/context explanations, no missing/duplicate mark, and synthetic family/final/legarmeh parity. No engine changes or generated-chant release are inferred from a chart passing.

Browser checks must establish same-origin font loads (no external requests), actual Noto glyph use rather than a merely declared font-family, NFC text preserved, samples/marks unclipped at phone and desktop widths, zoom/enlargement, qere/ketiv/paragraph markers and marked synthetic Hebrew. Repeat the **unchanged 390×844 first actual Hebrew range fully inside viewport at scroll 0**, with font-ready/two-frame measurement, on Windows and Linux using the bundled font. Test cold font load and unavailable font fallback. Any required geometry/CSS adjustment is a new explicit Astra-coordinated change, not an excuse to raise the viewport bound or reduce reading type.

Print checks use browser-generated PDFs under ignored local test output for Letter and A4, assert one page/text/font embedding, and visually inspect rasterized output and background-disabled/grayscale readability. Do not commit screenshots/PDFs containing licensed or real personal content. A semantic/keyboard check verifies the chart print/back controls and non-color identification. Reuse the one scoped detector/batched captures/fresh finish review workflow for actual UI implementation; this planning pass runs none. Root owns combined unit/typecheck/build/real-PG/hosted gates and publication.

Research establishes artifact identity, available license texts and cmap coverage only. It has **not** established browser shaping, full-corpus cantillation accuracy, printed legibility, first-viewport geometry with Noto, musical pedagogy approval, live-provider operation or student release. D2's generated-chant attribution, D5/D6 drill/default nusach and the G1/G2/G3 release rules remain applicable when audio is built; this slice has no audio path.

## Material root decisions before implementation

- Approve Noto-only content hosting and the omission of inactive Ezra/SR/Literata for this slice, with the recovered Ezra combined license documented rather than inventing a missing permission or changing NFC.
- Approve the exact two-entry font/license manifest and dedicated repository-guard implementation/review boundary. This is a repository-protection change even though the intended font is licensed.
- Approve the static public `/trope-chart` and full engine-codepoint inventory with contextual family semantics; coordinate the later assigned-text class/link edit with student-editor ownership. A teacher-preferred reduced chart or alternative accent naming scheme would materially change the proposed content and needs Astra's direction.

No material licensing ambiguity currently requires Daniel: the complete upstream notices and exact font provenance were recovered. Any future asset mismatch, modified/subset font, unresolved rights question, audio release or student exposure outside existing approvals returns to the applicable gate rather than being silently included.
