# State — CRC B'nei Mitzvah portal

Updated 2026-11-17. This file is replaced, not appended: it says where the work stands today, in about a hundred lines. The full log up to 2026-11-16 (gate lines, merges, migrations, walk findings) is unchanged at `docs/archive/STATE-through-2026-11-16.md`. Daniel's binding rulings are indexed in `docs/planning/RULINGS.md`; `MISSION.md` beside this file is still the authority. Historical plans, returns and reviews are under `docs/archive/` with their old folder layout.

## Released and live

- **Site:** https://beitmitzvah.centralreform.org (canonical; `BETTER_AUTH_URL` selects it). The other CRC hostnames redirect there. The intended main address, torah.centralreform.org, is not switched yet (cutover "T7", below).
- **Product name and state:** CRC Torah, in public beta since v2.0.0: "Beta" label in the header, `PUBLIC_INDEXING = true` in `src/lib/site/indexing.ts`. No real families have been invited; the pilot waits on Daniel ("I'll say when").
- **main:** the last recorded merge is #167 (`ae04746`, 2026-11-03: Remove tutor, tutor and student both allowed, the "People" page). The last tag recorded is v2.2.0 (2026-10-28).
- **What is in it:** public reading (Lein, Study, Learn to lein, the trope chart, print sheet), every signed-in person's shelf of readings, the student's assigned reading with PocketTorah audio, Got it marks, tutor notes and lesson log, practice calendar and visibility, family honors and honoree links, the service course (Shabbat morning, evening and Havdalah; not yet linked for students), base study guides for all 168 catalog keys, portion summaries, the per-student booklet, the admin's This week, Students, People and Settings, the portal MCP for staff, Maven intake, the roster Sheet, the music-card details sender, and guide export and import for other congregations.

## In progress

- **2026-11-16 project review and removals:** branch `claude/loving-babbage-2d0856` (not yet merged to main). It removes the spent release-migrate operators, student recordings (the `student_recording` table stays), the build probes, the voice experiments in `trope/` and the Finkel review page, and adds the review in `docs/planning/2026-11-16-project-review/` (summary: `REPORT.md`). CI is the check for the full suites; four browser test files were edited without being run there (see REPORT section 1).
- **Docs, CI and dead-leftover trim:** this file, `RULINGS.md`, the archive move, the CI trims and the small leftovers (REPORT section 6, step 1). A proposed replacement for CLAUDE.md waits on Daniel: `docs/planning/2026-11-16-project-review/CLAUDE-MD-PROPOSED.md`.
- **Study guides:** every catalog key has a published base guide, origin claude, not yet reviewed. Daniel marks guides reviewed as he reads them. The ones flagged as sensitive for his read: yom-kippur-mincha (Lev 18), achrei-mot, i-samuel-15 (Zachor), ezekiel-37, nasso, behar. Plan: `docs/superpowers/plans/2026-10-28-replacing-the-study-guide-booklet.md`.
- **Another congregation's own copy:** `DEPLOYING.md` and the fork identity work are merged; the Cowork starter prompt for that congregation's rabbi is ready, and Daniel sends it himself. Plan: `docs/planning/2026-10-30-second-congregation-copy/PLAN.md`.
- **torah.centralreform.org cutover (T7):** waits on CRC's firewall and SiteGround DNS. Then Daniel sets `BETTER_AUTH_URL`, rebuild, and check that beitmitzvah's `/sw.js` is the tombstone (runbook: `docs/archive/planning/2026-10-22-crc-torah-cutover/RUNBOOK.md`, section 4.3).

## Next, in order (REPORT section 6)

1. Finish clearing dead weight: the rest of S8, the unused CSS, one catalogue test in place of the 38 frozen migration tests, the source-grepping tests, then whatever of the CI and docs trim is left.
2. Make failures diagnosable (C1): log the route, error name and stack, never secrets or addresses. Daniel asked for a detailed proposal first.
3. Reconnect what is built: G1 link the service course for students (approved; Daniel sees it before it ships), G2, G4, G6, G7, the front door and the walkthrough's dead ends; T1, T2, T3 for tutors.
4. Intake friction: A2 relax the fresh sign-in rule for tutor assignment and invitations (approved; adversarial review), A3 bulk invitation, one setup flow for a student.
5. Oversight, only if Daniel wants it: A1, A4, then the timeline A5 with T6 and A8.
6. Structural simplification, one area per PR: C4, C2, C3, C5, then the approved parts of C6.

