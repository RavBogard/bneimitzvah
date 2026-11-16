# Project review: what to cut, what to simplify, and what students, tutors and the admin are missing

2026-11-16, reviewed at `582aa56`. Nine reviewers read the code, tests, docs, schema and connector, ran the app locally, and compared the portal with other products. Their full reports sit beside this file (`01` to `09`); the walkthrough screenshots were not committed. This page is the summary and the order I would do things in.

## Bottom line

- **The product core is good.** A student's own verses with human audio, word cards, Got it marks, tutor notes, a trope course wired to the student's verses and a run-through are ahead of every practice tool we could find.
- **The code is about twice as heavy as the job needs.** There are almost no stray files. The weight is in three places: features that were built and then dropped or parked but never removed; defensive machinery sized for a bank rather than one congregation; and the same thing built three to five times.
- **The biggest gaps are about oversight, not content.** Nobody can see at a glance how a student is doing against the date. The tutor's own assessments feed nothing. You cannot ask Claude how any student is doing. Every programme-management product has a dated timeline per family and the portal has none.
- **Several finished things are unreachable.** The 54-lesson service course has no link a student can follow. The student's home card lost its "next step". Run-through is not reachable from the reading.

## 1. What was removed on this branch

About 130,000 lines across 186 files, of which about 117,000 are the old operators' reference fixtures. No behaviour a person can see changes, and no production data is touched.

| Removal | Source and tests | Notes |
|---|---|---|
| Old reference player and 17 unused exports | about 1,180 lines | Only its own four tests imported the player. Found and verified by the review. |
| Spent release-migrate operators (S1) | 49 files, 3.7 MB | CI no longer fetches full git history. `db-migrate.mjs`, `db-generate.mjs` and the migrations are untouched. |
| Voice experiments in `trope/` (S4) | 43 files, about 6,000 lines | No Python is left in the repo. The engine the app uses, `melody.mjs`, `cells/` and the never-in-repo benchmark policy stay. |
| Student recordings (S2, S3) | 44 files, about 2,900 lines | The `student_recording` table, its schema and its RLS tests stay. The `prebuild` step is gone; the OIDC probe stays because the reference-audio publisher imports it. |
| Finkel listening-review page (S5) | 41 files, about 1,500 lines | "Recording review" is gone from the admin's More list. The table, schema and RLS tests stay. |

Also fixed: two app tests that began failing on 2026-11-07 only because a fixed fixture date passed (`saved-viewer`, `staff-screens`).

Checked on the merged branch: the type check, never-in-repo (3 of 3), the engine and policy suite (333 pass, 0 fail, 1 skipped), and the app tests related to every edited source file. Not run here, so CI is the check: the full Vitest suite, the Postgres suite, and the browser suites. Four browser test files were edited without being run (`e2e/tab-bar.spec.ts`, `e2e/workspace-shell.spec.ts`, `tests/http-browser/fixture.ts`, `tests/http-browser/server.ts`).

Left alone on purpose, though unused: anything in an auth file, the generated better-auth relations, a licence attribution string, `rowState` and `stateWord` (section 4 proposes using them), about 55 lines of unused CSS (list in report 01, section A3), the design note for the deleted review page under `.impeccable/`, and the README line that says student recordings are parked.

## 2. Code: what is superfluous

Each of these is a removal, not a rewrite. All are code-only; none needs a production data change. I did not make them because each is either a product decision or touches a "never relaxed" item.

| # | What | Size | Why it is dead | Needs from you |
|---|---|---|---|---|
| S1 | `scripts/release-migrate*.mjs` operators, their tests and fixtures | about 48 files, 3,300 lines, 3.7 MB | Each is pinned to one migration step between 15 and 25; production is at 56, so none can run again. They are the only reason CI fetches full git history. | Confirm these are not the "migration check scripts" CLAUDE.md protects (those appear to live outside the repo). |
| S2 | Student recordings | about 800 source lines, 28 test files (about 7,000 lines), one worklet | You dropped the feature on 2026-10-22. The flag is off and no screen calls it. | Yes or no. The table can stay. |
| S3 | Prebuild private-media probes | 368 script lines, 888 test lines, run before every build | A one-time check for the recordings feature in S2. | Goes with S2. |
| S4 | Voice experiments in `trope/` | about 5,500 lines, 57 tests, all the Python | SoulX zero-shot is recorded as a dead end, the Modal renderer was never run, and the 2.5 plan uses a different approach in a new folder. | Delete the dead two; move the parked lane to the voice branch. |
| S5 | Finkel listening review page | about 830 source lines, 630 test lines | Finkel playback was cut and the batch never published. STATE says it would be removed. | Keep only if 2.5's listening rounds will reuse it. |
| S6 | Notifications | about 700 lines and a daily cron | Complete, and MISSION says they stay off. The email settings page a student sees does nothing. | Turn on or park. See gap A7 below: a weekly tutor email is one of the most-wanted things. |
| S7 | Service course, if it stays unlinked | 107 KB of components, 223 KB of lib, five routes | Nothing a student can reach links to it. | Link it (gap G1) or park it. I would link it. |
| S8 | Small leftovers | about 150 lines | Practice-calendar retention is tested but never runs; the "I read this" route parses a request and always answers 403; the `auth` CLI dependency and its script; role-tab code from before only admins had tabs. | None. |

