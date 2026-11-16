# 08. Tutor and admin: feature and UI/UX gap analysis

Read-only review of the code a tutor and the admin (Rabbi Daniel) reach, on 2026-11-16. Paths are relative to `/home/user/bneimitzvah`. I read source, plans and rulings; I did not run the app or the browser tests, and I read the e2e and http-browser specs only by their test names. Where I did not verify something, it says so.

## 0. What the earlier reviews asked for, and what the code now has

The 2026-10-24 product review (`docs/planning/2026-10-24-product-review/REPORT.md`) is the one that matters for these two roles. Its staff findings are built, so this report does not repeat them:

| Earlier finding | State in code |
|---|---|
| G7 tutors can't see where a student is stuck | Built. "Needs work" (`src/components/portal/workspace/staff/needs-work.tsx`), the lesson card and rail (`workspace/reading.tsx:92-104`, `:503-504`), "Add note for this verse" (`staff/lift-note.tsx`), the family line (`staff/student-lines.tsx`), "with parent" on a mark (`staff/practice.tsx:44-47`). |
| G7/decision 7 per-day practice for the assigned tutor | Built and open since 2026-10-27 (`src/lib/practice-visibility/release.ts:15`, `src/server/practice-visibility/service.ts`). |
| G10 admin "Needs you" | Built as This week (`staff/this-week.tsx`, `staff/model.ts:57-77`), roster chips, three next-step links after Add student (`workspace/roster.tsx:201`), Sunday hint. |
| G11 tutor hand-over | Built (`src/server/staff/service.ts:81-131`, "Teaches n students"). |
| G12 family waiting on aliyah divisions | Built, status only (`staff/model.ts:151-155`). |
| G13 invitations 7 days, Copy link | Built (`workspace/invitations/workspace.tsx:72`). |
| People with access, Make/Remove tutor (2026-11-03) | Built (`src/server/people/tutor.ts`). |
| Tutor digest email (G7, "waits on decision 7") | **Not built, and no longer in any plan.** Decision 7 was answered; the digest was never picked up again. |

Rulings that bound this report (checked in MISSION and the plans):

- **Practice visibility.** Ruling 45 (MISSION line 145): others get days practised only, "no cross-student reporting or leaderboards". Decision 7 (1.9 PLAN line 17) widened it for the **assigned tutor only**: verses opened per day, mark changes, Learn's "Can hear" and the most-confused pair; **parents get two counts**; no durations, play counts or scores. The code is stricter than the rulings on one point: admins are shut out of the decision-7 read altogether (`practice-visibility/service.ts:18-20`, "Admins (rabbis) … never come through here"). Admins do read the days-practised calendar per student (`workspace/reading.tsx:427`, `StaffPracticeDays`) and every verse's marks, and This week already shows "n of m verses got" per student.
- **Student recordings are dropped.** Daniel, 2026-10-22: "I don't think this is really a useful thing for us" (STATE line 261); decision 6, "Hear yourself: revisit with 2.5". The routes are 404 unless `PORTAL_RECORDINGS_ENABLED` (`src/server/http/recordings.ts:14-23`). So "the tutor hears recordings" is not a gap to build; it is a ruling. About 550 lines of `src/server/recordings/` are parked code.
- **D'var Torah is out of the app.** 2.0 PLAN line 7: "that all happens with the rabbi not in the app. Cut all related pieces." No oversight of d'var work should be proposed.
- **No scores, streaks or tallies to students.** Nothing below shows a student anything new.

---

## 1. Tutor

### 1.1 Jobs

