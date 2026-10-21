# Handoff to the implementing session — whole product, starting with Torah study guides

Written 2026-10-21 by the planning session (Claude Code, Fable) after Daniel's 25-answer interview, then amended the same afternoon when Codex ran out of usage. **You now own the whole CRC B'nei Mitzvah product: integration, migrations, deploy, STATE.md, and the study slice.** There is no Codex to coordinate with. Daniel is the only other party. Read this file, then the spec, then the plan, in that order. Everything else is linked from here.

1. Spec: `docs/superpowers/specs/2026-10-21-torah-study-guides-design.md` (S1–S25 are Daniel's rulings; two of them amend earlier documents, see §3).
2. Plan: `docs/superpowers/plans/2026-10-21-torah-study-guides.md` (16 tasks, five milestones).
3. Codex's own stop notes, raw and in its compressed style, all git-ignored: `.local-logs/claude-finkel-handoff-2026-10-21.md` (the note it wrote for you), `.local-logs/source-assignment-current.md` (its running return), `.local-logs/finkel-integration-operation-history-2026-10-21-v2.md` (history). §4 below translates what you need from them.
4. Background you need not re-derive: `C:/Users/dsbog/bneimitzvah-review-output/` (the 2026-10-20 external review; outside Git), `docs/planning/2026-10-20-external-product-review/RECONCILIATION.md` on `origin/main`, and `docs/superpowers/specs/2026-10-18-portal-mcp-read-foundation-design.md`.

Standing rules are in `CLAUDE.md` and `docs/planning/2026-10-15-kickoff/MISSION.md`; the user-level rule set (commit, push and deploy at will inside the normal pipeline; interrupt Daniel only for money, irreversible effects, student-visible wording without precedent, security findings; log every other gate as `GATE: … — proceeded because …`) applies.

## 1. What the study slice is, in three sentences

The rabbi works with Claude in Cowork to pick themes for a parashah; Claude drafts a study guide (overview, themes, verse notes with Sefaria sources) in CRC's voice through the portal MCP; every student on that parashah sees it under their verses, labelled "Written by Claude for CRC · not yet reviewed by Rabbi Daniel" until he edits it and marks it reviewed. Parents read the same guide; students tick "I read this" per theme; tutors see the ticks. Nothing else in the product changes except English side by side on wide screens, meaning-first word taps, and translation drafts tucked under "More".

## 2. Repository state — read before touching anything

- **Baseline is `origin/main` at `16bfb4d` (2026-10-21).** It is the released product: canonical Vercel deployment `dpl_9BPVukERqTaEnRn4AnFvnte94ja3` is READY and protected, schema migration `0026_finkel_private_review.sql` is applied (27 ledger rows), the private Finkel review feature is disabled by default. Verify with `git fetch` before relying on the SHA.
- **This checkout (`C:\Users\dsbog\bneimitzvah`) is on `codex/roster-release-coordination`, 63 ahead of and 314 behind `origin/main`, and dirty** (tracked modifications plus about 65 untracked files, including the three study documents and Codex's notes). Do not branch from it, do not `git add -A` or reset it. Copy the three study documents into your own worktree and commit them there.
- Create your worktree: `git worktree add C:\Users\dsbog\bneimitzvah-study -b claude/study-guides origin/main`. Use your own ports and a disposable PGlite or embedded Postgres. Seventeen other worktrees exist under `C:\Users\dsbog\.codex\worktrees\` and `C:\Users\dsbog\bneimitzvah-*`; three of them hold Codex's unfinished work (§4) and must be preserved as they are. Never stop a process you did not start.
- **Migration numbers:** next free numbers on `origin/main` are `0027` and `0028`, reserved for the study slice (plan Tasks 2–3). The parked branch `codex/family-honors` (worktree `recording-media-transport`) carries its *own* `0024`–`0027` files with different content (auth provenance, MCP delegation, OAuth storage). Never apply or cherry-pick those over the installed schema; Codex's note is explicit about this. They are reference reading for the MCP tasks only.
- The spec's Constraints and the plan's file paths with line numbers describe `origin/main`; re-verify a line number before editing, they drift.
- Sandbox recipe that works for authenticated browser walkthroughs (memory `external-review-2026-10-20`): `embedded-postgres` initialised with `-E UTF8 --locale=C` (the Windows default cluster breaks Hebrew inserts with a generic 503), `browserFixture()` + `startBrowserServer()` held open by a STOP file, loopback mailbox via `fixture.takeMail(email)`. Playwright hangs on `window.print()`.
- CRLF gotcha: Codex's staged-protection check compares LF-normalised hashes; a Windows checkout can show a one-byte CRLF/LF difference between working and staged copies. `npm run check:repo` is the protection test (`tests/never-in-repo.test.mjs`).

## 3. Rulings that changed on 2026-10-21 (record them where they belong)

- **MISSION ruling 11 amended (S13):** the Claude-written default guide is student-visible immediately, clearly labelled with its review state; rabbi review changes the label, it does not gate visibility. Add a dated "Amended 2026-10-21" line under ruling 11 in `docs/planning/2026-10-15-kickoff/MISSION.md` on your branch.
- **PLAN-CODE note 7 amended (S10):** guide/summary approval happens through the MCP from Cowork; the web admin shows status and a preview only.
- **S25 (reviewed versus draft):** a save with `reviewed:true` goes live at once; a save with `reviewed:false` goes live only if no reviewed version exists, otherwise it is held and staff see "newer draft waiting"; an unattended routine's MCP consent can never set `reviewed:true`.
- **Scope note:** d'var Torah and any student writing surface remain 2.0 (S3). Server-side LLM generation is not authorized (new spend); drafting happens in a Claude session connected to the MCP.
- **MISSION ruling 26 unchanged** (Google-authenticated MCP for rabbi/admin and tutors), but only `admin` grants can obtain the new `portal:study` write scope (S21).

## 4. Inherited from Codex — what is open, what is parked, what to do first

Codex stopped on 2026-10-21 at Daniel's request (usage exhausted). Its workers are stopped, no process of theirs is running, and it will not resume. Its facts, translated:

### 4a. Main CI is red, and PR3 is the unfinished repair

- After PR2 merged (`16bfb4d`), main's CI run `39605739789` failed three PostgreSQL HTTP-browser tests (exploration initial metadata, signed-deadline response body, calendar readiness). Root cause proven: pinned Playwright 1.64.1 / Chromium 156.0.8078.4 drops a `no-store` streamed response body at EOF (Playwright issue 42742, fixed upstream in a later Chromium). The newer Playwright alpha also fails; do not upgrade to it.
- **PR3** (https://github.com/RavBogard/bneimitzvah/pull/3, branch `codex/finkel-browser-observation`, head `3c546be`, mergeable, 6 files) moves the two affected HTTP contract files to the already-pinned Firefox 157 build and fixes one real client bug on the way: the exploration metadata POST sent `Origin: null` under Firefox because of `referrerPolicy: "no-referrer"`; the fix in `src/components/portal/workspace/study/short-exploration-api.ts` changes only that policy to `same-origin`. Windows runs pass 12/12. Its exact CI `39624599627` passed calendar and metadata but failed two exploration *playback* assertions on Linux.
- Cause of the Linux failures, proven: the CI runner has no audio output device, so Firefox decodes but cannot play. Adding a PulseAudio null sink (only `PULSE_SERVER` passed to Firefox) made the same MP3 play. Codex built a test-environment-only helper for this; it is **uncommitted** in worktree **B** = `C:/Users/dsbog/.codex/worktrees/finkel-browser-stability/bneimitzvah` (5 pending files: `.github/workflows/ci.yml`, the RETURN doc, `tests/http-browser/reading-exploration-ui.test.ts`, new `tests/http-browser/firefox-audio-output.ts`, new `tests/app/firefox-audio-output.test.ts`). Focused tests 9/9, isolation 3/3, typecheck pass. The full Linux run has not passed yet: the helper's own setup fails an `ownedDirectory` check (hypothesis: `dpkg-deb` extraction resets the root directory mode; Codex wanted the actual mode/UID/realpath measured before changing anything).
- **Do this first, time-boxed.** "Done" in this repo means CI green, and nothing you ship after can be called done while main is red. Take PR3 over: start from worktree B's pending files (copy them onto a branch off `codex/finkel-browser-observation`, do not edit B in place), measure the directory facts, fix the helper if the mode is wrong, run the full Linux lane in CI. If one bounded attempt does not get PR3 green, stop, write what you learned into PR3's RETURN doc, log a GATE line, and go to the study slice; do not let this consume the session. Do not waive or mute the playback assertions; do not change runtime code beyond the one-line policy fix already on the branch.

### 4b. Finkel private listening review — parked, do not resume without Daniel

- The private reading-review batch (2 readings, 4 clips, off-repo) was never published: a single native Blob publication attempt errored and all five planned object keys are confirmed absent. A strict scan of the build output stops on an internal `.next/output/...` symlink; Codex designed a read-only "mirror" guard to get past it, and a **partial, untested-at-current-bytes** implementation sits ignored in worktree **I** = `C:/Users/dsbog/.codex/worktrees/finkel-integration/bneimitzvah` (`finkel-readonly-mirror-*.mjs`). Worktree **T** = `.../finkel-canonical-text/bneimitzvah` holds frozen operator modules and migration receipts; its Neon auth has probably expired.
- Gates that still stand before any activation: a fresh create-only publication of exactly five objects after a clean read-only proof and an independent review; admission requires all five to match within five minutes, a trusted Daniel Google CRC admin binding and an explicit six-day expiry; activation is two encrypted production env vars and a normal Git-source deploy. The private collection lives under Codex's LocalAppData, never in the repo. Josh's permission is already granted; do not re-interview. G3 (no student hears generated or reference chant before Daniel's listening review) holds.
- **Leave all of this parked.** It is not on the study path, it is blocked on Daniel listening, and it needs a careful operator session of its own. Record it in STATE.md as parked with the pointers above.

### 4c. Other parked branches (read-only facts; no action)

`codex/passive-reference-observation` (reading-companion worktree; CI passed, unmerged diagnostic), `codex/family-honors` (recording-media-transport; parked MCP/media foundations, not runtime-composed, own 0024–0027 migrations, see §2), `codex/beit-service-ecosystem` (service parts; merged as PR1), `codex/recording-single-read-diagnosis` (53 ahead, 180 behind). The sheet-music bridge is a separate repo at `C:/Users/dsbog/CentralReform.live/sheet-music-service-bridge`. None of these is needed for the study slice.

### 4d. Standing operational constraints Codex was holding (still true)

No roster import, mail, invitations or guest activation; no new provider scopes or spend; no generated voice or student recordings released; student reference listening held; no second tenant. Daniel cannot phone-test right now; do not ask him to. Never print a token, cookie, connection string or full email in any log or receipt.

### 4e. Your first hour, in order

1. `git fetch`; confirm `origin/main` head and that the canonical deployment is still READY (Vercel MCP `get_deployment`, read-only).
2. Create the study worktree (§2); copy the three study docs and this file into it; commit them.
3. Write a STATE.md "Current return point — 2026-10-21 handoff" entry on that branch: Codex stopped; PR3 status; Finkel parked (§4b pointers); study slice starting. Keep the older entries below it.
4. PR3, time-boxed (§4a).
5. Study plan, Task 1 onward.

## 5. Ownership and review

You own everything: Tasks 1–16, tests at every layer, the docs, MISSION amendment, migration-before-app rollout, deploy, STATE.md. Codex's former review role moves to a **second agent you dispatch** (the `dan-auditor` agent for adversarial verification, or a fresh general subagent given the code and not your conclusion). The items that *must* have that second-agent adversarial pass before you report them done, per `CLAUDE.md`: RLS/grants on the four new tables (Task 3), the `guide-write` capability (Task 4), MCP auth/delegation (Task 7), the `portal:study` scope and tool result projection (Task 8), and the end-of-slice review (Task 16). Enabling the MCP endpoint happens by configuration only after Task 9 acceptance, in its own commit; Google OAuth project settings and Vercel env changes are yours now too, logged as GATE lines, except anything that costs money.

If the MCP read foundation turns out larger than the plan assumes, stop at Task 6 (schema, HTTP, client), ship the bridge script (Task 8b) so Daniel can draft guides, and report; do not let the auth work swallow the slice.

### 5a. Interim bridge (built 2026-10-21; delete when the MCP is enabled)

**Removed 2026-10-21 with the MCP's enabling change.** Guides are written through the portal MCP from Cowork (§6). The text below is kept as history.

Until the portal MCP exists, a Claude session drafts a guide as a JSON file (`{ overview, themes: [{ id, title, intro, notes: [{ verseRef, body, sources: [{ id, ref, indexTitle, category, labels, readable }] }] }] }`; only `id` of each source matters, the server replaces the rest with Sefaria's own metadata) and the operator runs:

```
node scripts/apply-study-guide.mjs --kind torah --reading-key <slug> --file guide.json --admin-membership <rabbi membership uuid>          # dry run
node scripts/apply-study-guide.mjs --kind torah --reading-key <slug> --file guide.json --admin-membership <rabbi membership uuid> --apply  # write
```

`DATABASE_URL` must be the app's restricted runtime connection, never the owner. The bridge stores origin `claude`, reviewed `false`; it can never review, publish, write the voice or per-student additions. **Delete `scripts/apply-study-guide.mjs`, `src/server/study-guides/bridge*.ts` and their tests in the same commit that enables the MCP endpoint.**

## 6. Operator recipe for drafting guides (documentation; not code)

When the MCP is live and Daniel has connected Cowork:

1. `get_study_voice` — if `template:true`, Daniel writes the voice with Claude first and saves it.
2. `list_guide_work` — every `(kind, readingKey)` current students need, with base/reviewed state.
3. For each missing base: `get_reading_for_guide` → draft overview + 3–5 themes, each note ≤ 3 sources chosen **only** from the returned candidates → `save_guide` with `reviewed:false` (and `hold:true` if Daniel wants to read it before students do; otherwise it is live and labelled).
4. Daniel reviews in chat or via the admin "Preview as student", edits, `save_guide` with `reviewed:true`.
5. Per-student additions: `save_student_guide` for the one student, bound to their current assignment revision.

A scheduled Claude Code routine can run steps 2–3 weekly; it needs its own MCP consent as Daniel's staff identity and must never set `reviewed:true` (S25).

## 7. Decisions the planning session made that Daniel did not (marked "my call" in the spec)

- English default: off on phones, on in the wide two-column layout, remembered (spec §5).
- Theme ticks key on `readingKey` so they survive guide versions.
- Theme ticks are writable in parent child-practice mode (consistent with translation drafts there), read-only in parent overview.
- Held versions are staff-visible only; a save without `hold` is live immediately (S13 makes the default visible; the hold exists so the rabbi can polish a revision unseen).
- Rabbi display name lives at `tenant.customs.credits.rabbiDisplayName`, fallback "the rabbi".
- No generic congregation-resources table in this slice; only the haftarah-sheet link (S20).
- Bridge script `scripts/apply-study-guide.mjs` (Task 8b) as the interim write path until the MCP is accepted; Daniel may veto.
- PR3 before the study slice, time-boxed (§4a). Daniel did not rule on this; it follows from "done means CI green".

## 8. Open items that wait on Daniel (do not resolve them yourself)

- Server-side generation (Anthropic API key, new spend) — not authorized.
- Confirm the rabbi display name string.
- Connect Cowork to the MCP when Task 9 is accepted; write the study voice; draft the first parashah.
- Finkel private listening review: resuming it at all (§4b).

## Appendix — builder-check dispositions (2026-10-21)

A fresh engineer read the spec cold and asked four questions. Dispositions:

- **A1. MCP doesn't exist; is MCP the only write path?** Answered: you own the whole slice including the read-foundation activation (Tasks 7–9), with a second agent reviewing. One operator script (`scripts/apply-study-guide.mjs`, Task 8b, spec §3a) bridges until the MCP is accepted, then is deleted. Daniel may veto the bridge.
- **A2. Haftarah key on special Shabbatot.** A real bug in the first draft; fixed in spec §2 and Tasks 1–2: haftarah guides key by the passage actually read, not the parashah.
- **A3. A reviewed guide followed by a newer draft.** Daniel ruled (S25): "A Claude routine certainly should not replace my work. But a Cowork session where I was working with it absolutely should." Implemented as: `reviewed:true` saves go live at once; `reviewed:false` saves are held when a reviewed version exists; the routine's consent is flagged unattended and cannot set `reviewed:true`.
- **A4. Which custom readings get a key.** Settled in spec §2: key whenever the snapshot has a calendar reading and every assigned verse is inside it; else null.
