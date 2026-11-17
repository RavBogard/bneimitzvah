# Assigned-reading colors and transliteration — proposed next milestone

## Current scope override — 2026-10-16

Daniel questioned the need for visible transliteration and asked to discuss it.
**The active milestone is now phrase colors only.** Astra recommends omitting
Latin-letter reading aids; a permanent mission change is not assumed yet.
The pure Hebrew projection/grouping and color UI continue. Park the uncommitted
phonetic extraction and romanization work under ignored local logs, with an exact
manifest, and restore the legacy engine before publication. Do not bundle a
phonetic engine or add a transliteration control in this milestone. The extraction
and transliteration sections below are retained as deferred design history, not
active implementation requirements. No phonetic files need to enter the isolated
HTTP browser fixture for colors alone.

Implementation authorized by Daniel's “Go”, 2026-10-16. **Astra approved the bounded colors-only architecture. Daniel confirmed Adonai/Elohim for sung practice; this does not add visible transliteration.**
Authority: MISSION 12–14 and Phase 3; `PLAN-CODE-2026-10-15.md` Phase 3 step 2.
The editor/chart checkpoint is `74f798a`; its hosted verification is separate from
this proposal. Complete phrase-family colors and an optional student reading aid;
edition picker, word panel, commentary, drills and audio remain separate milestones.
No generated audio, renderer invocation or G3 release follows from this work.

## Astra decisions — 2026-10-16

Preserve Annotated score and the current first-reading viewport. Start with per-verse
reading-aid disclosures after English; both aids default off, with one disclosure
open at a time. No new controls precede the first Hebrew line. Preserve exact text,
existing notes/drafts, all authority barriers and actual tonic stress only.

The final canonical verse of the confirmed haftarah assignment receives the ending
context, including a custom assigned excerpt. A page boundary never supplies it;
Torah keeps its ordinary verse ending. Unicode-only paseq grouping is accepted at
this scope, with its lost-markup limitation disclosed. No normalizer/cache change.

Build the lossless typed projection and shared browser-safe engine core first, then
review its contract before UI integration. Existing `israeli-v1` may be implemented
as the provisional profile; Daniel has been asked about its practice divine-name
reading. Do not portray it as cantor-approved. This work remains within the existing
Daniel-only product-review sequence; it does not authorize a family pilot.

Astra owns architecture, boundary review, integration and publication. Sol owns
implementation and focused evidence. Reuse the already-loaded Impeccable context,
then read its craft floor immediately before UI changes; preserve the incumbent
design system and use the bounded capture/fresh-review/documentation workflow.

Review refinements: colors and transliteration have independent availability;
phonetic failure cannot remove valid colors or the source text. Bound the initial
projection before span mapping (including cumulative segment bytes and word count),
not just the later phonetic call. Existing custom assignments can contain Psalms,
Proverbs or Job; leave their Hebrew and work tools intact but mark these derived
aids unavailable, because this milestone implements the 21-book cantillation rules.
Do not change assignment eligibility or guess Job's prose exceptions here.

## Composition and ownership

Continue Annotated score, the active local Noto content font, Hebrew 2rem/line-height
2 and the existing phone bound. Add one initially collapsed **Reading aids** disclosure
after each verse's English reference, inside its reading column. It offers per-verse
**Color phrases** and **Show transliteration** controls, initially off. A disclosed
legend names families and links to the existing chart; color never carries meaning
alone. Transliteration is a separate LTR labelled line after the English reference,
not a replacement for Hebrew or the student's translation. Only one aids disclosure
is open at a time; settings are presentation-only and never submit student work.
Authorized parents/active-child helpers/staff may inspect the same aid without
gaining any write capability. Astra should approve these defaults/composition.

One Sol implementer, no recursive delegation, owns new `src/lib/hebrew/study-tokens.ts`,
`study-annotations.ts`, a browser-safe engine entry described below, new
`src/components/portal/workspace/study/annotations.tsx` and its scoped CSS module,
and the narrow `study/view.tsx` integration. Preserve concurrent edits. Root owns
architecture/pedagogical rulings, independent privacy/finish review and Git/CI.
Focused tests belong in `tests/app/study-annotations.test.ts`, engine parity tests,
and the existing actual-SDK `tests/http-browser/study-ui.test.ts`. No schema,
provider-account, remote service or package installation is proposed.

## Typed contract and source reuse

1. Build a lossless display projection from current `HebrewSegment[]`: text runs,
   explicit written/read alternatives, paragraph gaps and inverted-nun signs. Preserve
   exact NFC characters and original order. Attach **zero-based reading-word indices**
   to Hebrew lexical words, matching the pinned haftarah `verseWords`/`HE_WORD` rule:
   count qere, exclude ketiv, split maqaf-connected words, exclude punctuation/signs.
   A multiword qere owns multiple reading indices; ketiv retains its display anchor
   but receives no invented reading index. IDs are canonical `{verseRef, wordIndex}`,
   never page ordinal, engine unit number or romanized text. Preserve separators and
   map words back to segment/subrange; reconstruct both existing `text` and
   `readingText` exactly before accepting a projection. Engine NFD ranges must never
   become offsets into NFC DOM text.
