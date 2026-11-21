# State — CRC B'nei Mitzvah portal

Updated 2026-11-20. This file is replaced, not appended: it says where the work stands today, in about a hundred lines. The full log up to 2026-11-16 (gate lines, merges, migrations, walk findings) is unchanged at `docs/archive/STATE-through-2026-11-16.md`. Daniel's binding rulings are indexed in `docs/planning/RULINGS.md`; `MISSION.md` beside this file is still the authority. Historical plans, returns and reviews are under `docs/archive/` with their old folder layout.

## Usability release, November 20

The [release note and acceptance walkthrough](../2026-11-20-usability/RETURN.md) cover playback, immutable shared passages, course return, staff decisions and family recovery. The [baseline review](../2026-11-20-usability-review/REVIEW.md) records the original issues. The first release, `b4a8d2b4`, passed all 15 [CI jobs](https://github.com/RavBogard/bneimitzvah/actions/runs/44852147763). Daniel approved removing the floating playback bar. The verse controls now belong beside the selected verse. He also approved an explicit command to play a whole assigned aliyah through its last verse and chose to keep the existing lesson note types.

## Released and live

**Additional recordings, November 20 release candidate.** The `codex/karaite-finkel` branch adds 110 Egyptian Karaite recordings by Hazan Rotem Cohen and 300 CRC teaching tracks by Cantor Josh Finkel as optional full recordings. Shermet remains the default for verse practice. Four Karaite tracks have unresolved passage boundaries. Twenty-two prepared Finkel clips with speech flags remain private. The 300 selected performances have tag-free public derivatives with identical decoded audio (`45f828e1`), totaling 189 MB in the existing private store. The legacy copies remain private. Explicit device saves last 14 days. Daniel closed the search for additional traditions after reviewing the listening options.

- **Site:** https://beitmitzvah.centralreform.org (canonical; `BETTER_AUTH_URL` selects it). The other CRC hostnames redirect there. The intended main address, torah.centralreform.org, is not switched yet (cutover "T7", below).
- **Product name and state:** CRC Torah, in public beta since v2.0.0: "Beta" label in the header, `PUBLIC_INDEXING = true` in `src/lib/site/indexing.ts`. No real families have been invited; the pilot waits on Daniel ("I'll say when").
- **November 20 production releases:** `c247ba7f` introduced the complete Shermet collection, `87005a17` set the faster teaching pace, and `3b50f002` completed the timing and speed-menu release. The combined tutor, learner and Guides release is live at `7ec26e38`. All 15 CI jobs passed and independent reviewers signed off. The last tag recorded is v2.2.0 (2026-10-28).
- **What is in it:** public reading (Lein, Study, Learn to lein, the trope chart, print sheet), every signed-in person's shelf of readings, the student's assigned reading with Shermet and PocketTorah audio, Got it marks, tutor notes and lesson log, practice calendar and visibility, family honors and honoree links, the service course (Shabbat morning, evening and Havdalah; linked for students as "Learn the service"), base study guides for all 168 catalog keys, portion summaries, the per-student booklet, the admin's This week, Students, People, Guides and Settings, the portal MCP for staff, Maven intake, the music-card details sender, and guide export and import for other congregations.

- **Cantor Wendy Shermet, Temple Israel, Omaha.** CRC public and shared readings, assigned practice, and offline saves prefer her recordings. All 8,153 decodable public source files are represented. They cover 7,315 of CRC’s 7,475 baseline verses (97.86%) plus 119 verses for custom readings. The library includes 778 supplementary items. The completed GPU pass qualifies 4,786 verses for word practice, covering 61,262 sung words. All 110 curriculum verses have full performances and 72 qualify for word practice. Live checks verified first-tap Torah and haftarah playback, a timed word, a service blessing, byte ranges, both relative speed directions and the largest library recording. Shermet’s displayed 1× uses 125% of her recorded tempo with pitch preservation. [Implementation and source evidence](../2026-11-20-shermet-recordings/PLAN.md)

- **Tutor, learner and Guides workflows:** public entry offers Study Torah, Learn to lein, and Practice a reading. Tutors can share a student and set that student's aliyot. Student Practice opens the same aliyah reader with private tutor panels omitted. Optional pronouns, private tutor-spoken clips, installed-app offline practice, and Guides Release and Hold are live. The production smoke checked the new homepage, service worker build, anonymous access controls, Guides routes and Shermet audio. [Tutor and learner plan](../2026-11-20-tutor-and-learner/PLAN.md) and [combined CI](https://github.com/RavBogard/bneimitzvah/actions/runs/44827813695).

## In progress

- **Study guides:** every catalog key has a published base guide, origin claude, not yet reviewed. Daniel marks guides reviewed as he reads them. The ones flagged as sensitive for his read: yom-kippur-mincha (Lev 18), achrei-mot, i-samuel-15 (Zachor), ezekiel-37, nasso, behar. Plan: `docs/superpowers/plans/2026-10-28-replacing-the-study-guide-booklet.md`.
- **Another congregation's own copy:** `DEPLOYING.md` and the fork identity work are merged; the Cowork starter prompt for that congregation's rabbi is ready, and Daniel sends it himself. Plan: `docs/planning/2026-10-30-second-congregation-copy/PLAN.md`.
- **torah.centralreform.org cutover (T7):** waits on CRC's firewall and SiteGround DNS. Then Daniel sets `BETTER_AUTH_URL`, rebuild, and check that beitmitzvah's `/sw.js` is the tombstone (runbook: `docs/archive/planning/2026-10-22-crc-torah-cutover/RUNBOOK.md`, section 4.3).

## Shipped 2026-11-16 and 17

Review: `docs/planning/2026-11-16-project-review/REPORT.md`. Decisions: `RULINGS.md`, "Decided 2026-11-17".

- **Removed:** the spent release-migrate operators, student recordings, the voice experiments in `trope/` (no Python left), the Finkel review page, the old reference player, students' "My translation" and the tutor's translation-draft email, the CSV roster upload, the roster Google Sheet and its cron, the retired "I read this" route, the saved-reading "Yours" translation row, the unused CSS. Every table stays; no migration was written.
- **Students:** their own reading first on the front door; one named next step that opens Up close at the first verse not marked Got it, then Run-through; "Learn the service" linked; Run-through and step-by-step verse preparation from the reading; plain wording in save recovery and service parts; dead ends fixed; sign-in help matches the email.
- **Tutors:** an Aliyot block with "Mark Aliyah n solid"; "Since your last lesson" at the top; staff cards read "n of m solid · n got" and Behind follows the tutor's Solid count once the tutor has assessed anything; practice dots count the same last seven days everywhere; "Go to verse" in place of "Change".
- **Admin:** More, then Guides lists study guides, discussions and portion summaries, shows versions, withdraws discussions, and approves or withdraws summaries. Release and Hold for study guides shipped November 20.
- **Sign-in rule:** assigning an existing tutor, inviting a parent, student or tutor, and Send again no longer need a sign-in under 15 minutes old, on the web or through Claude. Everything else that needed one still does. Adversarial review passed.
- **Failure log:** one redacted line per unexpected server failure (`server.failure`: request id, method, route, site, level, error class, SQLSTATE, code-location stack). Expected degraded states (an upstream text source or cache unavailable) are `warn` on stdout; the rest are `error`. Two adversarial passes. Rules: `src/server/logging/redact.ts`.
- **Structure:** one ordered route table in `src/server/http/dispatch.ts`; services are built only when a handler first asks for one (`once(...)` in `src/server/runtime/composition.ts`); the tenant host directory is read once per request.
- **Session re-checking (C2):** the signed-in pages read the session once on opening and once on coming back to the tab (`src/components/portal/workspace/session.ts`); every refused request (401, 403, 404) clears the page through one handler. A session read that fails without a refusal leaves the session unconfirmed and nothing is sent or loaded until a read confirms the same person (`session-gate.ts`). Adversarial review and a delta pass. Accepted trade-off: when only a relationship is removed (a tutor's link, a guardianship, "Stop child practice", an adult changed to child) and the person stays signed in, what is already on screen stays until that person's next request for the student, a reload or Refresh. A revoked tutor now sees "Access has changed" with "Check access again".
- **Process:** docs archived (350 files), `RULINGS.md` and this short STATE, CLAUDE.md replaced, CI on Linux only and skipped for docs-only pull requests (never-in-repo still runs), Next.js 16.4.6, American spelling. Models: Fable leads, Opus builds and reviews, Sonnet only for bulletproof mechanical work; two or three agents at a time.

## Next, in order (REPORT section 6)

1. Dead weight still to clear: one catalogue test in place of the 38 frozen migration tests, the source-grepping tests.
2. Admin intake: one setup flow for a student instead of four places. Bulk invitation is not wanted now.
3. Structural simplification, one area per change (Daniel 2026-11-17: no fixed launch date, simplify now): C3 the hand-written validators, C5 the triplicated code and the note-save coordinator now that it serves notes only.
4. The parts of C6 Daniel asked to have proposed in detail: open reference audio served openly, fewer confirm steps and replay receipts, the second-congregation plumbing (scope only).

Small known follow-ups:
- The admin pages (accounts, relationships, invitations, settings, connections, guide admin) still show a refusal as an inline message only; their next read replaces the content. Route them to the workspace refresh when next touched.
- Thirteen older trigger functions (migrations 0022, 0023/0024, 0026, 0042, 0044/0055, 0049, 0052) resolve table names without a pinned `search_path`, the weakness fixed for 0058's trigger during its review. Pin them all in one later migration.
- The per-transaction `pg_roles` audit is 2 of a signed-in read's 11 queries; left as is (running it once per cold start would need a periodic re-check).
- The Tutors page's "Remove as a tutor" and the tutor hand-over leave `account_approver` live on the revoked grant, so a re-granted tutor cannot be designated an approver again (Low). Fix through a shared data helper.
- Identifiers still spelled the British way (`practisedDays` on the wire, `since-practised` test id, a CSS class): rename when the files are next touched.
- `rosterSheetId` and `tutorDraft` are still accepted by the settings schema so stored settings keep loading; `"student-import"` is still a signing purpose in `students/bindings.ts`. Nothing uses them.
- `practice-calendar/maintenance.ts` implements ruling 14 (practice-history retention) and nothing runs it: wire it to a cron or get the ruling changed.
- The music card keeps a ceremony's last names if every student leaves it; closing this needs a receiver change on centralreform.live.
- An importing rabbi cannot yet remove an imported guide's credit once its text is replaced.
- A "high" advisory in zod reaches the app through `@vercel/blob` and `@vercel/oidc`; the only offered fix is a breaking downgrade. Recheck when those packages update.

## Waiting on Daniel

- **Vercel cleanup:** delete the environment variables `GOOGLE_SHEETS_SERVICE_ACCOUNT` and `GOOGLE_ROSTER_SHEET_ID`, and the Google service account behind them. The code no longer reads them.
- How a child without their own email signs in (G9), once the number of such children is known.
- The rest of the "Unclear, ask Daniel" list in `RULINGS.md` (items 3, 4, 5 and 7).
- Whether everyday words (Shabbat, Torah, shofar, midrash) may appear in Latin letters in guides; the default meanwhile is yes, only quoted Hebrew is never romanised.
- Sending the other congregation's starter prompt; the T7 DNS and firewall steps.
- GitHub support purge of the old commits that named a student (closed PR refs), from the 2026-10-21 history rewrite.
- A look at the tutor's student page on a phone: its builder could not render it locally; CI's browser suites pass.

## Dated reminders

- Before 2026-12-21: import the course text to production.
- Neon cost: the check planned for about 2026-10-30 is not recorded as done. Pull the page-view counter if spend heads past $10 a month.

## Operational facts

- **Deploy:** Vercel builds Production from main through the Git integration. CI (`.github/workflows/ci.yml`) runs on pull requests and by hand; the current practice is a `workflow_dispatch` run on the working branch, then a fast-forward of main to the green commit. A full run takes about 9 minutes. A deploy that breaks the live site is rolled back at once and fixed forward.
- **Migrations:** production has 61 entries through `0061_private_pronouns`. The November 20 release applied and verified `0058_guide_web_release` first, then `0059` through `0061`. The preceding 57 ledger entries and 468 existing guide rows were preserved. Post-checks confirmed RLS, grants, indexes, and triggers. Apply future migrations using `scripts/db-migrate.mjs` with the owner connection before deploying code that depends on them (`DEPLOYING.md`, section 3.2).
- **Database roles:** the app connects as the restricted runtime role; RLS is forced on tenant tables; nothing is granted to PUBLIC.
- **Production flags (Vercel env), as last recorded:**
  - `PORTAL_MCP_ENABLED=true` (false and a redeploy turns every MCP and OAuth route off).
  - `PORTAL_NOTIFICATIONS_ENABLED` unset: notifications parked; only sign-in, invitation and the two account emails are sent.
  - `REFERENCE_AUDIO_STUDENT_RELEASE=true`, with `REFERENCE_AUDIO_CATALOG_SHA256` (ee39c3e1…) and `REFERENCE_AUDIO_SHORT_MANIFEST_SHA256` (f60823cb…) pinned. PocketTorah only; no Finkel variables.
  - `PORTAL_OFFLINE_ENABLED`: offline is on unless this is `false` (nothing records it being set); `false` and a redeploy serves the worker tombstone.
  - `PORTAL_MUSIC_DETAILS_ENABLED`: whether it was switched on after migration 0057 is not recorded. Check before relying on music-card details (`docs/planning/2026-10-31-music-card-details/DECIDED.md`, release steps 3 and 4).
- **Crons** (`vercel.json`): service-ecosystem drain 10:17 UTC, notifications run 14:05 UTC (sends nothing while parked).
- **Firewall:** Vercel Firewall rate limit on `/api/public/`, 120 requests a minute per IP.
- **Private Blob store** (iad1, Production only, OIDC): holds the private reference objects and the 168 Finkel objects, which stay until Daniel says otherwise.
- **Spend:** Claude may approve new cost while the portal total stays under $10 a month, logging each item here. Nothing is logged as added since the page-view counter (2026-10-23).
- **Claude connections:** the portal MCP is live for staff. Adding a tutor and inviting one work on any live admin connection.
- **Failure log:** search the Vercel logs for `server.failure`; `level` is `error` or `warn`.
- **Reference kit:** published as the GitHub Release `reference-kit-v1` (CC BY-SA 3.0 PocketTorah credit), outside the tracked tree.

## Where things are

- Rulings: `docs/planning/RULINGS.md`. Authority: `docs/planning/2026-10-15-kickoff/MISSION.md`.
- Builder brief: `docs/planning/AGENT-BRIEF.md`. Running a copy: `DEPLOYING.md`. Product and design: `PRODUCT.md`, `DESIGN.md`.
- Live plans: 2.0 (`docs/planning/2026-10-24-release-2-0/`, kept because two tests read its `cowork/A3-DRAFTS/`), the booklet plan, the second-congregation copy, music-card details, People and tutors, the 2026-11-16 review.
- Everything else: `docs/archive/`.