Two more to check with you, because I could not see production settings: is the CSV roster import still used now that Maven intake exists, and does anyone read the roster Sheet?

## 3. Code: what is over-complicated

Ranked by payoff. Sizes are estimates from the reviewers.

**C1. Errors that say nothing, by design.** 178 `throw 0`, about 100 `"X unavailable"` errors, 76 bare catches, and a logger that accepts only a fixed event name and status. `composition.ts` turns every exception into `RuntimeUnavailable` with no route, name or stack. A 503 in production cannot be diagnosed. This is the single change that most improves maintainability, and it removes code. Keep the rule that secrets and addresses are never logged; log the route, the error name and the stack.

**C2. The browser re-proves the session around every read.** `workspace/provider.tsx` (one 520-line function, a 38-member context) hides the page and refetches the session on every route change, and wraps most reads in check, read, check. That is three requests per fetch. The server already enforces access, so this protects nothing. Removing it saves about 100 KB and about two thirds of session requests. Medium risk because the parent's "practice with child" mode threads through it.

**C3. Hand-written validators for the site's own API.** 470 KB across 53 client files, 22 with their own byte-capped stream readers, plus 1,099 lines of server validation with the UUID pattern written 37 times and `Object.freeze` 833 times. The page is validating JSON from its own server as if it were hostile. One file already shows the light pattern (types derived from the server). Saves 250 to 300 KB.

**C4. Everything is constructed on every request.** One catch-all route forwards to a dispatcher that matches 30 modules twice, opens a new database pool, and builds all 60-odd services per request. Each transaction also runs a database role audit that belongs at deploy time, and the tenant host is resolved three times. A route table, lazy services and a once-per-start audit save about 600 lines and real latency.

**C5. The same thing built several times.**
- Three copies of "one saved document per member" (course progress, verse review, service-course progress): about 850 lines, differing only in names. Five browser-to-account sync engines on the client, one of them 17 KB to sync text size and colours.
- Three readers (assigned, public or saved, proposed) orchestrating the same twenty parts; `longDate` is defined in 11 files.
- Three service-part systems (section 4, G3).
- Five places that end a tutor link; Tutors, People and per-student access pages overlap.
- 46 connector tools where about 37 would do; `set_student_service` and `update_student` call the same function.

**C6. Safety machinery out of proportion.** These sit next to the four high-stakes areas, so they are yours to rule on, and any change gets the adversarial pass:
- The 15-minute fresh sign-in rule for assigning a tutor or sending an invitation, mirrored in Claude as "disconnect and reconnect". This is the largest friction in intake.
- Replay receipts and mutation ids on top of version checks, for every write including a verse note.
- Signed prepare-and-confirm tokens with 13 derived secrets, and a review sheet before nearly every write, including reversible ones.
- Private Blob storage, OIDC and SHA pins for reference clips that are published openly under CC BY-SA.
- Tenant plumbing in every query (369 filters, 153 composite keys) while the one real second congregation went out as a fork.

**C7. Tests and CI.** Test code is 90,500 lines against 64,300 of app code, on five runners, and a PR starts 20 jobs.
- 38 tests pin the SQL text of migrations already applied. One catalogue test (RLS forced, no broad grants) would replace them and cover the 19 migrations that have none.
- Nine tests grep the source for code shape, and 24 read component or CSS source as text.
- The `http-browser` suite hand-rebuilds the app's routing and has already drifted from it; 50 of its 55 files each boot their own server.
- Windows doubles the Vitest jobs. Firefox, PulseAudio and ffmpeg are installed in six jobs for two test files. Docs-only commits run everything.
- The low-risk test and CI items remove about 105 files and 10,000 lines without touching never-in-repo, the RLS tests or the three device projects.

**C8. Docs and process.** Every session is told to read MISSION and STATE first: about 85,000 tokens, with rulings scattered across some 25 amendments, some reversed. A 200-line "rulings in force" page and a 60-line STATE that is replaced rather than appended bring that to about 8,000. Roughly 370 of 393 docs files are historical and can move to `docs/archive/` with nothing deleted. `AGENTS.md` contradicts CLAUDE.md, the agent brief is half Windows paths, the README still says 1.0 is in progress, and CLAUDE.md still refers to "the rest of 1.9" and "green on Windows".

## 4. Gaps for students, tutors and the admin

