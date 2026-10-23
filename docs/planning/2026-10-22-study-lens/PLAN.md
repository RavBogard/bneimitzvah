# Release 1.2: Lein and Study, first cut

2026-10-22. The 1.2 row of the [release plan](../2026-10-22-release-1-5/PLAN.md), built to §3.1–3.3 and §4 of the [leyning platform spec](../../superpowers/specs/2026-10-22-leyning-platform-design.md). It builds on the commentary data layer from `claude/rashi` ([its plan](../2026-10-22-rashi/PLAN.md)), the tikkun menu from `claude/tikkun-columns` and the CRC Torah front door.

## What it adds

- **Lein | Study switch** at the top of the passage, beside Torah | Haftarah, on the weekly page (`/read`), the assigned reading in the workspace, and the proposed portion a student explores before verses are chosen. Lein is unchanged.
- **Study**: each verse on its own row. The Hebrew comes first, with colours and its verse number (Hear). The English follows, on by default. Then the commentary appears inline. On wide screens the Hebrew sits on the left and stays in view beside a long commentary. The English and commentary sit on the right, the same columns as Lein's English layout.
- **Rashi inline**, English-led:
  - Rashi's quoted words (the dibbur hamatchil) come first, in bold Hebrew, then the English.
  - **Hebrew** shows Rashi's own words in place.
  - Each comment shows three lines, then **More**.
  - A verse Rashi is silent on shows nothing.
- **Works** (Study's toolbar item, replacing Tikkun): Rashi is on by default. The Women's Commentary can be added; on a haftarah it is marked "Torah only" and Study says so in one line. At most three works.
- **Comment-to-word link**: pointing at a comment (hover, keyboard focus, or a tap on the quoted words) underlines the words it quotes. The link is made only when the quoted words occur exactly once in the verse.
- **Lein's "Rashi (n)"**: a closed disclosure in the selected verse's tools. On `/read` it follows the selected verse; in the workspace it sits in each verse's tools. It opens the comments in place, credit at their foot, and the word link works in the continuous passage.
- **Credit**: Study ends each passage with one line per work: edition, licence and "via Sefaria", linked, plus each chapter's page on Sefaria. Lein's disclosure carries the same credit at its foot.
- **Quiet states**: "Loading Rashi…", and "Rashi isn't available right now. Try again", one line above the rows. The Hebrew is never held back.
- **Front door**: the Study button is back, linking to `/read?lens=study`.

## Decided here

1. **Lens memory.**
   - **On `/read`**: a first visit opens in Lein. After that, this browser opens in the lens it last used (`localStorage` key `crc-torah-lens-v1:weekly`, wrapped in try/catch). `/read` can't tell whether a signed-in adult is visiting, and it never asks for a session, so per-browser memory is the nearest to "remembered per person".
   - `?lens=study` always opens Study. While Study is on, the address carries `?lens=study`, so the page can be shared.
2. **Workspace.**
   - Students, child practice and parents always open in Lein, and nothing is remembered for them.
   - Tutors and admins open in the lens they last used. That memory is per browser (`crc-torah-lens-v1:staff`), because there is no per-user preference store. No migration.
3. **Study's English** is its own choice. It starts on (spec decision 10.8) and leaves Lein's English as the reader set it.
4. **Works** are remembered with the lens (registered works only, in registry order, at most three). Choosing none is allowed: the rows then show alone.
5. **Matching rules** (`src/lib/hebrew/dibbur.ts`).
   - What is compared:
     - Letters only.
     - Final forms are folded into ordinary ones.
     - The maqaf, paseq and sof pasuq break words.
     - An editor's `[…]` or `(…)` is dropped.
     - A trailing "etc." (וגו׳, וגומר, וכו׳) ends the quotation.
     - ה׳, and the whole-word substitutes יי, יקוק and ידוד, read as the four-letter name.
     - The Elohim euphemism (אלקים, אלוקים, אלקיך, לאלקי) matches the verse's אלהים forms. Only the quotation is read this way, and the comparison stays exact, so a real word with אלק (אלקנה) still matches only itself. (Root relaying Daniel's answer, 2026-10-22.)
   - What makes a quotation unlinked:
     - Any other abbreviation.
     - Words that are absent, repeated in the verse, out of order or not consecutive.
     - A partial word.
   - The quoted words are the leading bold run of Rashi's Hebrew comment, as Sefaria marks them.
6. **The English repeat of the quoted words.** The Silbermann English (Torah) repeats the quoted Hebrew before its own capitalized lemma. That repeat is dropped only when its letters exactly match the quoted words. The Judaica Press English (Prophets) has a bold English lemma, which is kept.
7. **Pointing at a comment.**
   - Hover and focus underline the quoted words while they last.
   - A tap on the quoted words pins the underline until it is tapped again or another verse is chosen. It also brings the words into view, without smooth scrolling.
   - There is no other motion or colour.
8. **Commentary loading.**
   - Lein loads Rashi after the text renders, so that "Rashi (n)" can be counted. That is one CDN-cached request per chapter on the page.
   - The Women's Commentary loads only when Study shows it on a Torah text.
   - Try again replaces the chapter store, so the request is sent again at once.
