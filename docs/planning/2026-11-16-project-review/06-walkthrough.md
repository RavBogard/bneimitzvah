# 06 — Walkthrough: what each kind of user sees

Screenshots: `(session scratchpad)/shots/` (186 PNGs = 93 screens x phone 390x844 and laptop 1366x900, deviceScaleFactor 1).
Scripts: `.../scratchpad/review/shots-scripts/`. Per-page text/link dumps: `.../scratchpad/review/state/pages/*.json`.

## How it was run

- No Postgres on the machine. I installed `embedded-postgres@18.4.0-beta.17` (the version `scripts/test-local-db.mjs` pins) into the user cache, copied its binaries to `/var/tmp`, and ran `initdb`/`pg_ctl` as the existing `postgres` OS user, because the repo script cannot start Postgres as root.
- The app was served the way `tests/http-browser` does it: `browserFixture()` + `startBrowserServer()` (Next **dev** server in an isolated copy under `.local-logs/`, real migrations, real RLS role, real better-auth sessions) on port 3100, driven from a Vitest file kept in the scratchpad. No production build was made; the Playwright "no database" gate was not needed because the fixture's public runtime also serves the signed-out pages.
- Synthetic data only (`@example.test`): admin, a tutor (who in the repo fixture is also a parent of "Synthetic Learner"), student "Noa Example" (ceremony Sat Jan 23 2027, morning service, two rehearsals, Torah Genesis 37:1-11 in 3 aliyot, haftarah Amos 2:6-10, two lesson notes, five practice days, own sign-in, one parent), plus Eli Sample, Maya Fixture, Jonah Testcase and adult Ruth Adultlearner in various states of setup.
- Everything is stopped and removed: server, database, `/var/tmp` cluster, saved session files, `.local-logs/http-browser-project-*`. `git status` is clean; no `.env` file was created.

### Read these caveats before judging a screenshot

1. **Hebrew and English are invented.** The fixture's text loader returns made-up syllables and "Synthetic translation line N". Layout, colours, wrapping are real; the words are not.
2. **No audio locally.** No reference-audio catalog or course recordings, so `Listen` is disabled ("Listening isn't available yet"), lessons show "The recording did not load", and Prepare shows "A practice recording isn't available". These are local limits, but the screens show what a student gets when audio fails.
3. **No Hebcal, Sefaria or Maven.** "Couldn't load the calendar", "Rashi isn't available right now", word details and sources are empty for that reason. The portion is called "Synthetic portion".
4. **Fixture users have no names**, so staff lists say "Portal member" and the tutor is called "Tutor" ("Tutor: Tutor"). Not a product bug, though it shows the fallback is a bare role word.
5. **Full-page captures put fixed/sticky things mid-page** (the tool dock, the workspace tab bar, sticky aliyah chips, the "Skip to main content" link). The `*-fold-*` files are viewport-only and show the true position.
6. **"Reading needs review" on every seeded reading** is probably my seeding (readings inserted directly as custom, not through the confirm flow). Treat the chip's presence as an artifact, its wording and placement as real.

## Navigation and tap counts

Header (all roles, both widths): logo -> `/`, `Read` -> `/read`, `Learn` -> `/learn`; signed out `Sign in`; signed in a bookmark icon (laptop: "My Readings") -> `/mine` and a person icon -> `/account`. On phone the two signed-in items are **icons with no visible label**.

| Role | Extra navigation | Landing to main job |
|---|---|---|
| Signed out | none | `/` -> Lein = 1 tap to this week's reading. |
| Student | none (no tab bar). Everything hangs off the My Readings card. | `/` -> "Open My Readings" (or bookmark icon) -> "Open" = **2 taps** to the reading; **3** to practise a verse (Up close). The front door leads with this Shabbat's portion, not the student's own. |
| Parent | none | `/` -> My Readings -> "Open" = 2 taps to the child summary; My Readings -> "Practice with Noa" = 2 taps to practice mode. |
| Tutor | none. Student page has a horizontal strip of the tutor's students at the top. | `/` -> My Readings -> student row = **2 taps**; "Add lesson note" = 3 taps. |
| Admin | Workspace nav: `This week`, `Students`, `People` (sub-tabs Invitations / Tutors / People), `More` (Settings, Email settings, Claude connections, Share guides, Recording review, roster Sheet). Left rail on laptop, bottom tab bar on phone. | `/` -> "See this week" = 1 tap; roster = 2; one student's page = 3; that student's People and access = 4. The header's My Readings also lands on This week. `/workspace/tutor/<id>` redirects admins to the admin student page. |

