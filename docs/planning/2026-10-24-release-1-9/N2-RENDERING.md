# N2 rendering note: Taamey Frank CLM

Checked 2026-10-25 on the vendored bytes (`public/fonts/taamey-frank-clm/TaameyFrankCLM.ttf`, SHA-256 `f558d356…b991c`). No product surface uses the face yet; N8 switches it. This note is the check PLAN.md asks for before that switch.

## How it was checked

- **Text.** Genesis 18 (33 verses) and Genesis 24:30–36 (7 verses), Miqra according to the Masorah, fetched from Sefaria's v3 API at run time (`version=hebrew|Miqra according to the Masorah`, the edition the app uses). Sefaria's HTML tags were stripped; nothing was saved into the repository. The passages use 38 distinct code points in U+0591–U+05C7, U+05C7 among them (6 times, in וַיָּ֤רׇץ, כׇּל, לְכׇל, וּכְשׇׁמְע֗וֹ).
- **Browsers.** A throwaway local HTML page with an `@font-face` rule pointing at the vendored TTF, rendered by Playwright 1.64.1 in Chromium 156.0.8078.4 and in WebKit 27.2 (Playwright's WebKit build, the Safari engine), at device scale 2. `document.fonts` reported the face as loaded in every page in both engines. Chromium also printed both passages to PDF.
- **Shaping.** HarfBuzz 15.0.0 (uharfbuzz 0.57.0) and fontTools 4.67.0 in a throwaway virtual environment outside the repository, Python run with `-I`. Every verse was shaped three ways: all features, `mark` and `mkmk` off, and `mkmk` off.
- **Evidence files** are outside the repository, in `C:/Users/dsbog/bneimitzvah-review-output/n2-taamey-rendering-2026-10-25/`: full-page and 56 px close-up screenshots of Gen 18 and Gen 24:30–36 in both engines, a qamats and qamats qatan specimen in both engines, the two Chromium PDFs, and the load and text statistics. They are not committed because the repository policy refuses binary files outside the pinned fonts (its "unreviewed binary content" check), and that check is not weakened for evidence.

## Findings

- **Coverage.** The cmap maps every code point from U+0591 to U+05C7. Shaping all 40 verses produced 4,453 glyphs and no `.notdef`. Dagesh, shin and sin dots, holam haser for vav and rafe are composed by `ccmp` into precomposed glyphs (`betdagesh`, `shinshindot`, `shinsindot`, `vavholamhaser`, `betrafe`) rather than positioned as marks; that is the Tiro/Hancock-Hudson layout model and renders correctly.
- **`mark`.** All 1,822 mark glyphs in the passages are moved by `mark` (none sits at its default position with the feature on). Below the letter, a vowel and a disjunctive or conjunctive accent sit side by side (for example qamats with munah, mahpakh or tipha), as in a printed tikkun or chumash, rather than colliding.
- **`mkmk`.** 270 of the 1,822 marks change position when `mkmk` is turned off, so the font's mark-to-mark lookups do real work on this text: meteg next to a vowel (פֶּֽתַח, אָֽרְצָה), and merkha, atnah, tipha, mahpakh and munah beside the vowel under the same letter (יֹשֵׁ֥ב, מַמְרֵ֑א, בְּאֵלֹנֵ֖י, וַיֵּרָ֤א, מִפֶּ֣תַח). Above the letter, holam, the shin dot and an upper accent (zaqef qatan, pashta, qadma, telisha, gershayim, pazer) stay apart in the screenshots.
- **Chromium against WebKit.** The two engines' screenshots are visually identical for every page: same line breaks, same mark placement. No engine-specific fault was seen.
- **Qamats qatan against qamats.** The two glyphs are different outlines with the same width and anchor: qamats qatan's vertical stem is longer (bounds −637.6 to −184 font units against −587.3 to −194, units per em 2,048, so about 15% taller). At 140 px the difference is plain; at the 30–34 px reading size it is visible but small, about the same contrast Noto Serif Hebrew gives. That meets "a visibly distinct glyph", but a learner will not notice it unaided. If the reading surface needs qamats qatan to stand out, that is a teaching decision for N8 or later, not a font fault.

## Problems and notes for N8

- No rendering fault was found in either engine on either passage.
- MAM's ketiv and qere brackets in Gen 24:33 (`(ויישם) [וַיּוּשַׂ֤ם]`) come from Sefaria's text, not the font; this throwaway page shows them raw. N8 should confirm the app's own ketiv and qere display in the new face.
- Legarmeh's paseq (Gen 18:15, 18:21, 18:25, 24:30) renders as an upright bar in the face's own glyph.
- This checks the unmodified TTF only. If N8 serves a subset or WOFF2 (allowed under T6, with its conditions), it needs this check again on the derived file, since `salt` drops out of a default subset and name IDs 13 and 14 need `--name-IDs='*'`.
- Safari on a real Apple device was not used; WebKit through Playwright on Windows is the Safari engine but not Apple's font stack. N8's switch should get one look on an iPhone or Mac before release.