9. **Layout.**
   - "Rashi (n)" sits under Word tools rather than on the same line, because each disclosure opens its own panel below it.
   - The verse number in a Study row is a 44px target around the design system's lake-tint disc, floated at the start of the first Hebrew line.
10. **Credit placement.**
    - The spec (§4, "Credit without clutter") puts each text's credit at its foot. It is used here in place of DESIGN.md's older "no provenance on learner surfaces" rule.
    - The credit is shown once per work, at the passage's foot, not under every comment.
11. **Learners' phones keep the first verse above the fold.** That is an existing, tested rule.
    - So on a phone (640px and narrower), the switch for students, child practice and parents, and on the proposed portion, sits under the passage beside "About this text", not above it.
    - Everywhere else it is at the top, sharing the Torah | Haftarah row. On a 360px phone, that row now fits both controls on one line.
12. **Paragraph breaks in Study rows.** A break inside a verse keeps its space in the Hebrew. Its name ("closed paragraph") is read to screen readers only. The note under the verse names it in small muted type, the existing Apparatus line. This keeps apparatus out of the Hebrew line.
13. GATE: workspace Study for learners. Proceeded because spec §7 has students "find Rashi when a tutor points to it", and §3.1 gives every reading the switch. Lein remains their default and is unchanged.

## Deferred

- **CRC study guides in Study for everyone** (Daniel, 2026-10-22: show the guides to everyone). Two things hold this back:
  - **The public runtime.** It is deliberately composed so that no public request can reach a tenant table (`src/server/runtime/public-composition.ts`). Serving guides at `/api/public/` would add the first tenant-table read to the signed-out runtime. That is a tenant-isolation change, and CLAUDE.md requires an adversarial review for it.
  - **Wording with no precedent.** The 2026-10-21 study-guide spec fixes a label on every guide, saying what Claude wrote and whether the rabbi reviewed it. This release's brief says review status must not be exposed publicly. Two choices follow:
    - which guides appear publicly: reviewed only, or the visible version whatever its state;
    - how a public guide is labelled.
  - Both choices are user-visible wording. Left for a follow-up with its own review.
- **The "More on this verse" shelf**, more works and Compare translations belong to 1.3.

## Tests

- `tests/app/dibbur.test.ts`: the matcher, using synthetic strings only.
- `tests/app/study-lens.test.ts`: covers
  - the lens default and memory;
  - Works;
  - the weekly address;
  - comment parts;
  - the Rashi (n) count;
  - Study rows, the no-guess rule and the toolbar;
  - the switch, the quiet states and the credit.
- `tests/app/exploration-view.test.ts`: the proposed portion's switch.
- `e2e/study-lens.spec.ts`: covers
  - the switch, memory and the address;
  - Rashi inline;
  - the word link by hover, focus and tap;
  - More;
  - Lein's Rashi (n);
  - failure and Try again;
  - Works and the haftarah;
  - 360px without horizontal scroll, the one-row toolbar and 44px controls.

  Every commentary and reading answer in these tests is a synthetic route fulfilment.
- `e2e/front-door.spec.ts`, `e2e/foundation.spec.ts` and `tests/app/front-door.test.ts`: the Study link is back.

14. **English line breaks** (a fix to the shared text reader, found in Study). Sefaria's JPS 2023 HTML puts raw newlines beside small caps ("
G<small>OD</small>
 said"). Those newlines are now whitespace, as HTML treats them, and only `<br>` makes an English line. The CDN keeps `/api/public/text` for a day, and the study cache for a day, so the fix reaches cached chapters within a day.
15. **Busy verses** (decided by root after the finish review). Study shows at most three comments per work under a verse. The rest open in place from one row of at least 44px, "Rashi: 2 more" (the work's name, the count, "more"). There is no modal and no animation.
16. **Tapping** (logged at root's request; it replaces the spec's "marks them briefly"). A tap holds the underline until it is tapped again or another verse is chosen, because touch has no hover. There is no timer and no animation.
17. **Finish review** (root, 2026-10-22).
    - Commentary text is set in muted ink at 0.875rem, below the 1rem English. Muted ink is 6.3:1 on the light canvas and 9.0:1 on the dark one.
    - The quoted Hebrew words (600, 1.125rem) and the work's name stay in ink, as the one dark anchor.
    - The English edition's own lemma is split off without changing its text, and set at weight 500:
      - Bold lemmas keep their case.
      - Capitalized lemmas, including the Women's Commentary's capitalized section heads, become small capitals (`all-small-caps`).
    - So the Torah and Prophets editions read alike.

## Answered (root relaying Daniel, 2026-10-22)

- Lens memory per browser is fine as built.
- אלקים reads as אלהים (decision 5).
- Rashi's capitalized English lemma stays as Sefaria prints it; lowercasing would mangle proper nouns.
- Study guides on `/read` stay deferred to their own slice, with an adversarial review.

## Open items that wait on Daniel

- **Study guides on the public reading**: which guides, and what label (see Deferred), when that slice is built.