Old routes `/workspace`, `/workspace/student`, `/workspace/parent`, `/workspace/tutor`, `/workspace/more` (non-admin) and `/workspace/practice/<id>` opened cold all redirect to `/mine`.

## Observations

Ranked by how much they would trip a real user. "Phone"/"laptop" name the file suffix.

### Student

1. **The front door is not the student's own reading.** A signed-in student on `/` sees "THIS SHABBAT / Synthetic portion / Lein / Study" first; their own reading is a card below with one line and "Open My Readings" (`student-home-phone`). Tapping the big blue **Lein** takes a twelve-year-old to the wrong reading. The card also has a large empty area under the button (about 130px of blank white on phone) — looks like reserved space for something that did not render.
2. **Two different "Lein/Study" worlds look identical.** `/read` (public portion) and `/mine/reading` (own reading) share the reader, the header "Read" link goes to the public one. Nothing on `/read` says "this is not your reading" to a signed-in student.
3. **English is hidden on the phone by default.** Laptop shows Hebrew and English side by side (`student-reading-fold-laptop`); phone shows Hebrew only (`student-reading-fold-phone`) and English needs Text -> English or the Study toggle (`student-reading-text-menu-phone`). Reasonable, but nothing hints that a translation exists.
4. **The reading page keeps going after the reading.** Below the text: Next section, Word tools, About this text, Print practice sheet, a second Lein/Study toggle (phone only; laptop has it at the top), Trope chart, Print, Your plan, Service parts, Lesson notes, Family honors (`student-reading-phone`, `student-reading-plan-open-phone`, 1,950 to 3,450px). The tutor's latest note and the plan, which a student most needs, are at the very bottom, under licence text.
5. **Three print entry points with three names** on one page: "Print practice sheet", "Print", and on My Readings "Print booklet" (`student-reading-phone`, `student-mine-phone`). The first two open the same sheet builder.
6. **"Family honors" on the student's page is a paragraph telling the child to send names to the office** (`student-reading-phone`). Parents get a real form (`parent-honors-form-phone`). For the child it is a dead end; consider dropping it from the student view or saying "your parent fills this in".
7. **Verse tools is thin.** Tapping a verse number opens a sheet with "View Genesis 37:1 up close" and "More · Your translation & notes" (`student-reading-verse-tools-phone`). Marking Got it / Still working is only inside Up close (`student-reading-upclose-phone`), which is a good screen: one verse, phrase chips, clear rule ("when you can chant this verse twice in a row"). The path to it from a verse is two taps and the label "Up close" does not say "practise".
8. **Listen is a greyed dock button with no visible reason on the student's phone view.** When audio is unavailable the dock's Listen is dimmed (`student-reading-fold-phone`); the sentence "Listening isn't available yet. You can read, use word tools and practice up close." is in the page's text dump next to the dock but I could not see it in the student capture (the staff page does show it inline, `tutor-student-phone`). Not verified in code.
9. **My Readings card is the best student screen** (`student-mine-phone`): countdown, next rehearsal, verses got, latest tutor note, practice dots. Problems: the caption "a day fills when you open your reading up close" is the only explanation of what counts as practice; three look-alike links (Service parts, Lessons, Print booklet) of which two jump to anchors far down the reading page; and under the card a bare "**Add**" link with no noun (it goes to `/readings?add=1`, the full readings index, `student-readings-add-phone`) sitting right after "Tutor: Tutor".
10. **Learn to lein gives no sign that it relates to the student's own reading**, and with a failed recording a lesson is an empty screen: "The recording did not load. Try again / Back to Learn / Try the sound / Examples" (`student-learn-lesson-fold-phone`). `Run-through` is completely blank apart from "Back to the path" (`student-learn-runthrough-phone`) and `Review` is one sentence (`student-learn-review-phone`). Neither says what the student should do first.
11. **No recording flow exists.** There is no screen where a student records themselves or a tutor reviews a recording; `src/components/portal/workspace/recordings/capture.ts` has no UI importing it (Daniel dropped student recordings on 2026-10-22). "Recording review" under admin More is about the reference recordings, which the name does not make clear.
12. **Account page explains surveillance in one dense paragraph** (`student-account-phone`): fine in content, but it is the only place a student learns what the tutor sees. Email settings shows a reminder toggle followed by "Your congregation hasn't turned these emails on yet" (`student-email-settings-phone`) — a control that does nothing.
13. **Booklet is clean and useful** (`student-booklet-laptop`): summary, blessings page numbers, reading by aliyah with colours, unpointed practice page, haftarah. On phone it is 8,600px tall, which is expected for a print artifact.