| Job | What exists | Screens / steps | What is missing |
|---|---|---|---|
| **Before a lesson:** what did the student do since last time | `/mine` "Your students" row: chip for a date within two weeks, "Practiced 3 of last 7 days · Last lesson Oct 17 · 2 verses still working", first line of the latest note (`mine/your-students.tsx:35-46`). Student page `/workspace/tutor/<id>`: lesson card (next date, Needs work, "Last time"), then "Verses practiced" per day for 14 days, Learn's lines, practice-days calendar, lesson list. | 1 tap from `/mine`. The card is at the top of a right-hand rail on a wide screen; on a phone the card is under the title but the per-day lines and lesson list are below the whole reading and the service parts (`reading.tsx:429`, `:503-504`). | (a) Nothing is framed "since the last lesson": the window is a fixed 7 and 14 days. (b) No per-aliyah picture; see "track what is solid". (c) Translation drafts and service-part requests since last time are not listed; each is found by opening verses or a folded `<details>`. (d) No lesson day or time is stored, so the list is ordered by ceremony date, not by who the tutor sees today. |
| **During:** teach from the text, mark, note | Lein/Study on the student's reading, Practice up close with a verse picker, tutor assessment per verse (Not started / Working / Solid, `progress/marks.tsx`), "Add note for this verse", human reference recordings. | Same page. | Assessing is one verse at a time in Practice up close; no "mark this aliyah solid". No "play for student" control (review TP-25, parked with 2.5). |
| **After:** feedback and next steps | Lesson note with date, summary and "Before next time" (`lessons/panel.tsx`), shown to the student on Today and to parents in the weekly email (`server/notifications/copy.ts:51-65`). | "Add lesson note" on the card: 1 tap, a sheet, Save. | Every note is student- and parent-visible. There is no line for the rabbi only ("worried about pace", "family asked to move the date"). |
| **Between lessons** | One email kind for tutors: "A new translation draft to read", at most one a day per student, linking to the portal's front page, not to the student (`copy.ts:38-48`). | Email, sign in, find the student, find the verse. | No weekly tutor email. No notice when a student is assigned, when a student sends a service-part request, or when a student has not opened anything for a week. |
| **Track which aliyot and verses are solid** | Per-verse tutor assessment and student self-mark, both stored (`verse_assessment`, `verse_self_check`). "Needs work" lists the student's Still working verses. The Not started / Working / Solid state **per aliyah** is already computed, for the student's Today only (`workspace/today/model.ts:64-75`, `rowState`). | Scroll the reading and read chips verse by verse. | No per-aliyah summary for the tutor. The tutor's own "Solid" marks are summarised nowhere: `rosterLine` and "Needs work" use the student's marks only. Verified by grep: `assessment` is read only in `progress/`, `today/model.ts` and `learn/own-verses.ts`. |
| **Flag a student who is behind** | Nothing. The admin's "Behind on practice" chip is computed from the student's own Got it marks (`staff/model.ts:67`). | — | The tutor cannot tell the rabbi anything inside the app. The chip ignores the person best placed to judge. |
| **Onboarding a new student** | The student appears in Your students once an admin assigns them. Tutor can set the reading, divisions and service parts (Manage sheet, `staff/manage-sheet.tsx`). Family line says whether a parent has joined. | Manage → Change verses → preview → confirm. | No email or mark says "new student assigned". A tutor cannot invite the family or see why it has not joined beyond the one status line (by design: invitations are the admin's). |
| **Handing a student over** | Admin only: remove and assign on the student's People page, or the whole-tutor hand-over. Lesson notes, marks and assessments stay with the student, so the next tutor sees the history. | Admin: two fresh-sign-in writes for one student. | The tutor cannot ask for it. No hand-over note. Fine for this size; not worth building. |
| **Through Claude (MCP)** | `list_students`, `get_student`, `get_reading`, `study_link`, `print_sheet_link` (`src/server/mcp/tools.ts:134-165`, `study-tools.ts`, `print-tools.ts`). | — | No lesson notes, marks or practice lines. By design for practice (decision 7 names MCP as excluded); lesson notes are not covered by that ruling. |

### 1.2 Ranked gaps (tutor)

Sizes: S under a day, M a few days, L a week or more.

| # | Gap | Kind | Who it hurts | Evidence | Planned? | Fix | Ruling collision |
|---|---|---|---|---|---|---|---|
| T1 | No per-aliyah status on the tutor's page | Exists but buried (the function exists, shown only to the student) | Every tutor, every lesson | `today/model.ts:64-75`; not imported by anything under `staff/` or `reading.tsx`'s lesson card | Unplanned | Add an "Aliyot" block to the lesson card: one row per aliyah and the haftarah with Not started / Working / Solid and the count of Still working verses, each a link to that aliyah. Reuses the progress pages "Needs work" already reads. **S** | None: the tutor already reads every mark. |
| T2 | The tutor's "Solid" judgement feeds nothing | Missing | Tutors and the admin | `staff/model.ts:67` (behind = student's Got it under half); `server/staff/data.ts:112-122` (`verseCounts` joins `verseSelfCheck` only) | Unplanned | Count tutor-solid verses beside got-it in `verseCounts`; show "9 of 21 verses solid (tutor) · 14 got (student)" on the tutor row and the admin card; base "behind" on the tutor's marks when the tutor has made any. **S-M** | None for staff. Do not show the student a count. |
| T3 | No way to flag a student to the rabbi; every note is family-visible | Missing | Tutor, admin | `lessons/panel.tsx` (two fields, both shown to learner and parent); `server/data/lesson-log.ts:15-24` | Unplanned | One optional field on the lesson note, "For the rabbi only", plus a checkbox "Needs the rabbi's attention". The flag becomes a chip on the admin's This week. One nullable column and one boolean. **M** | Wording that says who sees a note is a privacy string: one question for Daniel. |
| T4 | Phone order: what the student did is below the whole reading | Buried | Tutors on a phone or on Zoom with a narrow window | `reading.tsx:429` (staff: service block then lessons block), `:503-504` (rail only when wide) | Unplanned | On narrow screens put "Verses practiced" (last three days, "Show all") inside the lesson card. **S** | None |
| T5 | No tutor email at all beyond translation drafts | Missing | Tutors who do not open the portal between lessons | `server/notifications/schedule.ts:4` (three kinds, none a tutor summary); review G7 said "digest waits on decision 7" | Was implied in G7; in no plan now | A weekly "Your students this week" email on the congregation's digest day: per student the roster line, the next date, pending part requests, new drafts, and a link straight to the student. Same ledger and unsubscribe as the parent digest. **M** | Per-day detail is tutor-only under decision 7 and the email goes only to the assigned tutor, but decision 7's code comment lists "notifications" as excluded (`practice-visibility/service.ts:18-20`). Keep the email to days practised (ruling 45 allows that) and lesson dates, or ask Daniel. Resend's free tier (100 a day) is the money check. |
| T6 | Service-part requests from a student are invisible until the tutor opens a folded section | Buried | Students waiting for an answer; tutors | `service-learning/my-service.tsx:118` (`<details>` "Part requests (n pending)"); no notice kind | Unplanned | Add "1 request waiting" to the tutor row and the lesson card; include in T5. **S** | None |
| T7 | "Since last lesson" is not a view | Buried | Tutors | `practice-visibility/service.ts:29` (fixed 14 and 7 days); `lastLesson` is already returned | Unplanned | Draw a rule in the per-day list at the last lesson date and head the lines above it "Since your last lesson (Oct 17)". **S** | None |
| T8 | Draft email links to the front page | Buried | Tutors | `notifications/copy.ts:38-48` ("Sign in to read it" + portal link) | Unplanned | Link to `/workspace/tutor/<id>`; sign-in already returns to the address asked for (`e2e/sign-in-return.spec.ts` exists; not re-verified). **S** | The 1.1 decision says links are the portal's address only, "never a link that opens content without signing in". A link that requires sign-in fits the reason; lead's call. |
| T9 | No lesson day per student | Missing | Tutors with a dozen students | No column; `your-students.tsx:26` sorts by ceremony | Unplanned | Optional weekday on the tutor-student link; "Today" group at the top of Your students. **M**. Low priority at this size. | None |
| T10 | Assess a whole aliyah at once | Missing | Tutors | `progress/marks.tsx` (per verse) | Unplanned | "Mark aliyah solid" on T1's row. **S** after T1 | None |
| T11 | Hear the student's recording | Ruling | — | STATE line 261; decision 6 | Parked to 2.5 | Do not build. Delete or keep parked `src/server/recordings/` (another report's subject). | **Collides** with Daniel's 2026-10-22 ruling. |

