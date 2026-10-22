# Tikkun side by side, with trope colors on both texts

Branch `claude/tikkun-columns`. Daniel (2026-10-22): "There should also be a view with tikkun and regular in
columns next to each other, and trope colors should be toggleable on both, always."

## What changed

| Piece | File |
|---|---|
| `tikkunView: "off" \| "beside" \| "only"` replaces the `tikkun` boolean; old stored values carry over | `src/components/portal/workspace/reading-prefs.ts` |
| Tikkun button opens a three-way menu (same popover as Size) | `src/components/portal/workspace/reading-toolbar.tsx` |
| Word-by-word tikkun from the study projection | `src/lib/hebrew/tikkun.ts` (`tikkunPieces`) |
| Colored, highlighted tikkun; two columns on every width; tikkun-only on every width | `src/components/portal/workspace/study/annotations.tsx`, `annotations.module.css` |
| Callers pass the view; the practice sheet's tikkun option starts on unless the view is off | `public-reading/view.tsx`, `study/view.tsx`, `study/exploration-view.tsx`, `study/practice-sheet.tsx` |

## Decided here

1. The preference is `tikkunView`, default `"off"`. A stored `tikkunView` that is one of the three views wins;
   otherwise a stored `tikkun: true` reads as `"beside"` and `false` as `"off"`. The storage key and its
   `-v2` version are unchanged; the old `tikkun` field is left in storage untouched (it is ignored once a
   view is stored).
2. The toolbar's Tikkun button keeps the scroll icon and the label "Tikkun", is `aria-pressed` whenever the
   view is not off, and its accessible name is "Tikkun: <current choice>". It opens a popover group named
   "Tikkun view" with "Pointed text", "Side by side" and "Tikkun only"; choosing one stores it and closes
   the menu. Torah only, as before: a haftarah never shows the control or any tikkun.
3. "Side by side" is two columns on every screen width: pointed text on the right, tikkun on the left, verse
   by verse. The width hook (`useWideReading`) is gone because nothing depends on width any more. Under
   1001px the column gap is 0.625rem, the tikkun padding 0.5rem, the tikkun font 0.92 of the Hebrew size
   (1.08 on wide screens) and the tikkun is set flush (start) instead of justified, so a narrow column has
   no wide word gaps. English, when on, spans both columns under each verse.
4. "Tikkun only" replaces the pointed text on every width; the verse-number button still plays the verse.
5. Trope colors follow the Colors button on both texts in both views; the old suppression in the
   tikkun-instead layout is removed. Each tikkun word uses the same `.word` class and `--phrase-color` as
   its pointed word. The screen-reader phrase list stays once per verse; the side-by-side tikkun stays
   `aria-hidden`; tikkun words never carry `aria-describedby`.
6. Word mapping (`tikkunPieces`) walks the projection's runs with exactly the character rules of
   `tikkunText` (NFD; Hebrew letters U+05D0-U+05EA kept; whitespace or maqaf becomes one word space between
   letters; everything else dropped; leading and trailing spaces never written):
   - `text` runs: each display part's letters carry that part's `wordIndex`; parts without one (spaces,
     maqaf, paseq, sof pasuq) can only contribute a word space.
   - `alternative` (ketiv/qere) runs: the written form (ketiv) is written, under the `wordIndex` of the
     first read (qere) word. The qere is never written.
   - `gap` runs: a word space. `inverted-nun` runs: nothing in the word stream; the sign is placed at the
     start and end of the verse exactly as `TikkunVerse` placed it before.
   - Consecutive pieces of the same word merge into one span (a word split by source markup).
   Without a ready projection, `TikkunVerse` falls back to the uncolored `tikkunText` rendering.
   The rule "whitespace or maqaf inside any part is a word space" is a little wider than the brief's
   "parts without a wordIndex": maqaf is outside the projection's reading words today, but the wider rule
   keeps the letter invariant true by construction even if a word part ever contained one.
7. Tikkun words are `<span data-tikkun-word>`; they are never `data-word-index`, buttons or focusable, so
   the pointed text's click and key handling never sees them. The playing word is highlighted in the
   tikkun with the same `data-reference-active` styling, in both views.
8. The practice sheet keeps its own uncolored tikkun column (print); only its initial checkbox reads
   `tikkunView !== "off"`. The flow container's `data-tikkun` attribute is now the view (`beside`/`only`)
   instead of `beside`/`instead`.

## Letter invariant

`tests/app/tikkun-letters.test.ts` normalizes every Hebrew verse in `tests/fixtures/trope` (Torah and
haftarah calibration corpora, edge cases raw and cleaned, the week fixtures, the two single-verse
fixtures) plus four synthetic verses for inverted nuns at start and end, ketiv/qere, paseq, maqaf, sof
pasuq and petuchah/setumah: 192 sources, 187 the study normalizer accepts (it refuses five raw strings
whose ketiv or qere lacks its pair or which carry an empty pisqa span, so the reader never shows them).
For all 187, the joined pieces equal `tikkunText(verse.hebrew.text)`, every piece is letters only or one
space, and the rendered colored and uncolored `TikkunVerse` text (inverted-nun signs included) equals the
old uncolored rendering.

## Open items that wait on Daniel

- None for release under the 2026-10-17 authority; the view is student-visible and ships with the branch.
