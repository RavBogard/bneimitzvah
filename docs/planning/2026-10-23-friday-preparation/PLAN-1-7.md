# 1.7 Friday preparation: reconciliation and build plan

Reconciled against main at 4475fd6, with #57 (print) at 62432e0 and #56 (Learn 1.6). Daniel's binding answers are in MISSION's "Amended 2026-10-23, Friday preparation direction" and in "Rulings" below. Daniel, verbatim: "Approved. Get everything through 1.8 done and released".

## Rulings (Daniel, 2026-10-23, popups)

- Print appendix licences: "CC BY-NC too (Recommended)". It may print public-domain, CC0, CC BY and CC BY-NC editions, each with its credit. Editions that state no licence are left out of print (they stay on screen).
- Claude translations through MCP: "Any original". Each carries the fixed credit naming Claude as translator and the person who selected it.
- Sign-in card on /read: the heading becomes "Save this reading" (the body is unchanged).
- Account intro: "All plus preferred commentaries, settings, etc". Today, preferred commentaries and reading settings are kept only in the browser (`study-lens.ts`, `reading-prefs.ts`). So M3b makes the account keep them. The full sentence ships only once it is true.

## Decided here (Claude, logged)

- GATE: account-kept preferences (M3b) are built rather than the sentence trimmed, because Daniel named them explicitly. Proceeded because it is owner-only data under the existing saved-owner RLS pattern, with a review.
- Stars stay. Marks and notes on verses dropped from a revised reading are kept hidden and come back with the verse. Stored notes and translations show read-only to their owner; the editors are gone.
- No quieter initial colour in Study: it contradicts the 2026-10-16 ruling that phrase colours are on by default.
- The consultant's "saving/recovery concern" was not reproduced. The closest evidence is `yours.tsx` dropping typed text on a conflict, and M3 removes that editor.
- GATE: M1 builds the Study word card as a `"word"` kind of the verse panel, fed by the text page through a registered host, and reuses the existing word-details fetch (no new data source). The existing Word tools disclosure stays below the text for both lenses. The reading place line and chapter jump are Study only; the one-Tab-stop-per-verse arrows apply wherever words are buttons (Lein too), while a Lein tap still plays. Proceeded because it needs no wording beyond the minimal literal strings listed in the PR.
- Migration numbers: 0039 is the page counter. M2's grant is 0040, M3b's preferences 0041, M6's curation 0042.

## Acceptance checks against source

| # | Status | Work |
|---|---|---|
| 1 whole portion, commentary, select, save, revise, reopen | partly; Edit changes only name and date | M2 |
| 2 Claude selection opens in Study, whole portion and back, Lein, Print | mostly; no Study link tool, no way back to the whole portion | M2 |
| 3 separated groups, revise, correct count | the data model supports up to 32 groups; no UI | M2 |
| 4 Study tap shows meaning, Lein tap hears | no; a tap plays in both lenses | M1 |
| 5 source in full, credit, return to place, phone, keyboard | largely; needs the current reference, a chapter jump and one Tab stop per verse | M1 |
| 6 writing controls cut, owner-only, Claude ownership | no | M3, M4 |
| 7 print the selection, appendix on and off | the sheet is done (#57); no appendix | M5 |
| 8 curated discussion through MCP, public, no intro | no; guide validation requires intros | M6 |
| 9 student guides secondary, journeys intact | already true | keep tests |

## Milestones

- **M1 (Sonnet, no migration).**
  - The Study word tap opens the word card beside the verse, as a `"word"` kind in `VersePanelScope`. Previous word, Next word and Hear this word stay in the card. Lein still plays.
  - The card gives a plain-language grammar sentence first (modelled on haftarah `words.js describe()`), with the dictionary folded below.
  - A current-reference line and a chapter jump.
  - One Tab stop per verse, with arrows between words (haftarah `a11y.js`).
  - Don't touch Learn's own word card.
- **M2 (Opus for the contract and migration, Sonnet for the UI).**
  - A "Choose verses" mode from the text, with a live count and references line. "Change verses" on a saved reading.
  - "Whole portion" goes to the parashah that holds the selection, with the selection marked, and back.
  - `validate.update` takes optional `ranges`, and `verseCount` is recomputed. Migration 0040 grants UPDATE on (ranges, verse_count).
  - Read-only MCP `study_link`.
  - The personal offline pack refreshes after a revision.
- **M3 (Sonnet, no migration).**
  - Cut the Yours note and translation editors; stored text stays visible read-only.
  - The translate drill shows JPS only. Remove `writeOwn` and `openStudy`.
  - The approval email gets Daniel's text.
  - The sign-in card heading becomes "Save this reading". The staff accounts line is aligned to match.
- **M3b (Opus plus review, migration 0041).**
  - The account keeps preferred commentaries and reading settings, owner-only. The browser value stays as the signed-out and offline fallback; the account value wins after sign-in.
  - Then the account intro becomes: "An account keeps your saved readings, your place in Learn to lein, your preferred commentaries and your settings. Everything else on {productName} is open without one."
- **M4 (Opus build plus an Opus adversarial review, no migration).**
  - Owner-only MCP tools: `list_saved_readings`, `open_saved_reading`, `create_saved_reading`, `revise_saved_reading`.
  - The owner is always the connection's own membership, set through a shared private `bindOwner`, plus `withConnectionOwner`. Unattended connections are refused.
  - `tests/saved-structure.test.mjs` is updated so only `mcp/saved-tools.ts` may import `saved/mcp`.
  - Admin and tutors only; double inserts are prevented (list first, or a mutationId).
- **M5 (Sonnet).**
  - An optional commentary appendix on the print sheet, chosen by work. It is off by default.
  - It starts on a new page after the reading, grouped by verse, with credits. Licence filter per the ruling above.
- **M6 (Opus plus review, migration 0042, short spec first).**
  - Source-only curated discussions: a question or title, ordered source refs with verse anchors.
  - Credited Claude translation records, bound to the exact original ref.
  - Admin MCP tools: adding one publishes it.
  - A cacheable public read route.
  - Two entrances: beside the verse, and an optional question list only where material exists.

Order: M1 and M3 in parallel after #57 and #56 merge; then M2; then M3b and M4; then M5; then M6. Release tags (Claude's choice): v1.7.0 after M1 to M3, and 1.7.x for the rest, or in one release if they land close together.

## Haftarah patterns adopted (read-only)

One panel at a time, and a sequence counter drops stale answers. Focus returns to the opener. The word panel shows plain language before the dictionary. A source opened inside the panel has a back button to everything on that verse. One Tab stop per verse, with arrows going right to left.