Only possible in the web UI for a tutor: everything about lessons, marks, practice and service parts. Only through MCP: nothing.

---

## 2. Admin (Rabbi Daniel)

### 2.1 Jobs

| Job | What exists | Screens / steps | What is missing |
|---|---|---|---|
| **Start-of-year intake** | MCP: `get_maven_roster_query` → Maven's own connector → `propose_roster_changes` → `apply_roster_changes` (`mcp/roster-tools.ts`). Web: Students → Import (CSV, three header formats, review step) or Add student. | MCP: one conversation. Web CSV: paste, review, import. | Intake creates students and stops. Each then needs a service slot, a reading, a tutor and a parent invitation, one student at a time (below). |
| **Assigning readings** | Web: student page → Manage → Change verses → preview → confirm. MCP: `preview_student_reading` → `set_student_reading`. A reading cannot be suggested until the service slot is set. | Web about 5 actions per student per reading; MCP one sentence each. | No "assign the calendar reading to every new student with a slot" in either place. |
| **Assigning tutors** | Web: Students → row "People" → Tutor to assign → review sheet → confirm, **with a session under 15 minutes old**. MCP: `list_tutors` → `set_student_tutor`, same 15-minute rule counted from connecting Claude (`mcp/instructions.ts`, step 3). | 4 actions per student plus a sign-out and sign-in if the session is older than 15 minutes. | No way to give one tutor several students at once. The Tutors page lists who teaches whom but cannot assign from there. |
| **Inviting families** | Web only: This week chip "Needs a parent" → Invitations form pre-filled with the parent's address (`invitations/workspace.tsx:48-54`) → Review invitation → send, fresh session again. Copy link when mail fails. | 3 actions per family, all inside 15 minutes of signing in. | **No bulk invite** and **no MCP tool** for parents or students (`invite_tutor` only). A cohort of 20 is 60 actions against a 15-minute clock. Maven intake says in terms that inviting is "his separate step in the portal". |
| **Weekly oversight** | This week (`/workspace/admin/students`): cards for anyone with a date inside 7 days or something wrong inside 8 weeks; at most two chips (no tutor, behind, needs a parent, reading to confirm) and setup lines (no reading, no service date, honors not started); "n link requests waiting". Students tab: every active student by date with tutor, parent-joined and "n of m verses got". | 1 screen. | See 2.3: no days practised, last lesson, tutor's judgement, flag, pending requests, or anything about students more than 8 weeks out who have gone quiet. **Nothing of this is in MCP**: `list_students` returns id, name, date and kind, ordered by id (`mcp/tools.ts:134-147`). |
| **8/4/2/1-week checkpoints** | Only the 8-week window and the 2-week "behind" rule (`staff/model.ts:18`, `:35`). Two optional rehearsal dates per student. | — | No notion of a checkpoint: nothing says "8 weeks out: reading confirmed, tutor assigned, parent joined, honors started; 4 weeks: half solid; 2 weeks: honors complete, rehearsal 1 set; 1 week: all solid, booklet printed". All the inputs exist. |
| **Service slots and rehearsals** | Per student: slot (morning / Havdalah) and two rehearsal dates in the Edit sheet or `set_student_service`. Service parts per student (editor with a check step). Staff Google Sheet with name, Hebrew name, date, slot, parashah, verses, tutor, rehearsals (`server/roster-sheet/rows.ts:10`), refreshed nightly and by button. | Edit sheet: 3 actions. | No calendar or list of services: two students on one Shabbat, or a date with no rehearsal set, shows only by reading the Sheet. |
| **Honors** | Per student: Honors sheet from the roster row or This week; print; honoree links. Status across students is one boolean, "Honors not started" (`server/staff/data.ts:42-45`). | 1 tap per student. | "n of 7 sections saved" is computed for the parent (`staff/model.ts:157-165`) but the admin gets only started / not started. Honors are not in MCP at all. |
| **Study guides** | MCP only for writing: `list_guide_work`, `list_guide_catalog`, `get_reading_for_guide`, `save_guide`, `publish_guide`, `save_student_guide`, portion summaries, discussions. Web: a guide status line on the admin's student page, "Share guides" under More, and the note "Discussions and insights are curated through Claude connections" (`shell/more.tsx`). | — | No web list of "held drafts waiting for you" or "students with no per-student notes"; the web cannot publish a held guide. Acceptable if Daniel always has Claude open; a held draft is otherwise invisible. Not verified: whether the guide status line names a held draft. |
| **Communicating with families and tutors** | Invitations; the weekly parent digest (off by default, two switches); lesson notes. | — | No message from the rabbi to a family, a tutor or the cohort. Messages to real people are a stop-and-ask item in CLAUDE.md; the practical route is Gmail from Claude, which needs addresses the MCP deliberately withholds (`get_student_setup` returns "on file" booleans only). |
| **End-of-cycle archive** | "Ceremony done" in the Edit sheet (two steps, reversible), a Ceremony done list under Students with Undo; the student keeps Learn and Study, tutors lose access (`roster.tsx:124-143`, `:236-241`). | 3 actions per student. | No prompt when a ceremony date passes (the student just drops off This week because `days < 0`, `model.ts:63`), and **no MCP tool** (`disable_student` only, which is the wrong action). Past students sit in an unbounded list. |

