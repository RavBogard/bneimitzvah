# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated within the existing Cowork plan: Next.js App Router, TypeScript, CSS modules, npm, Postgres on Neon with Drizzle, Better Auth, and Playwright. Exact supported versions are implementation decisions. Hosting remains Vercel within the mission's budget and approval rules.

Amended 2026-10-16: Astra owns product direction, architecture, ambiguous decisions and final integration; Sol 6.1 implements bounded assignments. The scope amendments below record Daniel's rulings 27–59 and direct recording-surface clarification. They describe required behavior, not completed features. Mechanisms in the new review's section 3 remain proposals subject to Astra's integration corrections.

## Users

CRC child and adult Beit Mitzvah students, including children under 13, practice their assigned reading and service parts. The rabbi sets child/adult status; parent contact is required for children and optional for adults. Clergy, staff, song leaders, independent tutors and parent volunteers all use the tutor role for assigned students; there is no pay tracking. The rabbi/admin sets assignments and congregation defaults. Parents follow linked children through a dashboard that is read-only except for honors. Office staff read the owned roster Sheet; no new staff role is implied.

Daniel confirmed on 2026-10-15 that all three settings matter: independent practice on a phone, independent practice on a laptop or tablet, and tutor-led lessons. Much tutoring happens on Zoom.

## Product Purpose

Current delivery authority, Daniel2026-10-17: continue through full feature completion and deploy at will. Separate student-visible release approvals are no longer required. Preserve the selected Annotated score direction, independent high-stakes reviews, new-spend/licensing gates, generated-chant listening gate and Daniel-only human testing until feature complete.

Put a student's Torah and haftarah readings, equally prominent, assigned service parts, text tools, chosen commentary, translation drafts and practice recordings in one place. The 1.0 success criterion remains a real CRC student and tutor completing a real reading with Daniel as rabbi without a workaround. D'var drafting/feedback, mitzvah projects and general family logistics are outside 1.0. Custom siddur/prayer inputs and packets are v2; collect none now.

Daniel requires the full planned product to be feature complete before any other human tests it. Daniel alone reviews and tests during development; automated tests and agent reviews continue throughout. The real-student/tutor pilot follows completion of the planned features, including MCP and generated chant, and Daniel's approval to proceed.

## Operating Context

- A rabbi creates a student with date and service slot: morning 10:00 or Havdalah/afternoon 16:00. Afternoon uses the following Shabbat's portion; verify holiday cases against actual Hebcal data. Show the whole portion and make custom verse selection primary, with triennial/full helpers retained. Typical 9–12 Torah / 5–6 haftarah verses are guidance, not caps. Tutors adjust readings and sources within their permitted relationships.
- Read-only Maven roster import uses stable source IDs within tenant/source namespace, with CSV fallback and explicit reconciliation of uncertain matches. Never write Salesforce or silently match name/date. Daniel adds slot to the external feed; unknown imported slots wait for rabbi selection. The portal writes one owned Beit Mitzvah Roster Google Sheet with student/Hebrew name, date, slot, portion, verses, tutor and rehearsal dates.
- Practice happens independently and during Zoom lessons. Layout and verse identification must support both small screens and shared discussion of the same passage. Video conferencing itself is outside the planned product.
- Daniel confirmed that the student's first screen opens directly on their assigned reading, with practice tools beside it. On small screens the tools must remain available without crowding the passage.
- Daniel confirmed parent sign-in with an explicit switch into linked child practice views, including sibling selection. Recordings are hidden from the parent dashboard and allowed within that selected linked-child practice view. The approved auth/tenancy spec uses explicit per-tab practice contexts; make the active child and role clear. Dashboard fields include reading/progress, date/slot, logistics, tutor notes, lesson log and honors.
- Google GIS popup/body sign-in and email fragment/body confirmation are the entry methods; passwords are out of scope. Actual Google, delivery, hosting and Daniel's phone acceptance remain separate gates. Honorees receive separately reviewed, expiring/revocable no-login links scoped to blessings/audio; no family data in URLs, logs or public caches.

## Capabilities and Constraints

