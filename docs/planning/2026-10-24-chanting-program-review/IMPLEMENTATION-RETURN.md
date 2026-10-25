# Parallel implementation return

24 October 2026. Daniel clarified that implementation should happen alongside Claude's 1.9/2.0 work and merge later. Implemented in managed worktree `C:/Users/dsbog/.codex/worktrees/chanting-curriculum/bneimitzvah`, branch `codex/chanting-curriculum`. Initial base `1777b29`; fast-forwarded the documentation-only main amendment `ef2933b`. Astra handled architecture/review and a bounded Sol worker implemented. Claude's checkout and the earlier parked highlighting candidate were not edited.

## Implemented scope

- Learn word outlines follow canonical reference-word intervals and the actual media clock, including maqaf parts, speed, pause/resume, buffering, comparison gaps and replaced clips. Visible examples bind to the owning play control/comparison part so duplicate references do not all light up.
- A guided Torah/haftarah first-reading flow replaces four passive playback steps: whole model, words, echo, independent attempt, comparison, targeted word/tune/uncertainty repair, complete-phrase joins and an independent whole verse.
- Whole-verse repair can target any word or explicitly select a part. Experienced readers can go directly to a whole attempt, select a part or use fewer color cues. Return/retry/recovery guidance and another available verse are reachable.
- New main's explicit Daniel ruling is preserved: “You can lein this verse.” appears only after “Same as the reader”. This is qualified as a learner comparison; “Not yet” routes to practice. The result is temporary state, never stored accuracy. Return later uses the practiced summary without certification.
- The active reading's playback selector also uses an outline without forcing the marigold fill or replacing phrase colors.
- Existing lesson IDs, course/card schemas, stored completion history, server access and service-course content remain unchanged. No new auth, database, recording, generated audio or private data access.

## Source ownership and merge coordination

Core code: `src/components/learn/guided-preparation.tsx`, `first-verse.tsx`, `player.ts`, `bits.tsx`, `learn.module.css`, `src/lib/learn/preparation.ts`, `phrase-audio.ts`; one active-word selector in `study/reference-player.module.css`.

Narrow shared hooks: `lesson.tsx` adds playback bindings and practiced Done copy; `drills.tsx` and `this-week.tsx` add control/part bindings only. These are the specific hunks to reconcile after P4/N17a. Do not duplicate this first-reading/player work as a second N18/N19a implementation. N17's assignment/reading context, N19's persistent verse review and the multi-verse workflow remain with the active stream. This branch does not claim to implement every future lesson specification or the full outcome-validation program.

PR #80 was still open when last checked. The existing one-open-PR rule for the Learn group is respected: keep this branch separate and reconcile the merge queue before opening another Learn PR. No merge to main or deployment is part of this return.

## Verification

- Node/repository suite: 458 passed, 1 skipped; no failures.
- Focused timing, rendering and preparation checks passed, including stale playback/resume races, canonical maqaf highlighting and progress compatibility; added self-report gating checks passed.
- Formal route/type check and production build passed after the final source fixes.
- Production browser coverage: 31 existing Learn cases passed, with 2 device-specific skips. All 15 new-flow cases passed across desktop/tablet/phone after self-report alignment. After the final metadata fix, the 6 affected moving-outline/word-card cases were checked against a fresh production build and passed. Earlier incorrect test expectations/locators were corrected without removing instructional colors or weakening behavior checks.
- Desktop/phone light/dark UI reviewed in a bounded initial/confirmation pass. A sticky-header prompt visibility defect was fixed and has browser coverage. Mechanical design scan reported advisories, with no blocking result; no unrelated design-system cleanup.
- Full app run: 3,123 passed, 1 skipped, 1 failed across 337 files. The single failure exposed answer-mode maqaf spans carrying card-only `data-part` metadata; it was fixed by separating `data-reading-word` from actual card targets. The existing failing test was left unchanged, and all 116 Learn tests in 15 files subsequently passed. The entire 18-minute app suite was not repeated locally after that focused fix; CI must run the complete final tree. Logs are in ignored `.local-logs/curriculum-*.log`.
- Staged repository policy check: 3 passed. No prohibited media, text payloads, local logs, generated AGENTS block or dependency changes are part of the candidate.

No actual reference recordings were auditioned and no learner efficacy observation occurred. Browser fixtures are synthetic and establish behavior/timing wiring, not how real recordings sound. Exact preparation-step position is not persisted; no new progress contract was introduced. Actual example/cue QA and the explicit content-selection decisions in main's reconciliation remain integration work, separate from a generic human-reference release gate.

## Next action

Review the isolated branch's CI and reconcile its exact changes with Claude's active Learn lane before later merge. Preserve the current content and project release gates. Do not silently overwrite the reconciled plan or activate a new learner pilot. This is an implemented branch candidate, not a deployed or fully validated complete curriculum.
