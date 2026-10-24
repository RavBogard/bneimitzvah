# 2.0 build plan (CRC Torah)

2026-10-24. Track G of `COWORK-HANDOFF-2.0.md`. Assembles A–F into milestones Claude Code builds. No code, no dates: each milestone gives its cost (S, M, L) and shape, never a schedule (Daniel's rule). Designs: `A4-COURSE-DESIGN.md`, `A6-TEXT-LICENSING.md`, `D-NOTIFICATIONS.md`, `F-SITE-REVIEW.md`. Rulings: `QUESTIONS-2.0.md` (binding, quoted below). Hand-back per track: `HANDOFF-TO-CLAUDE-CODE.md` in this folder. App paths are relative to `C:/Users/dsbog/bneimitzvah-study/` (read at `cfba020`; M3b, M4, M6 and v1.8.0 are not in that checkout). **[Inferred]** marks anything not ruled or read in code.

**Summary (after the D'var cut): 14 milestones: G0, F1–F6 (6), SC1–SC7 (7). Sizes: 4 S (G0, F2, F3, F6), 6 M (F1, F4, F5, SC3, SC5, SC6), 4 L (SC1, SC2, SC4, SC7). Before the cut: 17 milestones (5 S, 8 M, 4 L). Three migrations (0043–0045). Three lanes.**

**Cut 2026-10-24:** Daniel: "No dvar Torah guide.. that all happens with the rabbi not in the app. Cut all related pieces. The app is just for study". D'var Torah is out of the app entirely: no guide, stages, doc link, tracking or notices. Track B is cut; milestones DV1, DV2, DV3 and the D'var migration (0046) are removed. [Inferred] Track E family logistics also stay out of the app.

## Settled decisions (Daniel, binding, 2026-10-24)

- **The service course is open.** Batch 1 Q2: "open". Licensed Beit Mitzvah text is never shown, stored or cached by the app; the course reaches it only through "Open in the siddur, page {page}".
- **Shabbat morning first, then Saturday evening with Havdalah.** Batch 1 Q3: "Go".
- **Teaching is drafted in Daniel's voice and approved by him.** "I want you to get my understanding and then draft each one for my approval…" and "Always a humanistic approach that leaves room for more theistic people to still resonate." All 49 are approved: 38 Shabbat morning (`A3-DRAFTS/01-…` to `23-38-…`) and 11 evening/Havdalah with edits to reused texts (`A3-DRAFTS/evening-33-63.md`, "Approve all").
- **Credit on approved teachings:** Batch 2 Q9, "Rabbi Daniel Bogard". His name alone. This overrides MISSION's generated-text label for approved teachings only; anything not yet approved still carries "Written by Claude for CRC · not yet reviewed by Rabbi Daniel Bogard".
- **No melody link and no audio in 2.0.** Batch 2 Q6: "No link yet. You should give me a list of things to record", then "I'll handle the readings here as a part of two point one". The "Hear it" step is out of 2.0.
- **A short reading-fluency strand.** Batch 2 Q7: "Yes, a short strand (Recommended)".
- **Transliteration on request.** Batch 2 Q8: "On request (Recommended)".
- **Tutors see a per-part finished mark.** Batch 3 Q12: "Per-part 'finished' mark".
- **Key-word glosses:** Batch 3 Q13: "Claude drafts, live (Recommended)".
- **No notifications at 2.0.** Batch 3 Q11: "None yet".
- **Path = the tutor's service plan.** Batch 3b Q16: "Tutor's service plan (Recommended)". Falls back to the six default parts when there is no plan.
- **Approved teachings may live in the public app repo.** Batch 3b Q17: "Yes, public is fine (Recommended)".
- **Parents do not see the per-part finished mark.** Batch 3b Q18: "No (Recommended)". Tutors and rabbis only.
- **Text source for the course.** Decided by Cowork as a build detail (QUESTIONS-2.0.md, Batch 3b note): a public build of the Shabbat Morning volume (the public mirror's feed or a public-lane build), pinned by hash, never the licensed build. Daniel approved showing that book's text (Batch 1 Q2, "open").
- **Beta is Daniel's word.** Batch 1 Q5: "beta when I say so". Nothing in 2.0 waits on or turns on the beta label or indexing.

## Where a design file conflicts with a later ruling (the ruling wins)

| File and place | What it says | Ruling that replaces it |
|---|---|---|
| Brief §2 "Daniel's teaching"; RM2 Q19–Q20 | Claude does not write teaching; gaps stay gaps | Teaching ruling, 2026-10-24 (above). All 49 approved; there are no gaps to ship around |
| STATUS.md "For Claude Code" bullet | "[Inferred: whether approved teaching carries any credit line is Daniel's call]" | Batch 2 Q9: "Rabbi Daniel Bogard" |
| REVIEW ruling 51 | Prayer audio links out to CRC Music | Batch 2 Q6: no link in 2.0; Daniel records in 2.1 |
| REVIEW ruling 45 | "nothing finer than days-practiced is reported to anyone else" | Batch 3 Q12 widens it for the service course only: a per-part finished mark |
| A4 §1 last sentence | "A tutor sees the days a student practised, and nothing finer unless Daniel chooses otherwise" | Batch 3 Q12 (A4 §9 already carries the ruling; §1 is stale) |
| D-NOTIFICATIONS §0 and §8 | Switch on one tutor notice at 2.0 | Batch 3 Q11: "None yet" (the file's header already says so) |
| MISSION L36, L52; STATE L3; SPEC L298, L306; RM2 L28 | v1.5.0 is the beta tag; 2.0 is "out of beta" | STATE L30 and Batch 1 Q5. MISSION was never amended (G0 fixes the docs) |
| Brief Batch 3 Q13 "pilot kit, approved or edited" | — | Never asked; Batch 3 Q13 became the glosses question. The pilot kit has no approval on record (open) |

## Decided here

1. **One plan, three lanes.** Service course, 2.0 fixes, docs. Notifications and family logistics contribute no build.
2. **The fixes lane starts first with F1** (rate limit), because the course's Read step adds public text calls to the same limiter that F-SITE-REVIEW finding 1 shows tripping in ordinary browsing.
3. **The personal path rides with the signed-in sync (SC4), not with the finished mark,** as A4 slice 4 had it. The finished mark is its own slice (SC5) so its adversarial review is not diluted.
4. **Teachings enter the repo verbatim** in `src/lib/service-course/tenants/crc.json`, each with its approval date (A4 §5.2). They are Daniel's own text, not licensed text. **[Inferred]** The app repo is public (C3), so this publishes them; see open questions.
5. **Model per milestone:** Opus for every adversarial slice and its review; Sonnet for the rest, as the 1.8 plan did.

## Migrations (proposed numbers, all [Inferred — check latest])

The newest migration read is `0042_curated_discussions.sql`. M3b, M4 and M6 may add migrations before 2.0 starts. Numbers are taken at merge; whoever merges second renumbers (house practice, learn-to-lein plan item 23).

| Proposed | File | Slice | Review |
|---|---|---|---|
| 0043 [Inferred — check latest] | `0043_service_course_progress.sql`: owner-only copy of 0037 (A4 §6.2 Migration A) | SC4 | Adversarial: privacy |
| 0044 [Inferred — check latest] | `0044_course_text_catalog.sql`: tenant-scoped public-lane store with a `volume` column and a public-lane check (A4 §6.2 Migration B) | SC2 | Adversarial: licensed text |
| 0045 [Inferred — check latest] | `0045_service_part_finished.sql`: staff-readable, insert-only, forced RLS (A4 §9) | SC5 | Adversarial: privacy |

No migration for practice days (0018 already takes a `service-unit` target) or for the path (it reads 0015 as is). No notification migration.

## Milestones in build order

Sizes: S is a day-sized slice for one builder, M a few, L a week-sized slice. [Inferred] These are relative cost, not calendar.

### G0. Docs catch up with the rulings (S, Sonnet, docs only)

- Amend MISSION and STATE: the beta lines (RULINGS-DIGEST §h item 1); the teaching ruling and credit rule; ruling 45 widened for the course; ruling 51 replaced for 2.0; the bad learn-to-lein spec path (§h item 12).
- Confirm the next free migration number on main and fix the table above in this plan's copy in the repo.
- **Exit test:** no repo doc still says v1.5.0 is the beta tag or that Claude may not write teaching; the migration numbers are confirmed against main.

### 2.0 fixes ("anything the beta teaches us", from F-SITE-REVIEW)

The five top items, plus the polish that is cheap while those files are open. New strings these fixes need are drafts for Batch 4.

**F1. Public routes and the rate limit (M, Sonnet, second-agent check).** F-SITE-REVIEW finding 1.
- `Cache-Control: public, s-maxage` on the public text, commentary and word routes, so repeat reads never reach the limiter; a shared address is not one user; Study fetches commentary per reading, not per chapter and work.
- A 429 gets its own message; "The recording did not load" stays for a real audio failure.
- Check by a second agent: no private, signed-in or no-store route gains a public cache header.
- **Exit test:** the walk in finding 1 (/read, Study, Vayera, /print, first lesson) runs twice in a row without a 429, and a forced 429 shows the rate message, not the recording one.

**F2. Dark mode (S, Sonnet).** Findings 2 and 4.
- **Exit test:** every trope-chart sample and every /read verse number and its focus ring measure at least 4.5:1 in the dark scheme.

**F3. A way to ask for an account (S, Sonnet).** Finding 3.
- **Exit test:** signed out, /, /sign-in and /account each show the route to the request form before sign-in.

**F4. Choose verses and print (M, Sonnet).** Findings 5 and 9.
- A second tap after one verse makes the range; the empty bar says how to choose; signed out, "Sign in to save" from the start; chosen verses and Torah/Haftarah carry into /print.
- **Exit test:** tapping 18:1 then 18:10 gives "Genesis 18:1–10", and /print from that selection prints those verses only.

**F5. The word card in Lein, and Hebrew for screen readers (M, Sonnet).** Findings 6, 7, 18, 24.
- Lein opens Learn's bottom-sheet word card; one tab stop for the words with arrow keys inside; each word's accessible name is the word, the action in `aria-describedby`; verse-numbered control names; 44 px verse-number targets.
- **Exit test:** at 390 px, tapping a word in Lein opens its card without scrolling; a screen reader reads the Hebrew word; keyboard focus reaches the page controls in under ten tab presses.

**F6. Polish batch (S, Sonnet).** Findings 10, 11, 12, 14, 15, 17, 19, 20, 21, 22, 23, 25, 27.
- Includes the Learn path's locked state (the service course reuses that path list), the blessings links on every reading, the haftarah page label, trope-chart copy, word-card gloss cleanup, the live region for drill feedback, and Quick ten's tab title.
- **Exit test:** each listed finding re-walked and closed or recorded as left, with its reason.

Left for Daniel, not built: finding 8 (holiday readings are the traditional two-day list) waits on which readings CRC uses (ROADMAP Q13, a 2.5 question); finding 16 (Rashi's old English) is a source choice.

### The service course

**SC1. Course skeleton, signed out, morning (L, Sonnet).** A4 §2, §3.2, §5, §11, §12, §13, §14 W1, W4, W5, W9; slice 1 of A4 §15.
- `src/lib/service-course/course.json` (U0–U6), `tenants/crc.json` with the 37 morning lessons' approved teachings verbatim (38 approved; 28 V'zot HaTorah is not in the BM book), the validator with every rule in A4 §5.3, including "no Hebrew outside the alphabet table".
- Home, lesson frame, About, Where, Done, moment lessons, the siddur link, browser progress.
- **Exit test:** every morning lesson opens at 360 px; a moment lesson is marked done; the tone scan passes over strings and teachings; the siddur link opens printed pages 10, 11, 22, 22, 23 and 24 for the six U1 lessons; a Hebrew prayer word added to `course.json` fails the build.

**SC2. Public prayer text (L, Opus, adversarial: licensed text).** A4 §5.4 (feed fork), §6.2 Migration B, §7, §8.2; A6 "Things Claude Code must check"; A8 (the Sh'ma end to end).
- Migration 0044, `src/server/service-course/public-feed.ts` (public volume, public lane, `tr` kept), `GET /api/public/service-text?unit=`, Read with the two toggles, Key words (glossary and `torahRef` cards), Check. About 150 glosses, Claude-drafted, live (Batch 3 Q13).
- **Unblocked:** text source is a public build of the Shabbat Morning volume pinned by hash, never the licensed build (A4 Q1, decided).
- **Exit test:** no response of the new route ever carries a `legacy-beit-mitzvah` unit or a licensed-lane block; the Mi Shebeirach public unit is refused (A2 discrepancy 13); the A8 Sh'ma lesson runs screen for screen as written.

**SC3. Reading Hebrew, Review and Quick ten (M, Sonnet).** A4 §4, §8.3, §8.4; W10–W12.
- f1–f4 need only SC1; f5–f6, Review of word cards and Quick ten need SC2.
- **Exit test:** the six fluency lessons run in order with no audio; Quick ten opens only after three prayers with a Read step or after f6; nothing on screen counts right answers.

**SC4. Signed-in sync and "Your parts" (L, Opus, adversarial: privacy and auth).** A4 §6.1–6.3, §8.1; W2, W3.
- Migration 0043 (owner-only), the progress routes and sync forked from Learn's with every shared-device and sign-out rule, the path route `GET /api/learn/service/path`, Your parts and its seven states.
- The path route drops each unit's `name` and `caption`, which come from the licensed feed (A4 §6.3 step 3).
- **Unblocked:** the path is the tutor's service plan (0015), with the six default parts when there is no plan (A4 Q3, decided; the Music list in 0025 is not used).
- **Exit test:** staff, Daniel, MCP, cron and the Sheet read no row of 0043; a shared device never folds another account's progress in; a signed-in student sees their assigned parts in service order with their own pages; no path response carries a licensed name or caption.

**SC5. Per-part finished mark (M, Opus, adversarial: privacy).** A4 §9; W13; A7 `tu.*` strings.
- Migration 0045; written only from the Done screen of one of the student's own assigned parts, as a side effect of sync; readers are the student, a parent in child practice, assigned tutors, rabbis and admins. Parents never read it (P1 decided: No).
- Depends on SC4.
- **Exit test (A4 §9):** no row across students or tenants; a tutor without an active `tutor_student` row reads nothing; a parent in parent view reads nothing; no route, MCP tool or export returns the rows to anyone else; a lesson outside the student's parts writes nothing.

**SC6. Offline (M, Sonnet).** A4 §10; W14.
- The `service-course` pack (public lane only), the shell pages, the offline states.
- Depends on SC2 (and SC4 for the path's last copy).
- **Exit test:** installed, with the network cut inside 14 days of the last open, a done lesson's Read, Key words and Check work; the siddur link reads "Needs a connection"; the licensed book is never requested.

**SC7. Saturday evening and Havdalah (L, Sonnet).** A4 §2 (U7, U8, evening reuse), A6 last bullet.
- The 11 new evening teachings and the edited reused ones from `A3-DRAFTS/evening-33-63.md`; evening pages per lesson; the slot picks the version (signed out: morning).
- Evening-only prayers have no public text. Until Daniel rules per prayer on the Sefaria fallback, they ship as About, Where and the siddur link only (A4 §2.1 note 2).
- **Exit test:** a Havdalah-slot student's parts link to pp. 33–63 and show the evening teaching; the morning lessons are unchanged for everyone else.

## Dependencies

```
G0 ─────────────────────────────────────────────(docs; any time, before SC2/SC4/SC5 merge)
F1 ──► SC2 (the course adds public-text calls to the same limiter)
F6 (locked path state) ──► SC1's path list
SC1 ──► SC2 ──► SC3 (f5–f6, Review, Quick ten) ──► SC6
SC1 ──► SC3 (f1–f4)
SC1 ──► SC4 ──► SC5
SC4 ──► SC6 (path's offline copy)
SC1, SC2 ──► SC7
```

Nothing is blocked on Daniel: SC2 and SC4 are unblocked (Batch 3b).

## What runs in parallel (3 builders)

| Lane | Order |
|---|---|
| 1. Fixes | F1, then F2–F6 in any order |
| 2. Course content | SC1, then SC2, SC3, SC7 |
| 3. Course accounts | after SC1: SC4, SC5, then SC6; G0 fits here first |

The three migrations land in two lanes; renumber on merge. Each adversarial slice gets its review from a second Opus agent before merge, as the 1.8 M2 and learn-to-lein slice 3 did.

## High-stakes slices: adversarial review

| Slice | Why | What the reviewer attacks |
|---|---|---|
| SC2, public text | Licensed text | Any path by which a `legacy-beit-mitzvah` or licensed-lane block reaches the new route, the pack or the repo; the mixed Mi Shebeirach unit; the build's Hebrew guard |
| SC4, signed-in course sync | Auth and privacy | Owner-only RLS on 0043; shared-device and sign-out rules; the path route leaking licensed names or another student's plan |
| SC5, per-part finished mark | Privacy (widens ruling 45) | Readers beyond the ruled set; cross-student and cross-tenant reads; writes for parts not assigned; parent view |

F1 gets a lighter second-agent check: public cache headers on public routes only.

## Explicitly out of 2.0

- **Melody audio and recordings: 2.1, Daniel handles them** (Batch 2 Q6). The `hear` step exists in the schema and is refused by the validator while `recordings` is false (A4 §5.3 rule 7). `A5-RECORDING-LIST.md` is Daniel's list.
- **Notifications: none** (Batch 3 Q11). `PORTAL_NOTIFICATIONS_ENABLED` stays unset; no congregation switch turns on. `D-NOTIFICATIONS.md` is the design for later.
- **The second congregation: 2.5.** Designed per tenant (A4 §12), nothing built for it.
- **Family logistics (Track E): outline done, nothing in the app** ("The app is just for study"; [Inferred]). No build.
- **Voice work, megillot, High Holy Day trope, blessings:** 2.5.
- **The beta label and indexing:** on Daniel's word only; no 2.0 slice touches `PUBLIC_INDEXING`.
- **D'var Torah: out of the app entirely** (Daniel, 2026-10-24: "No dvar Torah guide.. that all happens with the rabbi not in the app. Cut all related pieces. The app is just for study"). No guide, stages, doc link, tracking or notices.
- **A per-word morphology source for liturgy:** not proposed (A4 §7).

## Questions still open (one line each, recommendation first)

Decided 2026-10-24, Batch 3b (removed from this list): A4 Q1 (public build of the Shabbat Morning volume, pinned by hash), A4 Q3 (tutor's service plan, default six as fallback), A4 P1 (parents don't see the finished mark), and the public repo question (approved teachings may live in the public app repo). The D'var questions are removed with Track B.

7. **Batch 4 copy sign-off:** A7 and the F-fix strings, keep or edit, a section at a time.
8. **The pilot kit** (`C2-PILOT-KIT/`): keep or edit; the pilot starts on Daniel's word.
9. **Evening-only prayers' text** (SC7): rec, Sefaria liturgy per prayer where it exists, otherwise teaching and the siddur link.
11. **D Q2, do students still type in "My translation"?** Matters only when notifications go on; not blocking.