### 2.2 Ranked gaps (admin)

| # | Gap | Kind | Who it hurts | Evidence | Planned? | Fix | Ruling collision |
|---|---|---|---|---|---|---|---|
| A1 | The cohort overview is not available through Claude | Web only | Daniel, who works through MCP | `mcp/tools.ts:134-147` (id, name, date, kind; ordered by id); `server/staff/service.ts:41-70` (`status`) has no MCP caller | Unplanned | One read tool, `list_student_status`: per active student in ceremony order, the `StudentStatus` facts plus slot, rehearsals, next event, honors sections saved, days practised of 7, last lesson date. Reuses `staff.status`. **S-M** | Names and readings to Claude are already allowed. Days practised is within ruling 45; "no cross-student reporting" was aimed at leaderboards, and the web already lists verses got per student, but the N23 comment excludes MCP. One line for Daniel, or ship without practice days. |
| A2 | A fresh sign-in (15 minutes) is required to assign a tutor or send any invitation | Clutter that blocks a job | Daniel at intake | `server/access/service.ts:20-21` (`manage-invites`, `manage-relationships`: `fresh: true`); `server/access/identity.ts:34`; MCP mirror in `mcp/instructions.ts` | Unplanned; SPEC 2026-11-03 reuses the rule | Keep fresh for making admins, approvers and Make/Remove tutor (they grant authority with no acceptance). Drop it for assigning an existing tutor to a student and for sending a parent or student invitation (the invitee must still accept from their own mailbox), or widen the window to the working day. A one-line rule change per capability plus test updates. **S** | Auth is high-stakes: needs the adversarial pass. This loosens a deliberate control, so it is Daniel's call; it is the single largest friction in his intake. |
| A3 | No bulk parent invitations, and none through MCP | Missing | Daniel at intake; families who wait | `invitations/workspace.tsx` (one draft at a time); no `invite_parent` in `mcp/setup-tools.ts`; `staffApi.needed` already computes who needs one | Unplanned | "Invite all n families" on This week: a list with each address, tick boxes, one review, one send, per-row outcomes. Then `invite_families` in MCP that takes student ids and returns outcomes with addresses masked. **M** | Messages to real people: the rabbi presses the button, so no new ruling; the MCP tool should be attended-only, as `approve_portion_summary` is. |
| A4 | This week misses the signals that say a student is drifting | Missing / hidden data | Daniel | `staff/model.ts:57-77`; see 2.3 | Unplanned | Add to each card: days practised of the last 7 (already readable by admin per student), last lesson date (lesson log, admin-readable), tutor-solid count (T2), the tutor's flag (T3), pending part requests (T6). Add chips "No lesson in 3 weeks" and "No practice in 14 days" for anyone inside 12 weeks. **M** | Days practised: allowed (ruling 45). The per-day detail stays tutor-only. |
| A5 | No checkpoint view | Missing | Daniel | `staff/model.ts:18`, `:35` are the only time rules | Unplanned | A Students-tab table, one row per student, columns = the setup and progress facts, each cell done / due / late against 8, 4, 2 and 1 weeks before the date. Pure function over data already loaded; rules in one constant so Daniel can change them. **M** | None. Staff-only. |
| A6 | Honors progress across students is a boolean | Buried | Daniel, office | `server/staff/data.ts:42-45`; `savedSections` in `staff/model.ts:157-165` used for parents only | Unplanned | Return sections saved from `status`; show "Honors 4 of 7" on the card and in A5; chip when under 7 at two weeks. **S** | The status must stay a count: no honoree names in a list read. |
| A7 | People are split across four places | Split | Daniel | `shell/tabs.ts:30-33` (Invitations, Tutors, Accounts under "People") plus `/workspace/admin/students/<id>/access` | Unplanned | Leave the pages; make the student's card and the Edit sheet do the two common writes in place: "Assign tutor" select and "Send parent invitation" button. **M** | Depends on A2. |
| A8 | Ceremony done is manual, per student, web only | Missing | Daniel | `roster.tsx:124-143`; no MCP tool | Unplanned | This week line the Monday after: "3 ceremonies have passed: mark done", one button each or all; `set_ceremony_done` in MCP. **S** | Ending tutor access is an access change: adversarial pass on the MCP tool. |
| A9 | No services calendar | Missing | Daniel, office | Sheet columns only (`roster-sheet/rows.ts:10`) | Unplanned | A by-date grouping on the Students tab (month headers, slot, both rehearsals, a mark when two students share a date or a rehearsal is unset). **S** | None |
| A10 | Held guide drafts and curation are invisible on the web | MCP only | Daniel when not in Claude | `shell/more.tsx` note; `publish_guide` MCP only | Unplanned | A read-only "Waiting for you in Claude" list under More (held guides, unapproved summaries) with the sentence to say to Claude. **S** | None |
| A11 | Bulk tutor assignment | Missing | Daniel at intake | `relationships/workspace.tsx` (one student at a time) | Unplanned | Through MCP it is already one sentence per student once A2 is fixed; no web work needed. **—** | — |
| A12 | Oversight of d'var Torah | Ruling | — | 2.0 PLAN line 7 | Cut | Do not build. | **Collides.** |