### Parent

14. **Child summary is clear and short** (`parent-child-phone`): next rehearsal, tutor's latest note, practice dots, "Verses Noa has got: 2 of 16", one primary button. This is the model the student page could follow.
15. **"Practice with Noa" is the child's whole reading page under a different title** (`parent-practice-with-fold-phone`, 1,900px), with a "What Noa's tutor sees" link and Done. A parent who cannot read Hebrew gets no guidance on what to do in this mode.
16. **Honors form** (`parent-honors-form-phone`) is a tidy list of honours with status, but opens with "The assigned reading needs staff review. Saving honors does not confirm the reading" — staff vocabulary shown to a parent. The Save button is disabled with "No saved form yet" and nothing says to tap a row first.
17. Two near-identical routes for the same child: `/mine/child/<id>` (summary) and `/workspace/practice/<id>` (practice). The second cannot be opened directly (redirects to `/mine`), so a bookmarked practice link silently lands on the list.

### Tutor

18. **The student list is good** (`tutor-mine-phone`): date, days to go, "Practiced 5 of last 7 days · Last lesson Nov 11", the last note. It is titled "My Readings", which is the wrong name for a tutor's roster, and reached by a bookmark icon.
19. **"Find a learner" is an unlabelled empty box** (no placeholder, no hint what it searches, `tutor-mine-phone`). Typing a real student's first name that is not the tutor's returns "No learners found" (`tutor-find-learner-phone`); it searches something other than the roster and does not say what.
20. **The student page is very long and ordered for the system, not the lesson** (`tutor-student-phone` 4,120px; `tutor-student-open-phone` 5,080px). Order on phone: header, Lesson card, Torah assignment card with "Needs review · Revision 1" and "Assigned verse references (11)", the reader, verse tools, licence lines, "Other confirmed reading details", link row, Service parts, Verses practiced, Learn to lein, Practice days, Lessons. The lesson log and practice evidence — what a tutor opens the page for — are the last things. On laptop they sit in a right column and it works much better (`tutor-student-laptop`).
21. **Internal wording leaks into the tutor page**: "Needs review · Revision 1", "Study guide: this reading has no calendar key, so only per-student additions can apply", "Verses 1–4 of 11. Selected English edition available.", "Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted." (`admin-student-page-laptop`, same component for tutors).
22. **"Change" opens a sheet titled "Change reading" that contains only a "Go to verse" picker** (`admin-student-change-reading-laptop`, `tutor-student-change-phone`). On the student's page the same control is honestly labelled "Go to verse". A tutor will think it reassigns the reading.
23. **"Listen to your reading"** is the player heading on the staff view (`admin-student-page-laptop`) — second-person student wording on someone else's page. On that laptop full-page capture the player card covers verses 1–2; this may be a sticky-element capture artifact and was not verified at a scrolled viewport.
24. **Practice dots disagree between screens.** Student and parent cards show the last seven days ending today (T W T F S S M, 5 filled; `student-mine-phone`, `parent-child-phone`); the tutor/admin page shows the current calendar week (S M … S, 2 filled; `tutor-student-phone`), while the tutor's list says "5 of last 7 days". Same data, three answers.
25. **Add lesson note is simple and right** (`tutor-student-add-lesson-phone`): date, "What you worked on", "Before next time" with a "When ___, I will ___" prompt, and "The student and their family can read this." No way to mark individual verses as assessed from here; the tutor's own assessment (solid / working) is not visible anywhere on the captured page except the student's own "Student: got it" chip.
26. No per-tutor view of "who has a lesson this week" or "who has not practised" beyond the list sentence; no way to message a family.