Rulings respected: no generated chant before your listening review, no scores or streaks, student recordings and d'var Torah stay out unless you say otherwise.

### Students and parents

| # | Gap | Fix | Size |
|---|---|---|---|
| G1 | The service course (blessings, Sh'ma, V'ahavta, the morning service, Havdalah) has no way in. | Link it from the student's home and reading. | S |
| G2 | The home card no longer says what to do next; it offers only "Open". The logic for "first verse not yet marked Got it" already exists. | Name the work on the button and open there. | S–M |
| G3 | A student can meet three different lists of service parts. | One list. | M |
| G4 | Run-through and step-by-step verse preparation are only on the Learn home, and preparation is offered for the first verse only. | Offer both from the reading. | S |
| G5 | Only the assigned-reading page counts as a practice day. Lessons, review, run-through and service lessons do not. | Count them. | S–M |
| G6 | Staff and system wording reaches a twelve-year-old: "Mark unverified", "Send the same save again", "Your service connection is queued". Raised in two earlier reviews and still open. | Rewrite in the house voice. | S |
| G7 | The installed app opens on the public front door, four taps from a verse. | A signed-in student lands on their own reading. | S |
| G8 | Tutor feedback sits in four places with no sign of what is new. | One place, newest first, marked new. | M |
| G9 | A child without their own email address is second-class: a 60-minute "practice with" session with no course on their own verses and no run-through. | Needs a count of how many children this is, then an auth decision. | M–L |
| G10 | Recording holes (18 special haftarot, three parashah haftarot, 38 Torah verses) are found by the student. | Warn the tutor when the reading is assigned. | S |
| G11 | No melody audio for blessings or prayers; the trope chart is silent. | Waits on recordings (2.1). | — |

Clutter a student does not need: an email settings page that does nothing, a roles list on one-role accounts, about twelve entry points on the Learn home, four ways to print, and "My translation" with a 344-line save coordinator and version history (if students do not use it, that is a large removal).

### Tutors

| # | Gap | Fix | Size |
|---|---|---|---|
| T1 | No per-aliyah status. The portal already computes Not started, Working or Solid per aliyah, but nothing shows it to the tutor. | An aliyot block on the student page with "mark aliyah solid". | S |
| T2 | The tutor's Solid marks feed nothing. The admin's "Behind" flag uses the student's own Got it marks. | Use the tutor's assessment for "behind". | S |
| T3 | What the student did since the last lesson sits below the whole reading on a phone, and nothing is framed that way. | "Since your last lesson" at the top. | S–M |
| T4 | No way to tell the rabbi something privately. Every lesson note is visible to the family. | A rabbi-only line and an attention flag. | S–M |
| T5 | The only tutor email is a translation-draft notice that links to the front page. | A weekly email with direct links (uses S6). | M |
| T6 | Weekly work is free text only. | Assign verses for the week; it appears on the student's first screen. | S |

### Admin (you)

| # | Gap | Fix | Size |
|---|---|---|---|
| A1 | Claude can set a student up but cannot say how any student is doing. `list_students` returns id, name, date and kind. Status, marks, practice, lesson log and notes are web-only. | One read tool for student status. | S |
| A2 | The 15-minute rule (C6) on tutor assignment and invitations. | Relax for these two, with an adversarial pass. | S |
| A3 | No bulk invitation. A cohort of 20 is about 60 actions, and there is no connector tool for it. | "Invite all families". | S–M |
| A4 | "This week" lacks days practised, last lesson, tutor-solid count, never-signed-in and pending requests. Honors shows as yes or no although "n of 7 sections" is already computed. | Richer cards, from data already stored. | M |
| A5 | No dated timeline per student and no 8, 4, 2 and 1-week checkpoint view. Every programme manager on the market has this; it is the one thing they sell. "Ceremony done" is manual and per student. | One congregation template of 8 to 12 offsets from the ceremony date, with an on-pace flag. | M |
| A6 | Guides, study voice, discussions and portion summaries can only be changed through Claude. If the connector is down you cannot withdraw published content, and held drafts are invisible on the web. | A minimal web page: list, hold, withdraw. | M |
| A7 | No change history. `audit_event` is written from 23 places and read by nothing. | A read-only "recent changes" list, or stop writing it. | S |
| A8 | No services calendar, and no calendar link for families. | A read-only `.ics` per family. | S |

Data already collected and shown to no one: tutor assessments, per-aliyah state, honors section counts, part requests, lesson cadence, invitation and sign-in state, and the notification delivery ledger.

### Against other products

The field splits into practice tools (TropeTrainer, PocketTorah, Torah Readers Tutor, Tikun Korim and others) and programme managers (Mitzvah Tools, MitzvahManager, Aliyah). The portal beats every practice tool on text, study and teaching, and is thinner than every programme manager on the dated family timeline (A5). MitzvahManager costs about $46 per student per year at this size.

