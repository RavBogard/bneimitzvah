# Standalone trope chart — implementation return

2026-10-16. The single approved print correction is confirmed: Letter, A4 and background-disabled Letter are each one readable page. Root reports confirmation typecheck/build and all15 production browser cases passing (9 chart +6 existing), `.local-logs/editor-chart-production-confirm.log`. The first inspection's two-page/color-off defects and their correction are retained below. No unresolved material defect was found in the confirmation packet; independent finish review remains pending.

## Scope and behavior

- New static public `/trope-chart`: all 30 engine codepoints, eleven source phrase families/colors, the two contextual verse endings and munach+paseq legarmeh. Names and colors remain tied to the existing engine. Tipcha/pashta/yetiv/zarka and conjunctives retain contextual semantics; both zarka codepoints appear. Samples contain only an invented letter/vowel carrier.
- New content-only Hebrew font module loads the approved same-origin Noto bytes. It changes no size, line height or system UI typography. Chart print waits for a nonempty successful FontFaceSet load/check covering every mark and ending, then rechecks on explicit print. A failed load disables scripted print and offers reload.
- Print CSS uses three family columns, 12mm margins, 22pt family samples, 20pt additional samples and10pt names. Confirmation output meets the one-page Letter/A4 target without reducing these type sizes; the background-disabled version retains visible marks/names without fills.
- No engine, scripture, audio, provider, global CSS, study renderer or reading-tools link edits. Root is coordinating any live-study integration separately. Font bytes and guard remain unchanged; provenance activation wording now identifies chart scope.

## Owned files

`src/styles/hebrew-font.module.css`; `src/lib/trope/chart-catalog.ts`; `src/app/trope-chart/{page.tsx,chart.module.css}`; `src/components/portal/trope-chart/print.tsx`; `tests/trope-chart-catalog.test.mjs`; `e2e/trope-chart.spec.ts`; the activation sentence in `public/fonts/PROVENANCE.md`; this return.

## Focused checks and evidence

- Catalog: **5/5 pass**, `.local-logs/trope-chart-catalog.log`. Exact engine registry/family parity, contextual synthetic engine cases, both endings/legarmeh and NFC samples. Node emits its existing module-type inference warning for importing the small typed catalog; no package-wide module change was made.
- Typecheck: **pass**, `.local-logs/trope-chart-typecheck.log`. The Next metadata and React CSSProperties imports are separated correctly.
- One scoped Impeccable detector: exit **0**, `.local-logs/trope-chart-detect.json`; **zero primary findings, 14 advisories**. Ten catalog-color advisories are intentional haftarah source colors; four screen type-size advisories preserve the existing reading/sample hierarchy. No ignore/config/sidecar/token changes or detector rerun.
- Root's confirmation production chart browser gate: **9/9 pass**, three cases across desktop/tablet/phone. It checks actual custom Noto glyph use via Chromium platform-font inspection, 30 marks/11 groups, no horizontal overflow, NFC, same-origin requests, a held font request blocking print, successful explicit print and a failed-font reload state. The phone case also doubles the root text size to200%, retaining all30 visible marks, all11 families and no horizontal overflow.
- Root ran the PDF skill create marker successfully exactly once before generating the three PDFs; do not rerun it. Desktop/phone PNGs were normalized after font readiness, scroll zero and two frames. All artifacts remain in ignored `test-results/`.

## First batched visual/print inspection

Packet: `test-results/trope-chart-public-chart-c-67772--font-and-printable-layouts-desktop/` contains `trope-chart-desktop.png`, `trope-chart-letter.pdf`, `trope-chart-a4.pdf`, `trope-chart-letter-no-background.pdf`; the sibling `...-phone/` contains `trope-chart-phone.png`. Poppler rendered **all six PDF pages** at 110dpi to `.local-logs/trope-chart-print/`. Desktop, phone and all six pages were inspected together. A four-panel phone contact sheet preserves legible inspection scale: `.local-logs/trope-chart-print/phone-contact.png`.

- Normal screen: clear ruled family groups, readable marked Hebrew/names, visible codepoint distinction for the two zarka entries, no observed clipping or overlap. Phone uses a single family column/two additional-sign columns. Browser assertions establish no horizontal overflow at supported normal viewports. Enlarged chart evidence is still missing.
- **P2 print fit:** all three PDFs have **2 pages**. Letter (612×792pt) carries the second additional-sign row and notices onto page 2; A4 (595.92×842.88pt) carries only the notices onto page 2. Marks/names remain readable and unclipped in the rendered pages. PDF text confirms 22pt family samples, approximately20pt additional samples and10pt names; no silent scaling occurred.
- **P2 evidence/background behavior:** `printBackground:false` still paints family fills because scoped print CSS forces `print-color-adjust:exact`. Therefore this output cannot establish a color-free print fallback, even though names are independently present.
- Font/resource verification: Chromium embeds Noto as **Type3 vector glyph programs**, with `FontDescriptor` names `NotoSerifHebrew`, family `Noto Serif Hebrew`, weight400 and ToUnicode maps. This is embedded glyph data rather than an embedded raw TTF FontFile. Both Noto subsets have nonempty CharProcs streams (22 and19 glyph programs). English Segoe UI subsets have embedded font files. Every U+0591–U+05AE accent extracts from each PDF; visual raster inspection establishes shaped marks beyond extraction alone. Poppler `pdffonts.exe` is absent in this bundled build, so pypdf resource inspection supplies the font evidence; `pdfinfo.exe` and `pdftoppm.exe` succeeded. pdfplumber emitted FontBBox warnings on Chromium Type3 font descriptors; extraction and Poppler rendering still completed. Raw details: `.local-logs/trope-chart-print/diagnostics.json` and ignored adjacent `.extracted.txt` files.

