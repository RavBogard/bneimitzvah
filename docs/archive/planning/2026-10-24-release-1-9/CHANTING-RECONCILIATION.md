# Chanting curriculum reconciliation (1.9 lane 3)

24 October 2026. This reconciles Astra's curriculum package with this plan and the Learn source on main `02d8af2`. The package is in `docs/planning/2026-10-24-chanting-program-review/`, which is Astra's and read-only from this stream. Lane 3 follows it. Application code and release plans stay with this stream. The parked highlighting draft and `trope/` are untouched.

## 1. The current opening

A learner with no progress opens /learn. The Next card is "How a verse is built" (`nextLesson`, progress.ts:108; home.tsx:58–62), and it is the only lesson the path links (home.tsx:27–29). `/learn/intro-phrases` runs six steps (lesson.tsx:18–21):

1. **Hear it:** Gen 1:1 whole (lessons.json:538), with the etnachta and sof pasuk chips. Next works without pressing play (lesson.tsx:102).
2. **In verses:** whole-verse tiles for Gen 1:1, Num 24:5, Deut 6:4 and Ex 25:8 (L537–641). Neither half can be played alone.
3. **Same or different, 4 items** (L645: sof pasuk against etnachta, two different recordings, pools.ts:168).
4. **Where does it end, 4 items** (L655, etnachta, with audio).
5. **Which half, 4 items** (L666: all ten families, eight of them not yet taught; always runs, course.ts:55).
6. **Done.**

The first question a new learner meets is therefore a cross-recording same/different, and neither sound has been played as a phrase before it. No lesson before `torah-first-verse` has an echo or chant step; the course's only production is that lesson's two "Chant along" steps (first-verse.tsx:13).

| # | Where | Item | Problem |
|---|---|---|---|
| 1 | intro-phrases L645 | Same/different, sof pasuk vs etnachta | Neither has been heard as a phrase. Two recordings. |
| 2 | intro-phrases L655 | End, etnachta | Heard only inside whole verses. |
| 3 | intro-phrases L666 | Which half, ten families | Eight are taught only in lessons 4–11. |
| 4 | torah-sof-pasuk L801 | Same/different | Etnachta's own lesson comes next (L846). |
| 5 | torah-sof-pasuk L811 | Name, 2 choices | The same, and etnachta can be the answer. |
| 6 | torah-etnachta L956 | Same/different | Both are modelled by now; it is the opening's third cross-recording same/different. |
| 7 | haftarah-sof-pasuk L2515 | Same/different, "Torah or haftarah" | The haftarah path's first question compares two melodies and two recordings. |
| 8 | haftarah-sof-pasuk L2529 | Name (haftarah) | Haftarah etnachta is modelled only in the next lesson (L2555). |
| 9 | review.tsx:23 | Review's naming fallback | With one family done, the second choice is zakef (chart order, chart-catalog.ts:6), which is still untaught. |

From `torah-zakef` (L1001) on, every family a drill names belongs to that lesson or an earlier one on the same path (all 24 lessons checked). Review's own same/different (review.tsx:22) uses only finished families.

## 2. Fit, milestone by milestone

**P4.** F6 finding 10 (the locked path) is the structural half of "skip familiar material". The re-order is a curriculum ruling, so it stays out of P4, which is a defect patch. **Amendment:** fix finding 10 by linking every lesson, with no new string (Next still recommends; "Best after The two endings." is the precedent). P4 leaves `lessons.json` alone.

**N17.** It already delivers the learner's own verse, haftarah-first and the link back.
- **Conflicts:**
  - It is signed-in only.
  - Several shipped "this week's" lines become false for an own verse: first-verse.tsx:44, the goals at L2294 and L4040, and the summaries at L446, L482, L2293 and L4039.
  - "After unit 2" puts the first real phrase at lesson 7.
  - Haftarah-first makes rows 7–8 the haftarah opening.
- **Amendments:**
  - One reading source feeds both first-verse and the first-phrase step: the assigned range when signed in with an assignment, otherwise this week's verse.
  - Learn reads nothing from /read shared links, and those links are untouched.
  - The first-phrase step is a path row like Quick ten (home.tsx:35–40), not a lesson, so it adds no progress key. It comes after unit 1.
  - For an own verse, show "In your reading" (approved) in place of line 44, and leave the Done goal line off rather than show a false sentence.

**N18.** It already delivers:
- Your turn (LD-03), with the celebration after it;
- silent end drills from zakef on (L1466, L1808, L3137, L3440);
- harder box 3+ review items;
- the closing-mark underline;
- Hear it playing once on open;
- "Read it, then pick the tune".