Only possible through MCP today: Maven intake, writing and publishing study guides, portion summaries, discussions and insights, source translations, per-student guide notes, page views.
Only possible in the web UI today: This week and all status, inviting parents and students, honors, lesson notes, service parts, ceremony done, tutor hand-over, link-request approval, Make/Remove tutor, congregation settings, CSV import, the staff Sheet refresh.

---

## 3. Data already collected that no one is shown

| Data | Where it lives | Who sees it now | Who could, within the rulings |
|---|---|---|---|
| Days practised per student | `practice_day`; read by `practisedDays` (`server/data/practice-visibility`), the parent digest and the staff calendar | Tutor (row line), parent (email), admin only by opening one student's calendar | Admin, as a per-student line on This week (ruling 45: "days-practiced only") |
| Verses opened per day, mark changes | `practice_event` (90 days), 0052 views | Assigned tutor only, 14 days | No one else (decision 7). Do not widen. |
| Last lesson date; lesson cadence | `lesson_log` | Tutor row; admin only by opening the student | Admin card: "Last lesson Oct 17"; chip when none in 3 weeks |
| Tutor's assessment per verse (Working / Solid) | `verse_assessment` | Only as a chip on each verse card | Tutor and admin as counts and per-aliyah state (T1, T2) |
| Per-aliyah Not started / Working / Solid | Computed in `today/model.ts:64-75` | The student | Tutor and admin |
| Honors sections saved (0-7) | `honors_version`; `savedSections` | The parent | Admin as a count (A6) |
| Pending service-part requests | `service_part_request` | Inside a folded section of one student's page | Tutor row, admin card |
| Service-course part finished | `service_part_finished` | Tutor and admin per student (ruling 45 widened for the course) | Same people, as "4 of 6 parts finished" on the row. Not verified where it renders today. |
| Learn to lein progress ("Can hear 6 of 10") | `course_progress` | Assigned tutor, on the student page | Tutor row. Admin: not without a ruling. |
| Translation drafts saved | `student-work` tables; a notice is queued per draft | Tutor by email (no link) and by opening the verse | Tutor: "2 new drafts" on the row |
| Invitation state: sent, accepted, expires, delivery failed | `invite` (`acceptedAt`, `expiresAt`), delivery outcome | Admin on Invitations; This week shows only "Needs a parent" | Card: "Invited Oct 30, not accepted" with Send again |
| Member has signed in / since when | `membership.createdAt`, `session.createdAt` | "Since <date>" on People with access | "Parent joined Nov 2; student has never signed in" on the card. A student who has never signed in is the earliest warning there is. |
| Notification ledger (sent, failed, deferred) | `notification_delivery` | No one (verified: no reader outside `server/notifications` and `composition.ts`) | Admin: "Weekly update: 31 sent, 2 failed" under Email settings |
| Audit events | `audit_event` | No one in the UI | Leave. Not needed at this size. |