### Admin

27. **Two overlapping lists.** "This week" (`admin-this-week-laptop`) showed two of six students (ceremonies in 19 and 47 days) and not Noa at 68 days; the rule is not stated and the title says "week". "Students" (`admin-students-roster-laptop`) shows all six with nearly the same facts plus chips. The same problems are named differently in each: "Reading to confirm" vs "Reading needs review", "Needs a parent" vs "Parent: not joined yet".
28. **Setting up one student takes four places.** Add student (panel on Students, `admin-students-add-laptop`; it says "Saving doesn't send an invitation… use People for that") -> student page -> Assign verses / Manage (`admin-student-unassigned-laptop`, `admin-student-manage-laptop`) -> People and access to assign a tutor (`admin-student-access-phone`) -> Invitations to invite parent and student (`admin-invitations-prefilled-laptop`, one invitation per person, with a Review step). A new family is roughly 12 to 15 taps across four pages. The setup checklist on People and access (Tutor / Family access / Student sign-in, each "Done") is the right idea and could be the whole flow.
29. **"People" means three things.** The workspace tab "People" opens Invitations; inside it there is a sub-tab "People" (accounts); each roster row has a "People" action that opens "People and access" for that student (`admin-people-phone`, `admin-students-roster-laptop`).
30. **Manage menu mixes jobs** (`admin-student-manage-laptop`): "Confirm reading is still right" twice (Torah, Haftarah), Set divisions, Change verses, three print items, Write a lesson note, Refresh reading, People and access, All students. Eleven rows, of which two are navigation already on the page and three are prints.
31. **An unassigned student's page is confusing** (`admin-student-unassigned-laptop`): a huge "Explore the full Torah portion" heading with student-facing copy ("Read the portion while you and your tutor choose your verses"), then the same heading again smaller, then "Choose a service for this student, then the reading can be shown" with an "Edit details" button, plus a reader tool rail with nothing to read. The actual next step (set the service, then Assign verses) is two separate buttons with no order.
32. **Roster rows on phone are tall and repetitive** (`admin-students-roster-phone`): four text links (Honors, Edit, People, Print booklet) on every row, "Print booklet" wrapping to two lines; six students take 1,650px. There is no sort or filter (by date, by "needs something"), only a name search.
33. **Laptop workspace pages have a dead second screen.** Every admin page is at least 1,888px tall: the left rail ends at 900px, the footer sits at about 1,000px, then roughly 850px of empty blue (`admin-this-week-laptop`, `admin-invitations-prefilled-laptop`, `admin-more-laptop`). Looks like a doubled min-height.
34. **Settings is one long form with a Save button in the middle** (`admin-settings-phone`, 3,200px): Rabbi and Sources, then "Save settings", then Services, Links, Roster and families, Email continue below it. It is unclear whether the lower sections are saved by that button. Email shows "Email is off for this portal" with three checkboxes that therefore do nothing.
35. **Guides, sources and discussions have no admin screen.** More says "Discussions and insights are curated through Claude connections" (`admin-more-phone`); the only guide UI is export/import (`admin-guide-sharing-*`). Per-student sources and study guides are reachable only through Claude. That is a deliberate choice, but the portal gives the rabbi no place to even see what is published.
36. **No dashboard or report** beyond This week: no overview of practice across students, no "invitations outstanding" count on the landing page, no calendar of ceremonies and rehearsals.
37. **Admin home is the public home** with a small "This week — Needs you, ceremonies and rehearsals. See this week" card (`admin-home-phone`); the header gives the admin "My Readings" as the way into the workspace.
38. People with access lists accounts as "Portal member" when no name is known (`admin-people-phone`) and the only action is "Make tutor" / "Remove tutor"; removing a parent or student is on a different page (People and access -> "Remove someone across the congregation").