Conflicts:
- "You can lein this verse." (first-verse.tsx:85) certifies; the curriculum describes the work instead.
- "Same as the reader" and "Not yet" are self-report.
- No-audio recognition must not become the opening.
- The validator pins the four first-verse steps (course.ts:370–371).
- The celebration wipe spreads the clip's length evenly across the words (first-verse.tsx:78–79).

Amendments:
- The celebration shows only after "Same as the reader". "Not yet" returns to the phrase step with no celebration.
- The answer is stored nowhere. It stays out of `learn-progress/v1` (strict three keys, progress.ts:41), moves no card and counts toward nothing. An exit test asserts this.
- Your turn may also appear per phrase, with the same approved lines.
- No new step uses the even-split wipe; the parked highlighting work owns word timing.
- **Files:** first-verse.tsx, lesson.tsx, drills.tsx, review.tsx, lib/learn/course.ts, and lessons.json at L2383 and L4135 plus the four end drills.

**N19.** It already delivers:
- delayed production through own-verse cards;
- the Run-through;
- a fade that never locks;
- LD-09.

Conflicts:
- Cards are keyed by family, melody and skill (progress.ts:13, 25, 55–56), so verse cards need a new document.
- It has no joins and no next passage.
- LD-09's "matched the reader" is self-judgment, which is acceptable only while no screen implies the app checked it.

Amendments:
- Verse cards go in a separate owner-only document, leaving every stored v1 document and the strict server parser untouched.
- The Run-through's stumble result offers the verse with its neighbour as a join exercise. Only the structure is built; its wording is a gap.
- "Prepare another passage" moves to N19a.

**SC3 and SC7.**
- The reading-Hebrew strand is service-course only. It is not a chanting gate, since basic decoding is assumed, and the Torah path does not link to it.
- N17a touches nothing under `learn/service/*` or `lib/service-course/*`.
- Prayer melody audio stays in 2.1. The approved teachings are unchanged.

## 3. New milestones

### N17a. Opening re-order: sounds before recognition, no same/different in the opening (S, Sonnet), lane 3

Lane 3 becomes P4 → **N17a** → SC3 → N17 → N18 → N19 → SC7 → SC6, with N19a once its content is approved. N17a depends on P4, because they share lesson.tsx, review.tsx and drills.tsx.

1. In `intro-phrases`, remove all three drills (L644–687). The lesson becomes Hear it, In verses, Done, with its goal unchanged.
2. In `course.ts:173`, allow an orientation lesson (no family, no first-verse step) to have zero activities. The 8–22 rule at :181 applies only to lessons with drills.
3. In lesson.tsx (HearIt, InVerses, Legend at :81–83), add a play control beside each phrase chip of a whole-verse example. It plays `phrase.words` cut from the same human recording; the split is already checked against the engine (verse.ts:95–97).
4. In `torah-sof-pasuk`, remove the same/different (L800–809), leaving 6 + 2 = 8 items.
5. In `torah-etnachta`, remove the same/different (L955–964), leaving 10 items.
6. In `review.tsx:23`, with one family done, take the second choice from that family's `confusedWith` list, only if the learner has finished its lesson or heard it as a phrase in a finished orientation lesson. Otherwise skip the slot.
7. Add `tests/app/learn-taught-first.test.ts`. Walking the path in order, every family a recognition drill names must be one of:
   - the lesson's own family;
   - an earlier lesson's family in the same melody;
   - a phrase of a whole-verse example in an earlier or the same orientation lesson.

   The test also asserts no same/different in Torah lessons 1–3, with one named exception, `haftarah-sof-pasuk` (open item 2).
8. Update `tests/app/learn-activities-16.test.ts:20,39` and `e2e/learn.spec.ts`.

Not in N17a: no lesson added, removed or renamed; no prerequisite change; no schema change; no highlighting work. Its only wording is the accessible name "Hear {family}", modelled on "Hear {ref}" (lesson.tsx:118).

**Exit tests:**
- A new learner gets a three-step rail, and each half's control plays a cut.
- Across 20 seeded runs of lessons 1–3, "Same tune or different?" never appears.
- `learn-taught-first` passes.
- `lessonCards(id)` for all 24 lessons matches a snapshot of main.
- `nextLesson` is unchanged for these fixture documents: empty, intro done, all done, and every Torah prefix.
- `coursePassages` is unchanged for both melodies, so the offline pack is unchanged.
- A v1 document with every lesson and card opens unchanged in the browser and on the server.

