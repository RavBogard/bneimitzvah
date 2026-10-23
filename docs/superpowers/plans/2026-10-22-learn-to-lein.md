# Learn to lein (release 1.5): implementation plan

2026-10-22. Builds the course Cowork delivered in `docs/planning/2026-10-22-learn-to-lein/`: the map is in COURSE.md, the drills in ACTIVITIES.md, the shared strings in COPY.md, the build order in HANDOFF-TO-CLAUDE-CODE.md, and Daniel's rulings at the foot of QUESTIONS-FOR-DANIEL.md. The content is `src/lib/learn/lessons.json`. Lesson text is Claude's and goes live at once (Daniel, ruling 7 of the 1.5 popups).

## Settled decisions (Daniel, binding)

- No streak and no daily goal. No score, badge, mascot, confetti, emoji, exclamation point, pep talk, slang or youth-group voice anywhere in the course.
- No recording of the learner of any kind; no compare-your-chant. The trope-song activity waits for a human recording.
- Signed-out progress lives in the browser. A browser's progress is copied into the account on that person's first sign-in.
- The first-verse lesson keeps its end-of-aliyah sentence.
- Notifications stay off. The review line on the course home is the only reminder.
- The audio is PocketTorah's human recordings only, cut by word. No generated chant reaches the course before G3; the course has no code path to the voice track at all.

## Decided here

1. **lessons.json in the repo has no index-derived fields.** The private PocketTorah index stays outside Git (SOURCE-READINESS.md). The committed copy drops `alignScore`, `recording` and `indexWords` from every example. Cowork's full file stays at `C:/Users/dsbog/learn-to-lein/lessons.json` for the off-repo checks. At runtime the app cuts by engine word, through the timeline the public short route already maps, so it doesn't need those fields. `firstWord` and `lastWord` stay: the app compares them with the engine's units and drops an example whose text has drifted.
2. **Verses load through the ref-keyed public routes from PR #32.** These are `/api/public/text?ref=&kind=&offset=` and `/api/public/reference/short?ref=&kind=&offset=`. There is no new server route and no new corpus index. Slice 1's pure modules come first and don't need #32. The UI half merges main once #32 lands.
3. **Pools are built over the verses the course has loaded:**
   - the verses of the lesson's examples, and of the lessons whose families the drill uses;
   - this week's reading, for this-week and first-verse.
   
   Every phrase in a loaded verse joins its family's pool, not only the example phrase. So the corpus grows from the 136 examples to every phrase in about a hundred real verses. The pool builder is a pure function over analysed verses, unit-tested with synthetic verses. Membership of the real examples is checked by the off-repo script in "Checks" below, because test fixtures must be synthetic.
4. **Routes:** `/learn` (course home), `/learn/<lesson-id>` (one lesson), `/learn/review`. Public and noindex, signed-out first, on the same CRC host checks as `/read`.
5. **Progress shape** `learn-progress/v1`:
   ```
   { lessons: { [id]: { done: ISO } },
     cards:   { ["family:melody:skill"]: { box: 0..5, due: ISO-date } } }
   ```
   - Skills are `name`, `find` and `end`.
   - Boxes are same session, then 1, 3, 7, 16 and 35 days. A right answer moves a card up one box. A wrong answer drops it two boxes and re-asks it in the current run.
   - Signed out: localStorage under one key. Every read and write is in try/catch, size-bounded and validated. A bad or missing value means a fresh start, never an error.
6. **Deep link into Lein:** `/read?date=<Saturday>&kind=<torah|haftarah>&verse=<n>`, or whatever verse parameter `/read` already has after #31 and #32. It opens the reading with that verse selected and the inline player's Repeat and Speed present.
7. **Contour marks** are drawn from the closing cell's core degrees in `trope/cells/torah.json` and `haftarah.json`. If two Torah marks collide at 16 px, lengthen the polyline to include the upbeat. The mark sits in the chip in ink, never in colour alone. It animates along the phrase during "Hear it", and is static under reduced motion.
8. **Slices:**
   - Slice 1 opens the course for Daniel to try.
   - Slice 2 finishes the v1 drills.
   - Slice 3 is the signed-in sync. It touches saved-data privacy, so it gets an adversarial review, and its migration is numbered after the 1.4 saved layer (0036).