### Signed out and shared

39. **Sign-in copy contradicts itself**: under the email box "We'll email you a code to sign in", on the button "Email me a sign-in link" (`signedout-sign-in-phone`). The page title is "Open your reading" and tells the visitor to use "the account on your invitation", which reads as invitation-only although the home card says anyone can save readings.
40. **Home when the calendar fails** shows "COMING UP / Couldn't load the calendar. Try again" in the middle of the page (`signedout-home-phone`); acceptable, but the section is the second thing on the page.
41. **Public reader with no text** shows "Text unavailable. The verses didn't load… Reload text" with the tool dock still floating over the empty page (seen during setup; capture not kept).
42. **Print sheet builder** is powerful and long: on phone the options plus preview are 27,700px (`signedout-print-phone`); about 20 radio/checkbox controls before the preview. Fine for staff, heavy for a parent who wants "print this".
43. **Learn to lein landing** is clear and well paced (`signedout-learn-phone`): one "Next" card, then the path with contour glyphs. "Start where you are" has a disclosure "Choose a starting point" that hides the four most useful links.
44. **Phone vs laptop differences**: Lein/Study toggle top-right on laptop, below the text on phone; tool dock is a right rail on laptop and a bottom bar on phone, with different items for student (Up close, Listen, Text) and staff/public (Colors, English, Tikkun, Standard, Hear verse); tutor page right column on laptop becomes the page's tail on phone; admin nav is a rail vs bottom tabs. No horizontal overflow was detected on any captured page at either width.

## Could not reach, and why

- **Any audio**: reference recordings, Listen, word drills, Learn to lein lesson steps past the first screen, Prepare a passage, Run-through content, Recording review (admin). No catalog/kit locally and the fixture's recording routes are not wired. Lesson screenshots therefore show only the failure state.
- **Real text and study aids**: commentary (Rashi), word details, sources, translations picker content, portion summaries, discussions. Needs Sefaria/STEP or seeded caches.
- **Calendar-driven screens**: Coming up lists, calendar-based reading proposal in "Assign verses" (I did not drive the assign/confirm flow to the end), the date picker results.
- **Sign-in round trip in the browser** (code entry, invitation acceptance landing, link-request flow, first-run screens): sessions were minted through the fixture's captured mail, so the post-sign-in landing page was not observed; tap counts start at `/`.
- **Assigned service parts and a filled honors form**: needs the service catalog and a ceremony projection seeded; screens show the empty states only ("No service parts are assigned yet", "Not started").
- **Study guides under verses, per-student sources, tutor assessment marks, draft-translation notes**: not seeded; the tutor "Teacher notes" control inside verse tools was not found by my selector in the time box.
- **Adult learner's own view, cantor role, approver role, a tutor who is not also a parent, the `/mine/learner/<id>` page, `/connect`, `/offline`, `/unsubscribe`, `/design-system`, MCP**: not captured.
- **Production build behaviour**: this was the dev server, so the service worker, install prompt, offline shell and real caching were not exercised.

## Screenshot index