**Progress compatibility:**
- Progress is keyed by lesson id (progress.ts:15, 51) and by `family:melody:skill` cards; steps are never stored.
- `parseProgress` drops unknown lesson ids, but rejects a document listing more lessons than the course has (progress.ts:46), and the server answers 400 (validation.ts:13–15). So no lesson may be removed or renamed without an alias, now or later.
- `intro-phrases` keeps its id. Learners who completed the old version did more, not less.
- The card set is unchanged, because same/different maps to the "name" skill (course.ts:52–53).

### N19a. Worked first verse (M, Sonnet), waits on Daniel's content review, not in the v1.9.0 gate

It waits on Daniel for:
- the starter verse and a prepared alternative;
- parts A/B and the join ranges;
- the musical attention cues;
- listening to the actual clips;
- a haftarah orientation verse;
- the new strings in §5.

Nothing is built before he picks. The build is course-verse settings in `lessons.json` (parts and joins as unit ranges) and new steps on the first-verse frame (§4).

**Rejected:**
- Folding the re-order into P4. It would mix a ruling into a defect tag.
- Renaming intro-phrases or adding a new intro lesson. Progress is keyed by lesson id.
- Moving lesson 2's naming drill to lesson 3.
- A starting-choice screen or stored entry profile. It needs new wording and a schema change; linking every lesson gives the skip with nothing stored.
- Splitting the Learn hot-file group.

**Shortlist for Daniel (Claude, 2026-10-24).** All four verses are course examples served word-timed today (`course-data.ts:62,73`) and are absent from the uncovered lists in `docs/superpowers/research/2026-10-22-reference-audio-coverage.md`. No clip has been listened to. Ranges are zero-based word units, as in `lessons.json`.

| Verse | Role | Units | Marks | Parts A / B | Joins | Marks not yet taught |
|---|---|---|---|---|---|---|
| Gen 1:1 (:539) | Starter (recommended) | 7 | tipcha, munach, etnachta, mercha, tipcha, mercha, silluq | 0–2 / 3–6 | 1–4 or 2–4 | none |
| Ex 25:8 (:617) | Prepared alternative | 5 | mercha, tipcha, etnachta, tipcha, silluq | 0–2 / 3–4 | 1–3 or 2–3 | none |
| Num 24:5 (:565) | Third | 5 (unit 0 is the maqaf chain) | mercha, tipcha, etnachta, tipcha, silluq | 0–2 / 3–4 | 1–3 or 2–3 | none |
| Isaiah 40:1 (:2424) | Haftarah orientation | 5 | mercha, tipcha, etnachta, tipcha, silluq | 0–2 / 3–4 | 1–3 or 2–3 | n/a |

- Gen 1:1 is the best known and has a real join inside B, but it is the most-drilled verse and the longest.
- Ex 25:8 is the shortest and least worn, but its B is two words, so the join is nearly trivial.
- Num 24:5's service tune may pull the ear away from the Torah melody.
- Num 6:26 is dropped because it brings kadma, mahpach, pashta and zakef katan (unit 2) and a paseq before they are taught. Deut 6:4 is out for a similar reason: it has a paseq and mercha legarmeh, and the Shema tune bleeds in.
- Daniel still listens to the exact cuts (boundary-v2), picks, and writes the cues.

## 4. The worked first reading on existing components

| Step | Exists | New | Assets |
|---|---|---|---|
| 1 Hear the whole verse | The "whole" step (first-verse.tsx:52), currently after the phrases | Order, prompt | Following word by word needs per-word player state (player.ts:9 publishes only seconds and part); this is the parked highlighting work, out of scope |
| 2 Comfortable words | The word card from any word (bits.tsx:53; services.tsx:26) | Prompt | None |
| 3 Hear and echo | Step 0 plays each engine phrase (first-verse.tsx:36, 50–52); replay; 0.75 speed | Echo prompt | A shorter segment needs boundaries Daniel has checked |
| 4 Attempt, compare | N18's Your turn, also per phrase | "Uncertain?" and three routes (a new step type) | None |
| 5 The ending's mark | The family chip (:51); `Marks` (lesson.tsx:74–80); `verse.units[].trope` | Route string | None |
| 6 Next part | Step 0 moves phrase by phrase | A control to replay A | None |
| 7 The join | No | New step type | Within one word-timed verse, any word range can be cut from the real timeline (phrase-audio.ts:58–60, 87–101); the bridge width is a content choice. Across verses the player puts 450 ms between clips (player.ts:11, 48), so verse-to-verse joins aren't faithful |
| 8 Whole verse alone | N18's whole-verse Your turn | A repair menu | "Practise the join" depends on step 7 |
| 9 Next step | Celebration sheet: "Open in Lein", "Back to the path" (first-verse.tsx:64–91) | The closing line (open item 1) | None |