9. **Lesson summaries.** lessons.json had no one-line summary for the next-step card, so each lesson gained a `summary` (Claude's lesson text, ruling 7 of the 1.5 popups), drawn from its goal ("Where the verse rests").
10. **Low-alignment swaps (off-repo check, 2026-10-22).** Numbers 6:24 (0.279) became Numbers 6:26 [4,6] (0.553) in sof pasuk; Exodus 3:14 (0.331) became Genesis 27:22 [5,5] (0.678) in revia; the Numbers 6:24 first-verse fallback was dropped (three remain). All 135 examples pass on live Sefaria text; none is left for the listening round on alignment grounds.
11. **Verse loading.** A lesson's single verses are grouped into as few canonical refs as the ref rules allow (one Torah book per ref, Nevi'im together, at most 32 segments and 1000 characters), so a lesson costs a handful of CDN-cached requests. This week's reading loads as its own ranges joined by "; ".
12. **Placing sof pasuk.** A verse's `endsRecording` is false only where the course knows it: sof pasuk examples (checked against the index off-repo) and week verses whose next verse shares the recording. Anything unplaced stays out of the sof pasuk pool. End-of-haftarah examples are analysed as last verses.
13. **Contour marks** always include the closing cell's upbeats (the fallback in 7), because without them tevir and telisha ketana, and zakef and segol, draw alike; a test checks the eleven shapes stay apart in each tune. Held notes are longer flat runs.
14. **Drills.** Answers come before anything is shown; chips are uncoloured until answered. The lesson's own family is about half of a run's answers. Eight right in a row with no miss in a lesson lets its remaining drills go. A drill the loaded verses cannot fill is skipped. The where-does-it-end start word carries a marigold underline. A wrong end tap says "That one is [family]." for another phrase's last word, "That's a munach, which joins." for a conjunctive (ACTIVITIES.md's wording) and "That's a tipcha, which joins the following phrase." for a sign that leads on (the trope chart's wording).
15. **Cards.** A lesson's cards are its family and melody times the skills its drills practise; only existing cards move on an answer. The review line counts distinct family-and-tune pairs due; minutes are the run's 8 to 12 items at 10 seconds, rounded up. Review fills each slot by its skill (tap or end where a verse fits, otherwise hear-and-name, with every third name slot a same-or-different).
16. **Path.** Unlocked lessons are links; locked ones are plain rows (a direct link still opens them). Done family rows fill with the family colour and a check; the next row has the marigold ring. Haftarah rows drop "in the haftarah" under the Haftarah heading. A unit whose only lesson has its title shows no unit heading.
17. **Signed-out note.** The home shows COPY's "Progress is saved on this device. Sign in to keep it." for everyone in slices 1 and 2; nothing in the browser is cleared on sign-in, so slice 3's copy keeps it. Slice 3 hides the line when signed in.
18. **Open in Lein** is `leinHref({date|ref, kind, verse})` in src/components/learn/lein-link.ts, a thin call to urls.ts `readAddress()` from 1.3's A3 (#34): `/read?date=…[&kind=haftarah]&verse=n` or `/read?ref=…&kind=…&verse=n`, the verse 1-based within the passage. The course's ref requests use urls.ts `publicTextPath`/`publicShortPath`.
19. **The front door card** keeps COPY's title and line, with a lake Start button to /learn and the trope chart as a plain link beneath.
20. **Celebration.** Each word's ink pull starts at its share of the recording's length, so the colour follows the voice; the line and actions appear after the last word. It runs only the first time a path's first-verse lesson is finished.
21. **Test hooks.** Drill elements carry their answer as data attributes (`data-right`, `data-end-unit`, `data-target-phrase`, `data-order`) so browser tests can answer deterministically. Nothing is scored, so exposing them costs nothing.
22. **After the adversarial review (2026-10-23).** A card moves up at most one box per lesson or review run (a miss still drops it), so one session cannot carry a new card to the 35-day box. A missed item comes back at most twice in a run; after that its card carries it into review. A lesson whose examples cannot be played shows "The recording did not load. Try again." with a button and is never marked done. The celebration's line and actions appear when the recording stops however it stops, within twenty seconds at most, and Escape leaves it. "Find three more." counts down to what the reading holds ("Find two more."). The review's loading line is "Loading the review…".

