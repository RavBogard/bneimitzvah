# 07. Student and parent: feature and UI/UX gap analysis

Reviewed at `582aa56` (main, 2026-11-16). Read-only. Paths are relative to `/home/user/bneimitzvah`.

## How to read this

- **Method:** code reading only. I read the routes a student and a parent reach, the e2e specs that describe them, PRODUCT.md, the five earlier reviews and both plans. I ran nothing in a browser and measured no page.
- **Not verified:** production flags (I take STATE.md's word that `REFERENCE_AUDIO_STUDENT_RELEASE=true`, line 291), how many CRC children have their own email address, and anything about real use.
- **Where the plans stand:** v1.9.0, v2.0.0 and v2.2.0 are released (STATE lines 37, 73). Almost every 1.9/2.0 milestone is built, so "in the plan" below mostly means "built, and here is what became of it". Later work ("Readings for everyone", 2026-10-27/28) replaced parts of 1.9.
- **Rulings respected:** no generated chant to students (G3); no streaks, scores, tallies, emoji, exclamation points or pep talk; no licensed text in the repo. Three further rulings shape the job itself and I mark every gap that touches them:
  - D'var Torah is out of the app ("that all happens with the rabbi not in the app … The app is just for study", 2.0 PLAN "Cut").
  - No student recordings ("I don't think this is really a useful thing for us", STATE 261; decision 6 "Revisit with 2.5").
  - No notifications at 2.0 ("None yet"); family logistics out.

## The short version

The practice core is good and mostly finished: a student's own verses with human audio, phrase colours, Up close, Got it marks, a tutor's notes, a 24-lesson chant course wired to the student's verses, and a run-through with fading help. The gaps are not in that core. They are in three places:

1. **Things that were built and then left unreachable or dropped.** The 54-lesson service course (blessings, Sh'ma, V'ahavta) has no link from anywhere. The "one next step" on the student's home was built in N11 and removed a week later. Run-through and step-by-step preparation sit in Learn with no way in from the reading.
2. **The service side is three systems.** A student can meet "Parts I lead" (from CRC Music), "Assigned service material" (the tutor's plan) and the course's "Your parts", with no audio in any of them.
3. **Vocabulary and chrome meant for staff still reach a 12-year-old.** Save-recovery wording, an inert Email settings page, a Roles list, four print entry points, twelve entry points on the Learn home.

---

## 1. The student journey

| Stage | What exists (route / component) | How well it works (from code) | What is missing |
|---|---|---|---|
| **Invitation** | Rabbi sends a student invitation by email (`workspace/invitations/form.tsx`); `/invitations/accept` → `portal/entry.tsx`. Lasts 7 days; the email names congregation, role and expiry. | Clear: "Review your invitation" → "Accept invitation" → "Open your reading". Uncertain outcomes are handled honestly. The form requires "the student's own email, not a parent's", and the server refuses a parent's address for a student (`server/invitations/service.ts:90`). | A child with no email address of their own cannot have a student account. Their only route is the parent's "Practice with {child}" (see gap A7). |
| **Sign in** | Email link plus 6-digit code, or Google on demand (`entry.tsx`, `google-sign-in.tsx`). | Code sign-in is good on a phone. Sessions last 7 days (`server/auth/factory.ts:50`); a student who lapses a week signs in again from an emailed code that lives 5 minutes. | Nothing missing; the 7-day session is short for a child (A10). |
| **First screen** | `/mine` → `mine/shelf.tsx`. The pinned card (`workspace/today/today.tsx`): date chip, countdown, name, ranges, **Open**, next rehearsal, "Verses you've got" bar, latest lesson note with "Before next time", seven dots, a month calendar behind a disclosure, links to Service parts, Lessons, Print booklet. | Loads in a cascade (students → reading → marks, lessons, calendar) with held space, so nothing jumps. Empty state is plain: "Your tutor or rabbi will add your verses here." The installed app's `start_url` is `/` (`lib/offline/manifest.ts:18`), so the app opens on the public front door, not here. | No "what do I do now". N11's Next card and per-aliyah rows are gone (A3). No first-run orientation. |
| **Knowing the portion** | Ranges on the card; `/mine/reading` (`workspace/reading.tsx` + `study/view.tsx`); "About this portion" card from the guide; before verses are assigned, "Explore the full Torah portion". | Good. Torah and haftarah are equal. Aliyah chips show when the tutor recorded the divisions; otherwise the page says "Aliyah boundaries have not been recorded for this assignment." | A special-date reading still dead-ends at "Your rabbi will help choose the verses." with no contact (`study/exploration-api.ts:17-22`; R-15 in 2026-10-20, still open). The service time never shows on a phone (C-list, small). |
| **Learning trope** | `/learn` (`learn/home.tsx`): 24 lessons (34 ids in `lib/learn/lessons.json`), Leitner review, Quick ten, human PocketTorah clips only (`lib/learn/phrase-audio.ts:13`). `/trope-chart`. | Strong, and reordered to "hear, try, in verses". Progress syncs to the account. Reached by "Learn" in the site bar and a row on the shelf. | The trope chart is silent (`portal/trope-chart/` holds only `print.tsx`). Learn work does not count as a practice day (A6). |
| **Learning the verses** | `/mine/reading` in Lein: tap a verse to hear it, word highlighting, Repeat and Speed (`study/reading-player.tsx`), phrase colours, tikkun views, word card. **Up close** (`study/lift.tsx`): one verse, phrase by phrase, swipe or Next, opens at the first verse not marked Got it (`reading.tsx:371`). | The best screen in the app, as the 2026-10-24 review said, and now with audio. The dock is three controls: Up close · Listen · Text. | Step-by-step preparation of a verse (`learn/guided-preparation.tsx`: words, phrases, joins, attempt without the recording, compare) exists but is reachable only for the first verse, from the Learn home ("First phrase of your verse", `home.tsx:59`). Nothing in Up close links to it (A5). |
| **Daily practice** | Open → reading → Up close. Got it / Still working per verse with a stated criterion (`progress/marks.tsx:62`). Seven dots on the card. | Four taps from the installed app's icon to the verse: front door → My Readings → Open → Up close. The dot fills only for the assigned reading's page; Learn, Run-through and the service course never fill it (A6), and its caption says "when you open your reading up close". | A one-tap "carry on" from the home card. |
| **Recording and tutor feedback** | Tutor → student only: lesson notes with "Before next time" (`lessons/panel.tsx`), per-verse "Notes from your teachers" (`work/verse-tools.tsx`), the tutor's Working/Solid mark, "Feedback for you" on a service part. Student → tutor: Got it marks, "My translation", "Ask about this part". | Lesson notes surface on the home card. The other three are each somewhere else, with nothing saying one is new (A9). | Recording is absent **by ruling**; ~600 lines of parked server code (`src/server/recordings/`) and an unused `workspace/recordings/capture.ts`. Between lessons nobody hears the student. |
| **Haftarah** | Same reader, haftarah melody path in Learn, haftarah-first ordering for a haftarah-only student. | Equal to Torah. | 18 special haftarot (~400 verses), three parashah haftarot and 38 Torah verses have no recording (STATE 288). The student sees "A reviewed recording isn't available for this verse." and nobody was warned at assignment (B4). |
| **Blessings and service parts** | (a) "Your plan" → Service parts (`service-learning/panel.tsx`, `my-service.tsx`). (b) The service course at `/learn/service`: 37 morning, 11 evening/Havdalah and 6 Hebrew-reading lessons, with "Your parts" from the tutor's plan. | (b) is **linked from nowhere**; `e2e/service-course.spec.ts:87` asserts it. (a) is folded at the foot of the reading and speaks in system terms. No audio anywhere (2.0 ruling; Daniel records in 2.1). The assigned reading has no blessings link, though the public reader has one (`public-reading/siddur-blessings.tsx`; `reading.tsx:492` passes none). | A way in (A1), one parts list (A2), melody audio (B2). |
| **D'var Torah** | Out of the app by ruling. What supports it: Study lens (commentaries, "From Rabbi Daniel", guide overview), per-student booklet (`/print/booklet/[id]`). | Fine for reading sources. | Nothing proposed. |
| **Rehearsals** | Dates on the card, in the calendar and in "Your plan"; "Rehearsal today". **Run-through** (`/learn/run-through`, `learn/verse-run.tsx`): own verses, no audio, help fades Colors → Marks only → Tikkun, ends with "Practice verses 3 and 8 again." | Run-through is exactly the right tool for the last month and is one small row on the Learn home; the reading never mentions it (A5). Its result is private to the student (`run-through.tsx:15`). | A run that includes the blessings in order. Start time on a phone. |
| **The day** | Card says "Today". Tikkun-only view. Print practice sheet, booklet. Offline pack of the assigned reading on CRC's origins. | Works offline for 14 days if installed. | Nothing essential. |
| **After** | "Ceremony done" keeps Learn and Study (N21). | Good. | — |

**On a phone, offline, first run:** phone layout is carefully handled everywhere I read (320 px tests, dock above the keyboard, held space while loading). Offline works only where the app is installed on a CRC origin. First run has no guidance beyond each screen's own labels.

---

## 2. The parent journey

| Stage | What exists | How well it works | What is missing |
|---|---|---|---|
| **Invitation and sign-in** | Parent invitation, one per child; same accept flow. | Clear. One email can serve siblings. | — |
| **Home** | `/mine` → "Your child" card (`mine/children.tsx`): date, countdown, parashah and ranges, "Verses Noa has got: 9 of 14", the tutor's "Before next time", **Open**, **Practice with Noa**, Service parts, Honors form, Print booklet. | The best-shaped screen in the product: it answers "is my child on track and what was asked". | Nothing tells a parent anything happened; they must come and look (no notifications, by ruling). |
| **Following** | `/mine/child/[id]` (`reading.tsx`, parent mode): "This week" summary, lesson notes, service parts, family honors, then the text behind "See Noa's reading". | Good order. Read-only apart from honors. | — |
| **Helping** | "Practice with Noa" → `/workspace/practice/[id]`: the child's Hebrew-first page under the parent's account, marks recorded as "with parent". | Ends after 60 minutes (`server/practice/handles.ts:6`) with "This practice session ended." A parent who cannot chant gets the same Listen as the child, which is enough. | For a child with no own account this is the child's only way in, and it has no Learn-on-own-verses, no Run-through and no verse review (`learn/own-reading.ts:11-13`). |
| **Honors** | `honors/sheet.tsx`, blessing links for honorees (`honoree-controls.tsx`). | Thorough and heavy: "Check what saved", "Leave with the link action unconfirmed?", "Replace recorded link". The full link shows once. UX-12 and UX-13 (2026-10-18) are only partly answered. | A plain "who still has no name" summary; R-11's "Create blessing link waits on Check link with no hint" was not re-checked here. |
| **Logistics** | Dates and service name only. | — | Out by ruling. |
| **Account** | `/account`: Roles, Email settings, a long paragraph on what the tutor sees, sign out. | Email settings leads to "Your congregation hasn't turned these emails on yet." | — |

---

## 3. Ranked gaps

Sizes: S about a day, M a few days, L about a week. "Plan" cites the 1.9 or 2.0 milestone. Ranked by how much a student's preparation improves per unit of work.

### A. Exists, but hard to find or hard to use

| # | Gap | Who it hurts | Evidence | Plan | Fix | Ruling collision |
|---|---|---|---|---|---|---|
| **A1** | **The service course has no way in.** 54 lessons covering the six parts every student leads, the Torah and haftarah blessings, the whole morning service and Havdalah. | Every student from month three on; parents asking "where are the blessings?" | `e2e/service-course.spec.ts:87-96` asserts no page links to `/learn/service`. The only link in `src/components` is the offline shelf (`portal/offline/shelf.tsx:30`). 2.0 PLAN line 144: "the course lives at `/learn/service`, out of every nav" — a builder's "Decided here" at SC1, never revisited after SC2–SC7 shipped. | SC1–SC7 built; linking was never a milestone. **Unplanned.** | **S.** Link it from the Service parts section of "Your plan", from the shelf beside "Learn to lein", and from the Learn home. Delete the e2e assertion. | None found. Daniel ruled the course "open". Worth one line to him, since it becomes student-visible. |
| **A2** | **Three service-part systems.** "Parts I lead" + "Full order of service" (CRC Music), "Assigned service material" / "Additional practice" (tutor's plan), and the course's "Your parts". | Students and parents; tutors who must keep them consistent. | `service-learning/my-service.tsx:86-117`, `panel.tsx:74`, `learn/service/` "Your parts" (2.0 PLAN line 192). The 2026-10-24 REPORT note N1 asked that "the service course should own a phone-first parts view"; it did not happen. | SC4/SC5 built the course side only. **Unplanned.** | **M.** One student-facing list, "Your parts", each row opening its course lesson, with the tutor's directions and feedback on the row. Keep the Music connection for staff. | None. |
| **A3** | **The home card has no next step.** N11 built a Next card ("Start where you left off" / "Practice verses {range}") and per-aliyah rows (Not started / Working / Solid). The shelf move a week later kept only **Open**. | Every student, every day. This was finding #8 of the twelve in 2026-10-24 (G3). | 1.9 PLAN N11.2–N11.3. `today/today.tsx:158` has one button. `today/model.ts:50-75` (`readingRows`, `rowState`, `stateWord`) is now used only by tests (grep: no other importer). | N11 built, then **regressed** by "Readings for everyone" E1. | **S–M.** Make the primary button name the work: "Practice Aliyah 2 · Genesis 23:5–8", opening Up close at the first verse not marked Got it (the logic is already `reading.tsx:371`; it needs an address, e.g. `/mine/reading#up-close`). | None. "9 of 14" stays a position, not a score. |
| **A4** | **The app opens on the public front door.** | Students who installed it. | `lib/offline/manifest.ts:18` (`start_url: "/"`); `e2e/front-door.spec.ts:110` "a single-role student at the root sees the front door … reaches My Readings in one tap". | Decided in "Readings for everyone" (decisions 12, 22). | **S.** For a signed-in student, lead the front door with the student's own card (or its one button from A3) above "This week". | Touches a "Readings for everyone" decision; confirm before changing. |
| **A5** | **Learn's work on the student's own verses is invisible from the reading.** Run-through and guided preparation live only on the Learn home; guided preparation is offered for the first verse only. | Students in the middle months (learning verse by verse) and the last month (run-throughs). | `learn/home.tsx:59` (first verse only), `:99` (Run-through row). In `src/components/portal`, nothing links to `/learn/run-through`, and `/learn/prepare` is linked only from the readings index (grep). `reading.tsx:492` passes only the review line to the foot. | N17 and N19 built the tools; the links back were "left for others" (PLAN line 135). | **S.** In Up close, under the marks: "Learn this verse step by step" → `preparationHref(ref, kind)`. In the reading foot: "Run-through". | None. |
| **A6** | **Only one kind of practice counts as practice.** A day fills when the student opens a verse on the assigned-reading page. A Learn lesson, a review, a Run-through or a service lesson leaves it empty. | Students (an honest half hour shows as nothing); parents and tutors reading the dots; the admin's "Behind on practice." | Practice visits are written only from `reading.tsx:425,484` (`calendar.visitVerse/visitUnit`); nothing under `src/components/learn` or `src/server/course-progress`, `verse-review` touches the practice calendar (grep). Caption at `today.tsx:182`. | N23 widened what tutors see; nothing widened what counts. **Unplanned.** | **S–M.** Record a practice date when a signed-in student finishes a Learn activity, a Run-through or a service lesson. Change the caption to "a day fills when you practice". | None: still dates only. |
| **A7** | **A child without their own email is a second-class student.** | Under-13s whose family uses one address. | `invitations/form.tsx` "Use the student's own email, not a parent's."; `server/invitations/service.ts:90`; practice context 60 minutes (`server/practice/handles.ts:6`); Learn gives a parent "none" (`learn/own-reading.ts:11-13`), so no first phrase of own verse, no Run-through, no verse cards, and Learn progress lands in the parent's account. | **Unplanned.** | **M–L**, auth work (adversarial pass). Either let the practice context last the session on that device and feed Learn's own-reading read, or allow a student sign-in that reuses the parent's mailbox with a distinct identity. | None, but it is auth and cross-family isolation: high-stakes by CLAUDE.md. Size the problem first (how many children). |
| **A8** | **Staff and system vocabulary reaches the child.** | Students and parents at the moment something goes wrong. | "Mark unverified", "Check what saved" (`progress/marks.tsx:17,40`); "Keep my text for another save", "Send the same save again" (`work/verse-tools.tsx`); "Your service connection is queued and retries automatically. The daily fallback may take until tomorrow; your roster and practice work are saved." and the button "Load my service" (`service-learning/my-service.tsx:111-112`); "No student is currently linked to this role." (`today/today.tsx:138`); "Checking the current assignment, text and saved work…" (`reading.tsx:441`). UX-11 (2026-10-18) and N1 (2026-10-24) named these; they remain. | **Unplanned** (F6 and N16 polished other strings). | **S.** A string pass for learner modes: one "Try again" where there are three recovery verbs; "Your service parts aren't ready yet. Your tutor is setting them up." | None. Lead's call under the small-wording rule. |
| **A9** | **Feedback from the tutor is in four places with no sign of what is new.** | Students; tutors whose verse notes go unread. | Lesson note on the card (`today.tsx:167`); verse notes behind "More · Your translation & notes" (`work/verse-tools.tsx:81`); tutor's mark in Up close (`marks.tsx:65`); "Feedback for you" (`my-service.tsx`). | N12 added "Before next time" only. **Unplanned.** | **M.** On the home card, under the lesson note: the verses that carry a note from the tutor since the last lesson, each a link into Up close at that verse. | None (no notification is sent). Phrase it as a list, not a count. |
| **A10** | **Seven-day sessions.** | A child who misses a week and has no email on the phone. | `server/auth/factory.ts:50`. | Not planned. | **S** to lengthen for learner roles; auth, so it needs the adversarial pass. | None; high-stakes area. |

### B. Missing features

| # | Gap | Who it hurts | Evidence | Plan | Fix | Ruling collision |
|---|---|---|---|---|---|---|
| **B1** | **Nobody hears the student between lessons.** | Students who practise a mistake for a week; tutors. | No capture UI; `workspace/recordings/capture.ts` has no importer; `src/server/recordings/*` parked. | Dropped at 1.5; decision 6 "Revisit with 2.5". | Not proposed. Inside the ruling: let Run-through's stumbled verses set "Still working" on those verses (the tutor already sees marks), with the student told. **S–M.** | **Yes** for recording. The marks route does not collide (decision 7 already shows marks). |
| **B2** | **No melody for the blessings or prayers.** The parts every student leads have text, key words and a check, and no sound. | Every student; this is what families ask for first. | 2.0 PLAN "Explicitly out": "Melody audio and recordings: 2.1, Daniel handles them"; the `hear` step exists in the schema and is refused. | **2.1**, waiting on Daniel's recordings (`A5-RECORDING-LIST.md`). | **M** once recordings exist. Until then **S**: put the siddur blessings link on the assigned reading (`reading.tsx:492`), as the public reader has, and the "Service music" link beside each part rather than at the foot. | None. Human recordings need no listening review. |
| **B3** | **Recording holes are discovered by the student.** | A student assigned a special haftarah or one of the unrecorded verses. | STATE 288: Torah 5,808 of 5,846 playable; 18 special haftarot (~400 verses) unrecorded; Noach, Re'eh and Ki Teitzei haftarot refused by the duplicate-cut resolver. `reading-player.tsx` "A reviewed recording isn't available for this verse." | 1.5 ruling 6: "count PocketTorah gaps before any tutor reference uploads". Counted; nothing followed. | **S:** when verses are confirmed, tell the tutor "4 of these verses have no recording". **L:** let a tutor or the rabbi record those verses. | The L part needs Daniel (storage, licence of the tutor's own voice, never-in-repo). Finkel's recordings are ruled out of playback. |
| **B4** | **The trope chart is silent.** | Students using it as the reference it claims to be. | `portal/trope-chart/` contains only `print.tsx`. L3 in the 2026-10-24 listening list. | "2.5 listening list". **Unplanned.** | **M.** A play control per family, from the same PocketTorah exemplar cuts Learn uses (`lib/learn/phrase-audio.ts`). | None: human audio only. |
| **B5** | **No shape to six months.** The only plan is the tutor's free-text "Before next time". | Students and parents who cannot tell whether "9 of 14 with ten weeks left" is fine. | `lessons/panel.tsx`; no target or section field on a lesson note (`lib/lesson-log/types.ts`). | **Unplanned.** | **S–M.** Let "Before next time" name a section (an aliyah chip) so the home card's button (A3) opens exactly what was asked. No dates, no pace line. | A pace or target line would lean on "no daily goal"; the section pointer does not. |
| **B6** | **Special-date students dead-end.** | Adults and holiday-date students. | `study/exploration-api.ts:17-22`; R-15 open since 2026-10-20. | **Unplanned.** | **S.** Add the congregation's contact from settings. | None. |
| **B7** | **No first-run orientation.** | A new 12-year-old; a parent helping. | No such component; first screen is the card. | **Unplanned.** | **S.** Three lines on the empty and first-loaded card: tap a verse to hear it; Up close to work on one; mark Got it when it matches the criterion. Shown until the first mark. | None; keep it plain. |
| **B8** | **D'var Torah, reminders, logistics.** | — | — | Cut by ruling. | Not proposed. | **Yes.** |

---

## 4. What the student has and does not need

This matters as much as the gaps: the practice core is three controls, and the rest of the surface dilutes it.

| Clutter | Where | Why it is not needed | Suggestion |
|---|---|---|---|
| **Email settings** row and page | `account-page.tsx:38`, `workspace/email/workspace.tsx` | Notifications are off; the page says "Your congregation hasn't turned these emails on yet." Three toggles that do nothing. | Hide the row while `PORTAL_NOTIFICATIONS_ENABLED` is unset. |
| **Roles** list for a one-role account | `account-page.tsx:31` | A student has one role; the list is a row that leads back to `/mine`. | Show it only with two or more roles. |
| **What-the-tutor-sees text in five places** | Shelf foot (`shelf.tsx:66`), Account (two paragraphs, `account-page.tsx:43-44`), Learn home (`home.tsx:105`), child practice (`reading.tsx:451`), `/about#accounts` | Daniel, 2026-10-26: stressing about disclosure "way more than is needed". | Keep Account and `/about`. Drop the shelf foot and the Learn line. |
| **Learn home: about twelve entry points** | `learn/home.tsx:88-107`, `learning-start.tsx` | Next, Review, Run-through, Quick ten, "Start where you are" (a disclosure with four more links, two of them the same address), First phrase, Prepare a passage, two paths, Trope chart, About, My Readings. | For a signed-in student with a reading, hide "Start where you are" (it is for visitors choosing a level). |
| **"My translation" with its save machinery** | `work/verse-tools.tsx`, `work/coordinator.ts` (344 lines), `work/history.tsx`, `work/departure-review.tsx` | A per-verse translation draft with version history, conflict review and a leave-page guard. 2.0 PLAN open question 11 already asks "do students still type in 'My translation'?" | Ask Daniel that one question. If no, remove the student draft and keep the tutor's verse notes read-only. Large simplification for the redundancy review. |
| **Four ways to print** | Card "Print booklet" (`today.tsx:190`), "Print practice sheet" and "Print the whole reading" (`study/view.tsx`), "Print" in the foot (`reading.tsx:492`) | Three different documents with near-identical names. | One "Print" that offers the three. |
| **Service parts mechanics** | `my-service.tsx:86-117` | "My progress" dropdown, "Ask about this part" form, "Full order of service", "Additional practice", "Load my service", plus two external links. | Folds into A2. |
| **Study extras for a child** | `reading-toolbar.tsx` (11 commentaries), `study/verse-panel.tsx` (Compare translations, More on this verse, Sources), `study/own-layer.tsx` (stars) | Right for Daniel and adult learners; a 12-year-old needs the guide's overview and the rabbi's notes. | No removal. Keep Lein as the learner default (it is) and leave Study alone. |
| **Two readers** | `/mine/reading` (workspace) and `/read?saved=` (public reader), plus "Add" and "Also working on" on a student's shelf | Different chrome and tools for the same act. Fine for the rare student who keeps a second reading. | Leave; note for the redundancy review. |
| **"Go to verse" pill** | `reading.tsx:401` | A 10–14 verse reading with aliyah chips does not need a verse jump sheet. | Hide when the reading fits one section page. |
| **Dead Today code** | `today/model.ts:25-30,50-75` | `rehearsalLine` survives only for the parent; `readingRows`, `rowState`, `stateWord` have no caller. | Reuse for A3 or delete. |

---

## 5. Earlier findings: what was actually fixed (checked in code)

| Finding | Source | Now |
|---|---|---|
| 22,000 px student page | 10-24 G2, 10-20 R-06 | **Fixed.** Hebrew first; plan folded at the foot; paged by aliyah. |
| Word tap shows nothing on a phone | 10-24 X1 | **Fixed** (word card in a sheet; `e2e/word-card.spec.ts`). |
| Audio promised, not released | 10-20 R-02 | **Fixed**: human recordings released (STATE 291). |
| "What do I do today?" | 10-24 G3 | **Built, then lost** (A3). |
| Learn cut off from the student's reading | 10-24 G4 | **Half fixed**: Learn knows the reading; the reading does not know Learn (A5). |
| Never asked to chant alone; review never covers own verses | 10-24 G5, G6; chanting review | **Fixed** in Learn (attempt before compare; verse cards; Run-through). Hard to find (A5). |
| Start / Hear / Play compete | 10-18 UX-06 | **Fixed**: Up close · Listen · Text. |
| Parents can't tell if a child is on track | 10-24 G8 | **Fixed** (child card, This week). |
| Service parts speak system language | 10-24 N1 | **Open** (A8, A2). |
| Recovery asks users to diagnose saving | 10-18 UX-11 | **Open** for learners (A8). |
| Special-date dead end | 10-20 R-15 | **Open** (B6). |
| Trope chart and rare trope silent | 10-24 L3 | **Open** (B4). |
| Signed-in landing demotes the task | 10-20 R-07 | **Partly**: sign-in lands on `/mine`; the installed app does not (A4). |
| Honors: link steps mislead | 10-18 UX-13, 10-20 R-11 | **Mostly fixed**; wording still heavy. Not re-walked. |

---

## 6. The five that would most improve a student's first week

1. **Give the home card one named next step that opens the verse** (A3, S–M).
2. **Open the installed app on the student's own card** (A4, S; confirm against the "Readings for everyone" decision).
3. **Three lines of orientation until the first mark** (B7, S).
4. **Count every kind of practice as practice** (A6, S–M), so the first week's Learn lessons show.
5. **Warn the tutor at assignment when verses have no recording** (B3 S part), so the student never meets a silent verse first.

Also worth settling in the first week, before anything is built: how many children have no address of their own (A7).

## 7. The five that would most improve the last month

1. **Link the service course, starting from "Your parts"** (A1, S). The blessings are already written and approved; nobody can reach them.
2. **One parts list** (A2, M).
3. **Run-through from the reading, and its stumbles marked "Still working"** so the tutor sees them (A5 + B1's allowed part, S–M).
4. **Blessings links on the assigned reading now, melody audio when Daniel records** (B2).
5. **Tutor notes that are new, on the home card** (A9, M), so the last lessons' corrections are not missed.

## Open items that wait on Daniel

1. Whether the service course may be linked for students now (A1). No ruling forbids it; it becomes student-visible.
2. Whether students still write "My translation" (already open as 2.0 question 11); the answer decides a large removal.
3. How children without their own email should sign in (A7), once counted.
4. Whether a signed-in student's front door may lead with their own reading (A4).
5. Tutor or rabbi recordings for unrecorded verses (B3, the L part).