The engine splits phrases at every pausing mark (verse.ts:74–79). No field holds hand-picked parts or joins, and `phrases` exists only on whole-verse examples and must match the engine (course.ts:158–168). An own verse under N17 gets engine phrases only. A verse whose recording has no word timing is never offered (first-verse.ts:8), so no timing is invented.

## 5. Strings

**Already approved, and enough for N17a, N18 and N19:**
- LD-03: "Your turn", "Chant it without the recording. Then hear the reader.", "Same as the reader", "Not yet".
- N17: "In your reading", "Back to my reading", "First phrase of your verse".
- N18: "Read it, then pick the tune", "Sing it (in your head or out loud), then check.", "Same", "Not quite".
- N19: "Run-through", "Practise verses 3 and 8 again.", "Help: Colors → Marks only → Tikkun".
- Shipped Learn lines.

**Astra's lines, all new and waiting for Daniel with N19a's content.** The house spelling for the verb is "Practise". Lines 6 and 11 overlap LD-03, so use LD-03 for those.
1. "You'll learn this verse in short parts, then try it without the recording."
2. "Listen once and follow the words."
3. "Read these words aloud. Open any word you want help with."
4. "Listen to this phrase. When it stops, chant it back."
5. "Use a comfortable voice. Follow the tune and the words."
6. "Try it without the recording. Then replay it and follow the words." (overlaps LD-03)
7. "Were any words uncertain?", with "Work on a word", "Listen again" and "Continue".
8. "Listen to the ending. Try the ending, then the whole phrase."
9. "See the mark for this ending"
10. "Now connect the two parts. Listen across the join, then try it."
11. "Chant the whole verse without the recording. Then listen and choose what to work on." (overlaps LD-03)
12. "Practise a part", "Practise the join", "Try the whole verse again" and "Return later".
13. "You've practised preparing a verse: learn the parts, connect them, try without the recording, and return to anything uncertain."
14. The four starting-choice options, not yet drafted as final copy.

**Gaps:**
- The Done goal for an own verse.
- A signed-out label for the first-phrase row.
- The Run-through's offer to practise a join.

**Retired or changed:**
- "Tap the word where the verse rests." (L662) is retired by N17a; this was its only use.
- "Same tune or different?" stays in later lessons and in review.
- "One verse from this week's reading." becomes "In your reading" for an own verse.
- The public-case goals and summaries stay.

## 6. Open items for Daniel

1. **The first-verse ending.** Recommended: keep "You can lein this verse.", shown only after "Same as the reader". Astra's line 13 is the alternative.
2. **The haftarah opening (rows 7–8).** Left as it is until a haftarah orientation verse is chosen (N19a). Haftarah-first ships with N17.
3. **N17a's per-half models before Daniel listens.** Recommended: ship them. They are cuts of verses learners already hear in today's drills; Daniel listens on the preview, and anything he rejects comes out.
4. **A starting-choice screen, or "mark done without doing".** Neither in 1.9. Linking every lesson (P4) is the skip.
5. **The first-phrase row.** After the two endings, and also for signed-out visitors (its label is a gap).
6. **N19a content selection.** Claude shortlists three word-timed course verses (e.g. Gen 1:1, Ex 25:8, Num 6:26) with their engine splits and candidate joins; Daniel listens, picks and writes the cues.

## Decided here

- Lane 3 order as above.
- F6 finding 10 is fixed by linking every lesson.
- The intro's which-half step (1.6) is removed under Daniel's 2026-10-24 direction to teach sounds before recognition.
- The first-phrase step is a path row, not a lesson.
- N19 keeps verse cards in a separate document.
- Open items 2 and 4 follow the recommendations, since neither needs new wording. Items 1, 3, 5 and 6 and the "Hear {family}" label go to Daniel.

## Daniel's answers (popups, 2026-10-24)

1. First-verse ending: **"Keep ours, gated (Recommended)"**. "You can lein this verse." shows only after the learner taps "Same as the reader". "Not yet" returns to phrase practice with no celebration.
2. N17a's per-half clips: **"Ship, I'll listen after (Recommended)"**. They go live with the re-order. Daniel listens on the site, and any cut he rejects comes out.
3. The first-phrase row: **"After the endings, for everyone (Recommended)"**. It sits after the two endings. Signed-out visitors get this week's first phrase, and students get their own. Its signed-out label is drafted for Daniel's later approval; until then the row shows only to signed-in students.
4. N19a content: **"Claude shortlists, you pick (Recommended)"**. Claude proposes three word-timed verses with their engine splits and candidate joins. Daniel listens, picks one and writes the cues. Nothing is built before that.

The accessible name "Hear {family}" follows the approved "Hear {ref}" pattern and ships with N17a.