2. Phrase grouping ports the small `trope/lib-trope.cjs` rule to typed tokens,
   parity-tested against that existing source. Reuse `src/lib/trope/chart-catalog.ts`
   IDs/colors/names. Tipcha/pashta/yetiv/zarka follow their closing phrase; conjunctives
   are not permanently assigned a color. Preserve standalone paseq, munach-legarmeh,
   gaps and uncolored Masoretic signs; do not color by accent codepoint alone.
   Proposed `final` is true only for the final canonical ref of the confirmed
   haftarah assignment, never the last verse of a text page. Astra must settle custom
   excerpt finality below. Color the **read** alternative; keep written ketiv distinct
   and uncolored rather than implying it is spoken.
3. `trope/text.mjs` currently takes HTML and imports `node:module`; do not import it
   into a client component or call `tropeHtml`/`dangerouslySetInnerHTML`. Recommended
   extraction: a dependency-free `trope/reading-core.mjs` with a typed-token entry
   and the existing stages 2–7 syllable/phoneme functions. Existing HTML `verseUnits`
   delegates to that same core after its existing parser; its public outputs stay
   compatible. The app passes canonical read tokens, explicit punctuation/break
   semantics and the pinned `israeli-v1` profile only. No provider HTML, English,
   notes or draft text enters this path. Keep the engine's existing vendored
   havarotjs/license; never bundle melody tables, renderers or Python. Dynamic-import
   this pure entry only on explicit transliteration request.
4. Return an app-local projection, not the full phonetic object:
   `{version:1, ref, words:[{index, family:null|FamilyId, phrase:null|number,
   roman:null|string}], status:'ready'|'unavailable'}` plus typed display runs.
   Derive roman text from existing `symbols.roman`, syllable boundaries and actual
   tonic stress. Start with `lexical:false`: uppercase tonic syllables only; the
   existing default lexical-stress guess for unaccented maqaf words is not a fact.
   A mapping mismatch, unsupported symbol or engine warning yields an honest
   per-verse unavailable aid; never fabricate missing romanization or hide Hebrew.

## Bounds, cache and lifecycle

Keep current private study DTO and the strict `study-normalized-v1` chapter cache
unchanged: cached canonical text/edition provenance contains no learner preferences
or annotations. This proposal needs no new HTTP fields or endpoint. Derive only from
the currently authorized parsed page (existing maximum 100 verses/eight chapters,
2 MiB client reader). Proposed per-verse phonetic caps: 8 KiB UTF-8 reading text,
512 lexical words and 2,048 syllables; roman output at most 16 KiB. Exceeding a cap
disables that aid only. Validate before invoking syllabification; avoid whole-page
eager romanization. Root may tighten these caps after synthetic worst-case evidence.

Preferences/results stay in mounted current-page memory, keyed by the existing
session/mode/learner/context/kind/assignment-revision binding plus canonical ref.
No browser persistence, analytics, text logging or clipboard. Same-binding focus
checks may retain settings hidden; render only after the full existing metadata/text/
work barrier. Changed/denied authority, assignment or page clears obsolete projections;
late dynamic-import/derivation completions require an unchanged generation. Do not
remount or clear the independent work coordinator, mutate save state, intercept
navigation, add a fetch or bypass departure review. Keep MAM/JPS attribution; add a
short labelled automated-transliteration/profile notice, without implying a cantor
approved the result or that it represents audio.

## Pedagogy and acceptance before release

Recorded sources settle family names/colors, 21-book grouping, qere-first word
numbering, optional student transliteration and Binder/Avery as the initial nusach.
The haftarah customs file's `divineName:'yy'` is a **display** choice, not approval of
spoken-name substitutions; its nusach also predates the portal's Binder/Avery ruling.
The current study API exposes no pronunciation/customs setting. `israeli-v1` explicitly
says cantor-unconfirmed: vocal sheva after long vowels, tsere/yod, gutturals, furtive
patach and gemination remain teaching choices. Daniel's existing rulings do not settle
them. Daniel's preference is being requested during implementation; use the identified
provisional aid for his review unless he directs another profile. Confirm the teaching
profile before the later learner release; a melody tradition does not settle pronunciation.
Astra's assigned-excerpt ending and actual-tonic stress decisions are recorded above.
Current normalization drops bold/small paseq markup: use the documented Unicode fallback
and disclose its limit; never infer discarded semantics or expand the cache boundary.

Acceptance: synthetic typed reconstruction/word-index parity (multiword qere, maqaf,
marks, gaps, inverted nun, no trusted-HTML shortcut); family parity including page
versus assignment endings and all chart families; old/new engine golden parity plus
roman/profile edge cases and bounded failure. Actual-SDK browser cases prove toggles,
literal text safety, canonical IDs across pages/toggles, current-only lifecycle output,
unchanged draft/unknown-save state, note visibility and forced revocation clearing.
One batched desktop/390×844/200% capture verifies first complete Hebrew range after
fonts settle, real Noto glyph use, keyboard labels, wrapping and color-off legibility.
Root requires independent boundary/finish review, normal integration gates and
Daniel-only pedagogical review; this milestone does not authorize a student pilot.