Root approved **one coherent print correction batch**, now applied and confirmed: three family columns (four rows instead of six), preserving 22pt/20pt marks, 10pt names and12mm margins; forced exact print color adjustment removed so background-disabled output can remove fills. Added a representative phone200% reflow assertion/capture, retaining all30 visible marks, all11 groups and no horizontal overflow. Normal screen composition/content is unchanged. No detector rerun or worker-run build/browser gate.

## Single confirmation packet

Root rebuilt and reran all15 production checks successfully; `.local-logs/editor-chart-production-confirm.log`. Current PDFs/screens overwrite the original `test-results/` paths above. To avoid mistaking old page2 images for current output, **all confirmation diagnostics/renders are in a separate folder**: `.local-logs/trope-chart-print-confirm/`. This confirmation inspected desktop, normal phone, enlarged phone and all three PDF pages together; no additional source changes or polishing followed.

| Current PDF | Page count / size | Last extracted text bottom | Visual result |
| --- | --- | --- | --- |
| `trope-chart-letter.pdf` | **1**, 612×792pt | 686.13pt | All families/context marks/notices visible; readable long names and legarmeh; no observed clipping/overlap. |
| `trope-chart-a4.pdf` | **1**, 595.92×842.88pt | 711.63pt | All content fits; narrower labels wrap onto readable lines; no observed clipping/overlap. |
| `trope-chart-letter-no-background.pdf` | **1**, 612×792pt | 686.13pt | Family fills actually absent, with clear black/dark marks, names and rules; identification remains independent of color. |

PDF diagnostics again confirm22pt/approximately20pt samples and10pt names, all30 accent codepoints extract in every file, and both embedded Noto Type3 subsets retain their FontDescriptor names, ToUnicode maps and nonempty glyph programs (22/19 programs;12,713/8,875 bytes). The output embeds glyph programs, not a rawTTF FontFile. Same-origin actual browser Noto use is separately asserted by the passing Chromium test. A simple saturated-light-pixel diagnostic found24,952 colored pixels in Letter versus **0** in background-disabled Letter; visual comparison confirms the fills disappear. This is not a physical printer or cross-PDF-viewer test.

Exact confirmation evidence:

- Source PDFs: `test-results/trope-chart-public-chart-c-67772--font-and-printable-layouts-desktop/{trope-chart-letter.pdf,trope-chart-a4.pdf,trope-chart-letter-no-background.pdf}`.
- Desktop PNG: `test-results/trope-chart-public-chart-c-67772--font-and-printable-layouts-desktop/trope-chart-desktop.png`.
- Normal/enlarged phone PNGs: `test-results/trope-chart-public-chart-c-67772--font-and-printable-layouts-phone/{trope-chart-phone.png,trope-chart-phone-200-percent.png}`. The200% view reflows vertically, including header/print controls and wrapping labels; no observed overlap/clipped marks. All30 visible marks/11groups/no horizontal overflow also pass in the test. This exercises text enlargement in Chromium's emulated Pixel7 viewport, not a physical phone or browser pinch zoom.
- Current Poppler110dpi renders: `.local-logs/trope-chart-print-confirm/{trope-chart-letter-1.png,trope-chart-a4-1.png,trope-chart-letter-no-background-1.png}`. There are no page2 renders in this folder.
- Readable phone inspection contact sheets: `.local-logs/trope-chart-print-confirm/{trope-chart-phone-contact.png,trope-chart-phone-200-percent-contact.png}`.
- Resource/page/type-size/color diagnostics and extracted text: `.local-logs/trope-chart-print-confirm/diagnostics.json` and the three adjacent `.extracted.txt` files. The same nonfatal pdfplumber Type3 FontBBox warnings occurred; Poppler rendering and extraction succeeded.

## Remaining gate

Ready for an independent fresh reviewer of the current confirmation packet. Root owns combined checks, live-study first-phone geometry on Windows/Linux, release decisions and publication. Printed reference material does not release generated chant or establish musical pedagogy/corpus accuracy. No unresolved material chart/print defect was found in this bounded confirmation; physical printing, other browser engines/PDF viewers and musical pedagogy remain outside this evidence.

## Independent finish verdict

The fresh reviewer inspected desktop, phone, enlarged phone and all three confirmed print renders. The editor recovery-copy and scoped documentation findings were resolved in one batch; EDITOR-CHART-FINISH-REVIEW.md records **ship** for those scored fixes. Chart composition and readable print output required no further change. Final publication/hosted verification belongs to Astra and STATE.md; this is not whole-product or generated-chant approval.