Worth taking from them: the timeline (A5), verse-level weekly assignment (T6), the family calendar link (A8), and perhaps a documents shelf. Six products offer student recording with a tutor reply; you dropped that on 2026-10-22, so it is listed as a question, not a gap.

Not worth having at this size: lesson scheduling and attendance, in-app message threads, automated chant scoring, badges.

What none of them has: commentary and reviewed study guides beside the chant, word cards with syllables and stress, a sequenced trope course on the student's own verses, open human word-level audio, and the Claude connector.

### What the screens showed

The app was run locally with a throwaway database and synthetic people, and 93 screens were captured at phone and laptop width (`shots/`, described in report 06). Audio, real text and calendar lists could not be reached locally, so those are judged from code only.

- **Student front door.** A signed-in student lands on this Shabbat's portion with a large "Lein" button for a reading that is not theirs. Their own reading is a card below: two taps to open, three to practise.
- **Student reading page.** 1,950 to 3,450 px tall on a phone. The tutor's note and plan sit at the bottom, under the licence text. Three print links have three different names.
- **Student dead ends.** "Family honors" tells the child to send names to the office. A bare "Add" on My Readings opens the whole readings index. The Listen button in the dock is greyed out with no reason given. The email settings page offers a switch the congregation has turned off.
- **Tutor's student page on a phone.** 4,100 to 5,100 px, with the lesson log and practice evidence last. The laptop layout, with a right-hand column, works well.
- **Practice dots disagree.** The student and parent cards show the last seven days; the tutor and admin page shows the calendar week; the tutor's list says "5 of last 7". The same student showed 5, 2 and 5.
- **"Change" opens the wrong thing.** On tutor and admin pages it opens a sheet titled "Change reading" that holds only a go-to-verse picker.
- **Setting up one student** crosses four places (Add student, the student page and Manage, People and access, Invitations): 12 to 15 taps. The checklist on People and access could be the whole flow.
- **"People" means three things**: the tab that opens Invitations, a sub-tab for accounts, and an action on each row. "This week" and Students name the same problem differently ("Reading to confirm", "Reading needs review"), and "This week" lists some students by a rule the page does not state.
- **Admin pages on a laptop** are at least 1,888 px tall with about 850 px of empty space under the footer. Settings is one 3,200 px form with Save in the middle.
- **Sign-in** says "We'll email you a code" above a button reading "Email me a sign-in link".
- **Working well:** the parent's summary of a child, the tutor's student list, the Add lesson note sheet, Up close practice, the booklet and the Learn landing. Nothing overflowed sideways at either width.

## 5. What you decided on 2026-11-16

| Question | Your answer | Status |
|---|---|---|
| S1 Old migration operators | Remove | Done on this branch |
| S2, S3 Student recordings and build probes | Remove (table stays) | Done on this branch |
| S4 Voice experiments in `trope/` | Remove | Done on this branch |
| S5 Finkel review page | Remove | Done on this branch |
| S6 Notifications | Leave parked | No change. Hiding the student's inert email settings page is a small follow-up. |
| G1 Service course | Link it for students | Next build. Student-visible, so you see it before it ships. |
| A2 Fresh sign-in rule | Relax for tutor assignment and invitations | Next build, with the adversarial review. |
| C1 Useful error logs | Propose in detail | To be specified |
| C6 Open audio served openly | Propose in detail | To be specified |
| C6 Fewer confirm steps and replay receipts | Propose in detail | To be specified |
| C6 Second-congregation plumbing | Scope only | To be specified |

Two questions came back "Na", and I have treated both as unanswered rather than as a no:

- **Oversight views** (days practised across students, asking Claude how students are, a tutor's private line to you, a dated timeline per student). Nothing here is planned until you say which, if any, you want.
- **Still in use?** (students' "My translation", the CSV roster import, the roster Google Sheet, tests on Windows). Nothing has been removed on the strength of that answer.

Still open: how a child without their own email should sign in (G9), once we know how many children that is.

## 6. The order I would do it in

1. **Finish clearing dead weight**: S8, the unused CSS, the 38 frozen migration tests replaced by one catalogue test, the source-grepping tests, the CI trims, the docs archive and a "rulings in force" page. No behaviour change, and every later PR gets cheaper and faster.
2. **Make failures diagnosable** (C1).
3. **Reconnect what is already built**: G1 (approved), G2, G4, G6, G7 for students, plus the front door and dead ends from the walkthrough; T1, T2, T3 for tutors. All small.
4. **Intake friction**: A2 (approved), A3, and one setup flow for a student instead of four places.
5. **Oversight**, if you want it: A1, A4, then the timeline A5 with T6 and A8.
6. **Structural simplification**, one area per PR: C4, C2, C3, C5, then the approved parts of C6.