Small known follow-ups:
- The Tutors page's "Remove as a tutor" and the tutor hand-over leave `account_approver` live on the revoked grant, so a re-granted tutor cannot be designated an approver again (Low). Fix through a shared data helper.
- Two browser specs fail on main for a date or environment reason, not a code one (`foundation.spec.ts` "honest unavailable state", `public-reading.spec.ts`; seen when #164 merged).
- The music card keeps a ceremony's last names if every student leaves it; closing this needs a receiver change on centralreform.live.
- An importing rabbi cannot yet remove an imported guide's credit once its text is replaced.
- The student's email settings page offers a switch that does nothing while notifications are parked; hiding it is a small follow-up (REPORT section 5).

## Waiting on Daniel

- The open items of REPORT section 5: which oversight views, if any (days practised across students, asking Claude how students are, a tutor's private line to the rabbi, a dated timeline per student); whether "My translation", the CSV roster import, the roster Sheet and tests on Windows are still in use; how a child without their own email signs in (G9), once the number of such children is known.
- The "Unclear, ask Daniel" list at the end of `RULINGS.md`, and one read of `RULINGS.md` itself, since it indexes the binding text.
- Whether to adopt `CLAUDE-MD-PROPOSED.md` as the new CLAUDE.md.
- Whether everyday words (Shabbat, Torah, shofar, midrash) may appear in Latin letters in guides; the default meanwhile is yes, only quoted Hebrew is never romanised.
- Sending the other congregation's starter prompt; the T7 DNS and firewall steps.
- GitHub support purge of the old commits that named a student (closed PR refs), from the 2026-10-21 history rewrite.

## Dated reminders

- Before 2026-12-21: import the course text to production.
- Neon cost: the check planned for about 2026-10-30 is not recorded as done. Pull the page-view counter if spend heads past $10 a month.

## Operational facts

- **Deploy:** Vercel builds Production from main through the Git integration. CI (`.github/workflows/ci.yml`) runs once per pull request on the merge result, not again after the merge; run it by hand with workflow_dispatch. A deploy that breaks the live site is rolled back at once and fixed forward.
- **Migrations:** 57 files in `src/server/db/migrations/`, newest `0057_music_card_details`; the production ledger is at 57 (applied before #164 merged). The next free number is 0058. A migration is applied to production before the PR that needs it merges: check (ledger and hash), apply, verify (RLS forced, grants, row counts). The apply uses `scripts/db-migrate.mjs` with the owner connection, which lives outside the repo and is deleted after use (`DEPLOYING.md` section 3.2).
- **Database roles:** the app connects as the restricted runtime role; RLS is forced on tenant tables; nothing is granted to PUBLIC.
- **Production flags (Vercel env), as last recorded:**
  - `PORTAL_MCP_ENABLED=true` (false and a redeploy turns every MCP and OAuth route off).
  - `PORTAL_NOTIFICATIONS_ENABLED` unset: notifications parked; only sign-in, invitation and the two account emails are sent.
  - `REFERENCE_AUDIO_STUDENT_RELEASE=true`, with `REFERENCE_AUDIO_CATALOG_SHA256` (ee39c3e1…) and `REFERENCE_AUDIO_SHORT_MANIFEST_SHA256` (f60823cb…) pinned. PocketTorah only; no Finkel variables.
  - `PORTAL_OFFLINE_ENABLED`: offline is on unless this is `false` (nothing records it being set); `false` and a redeploy serves the worker tombstone.
  - `PORTAL_MUSIC_DETAILS_ENABLED`: whether it was switched on after migration 0057 is not recorded. Check before relying on music-card details (`docs/planning/2026-10-31-music-card-details/DECIDED.md`, release steps 3 and 4).
- **Crons** (`vercel.json`): service-ecosystem drain 10:17 UTC, roster Sheet sync 09:40 UTC, notifications run 14:05 UTC (sends nothing while parked).
- **Firewall:** Vercel Firewall rate limit on `/api/public/`, 120 requests a minute per IP.
- **Private Blob store** (iad1, Production only, OIDC): holds the private reference objects and the 168 Finkel objects, which stay until Daniel says otherwise.
- **Spend:** Claude may approve new cost while the portal total stays under $10 a month, logging each item here. Nothing is logged as added since the page-view counter (2026-10-23).
- **Claude connections:** the portal MCP is live for staff. Adding a tutor or sending an invitation through it needs a connection made in the last 15 minutes until A2 ships.
- **Reference kit:** published as the GitHub Release `reference-kit-v1` (CC BY-SA 3.0 PocketTorah credit), outside the tracked tree.

## Where things are

- Rulings: `docs/planning/RULINGS.md`. Authority: `docs/planning/2026-10-15-kickoff/MISSION.md`.
- Builder brief: `docs/planning/AGENT-BRIEF.md`. Running a copy: `DEPLOYING.md`. Product and design: `PRODUCT.md`, `DESIGN.md`.
- Live plans: 2.0 (`docs/planning/2026-10-24-release-2-0/`, kept because two tests read its `cowork/A3-DRAFTS/`), the booklet plan, the second-congregation copy, music-card details, People and tutors, the 2026-11-16 review.
- Everything else: `docs/archive/`.