- Hebrew includes vowels and cantillation, verse-aligned translations, trope family colors, word analysis and verse-based translation drafts. Daniel's later ruling 38 closes the earlier pause: no visible transliteration. Tapped words show syllables and stress in Hebrew letters. Preserve reviewed Hebrew/qere-ketiv/read indices while consolidating shared trope logic into the dependency-free engine with existing tests and the 182-verse parity lock.
- Commentary is available broadly, with congregation defaults and tutor/rabbi assignments surfaced first. Generated summaries require rabbi approval and clear attribution. No student chatbot in 1.0.
- Recording/ear-first practice is equal to trope-based learning, chosen by student/tutor. Tutor recordings are interim Torah/haftarah reference audio. Generated chant remains a 1.0 goal with bass/tenor/alto/soprano ranges and tutor-set default; reference recordings remain unchanged. Benchmark renderer/transposition choices on the same reviewed score. Release identity includes range and renderer/version; every asset passes G1/G2 and released ranges have G3 listening evidence at the unchanged threshold before students hear them.
- Tikkun, printable practice sheets, aliyah cuts and parent-writable honors are in 1.0. Assigned service parts include Torah/haftarah blessings, Sh'ma/V'ahavta and tutor/rabbi-selected units from a published shirei-tfilah feed with stable IDs and a dedicated morning/Havdalah Beit Mitzvah volume. Prayer audio links to CRC Music at centralreform.live; confirm dependent feed/music capabilities before release.
- Tutors mark verse progress not started/working/solid, with student self-checks. Student-scoped practice events support a quiet calendar/streak; others get days-practiced only, with bounded event retention/purpose and no comparisons or leaderboards. Lesson summaries have no hours, scheduling or accounting. Existing Resend supplies tutor recording/draft notices, weekly parent digest and opt-in student practice reminders. No automated pronunciation/chant feedback or student assistant in 1.0.
- Sung practice uses Adonai/Elohim as in the ceremony, as Daniel confirmed on 2026-10-16. This pronunciation choice does not introduce visible transliteration.
- Google OAuth is intentionally public (Daniel, 2026-10-16); portal roles and linked-student authority still require explicit grants. The existing CRC Resend account will be reused for this portal.
- One congregation launches first; tenant isolation belongs in the schema and access layer from the beginning. Congregation settings and minimal onboarding are now in 1.0; actual second-congregation provisioning still requires Daniel.
- Installable PWA/offline current audio and later recording upload are in scope. Before release, settle the offline authorization/release lease interval; scope caches to tenant/user/assignment, expire leases, revalidate/purge on reconnect and clear on logout/account switch. No instantaneous offline revocation or generic private API caching. Show pending uploads and storage-eviction/loss risk. Offer no file-export control without promising prevention of saving playable audio.
- Public source control must contain no student/family records, recordings, credentials, licensed translation payloads, rendered audio, or model weights. Approved redistributable engine fixtures need their own provenance; an already-public source is not evidence of permission.
- Cost, publication, licensing, recording/bearer-access review and student-release gates in MISSION.md continue to apply. Amended2026-10-17 (Daniel): all student recordings, including private unsent recordings, are retained for one calendar year after the ceremony, then deleted; earlier student deletion remains available. Postponement cannot revive overdue recordings. Parent notice explains storage/access/deletion without a consent gate; separately consented adult training/source audio remains distinct.

## Brand Commitments

Amended 2026-10-16: the approved product name is "Beit Mitzvah", displayed at CRC as "CRC Beit Mitzvah"; the rename is required work. Canonical target is `beitmitzvah.centralreform.org`, with `barmitzvah`, `batmitzvah`, `bnaimitzvah` and `bneimitzvah` spelling aliases under `centralreform.org`. DNS and project-domain/TLS checks are recorded; Daniel reports the new Google JavaScript origin added. Canonical app mapping/redirects and reviewed cutover remain outstanding; preserve the working Vercel origin until acceptance. Navigation aliases do not authorize API/cookie access or credential-query forwarding.

Amended 2026-10-16 (Daniel, binding): the product must be **useful, intuitive and beautiful, and fun to use; never cringe, boring or complicated.** This is the quality bar every surface is reviewed against. "Fun" comes from committed color, type, scale and one signature interaction, never from mascots, confetti, streaks, badges, emoji, pep-talk copy, slang or youth-group voice; copy stays adult-respectful because adults use the same screens. After the full UX critique of the same day (`docs/planning/2026-10-16-ux-analysis/UX-ANALYSIS.md`), Daniel authorized a full redesign and locked the replacement world "Song session" (Impeccable seed 8ac4194f) for the student surface, with the pinned audience line that these students live in Google Classroom, TikTok, Instagram and Snapchat. Students see no status, revision or provenance on the page; phrase colors are on by default and remembered; the toolbar shows a disabled "Hear · coming soon" before G3.

Annotated score was Daniel's earlier code-first direction and is superseded by the above for the workspaces; its clear Hebrew reading and practice tools beside it carry forward. Preserve the haftarah color/font continuity; its adult printed-sheet layout is reference material. JPS 2023 remains the reference translation; source credits and generated-content labels remain visible.

## Evidence on Hand

- Authority: `docs/planning/2026-10-15-kickoff/MISSION.md` and the dated amendments recorded in the project-manager review.
- Implementation proposal: `docs/planning/2026-10-15-kickoff/PLAN-CODE-2026-10-15.md`.
- Dated 2026-10-16 amendment: `docs/planning/2026-10-16-review/PLAN-REVIEW.md` section 1, Astra integration review and Daniel's recording-surface clarification. Section 3 does not approve every proposed mechanism. Current implementation/provider evidence belongs in the existing STATE handoff.
- At review start there was no application, runnable interface, or student usability evidence in this project.
- The haftarah source commits cited in the plan resolve locally: main reference `5b2530f72c544a9dab028d73076d47744b8252dc`, engine reference `380b1b20095285db373478db1057db2c6bd04b60`. The current remote tip must still be checked before extraction.

## Product Principles

- Make the assigned reading and next useful practice action easy to find.
- Support understanding and practice together, with detailed tools available without overwhelming the reading.
- Keep child identity, parent access, and tutor responsibility explicit.
- Preserve textual and musical provenance; readiness is demonstrated before student release.

## Accessibility & Inclusion

Mixed Hebrew/English directionality, full cantillation mark rendering, and text enlargement are essential to the content. Plan keyboard-accessible controls and non-color identifiers for trope families. Phone, tablet, laptop, and Zoom teaching scenarios are confirmed requirements. Additional individual accommodation needs have not yet been established.
