# Reader's print sheet: design

Status: designed and built, 2026-10-23 (branch `claude/print-sheet`). This replaces the stub of the same date. Its settled decisions are unchanged; the formats it listed as proposals are settled below under "Decided here".

## Settled decisions (Daniel, binding)

- **The feature (2026-10-23, verbatim):** "I want selecting a reading to do for this next Shabbat to be super easy. Including selectable and creatable from the MCP. I'm thinking through a use case where I want a printed sheet for me to have up for the Torah reading. It's got Hebrew-- I don't need a tikkun view-- and the English translation next to each other in columns. It needs to be really well thought out as a usable document. But it needs to be able to have all sorts of different formats because different people might want different things printed."
- **Skills:** the build uses the impeccable, ui-ux-pro-max and frontend-design skills.
- **Licence (2026-10-23, verbatim):** "JPS 2023 is fine in print." Each printed page carries the edition and its credit line. Never-in-repo is unchanged: no JPS text in the repository, fixtures or tests; tests use stand-in text.
- **Outdated comment:** the "English is never on the sheet" comment in `practice-sheet.tsx` is corrected.
- **English edition (MISSION ruling 12, amended 2026-10-21):** the main text is JPS 2023 only; there is no translation picker. The sheet therefore prints JPS 2023 and names it; the format record carries the edition (`en=jps2023`) so another edition can be added later without changing addresses.
- **Indexing (2026-10-23):** signed-in pages and this route stay noindex; no "beta" wording.
- **Wording (Daniel, 2026-10-23, on PR #57):** "Keep all". Every `/print` label, the help line and the Print link on `/read` ship as written.
- **Where it lives (Daniel, 2026-10-23):** "Both. There should also be a UI in the site that anyone can use." The rabbi and tutors keep `print_sheet_link`; `/print` works for anyone, signed out included; the Print link stays on `/read`, and the signed-in reading (student, child practice, parent, tutor, rabbi) gains a Print link, beside Print practice sheet, that opens the sheet for the verses on screen.
- **Credit (Daniel, 2026-10-23):** "No note". The printed credit lines stay the same in every Hebrew mode (vowels and trope, vowels only, letters only); no change note is added.
- **iPhone and Safari printing (Daniel, 2026-10-23):** a follow-up for the pilot phone check.

## What it is

`/print` is a document for a reader standing at the Torah: Hebrew and English side by side, verse by verse, laid out as a page rather than a screen. It is rendered by the browser's print CSS; nothing is rendered on a server. It is open to anyone, like `/read`, and loads text only from the same public routes `/read` uses; a member's own saved reading comes from their account, as on `/read`. With no address it opens on this coming Shabbat's Torah reading in the default format.

Mode: Read (the document) inside an Operate shell (the settings). The shell inherits Song session: the lake app bar, the poster-scale hero, pill segmented choices, white objects on the lake canvas. The paper is white in both themes and set in points, so the preview is the printed size.

## The document

- **One table.** Its `thead` is the running head and its `tfoot` the credit, so both repeat on every printed page; each verse is one row, so its English sits beside its Hebrew. Column order left to right: English, the verse number in the gutter between the languages, Hebrew at the right edge, then the notes column (when chosen) at the far right, beside where each Hebrew verse begins.
- **Running head:** the reading's name (lake), its passage ("Torah Genesis 1:1–6:8"), and the Shabbat date when there is one, over a 1pt ink rule.
- **Credit, every page, not optional:** "Hebrew: Miqra according to the Masorah, Dovi and Hebrew Wikisource contributors, via Sefaria (CC BY-SA 4.0)." and "English: THE JPS TANAKH: Gender-Sensitive Edition, The Jewish Publication Society, 2023, via Sefaria (CC BY-NC 4.0).", each only when that language is printed, built from the edition records the text arrives with; the product name at the right. Page number "Page N of M" in the bottom-right page margin (the practice sheet's wording), where the engine supports page margin boxes (Chromium).
- **Verse numbers:** chapter:verse at the first verse and at every chapter change, the verse alone otherwise, tabular, muted.
- **Aliyot:** a forest "Aliyah N" (or "Maftir") label over a strong rule, on the Hebrew side, from the Shabbat's calendar aliyot (full kriyah; the triennial year's aliyot when the triennial portion is printed). A catalog reading or a custom passage has no calendar aliyot, so the Aliyot control is not shown for it.
- **Paragraphs and apparatus:** פ or ס after a verse that ends an open or closed paragraph (and inside a verse where one falls), muted; a ketiv/qere is the written form in muted ink followed by "[read / qere: …]", the existing apparatus wording.
- **A skip in the reading** (a haftarah of several segments): the new reference on its own quiet row, so the reader turns the scroll.
- **Page breaks:** a verse never splits across pages at Small and Standard; at Large and Huge, where one verse can fill half a page, it may continue overleaf rather than leave half pages blank. An aliyah label stays with its first verse.

## Formats (Decided here, 2026-10-23)

Each is in the address under a short fixed key; a default is left out, so `/print` alone is the default sheet. Unknown values fall back to the default for that field.

| Setting | Values (address) | Default |
|---|---|---|
| Languages | both, hebrew, english (`show`) | both |
| Hebrew | full (vowels and trope), vowels (cantillation, meteg and paseq removed), letters (the scroll's rule: letters and word spaces) (`script`) | full |
| Text size, Hebrew/English pt | small 15/9.5, standard 18/11, large 22/13, huge 28/16 (large print) (`size`) | standard |
| Aliyot | marked, page (each on a new page) (`aliyot`) | marked |
| Verse numbers | on, off (`numbers`) | on |
| Notes column | none, lined, blank (`notes`) | none |
| Paper | letter, a4 (`paper`) | letter |
| Orientation | portrait, landscape (`orient`) | portrait |
| Stand-up spacing | normal, standing: line height 1.85 to 2.15, Hebrew weight 400 to 520, more room between verses (`spacing`) | normal |
| English edition | jps2023 (`en`) | jps2023 |

Margins: Letter 0.5in top, 0.55in sides, 0.6in bottom; A4 12.7mm, 14mm, 15mm. English alone is held to a 40em measure.

## Choosing the reading

- The reading is named exactly as on `/read` (`date` and `kind`, `reading` and `passage`, `ref` and `kind`, `saved`), plus `pick` for part of a Shabbat's Torah reading: `triennial`, `aliyah-1` to `aliyah-7`, `maftir` (whole parashah when absent).
- On the page: Previous week, This week, Next week in the hero; in the settings, Torah or Haftarah, Portion (Full calendar portion, Triennial portion (year N), Aliyah 1 to 7, Maftir, as the calendar gives them) and Find a date; "Choose a reading" opens the existing reading chooser (any parashah, holiday or custom passage) and, for a signed-in member, their own saved readings (asked for only once the chooser is opened; signed out, nothing shows).
- One Print button; it waits only for the Hebrew face to load, then opens the browser's print window. `/read` gains a Print link beside Trope chart that opens the sheet for the reading on screen.
- The calendar aliyot come from a new public route, `/api/public/aliyot?date=` (numbers and book names only, from the same Hebcal snapshot `/api/public/reading` uses, CDN-cacheable, noindex), so a week's aliyah labels and portion picks need no session.

## MCP

`print_sheet_link`, read-only, scope `portal:read`, for the rabbi and tutors. Input: at most one of `parashah` (name or slug, matched ignoring case and punctuation), `ref` (with `kind`) or `savedReadingId`; otherwise `date` (defaults to this coming Shabbat) with `kind` and `portion`; an optional `format` record checked field by field. Output: the link (always naming its date), a plain statement of the reading and verse count, the format in one sentence, and a note. It never loads text, so no verse, and no licensed translation, passes through a tool result or a log. Saved readings stay outside the MCP (the saved-structure rule): a saved reading's id is only carried into the link, and the page opens it from the signed-in member's own account.

## Out of scope, follow-ups

- The workspace Print link opens the assigned verses as a passage, so the student's own aliyah cut points are not marked on the reader's sheet (the practice sheet keeps them).
- Saved named formats ("my Shabbat sheet") as account data: this needs a migration and a write tool; for now a format is the link.
- Calendar aliyot for a catalog parashah opened by name (the catalog keeps only whole ranges): extend `scripts/named-readings-extract.mjs` to keep each parashah's aliyot.
- Another English edition in print: needs a chapter-level route for that edition, and a ruling, since the main text is JPS 2023 only.
- The family practice sheet stays Hebrew only (it is the student's chanting sheet); an English option there is not added.
- Physical printing, Safari and Firefox page-number support, and the phone-to-printer path are not verified here; Chromium print output at Letter and A4, portrait and landscape, default and large print, was checked with stand-in text.

## Open items that wait on Daniel

None. The wording, the tutors' tool, the credit and the Safari question were answered on 2026-10-23 (Settled decisions above). At the pilot phone check: confirm that Safari and iPhone printing repeat the table's head and foot (the credit on every page); if WebKit does not, the credit needs a fallback before the sheet is used from an iPhone.
