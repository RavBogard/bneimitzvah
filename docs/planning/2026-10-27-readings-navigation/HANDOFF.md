# Handoff: building "readings for everyone" (written 2026-10-27 for the next session, on Opus)

Read in this order, nothing else first: `CLAUDE.md` (root), `docs/planning/2026-10-15-kickoff/MISSION.md`, the 2026-10-27 return point at the top of `docs/planning/2026-10-15-kickoff/STATE.md`, then `docs/superpowers/plans/2026-10-27-readings-for-everyone.md`. The spec it implements is `docs/superpowers/specs/2026-10-27-finding-and-keeping-readings-design.md`; the evidence is `FINDINGS.md` and `MENU-MAP.md` beside this file. The plan is complete and self-contained; builders need only `docs/planning/AGENT-BRIEF.md` plus their own tasks pasted in.

## What Daniel decided (all binding)

- Anyone who signs in gets a shelf, no approval; one shelf for everyone with the Beit Mitzvah reading pinned; children under 13 included, no gate.
- The bar's word is "My Readings" (capital R); the signed-out door is "Your readings".
- Readings are not private: any tutor may see any signed-in learner's readings and claim them; the learner can undo a claim.
- The week arrows retire. Parents and tutors have no tab bar; their role is sections of My Readings. Only the admin keeps This week · Students · People · More.
- "Your recommendations are approved. Write out everything you need, whatever plans you want, whatever details, etc. And prepare for compaction and changing the model to opus for implementation."

## How to run it

1. Work from `C:/Users/dsbog/bneimitzvah-study` (main). Never commit from `C:/Users/dsbog/bneimitzvah` (it sits on a stale Codex branch). Never stash in the study checkout.
2. Start areas A, B and D together. A and B on Sonnet; D on the strongest model (auth and data access). Each builder: a fresh worktree from `origin/main`, the brief, its tasks, the exact strings. Builders push, open the PR and stop.
3. Area C continues on B's branch after B's PR merges (they share `view.tsx` and `read-header.tsx`). Area E starts after A, D and C have merged.
4. Migration 0054 belongs to area D alone. Apply it to production before D merges (check, apply, verify; the ledger becomes 54; the recipe is in memory `torah-study-guides-2026-10-21.md` and in STATE's earlier GATE lines).
5. D's PR gets the adversarial pass of Task D9 (ten named attacks) before it is reported done; one fix round, re-review only the security deltas. E gets a scoped access review (Task E6 step 3).
6. Wait with one watcher per PR (`bash ~/.claude/scripts/merge-if-green.sh <pr> C:/Users/dsbog/bneimitzvah-study`). Batch STATE commits per wave. Report to Daniel in under 15 lines when a wave lands or something needs him.
7. Ask Daniel only for: money, licences, a second tenant, launch labels, irreversible production changes, messages to real people. Wording gaps the builders list go to him in one round at the end of the wave, not one at a time.

## Things the plan already settled so no one re-opens them

- Membership row at first sign-in via `POST /api/session/begin`; `tenant_member` keeps its schema and no longer gates the shelf (plan decision 1).
- Claims live in `learner_claim`; a claim on a linked student also writes the existing tutor link (decision 2).
- The staff read path is two read-only policies with `app.saved_viewer` and `app.saved_directory`, set only in `src/server/saved/access.ts` (decision 3).
- One reader header (`ReaderTitle`) now; the public and workspace bodies stay separate until the store unification (decision 5).
- Addresses: `/mine`, `/mine/reading`, `/mine/child/<id>`, `/mine/learner/<membershipId>`, `/readings`, `/api/public/calendar` (decision 6).

## Known gaps to list for Daniel at the end of the wave

- "Saving isn’t available for this account." (a disabled membership's Save line, D2).
- "A learner (no name yet)" versus the `displayName(value, "Learner")` fallback for an account with no name in Find a learner (D5).
- The Needs you empty line and the "{n} link requests waiting" row (E4).

## Sandbox

The audit sandbox (`C:\Users\dsbog\bneimitzvah-audit`, recipe in `C:\Users\dsbog\bneimitzvah-review-output\2026-10-27-readings-navigation\SANDBOX.md`) is stopped and its database deleted. It can be restarted for a final walk after area E merges; the walk scripts are in the previous session's scratchpad and are described in `AUDIT-PLAN.md`.