| File (each has `-phone.png` and `-laptop.png`) | Role | Route | What it shows | Page height phone / laptop (px) |
|---|---|---|---|---|
| `signedout-about` | signedout | `/about` | About page | 3256 / 2571 |
| `signedout-home` | signedout | `/` | Front door: this Shabbat's portion, Lein/Study, find a reading, sign-in card, Learn card | 1416 / 1145 |
| `signedout-learn` | signedout | `/learn` | Learn to lein course path (Torah and haftarah lessons) | 2857 / 2081 |
| `signedout-learn-lesson-intro` | signedout | `/learn/intro-phrases` | Lesson 'How a verse is built' (recording failed to load locally) | 952 / 988 |
| `signedout-learn-lesson-sof-pasuk` | signedout | `/learn/torah-sof-pasuk` | Lesson 'Sof pasuk' (recording failed to load locally) | 952 / 988 |
| `signedout-learn-prepare` | signedout | `/learn/prepare` | Prepare a passage (no practice recording locally) | 969 / 988 |
| `signedout-learn-service` | signedout | `/learn/service` | Learn the service course path | 5180 / 4407 |
| `signedout-mine` | signedout | `/mine` | /mine signed out: 'Sign in to continue' | 1020 / 1056 |
| `signedout-print` | signedout | `/print` | Print sheet builder for this week's reading with all options | 27730 / 14154 |
| `signedout-read-lein` | signedout | `/read` | Public reader, Lein lens (colour-coded trope phrases), tool dock, save prompt | 13230 / 5530 |
| `signedout-read-study` | signedout | `/read?lens=study` | Public reader, Study lens (Hebrew + English, commentary unavailable locally) | 26790 / 11554 |
| `signedout-readings` | signedout | `/readings` | Index of every parashah, holiday and passage | 3955 / 3839 |
| `signedout-sign-in` | signedout | `/sign-in` | Sign-in: Google or email code/link | 952 / 988 |
| `signedout-trope-chart` | signedout | `/trope-chart` | Trope chart | 4285 / 2629 |
| `student-account` | student | `/account` | Account: role, email settings, what others see, sign out | 1020 / 1056 |
| `student-booklet` | student | `/print/booklet/<id>` | Printable study booklet | 8596 / 5292 |
| `student-email-settings` | student | `/workspace/email` | Email settings: weekly practice reminder | 1020 / 1056 |
| `student-home` | student | `/` | Front door signed in as student: portion first, 'Your readings' card second | 1400 / 1386 |
| `student-learn` | student | `/learn` | Learn to lein path signed in | 2853 / 2081 |
| `student-learn-lesson` | student | `/learn/torah-sof-pasuk` | Lesson 'Sof pasuk' signed in (recording did not load locally) | 952 / 988 |
| `student-learn-lesson-fold` | student | `/learn/torah-sof-pasuk` | Same, first screen | 952 / 988 |
| `student-learn-prepare` | student | `/learn/prepare` | Prepare a passage | 969 / 988 |
| `student-learn-review` | student | `/learn/review` | Review: 'Nothing to review yet' | 952 / 988 |
| `student-learn-runthrough` | student | `/learn/run-through` | Run-through (blank apart from 'Back to the path') | 952 / 988 |
| `student-learn-service` | student | `/learn/service` | Learn the service, with 'Your parts' | 6028 / 5289 |
| `student-learn-service-lesson` | student | `/learn/service/shma` | Service lesson 'Sh'ma', first step | 952 / 988 |
| `student-mine` | student | `/mine` | My Readings: the student's pinned card (countdown, Open, progress, tutor note, practice dots, links) | 1297 / 1193 |
| `student-mine-after-mark` | student | `/mine` | My Readings after marking verses Got it | 1297 / 1193 |
| `student-mine-calendar` | student | `/mine` | My Readings with Practice calendar expanded | 1591 / 1487 |
| `student-print-sheet` | student | `/print?ref=Genesis+37%3A1-11&kind=torah` | Print sheet builder for own Torah reading | 4207 / 2253 |
| `student-reading` | student | `/mine/reading` | The student's own reading (Lein), full page: text, plan, service parts, lesson notes, honors | 1950 / 1655 |
| `student-reading-fold` | student | `/mine/reading` | Same, first screen only (true position of the tool dock) | 1950 / 1655 |
| `student-reading-gotit` | student | `/mine/reading` | Up close after tapping Got it | 1950 / 1655 |
| `student-reading-goto` | student | `/mine/reading` | Go to verse menu | 1950 / 1655 |
| `student-reading-haftarah` | student | `/mine/reading` | Haftarah tab of own reading | 1776 / 1527 |
| `student-reading-plan-open` | student | `/mine/reading` | Own reading with every disclosure open (About this text, Your plan, Assigned service material) | 3454 / 2815 |
| `student-reading-study` | student | `/mine/reading` | Own reading in Study lens (English, commentaries, 'Rashi isn't available') | 2483 / 1758 |
| `student-reading-text-menu` | student | `/mine/reading` | Text menu: colours, English, tikkun, size | 1950 / 1655 |
| `student-reading-upclose` | student | `/mine/reading` | Up close practice: one verse, phrase by phrase, Still working / Got it | 1950 / 1655 |
| `student-reading-verse-tools` | student | `/mine/reading` | Verse tools sheet for verse 1 (first screen) | 1950 / 1655 |
| `student-reading-verse-tools-full` | student | `/mine/reading` | Verse tools sheet, full page | 1950 / 1655 |
| `student-reading-word-tools` | student | `/mine/reading` | Word tools sheet | 1950 / 1655 |
| `student-readings-add` | student | `/readings?add=1` | 'Add' from My Readings: the readings index | 3955 / 3839 |
| `parent-account` | parent | `/account` | Parent account | 1020 / 1056 |
| `parent-booklet` | parent | `/print/booklet/<id>` | Child's study booklet as the parent | 8565 / 5260 |
| `parent-child` | parent | `/mine/child/<id>` | Child summary: This week, tutor note, practice dots, Practice with Noa, honors | 1284 / 1056 |
| `parent-child-open` | parent | `/mine/child/<id>` | Child summary with Lesson notes, Service parts and See Noa's reading opened | 2956 / 2865 |
| `parent-home` | parent | `/` | Front door signed in as parent | 1400 / 1386 |
| `parent-honors-form` | parent | `/mine` | Family honors form opened from My Readings | 1020 / 1056 |
| `parent-mine` | parent | `/mine` | My Readings: 'Your child' card | 1020 / 1056 |
| `parent-practice-with` | parent | `/workspace/practice/<id>` | 'Practicing with Noa' mode (child's reading as the child sees it), full page | 1904 / 1680 |
| `parent-practice-with-fold` | parent | `/workspace/practice/<id>` | Same, first screen | 1904 / 1680 |
| `tutor-account` | tutor | `/account` | Tutor account | 1069 / 1056 |
| `tutor-claude` | tutor | `/workspace/claude` | Claude connections as tutor | 1020 / 1056 |
| `tutor-find-learner` | tutor | `/mine` | Find a learner with a query typed: 'No learners found' | 1412 / 1335 |
| `tutor-home` | tutor | `/` | Front door signed in as tutor | 1400 / 1386 |
| `tutor-mine` | tutor | `/mine` | My Readings: Your students list, Find a learner, (fixture tutor is also a parent) Your child | 1382 / 1305 |
| `tutor-student` | tutor | `/workspace/tutor/<id>` | One student's page: header, Lesson card, reading, service parts, verses practised, practice days, lessons | 4124 / 2739 |
| `tutor-student-add-lesson` | tutor | `/workspace/tutor/<id>` | Add lesson note sheet (first screen) | 4124 / 2739 |
| `tutor-student-add-lesson-full` | tutor | `/workspace/tutor/<id>` | Add lesson note sheet, full page | 4124 / 2739 |
| `tutor-student-change` | tutor | `/workspace/tutor/<id>` | 'Change' menu (sheet titled Change reading, holds Go to verse) | 4124 / 2739 |
| `tutor-student-fold` | tutor | `/workspace/tutor/<id>` | Same, first screen | 4124 / 2739 |
| `tutor-student-manage` | tutor | `/workspace/tutor/<id>` | Manage menu as tutor | 4124 / 2739 |
| `tutor-student-no-reading` | tutor | `/workspace/tutor/<id>` | Second student (Eli), no practice yet | 4357 / 2869 |
| `tutor-student-open` | tutor | `/workspace/tutor/<id>` | Student page with every disclosure open | 5081 / 3410 |
| `tutor-student-service-parts` | tutor | `/workspace/tutor/<id>` | Choose service parts expanded | 4235 / 2797 |
| `tutor-student-upclose` | tutor | `/workspace/tutor/<id>` | Practice up close as tutor | 4124 / 2739 |
| `tutor-student-verse-tools` | tutor | `/workspace/tutor/<id>` | Verse tools on a student's verse | 4124 / 2739 |
| `admin-account` | admin | `/account` | Admin account | 1020 / 1056 |
| `admin-claude` | admin | `/workspace/claude` | Claude connections | 1084 / 1888 |
| `admin-email-settings` | admin | `/workspace/email` | Admin's own email settings | 1084 / 1888 |
| `admin-guide-sharing` | admin | `/workspace/admin/guide-sharing` | Share guides: export/import | 1084 / 1888 |
| `admin-home` | admin | `/` | Front door signed in as admin: portion first, 'This week' card | 1416 / 1145 |
| `admin-honors-form` | admin | `/workspace/admin/students` | Honors form opened from This week | 1084 / 1888 |
| `admin-invitations` | admin | `/workspace/admin/invitations` | Invitations: invite form and sent list | 1270 / 1888 |
| `admin-invitations-prefilled` | admin | `/workspace/admin/invitations?student=<id>&role=parent` | Invitation form prefilled from a 'Needs a parent' chip | 1270 / 1888 |
| `admin-more` | admin | `/workspace/more` | More: settings, email, Claude, share guides, recording review, roster Sheet | 1084 / 1888 |
| `admin-people` | admin | `/workspace/accounts` | People: link requests, people with access, approvers | 2106 / 2352 |
| `admin-read-study` | admin | `/read?lens=study` | Public reader, Study lens, signed in as admin | 26759 / 11554 |
| `admin-recording-review` | admin | `/workspace/admin/reference-review` | Recording review (could not load locally) | 1084 / 1888 |
| `admin-set-service` | admin | `/workspace/admin/students` | 'Set the service' opens the edit-student panel | 1084 / 1888 |
| `admin-settings` | admin | `/workspace/admin/settings` | Congregation settings: rabbi name, sources, services, links, consent notice, email | 3214 / 3509 |
| `admin-student-access` | admin | `/workspace/admin/students/<id>/access` | People and access for one student: setup checklist, tutors, parents, student sign-in | 2238 / 2612 |
| `admin-student-change-reading` | admin | `/workspace/admin/students/<id>/reading` | 'Change' sheet: titled Change reading, contains only Go to verse | 4349 / 2782 |
| `admin-student-manage` | admin | `/workspace/admin/students/<id>/reading` | Manage menu: confirm reading, set divisions, change verses, prints, lesson note, people | 4349 / 2782 |
| `admin-student-page` | admin | `/workspace/admin/students/<id>/reading` | One student's page as admin (same page the tutor sees plus People and access) | 4349 / 2782 |
| `admin-student-page-fold` | admin | `/workspace/admin/students/<id>/reading` | Same, first screen | 4349 / 2782 |
| `admin-student-unassigned` | admin | `/workspace/admin/students/<id>/reading` | Student with no reading: Explore the full Torah portion / Assign verses / 'Choose a service' | 2396 / 1593 |
| `admin-students-add` | admin | `/workspace/admin/students?tab=students` | Add a student panel | 1654 / 1888 |
| `admin-students-import` | admin | `/workspace/admin/students/import` | Import students from CSV | 1606 / 2210 |
| `admin-students-roster` | admin | `/workspace/admin/students?tab=students` | Students roster with chips and row actions | 1654 / 1888 |
| `admin-this-week` | admin | `/workspace/admin/students` | Workspace landing 'This week': students needing attention | 1084 / 1888 |
| `admin-tutors` | admin | `/workspace/admin/tutors` | Tutors list | 1084 / 1888 |