23. **Slice 3, the table.** Migration 0037 (renumbered by whoever merges second, with 1.4 PR 2) adds `course_progress`: one `learn-progress/v1` document per member, keyed by tenant and membership, on 0036's model exactly. One forced `owner_only` policy reads the tenant and a transaction-local `app.course_owner` (its own setting, not the saved layer's), set only in src/server/course-progress/access.ts after the session and grant checks. The runtime has SELECT, INSERT and UPDATE of progress, version and updated_at; no DELETE, no TRUNCATE. The database checks the document's outline and size; the server checks the whole document with the browser's own parser. No audit rows. Staff, Daniel, MCP, cron and the Sheet never set the owner and see nothing.
24. **Slice 3, who.** Any membership with a live grant (student, parent, tutor or admin) keeps course progress, unlike the saved layer, which leaves students out: the known-date cap is for students. A practice-context (parent acting for a child) request is refused, as in the saved layer; a parent signed in keeps their own progress.
25. **Slice 3, the routes.** `GET /api/learn/progress` (401 signed out, 403 without a live grant), `POST /api/learn/progress/put` (replace under the version last seen; a stale version is a 409 carrying the current one) and `POST /api/learn/progress/merge` (the first-sign-in rule; with no stored document the browser's is taken). All private, no-store, exact Origin, bounded body. Each answer carries an opaque owner name (a hash of tenant and membership) so the browser knows whose copy it holds.
26. **Slice 3, the browser.** One sync per page. With no record of an account, the browser's progress is merged into the account's and only the server's answer replaces it. With this account's record, a change is written back after about a second under the version last seen (a conflict merges); a newer account copy is taken when nothing local is unsent, merged when something is. A browser holding another account's progress (a shared device) takes this account's copy and never folds the other's in; unsent changes of the other account in that browser are dropped. The home's "Progress is saved on this device" line hides once synced.
27. **Slice 3, the known date.** For a member whose live student grant names a student, the answer carries that student's ceremony date, to them only. Before it, no review gap exceeds a fifth of the days left (at least one day), so reviews close in on the date and the last lands in its final 10 to 20 percent; on and after the date the normal gaps resume.

28. **Slice 3, after its adversarial review (2026-10-23).** The stored copy is the working copy: every change starts from it, and another tab's save shows at once. A change made while a sync request is out is merged into the answer and sent next, never overwritten. A conflict between devices merges, so a miss on one device can be cancelled by the other's higher box; that is accepted. After a clean sync, a sign-out (or a lost grant) clears the device, since the account holds everything; unsent changes stay for that account. Before a known date, review treats every card as due no later than the day before it, whenever it was scheduled; together with the gap cap this means daily reviews in the last days. A lesson or card id the course no longer knows is dropped when a document is read, never fatal, so a later course edit cannot strand a stored document. The last write leaves with `keepalive`.

29. **Ruling, Daniel 2026-10-23 (verbatim):** "In learns, tapping a word should give you a definition, shoresh, etc card, not play trope."
30. **The word card is /read's.** Learn shows the same WordCard that word tools on /read show (extracted from word-tools.tsx), over the same createWordToolsSelection and the same ref-keyed public routes, `/api/public/word-aids` and `/api/public/word-details`. There is no second card and no new route. The card leaves out Previous word, Next word and Hear this word: it is for the word tapped, and a tapped word never plays.
31. **Which ref the card asks.** A course verse is asked by its own single-verse ref (verse 0 of 1), because its lesson batch's grouping is a loading detail. A verse of this week's reading is asked by the week's passage ref and its place in it, as /read asks, so "This word elsewhere" covers the reading. A one-verse card leaves "This word elsewhere" out, since it would only search one verse.
32. **Where a tap goes.** Reading Hebrew becomes card targets: lesson examples, Hear it, the first verse, every revealed answer, review answers, This week's rows and the Finder once it is done. While a question is open, a tap that is the answer stays the answer and plays nothing: tap where the phrase ends, tap the phrase you heard, and the Finder while finding. Once answered, every word becomes a card target. The celebration sheet stays plain. The feedback lines are unchanged. After a miss in "Hear a phrase, then tap it", its Hear it tile plays the phrase and then the one tapped, so "Here is X for comparison." stays true without a word tap playing anything.
33. **Maqaf units.** A maqaf unit is one target with one tab stop. A pointer tap opens the card on the maqaf word under it; a key press, or parts that do not line up with the reading words, open on the unit's first word. The card heading always shows the whole unit, with the word shown marked in marigold.
34. **Presentation.** Up to 640px the card is a bottom sheet over a scrim. From 641px it is a panel under the word, or above it when there is more room there, kept inside 16px gutters, and it scrolls with the page. Escape, the Close button or a tap outside closes it, and focus goes back to the word. Tabbing out of it closes it and leaves focus where it went. It is flat, on the white surface with hairlines (DESIGN.md: no shadows). The sheet rises 2.5rem on the settle ease, and there is no motion under reduced motion. The card has no new wording: Close and every card label are existing strings.

## Slice 1: data, cut, pools, home, shell, first three drills (`claude/learn-to-lein`)

1. **`src/lib/learn/course.ts`**: parse and validate lessons.json at module load. Tests:
   - the schema id;
   - every lesson is in exactly one unit;
   - prerequisites exist and are acyclic, and `haftarah-sof-pasuk` requires the two Torah endings;
   - families are the eleven ids in `chart-catalog.ts`, plus `sof-haftarah` as a context;
   - activity types are known, and params are within ACTIVITIES.md's ranges;
   - every string has no `!`, emoji or banned phrase ("awesome", "great job", "keep it up", "streak", "badge", "level up", "you got this");
   - bodies are at most about 120 words.
2. **`src/lib/learn/phrase-audio.ts`**: the one cut function, `phraseClip({ ref, kind, words: [first, last] })`.
   - It resolves the verse's short reference through the ref route, downloads it with `downloadShortReferenceAudio` (complete bytes, SHA-256 checked), decodes it, maps engine words to frames through the existing timeline (maqaf-joined units handled as the Lein player does), and returns `shortWordWav` with the 5 ms fades.
   - Reuse the study short-main playback helpers rather than copying them. One clip cache per verse per page.
   - Test with a synthetic maqaf verse (the shape of Genesis 1:2, `words` [4,6]), and confirm that the frames are the three units' span.
3. **`src/lib/learn/pools.ts`** (pure): `buildPools(verses)` returns family → melody → phrases.
   - Each phrase: `{ ref, kind, words, family, tropes }`.
   - Rules (ACTIVITIES.md's last section):
     - 1 to 5 words;
     - exclude the special-melody passages;
     - sof pasuk excludes a verse that ends an aliyah recording or a haftarah;
     - sof-haftarah takes only the last verse of a haftarah;
     - munach legarmeh counts as revia.
   - Also `drillItems(activity, pools, learned, rng)`, which applies:
     - the distractor weighting (2 to 1 toward confusable neighbours, from `families[].confusedWith`);
     - never two items in a row from one verse;
     - spread across books;
     - verses of 5 to 12 words for the tap and end drills.
   - The rng is seeded, so tests are deterministic.
4. **`src/lib/learn/progress.ts`** (pure core plus a storage adapter), covering:
   - the scheduler;
   - a lesson's done state (listening screens seen, and every drill run done, meaning each item answered right once);
   - "heard" counts;
   - the next lesson;
   - the due count, with minutes at about 10 s an item;
   - the review-run composer: 8 to 12 items, confusable families back to back, never the same verse twice in a row.
   
   Test against fixed clocks.
5. **UI**, under `src/app/learn/` and `src/components/learn/`, in DESIGN.md's Song session world (COURSE.md's sketches are structure only):
   - the course home: intro, the next-step card, the review line, the two paths, "Can hear", the signed-out note;
   - the lesson shell: close, title, segment rail, "Hear it", "In verses", drills, Done;
   - the family chip (name, colour, contour mark);
   - hear-and-name, same-or-different and where-does-it-end.
   
   Drill behaviour:
   - Feedback follows COPY.md exactly. On a wrong answer, play the right phrase, then the chosen family's phrase, and re-ask the item three to five items later.
   - A run may stop early after eight right in a row with no miss.
   - Touch targets are 56 px. The Hebrew is always the largest text on the screen. RTL is handled.
6. **The front-door card:** title "Learn to lein", line "Hear the phrases, then lein a verse of this week's reading." It links to `/learn`.
7. **E2E** (Playwright, synthetic fixtures through the isolated public server, as `/read`'s tests do):
   - home, then a lesson, then a hear-and-name item answered wrong then right, then the lesson done;
   - progress surviving a reload;
   - a corrupt localStorage value meaning a fresh start;
   - a 360 px layout with no horizontal scroll.

## Slice 2: the rest of v1 (same branch or `claude/learn-to-lein-2`)

1. **Tap-the-phrase.** Tap targets are whole phrases over the wrapped RTL verse, with the play tile above it.
2. **Build-the-phrase.**
   - Mark tiles use `accentSample` from `chart-catalog.ts`, plus `extraMarks` decoys.
   - Each placed mark plays its word from the recording. A wrong tile shakes once and returns to the tray.
   - Under reduced motion there is no shake; an outline shows the miss instead.
3. **This-week:**
   - It uses `thisShabbat()`, then `/api/public/reading?date=`, then the text and short pages.
   - It shows rows of the family in colour, each with play, then "Find three more." in the small reader, then "3 of 3 found."
   - Special cases, all per COPY.md:
     - a text-only haftarah;
     - no reading this week, which shows the coming Shabbat;
     - no word-ready verse, which falls back to the course's own verses.
4. **Review** at `/learn/review`.
   - Before any lesson is done it says "Nothing to review yet. Finish a lesson and its phrases come back here."
   - At the end: "Done. These come back on Thursday." The day is computed; if it is more than a week away, the line says "These come back next week."
5. **First-verse:**
   - It picks the shortest word-ready verse of this week's reading, preferring one that uses only common families, with "Choose a different verse".
   - The steps are: Hear each phrase, Hear the verse, Chant along slowly (0.75), Chant along (1).
6. **The celebration moment, exactly as COURSE.md describes it.**
   - It uses the lake sheet and the lifted size.
   - The phrase colours wipe in word by word with the existing ink pull as the recording plays once.
   - The line "You can lein this verse." follows, then the reference, "Open in Lein" and "Back to the path".
   - Nothing moves after that. Under reduced motion the colours appear at once.
   - It happens once per path.
7. **The deep link into `/read`** with the verse selected.
8. **About and offline copy** per COPY.md. The offline line ships with A1, not here.
9. **Then:** an impeccable finish review on screenshots at 360 px and desktop, light and dark, fixed in one batch.

## Slice 3: signed-in progress (after 1.4 PR 1 merges)

- A `course_progress` table keyed by user and tenant, owner-only under RLS, on the saved layer's model. Neither staff nor Daniel can read it, the same rule as members' notes.
- Bounded JSON validated by the same `learn-progress/v1` parser, server-side.
- Copy on first sign-in: if the account has no progress, it takes the browser's. If both exist, merge them:
  - lessons: the union, with the earliest `done`;
  - cards: the higher box, with its due date.
  
  Then clear nothing in the browser until the server confirms.
- A known date: for a signed-in Beit Mitzvah student with an assigned date, cap the gaps so that the last review lands in the final 10 to 20 percent of the time left.
- Gate: an adversarial review of auth, tenant isolation and progress privacy before merge. The production migration uses a guarded operator, and a STATE GATE line is written.

## Checks (off-repo, before trusting any example)

The script lives in the scratchpad or under `C:/private/learn-to-lein-checks/`, never in a working tree. It asserts `insideGitWorkingTree()` is false before any write.

1. For every example, fetch the live MAM verse from Sefaria with the app's own normalization. Run `colorStudyVerse` and assert:
   - `words` is exactly one phrase of the lesson's family;
   - `firstWord` and `lastWord` match the units;
   - whole-verse examples span the verse.
2. Low-alignment examples:
   - Numbers 6:24 (used twice) and Exodus 3:14.
   - Compare the replacements Cowork named (Numbers 6:26 [4,6]; Genesis 27:22 [5,5]) on the private index's alignment score and the range check.
   - Swap where the replacement is better, rewriting `why` within the tone rules.
   - Whatever stays goes into Daniel's listening round.
3. Maqaf mapping: Genesis 1:2 `words` [4,6] is index words [4,7].
4. Every example is a member of its family's pool, built over the examples' own verses. If one is not, the pool rule is wrong, not the example.
5. This week: a text-only haftarah degrades per COPY.md, and doesn't error.

## Daniel's listening round (at most 15 minutes, after slice 1 deploys)

One example per lesson (24 clips), plus whatever low-alignment examples remain. The lines are editable and live. For each, ask: does the cut clip a word, and does the "listen for" line match what the reader sings?

## Open items that wait on Daniel

None. Wording for the offline line waits for A1's popup.