### A single admin "who needs attention" view, from existing data

One row per active student, soonest first, on the This week screen and as one MCP read:

`Noa Levin · Beit Mitzvah Dec 12 (26 days) · Morning · Rehearsals Nov 22, Dec 6`
`Tutor Dana W. · last lesson Nov 10 · practiced 3 of last 7 days · 14 of 21 verses got, 9 solid`
`Parent joined · Honors 4 of 7 · Reading confirmed · 1 part request waiting`
chips, at most two: `Needs a tutor` `Tutor asks for you` `Behind` `No lesson in 3 weeks` `Never signed in` `Needs a parent` `Reading to confirm`

Everything on it is already stored. New reads needed: tutor-solid counts and last lesson date in `server/staff/data.ts`, days practised for admins, honors section counts, pending requests. The only new data is the tutor's flag (T3).

### A tutor "before this lesson" view, from existing data

At the top of the student page on every screen width:

`Since your last lesson (Tue Nov 10): practiced 4 days`
`Wed Nov 11 · Torah 23:1–23:9 · marked 23:4 Got it` (the existing per-day lines, cut at the last lesson)
`You asked: "Aliyah 2 slowly, three times a day."` (existing Last time)
`Aliyot: 1 Solid · 2 Working (3 still working: 23:10, 23:12, 24:1) · 3 Not started · Haftarah Working`
`Often mixed up: tevir and etnachta` · `1 new translation draft (23:7)` · `1 part request waiting`
`Next: Rehearsal Nov 22 (6 days)` · `Add lesson note`

