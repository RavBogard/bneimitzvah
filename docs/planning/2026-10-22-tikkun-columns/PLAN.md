# Tikkun side by side, with trope colors on both texts

Branch `claude/tikkun-columns`. Daniel (2026-10-22): "There should also be a view with tikkun and regular in
columns next to each other, and trope colors should be toggleable on both, always."

## What changed

| Piece | File |
|---|---|
| `tikkunView: "off" \| "beside" \| "only"` replaces the `tikkun` boolean; old stored values carry over | `src/components/portal/workspace/reading-prefs.ts` |
| Tikkun button opens a three-way menu (same popover as Size) | `src/components/portal/workspace/reading-toolbar.tsx`, `src/app/globals.css` |
| Word-by-word tikkun from the study projection | `src/lib/hebrew/tikkun.ts` (`tikkunPieces`) |
| Colored, highlighted tikkun; two columns on every width; tikkun-only on every width | `src/components/portal/workspace/study/annotations.tsx`, `annotations.module.css` |
| Callers pass the view; the practice sheet's tikkun option starts on unless the view is off | `public-reading/view.tsx`, `study/view.tsx`, `study/exploration-view.tsx`, `study/practice-sheet.tsx` |

## Decided here

1. The preference is `tikkunView`, default `"off"`. A stored `tikkunView` that is one of the three views wins;
   otherwise a stored `tikkun: true` reads as `"beside"` and `false` as `"off"`. The storage key and its
   `-v2` version are unchanged; the old `tikkun` field is left in storage untouched (it is ignored once a
   view is stored).
2. The toolbar's Tikkun button keeps the scroll icon and the label "Tikkun" and its accessible name is
   "Tikkun: <current choice>". It opens a popover group named "Tikkun view" with "Pointed text", "Side by
   side" and "Tikkun only"; choosing one stores it and closes the menu. Like the Size button, it carries
   no `aria-pressed` (review fix: it opens a menu, it is not a toggle); a `data-active` attribute gives it
   the same white "on" look as a pressed toolbar button while the view is not off (`globals.css`). Torah
   only, as before: a haftarah never shows the control or any tikkun.
3. "Side by side" is two columns on every screen width: pointed text on the right, tikkun on the left, verse
   by verse. The width hook (`useWideReading`) is gone because nothing depends on width any more. Under
   1001px the column gap is 0.625rem, the tikkun padding 0.5rem and the tikkun is set flush (start)
   instead of justified, so a narrow column has no wide word gaps. English, when on, spans both columns
   under each verse.
   - **No Hebrew word ever breaks inside a column** (review fix): both columns set `overflow-wrap: normal;
     word-break: keep-all`, overriding the global `.study-hebrew { overflow-wrap: anywhere }` and the flow
     paragraph's own `anywhere`. Before the fix Genesis 1:1 at Huge on a 360px phone split a word across
     two lines; a split word teaches a wrong word.
   - **Phone size cap** (review fix): under 1001px, in "Side by side" only, the Hebrew of both columns is
     capped at the Standard step, `min(var(--hebrew-size), 2rem)`, and the tikkun takes its 0.92 ratio on
     top of the capped size (1.08 of the full size on wide screens). Large and Huge therefore read as
     Standard in the phone columns; Small still reads smaller. This stays within the four named size steps;
     "Pointed text" and "Tikkun only" keep the full chosen size on phones. A ten-letter pointed word (the
     Torah's longest) fits on one line at 360px; it can reach a few pixels into the column gap.
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
   - `alternative` (ketiv/qere) runs: the written form (ketiv) is written, colored as the first read (qere)
     word, and it stands for every read word (`words`), so it is highlighted while any of them plays
     (review fix; Genesis 30:11's one-word ketiv for a two-word qere). The qere is never written.
   - `gap` runs: a word space.
   - `inverted-nun` runs (review fix): the sign is written in the stream where it stands, set off by word
     spaces. Real MAM puts Numbers 10:36's closing sign before its `{פ}` open-paragraph gap, which the
     first version dropped because it only looked at the verse's last segment. Without a projection, the
     uncolored fallback (`tikkunSigns`) places a sign before the letters when one stands before every
     letter and after them when one stands after every letter, ignoring paragraph gaps.
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
fixtures) plus four synthetic verses: Numbers 10:35's opening inverted nun, 10:36's closing one before a
`{פ}` gap (the real MAM shape), ketiv/qere, paseq, maqaf, sof pasuq and petuchah/setumah. That is 192
sources, 187 of which the study normalizer accepts (it refuses five raw strings whose ketiv or qere lacks
its pair or which carry an empty pisqa span, so the reader never shows them). For all 187, the pieces with
the signs set aside spell exactly `tikkunText(verse.hebrew.text)`, there is one sign piece per inverted
nun, every other piece is letters only or one space, and the colored, uncolored and fallback
`TikkunVerse` renderings read the same. Numbers 10:35 reads `<sign> <letters>` and 10:36 `<letters>
<sign>` in all three.

The phone layout is checked in `tests/http-browser/tikkun-print-ui.test.ts`: at 360 and 390px, at Large
and Huge, every tikkun and pointed word span has exactly one client rect and stays on screen, with no
sideways page scroll (Genesis 1:3 there carries invented words up to ten letters long).

## Open items that wait on Daniel

- None for release under the 2026-10-17 authority; the view is student-visible and ships with the branch.