All from reads the tutor already has. No new data.

---

## 4. Clutter: heavier than this job needs

Ranked by how often Daniel or a tutor hits it.

1. **Fresh sign-in for routine setup** (`server/access/service.ts:20-21`). See A2. Right for granting admin or tutor authority; wrong for attaching an existing tutor to a student or sending an invitation the invitee must still accept. Risk of relaxing: low to medium. Confidence high.
2. **A review sheet before nearly every write.** Assign or remove a tutor (`relationships/review.tsx`, with a "Technical details / Role identifier" disclosure), send an invitation (`invitations/review.tsx`), set service parts ("Check before saving", `service-learning/editor.tsx`), change verses (preview then confirm), import, Make tutor (two steps), Ceremony done (two steps although it has Undo), Disable (two steps). Keep the second step where the act cannot be undone here (Disable, Remove across the congregation, hand-over, sending mail). Drop it for assigning a tutor, saving service parts and Ceremony done: each is reversible and the result is visible at once. The client-side fingerprint re-checks around those reviews (`invitations/workspace.tsx:14-15`, `:109`; `relationships/workspace.tsx:56-61`) can go with them; the server re-checks anyway. Roughly 150-250 lines; not counted precisely.
3. **"Unknown outcome" and conflict machinery on low-contention forms.** The roster editor (`roster.tsx`, 275 dense lines) carries generation counters, a conflict latch that blocks all editing until reload, focus restoration across "access checks", Escape interception and a discard prompt, for a form one rabbi uses. The lesson note sheet is the same (`lessons/panel.tsx`, 299 lines). A plain save with "Someone changed this; reload" on 409 would do. This is a code-weight finding more than a UX one; the user-visible cost is messages like "We couldn't confirm whether this saved. Reload the roster to check before trying again."
4. **Three People pages plus a per-student People page** (`shell/tabs.ts:30-33`). Invitations, Tutors and Accounts ("People with access", link requests, approvers) could be one page with three sections; the per-student page stays.
5. **More holds two things Daniel cannot use and one he rarely needs.** "Recording review" is a page for a review that is not running (the product review's AD-14 moved it under More; it is still a row). "Share guides" and "Claude connections" are once-a-year. Fold Recording review away until 2.5.
6. **CSV import carries three header formats** behind "Advanced: other column layouts and limits" (`csv-import/workspace.tsx`: legacy v1, extended v2, full intake) and an "Allow additional records for exact duplicates" switch, while the real intake path is Maven through Claude. One format is enough.
7. **Admin copy written for an auditor.** "An invitation isn't access. Once someone accepts, they appear on the student's People page, or under Tutors."; "Access is checked again before anything is saved."; "Can read this student's work. Practicing as the child is a separate permission."; "Current access couldn't be loaded, so none of it is shown." Each is true and none helps the rabbi do the task. Lead's call under the small-wording rule.
8. **Tutor adds through MCP need a reconnect.** "Adding a tutor … works only within 15 minutes of connecting Claude; otherwise tell the rabbi to reconnect Claude to the portal" (`mcp/instructions.ts`). In a long Cowork session this fails every time. Goes away with A2.
9. **The roster's Honors, Edit, People and Print booklet are four buttons on every row** (`roster.tsx:229`), on top of the row's own link. On a phone that is five targets per student. Put them behind the student page's Manage sheet, which already has most of them.

Not clutter, and should stay: tenant and cross-family checks, the never-in-repo guard, the chant gate, the decision-7 tutor-only read, the hand-over's transaction.

---

## 5. The five changes with the most payoff

### Tutor

1. **Aliyot block on the lesson card (T1), with "Mark aliyah solid" (T10).** S. Answers "what is solid" in one glance from data already loaded.
2. **"Since your last lesson" at the top on every screen width (T7 + T4).** S. Reorders and re-heads lines that already exist.
3. **Count the tutor's Solid marks and use them for "behind" (T2).** S-M. Makes the tutor's judgement visible to the tutor and the rabbi.
4. **A rabbi-only line and an attention flag on the lesson note (T3).** M. The only new data in this report, and the only channel from tutor to rabbi.
5. **A weekly tutor email with direct links, including pending requests and new drafts (T5, T6, T8).** M. Limited to days practised and dates unless Daniel says the per-day lines may be mailed.

### Admin

1. **`list_student_status` in MCP (A1).** S-M. Lets Daniel ask Claude "who needs me this week" and get the This week facts; he works there already.
2. **Relax the 15-minute rule for assigning a tutor and inviting a family (A2).** S, with an adversarial pass. Removes the largest friction in intake, on the web and in Claude.
3. **"Invite all families" on This week, then in MCP (A3).** M. Turns 60 actions into one review.
4. **Richer This week cards: days practised, last lesson, tutor-solid, honors n of 7, never signed in, the tutor's flag (A4, A6).** M. All but the flag from data already stored.
5. **The checkpoint table at 8, 4, 2 and 1 weeks, with ceremony-done prompts after the date (A5, A8).** M. The at-a-glance cohort view he asked for; pure rules over existing facts.

## Questions this raises for Daniel (three, all real product or auth decisions)

1. May an admin assign an existing tutor and send a family invitation without having signed in within the last 15 minutes? (A2)
2. May the rabbi see days practised per student in one list, on the web and through Claude? Ruling 45 allows days practised to others but says "no cross-student reporting"; the code currently keeps admins out of the practice read. (A1, A4)
3. May a tutor write a line only the rabbi sees? (T3)

## Not verified

- I did not run the app, so screen and step counts come from reading components, not from walking them.
- The reading editor's exact number of steps (preview, divisions, confirm) is estimated.
- Where the service-course "finished" marks render for staff.
- Whether the admin's guide status line names a held draft.
- That a deep link in an email survives sign-in (a spec exists by name; I did not read it).
