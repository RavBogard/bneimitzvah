# Curriculum integration package for Claude Code

## Implementation ownership clarified — Daniel, later 24 October

Daniel clarified that he expected Astra's stream to implement alongside Claude's 1.9/2.0 work in isolation and merge later. This supersedes the earlier interpretation that Astra's lane ends at documents. Astra coordinates architecture and review; a Sol worker implements in branch `codex/chanting-curriculum`, managed worktree `C:/Users/dsbog/.codex/worktrees/chanting-curriculum/bneimitzvah`, based on main `1777b29`. Claude's other checkout and active P4 patch remain separate. First implementation ownership is guided first-reading preparation, targeted repair/joins/independent attempts, accurate Learn word outlines, related tests, and narrow playback/truthfulness hooks. No auth/server/schema/service-course changes or automatic merge/deployment. Integration will reconcile narrow shared Learn hunks with Claude's active stream. The old highlighting worktree stays parked; this uses a fresh current-main checkout.

24 October 2026. Daniel says the coordination message has been sent and instructs Astra to continue. This package completes the detailed planning/content-design lane. Claude's active stream retains application and release ownership; this is not a second Learn implementation or permission to merge the parked highlighting candidate.

## Approved — Daniel, 24 October 2026

After receiving the completed package, Daniel replied **“Approved.”** The curriculum design, lesson specifications, proposed curriculum copy, flexible entry paths, practice/correction flows and implementation acceptance criteria are approved for implementation through Claude's existing release stream. This supersedes draft/proposal status in the linked curriculum documents; it does not require another general curriculum approval before routine implementation.

Astra retains product direction and final integration review; Claude retains application/release ownership and coordinates the Learn hot-file group with ongoing 1.9/2.0 work. Existing service teachings and unrelated approved strings remain within their current scope. Actual audio/timing checks and required technical/privacy checks remain implementation work; design approval is not evidence of completed implementation or learning efficacy. Human references need no new listening-release gate, while generated-chant and learner-pilot rules remain unchanged. The parked highlighting candidate has not been accepted or resumed.

## Read the package in this order

1. [TEACHING-SEQUENCE.md](TEACHING-SEQUENCE.md): learner-facing progression and existing activity roles.
2. [ENTRY-POINTS-AND-SUPPORT.md](ENTRY-POINTS-AND-SUPPORT.md): flexible starts, mixed strengths and basic-Hebrew baseline.
3. [LESSON-SPECIFICATIONS.md](LESSON-SPECIFICATIONS.md): all 24 existing lesson IDs with model candidates, teaching, practice/repair and next use.
4. [WORKED-FIRST-READING.md](WORKED-FIRST-READING.md) and [STARTER-EXAMPLES.md](STARTER-EXAMPLES.md): a complete first task and actual catalogue references/ranges.
5. [PRACTICE-AND-FEEDBACK.md](PRACTICE-AND-FEEDBACK.md): eight reusable practice recipes, uncertainty handling and authored-question validity.
6. [PASSAGE-AND-INDEPENDENCE.md](PASSAGE-AND-INDEPENDENCE.md): seven tasks beyond the first verse, through preparation transfer.
7. [READINESS-AND-VALIDATION.md](READINESS-AND-VALIDATION.md): participation versus demonstrated ability, and future authorized outcome observation.

Existing [structural review](REVIEW.md), [evidence](EVIDENCE.md) and [parallel overlap](PARALLEL-WORK.md) explain the reasons and boundaries. Daniel's approval above covers the curriculum copy in this package; reconcile it with existing Learn strings during integration, without replacing unrelated service-course copy.

## Settled requirements from Daniel

- Assume basic Hebrew phonetic ability; do not make initial literacy a core chanting gate.
- Consider different prior abilities/knowledge. One common public experience supports flexible starting points and targeted help rather than fixed ranks or separate products.
- Move introductory same/different comparison out of the opening. Teach sounds first and offer easier recognition afterward; different voices made the actual opening exercise especially difficult.
- Synchronize lesson playback with active-word highlighting. Start with an outline treatment; consider light shading after visual review if needed. Retain instructional phrase/family colors.
- Signed-in users customize dated readings; anyone with a shared reading link has open viewing. Private personal learning records do not become public through a reading link.
- Coordinate with the active Claude stream before coding. Preserve its 1.9/2.0 ownership, current audio scope, approved service teachings and actual project gates.

## Integration order within the existing release stream

These are dependency groups for reconciliation, not newly assigned release milestones or deadlines. Claude can combine them with existing work and re-check current main before editing.

| Group | Connect to existing work | Source area to inspect | Acceptance focus |
| --- | --- | --- | --- |
| A. Accessible entry and opening | P4/F6, existing Learn home/path | `src/components/learn/home.tsx`, `lesson.tsx`, `src/lib/learn/lessons.json`, `course.ts` | No opening cross-voice quiz; known work bypassable; direct haftarah entry; stable lesson links/history |
| B. A complete first reading | N17/N18 and existing first-verse/player | `first-verse.tsx`, `week-data.ts`, `course-data.ts`, `bits.tsx`, `player.ts`, `src/lib/learn/phrase-audio.ts` | Phrase models, independent attempt, join, focused repair, honest reading context and actual playback-word outline |
| C. Targeted library/drill practice | P4/N18, existing drill/pool authoring | `drills.tsx`, `src/lib/learn/pools.ts`, `lessons.json` and relevant validators | Models before distinctions; taught options; broad family buckets do not falsely assert sound equivalence; uncertain users can return to teaching |
| D. Passage preparation and return | N19, existing reading/practice/review | Existing reader/player/Up close, `learn/review.tsx`, `src/lib/learn/progress.ts` | Verse joins, guided local repair, independence/fading, recovery and delayed return; no private-progress leak |

Paths are relative to the study checkout and must be checked on current main. The 1.9 plan's single active PR rule for the Learn hot-file group remains. No migration number, new progress schema, profile field or second shared player is selected here. Do not replace existing account/shared-reading access contracts to implement instructional recommendations.

## Focused implementation checks

Run checks appropriate to actual changes and existing required integration gates. No app checks were run for this document-only work. The following scenarios specify meaningful behavior to verify when implementing:

1. A signed-out basic decoder reaches a supported phrase attempt without a diagnostic exam; two taught sounds precede any recognition question requiring their distinction.
2. An experienced reader reaches a relevant reading or lesson directly, can bypass familiar teaching and reopen help without a lock or progress reset.
3. A haftarah learner hears haftarah models and reaches an early verse without completing Torah first.
4. Actual playback events map to the correct visible Hebrew word in lesson models, drills, examples and first-verse playback. Seeking, replaying, word-range clips and changing the active clip do not leave a stale outline. Paused/ended/error behavior is clear. Synthetic tones can test wiring but cannot establish actual audibility or timing quality.
5. An independent-attempt state does not start playback underneath the user; the subsequent model and targeted repair remain reachable.
6. A difficult join routes to bridge practice and back to the whole reading. An “I'm not sure” route offers useful support without declaring vocal accuracy.
7. The public default, an owned dated reading and an open shared reading retain honest context. Missing audio offers retry/an honestly labeled example, without an unheard-model success claim.
8. Recognition-item tests use the authored target and taught variants; azla/pazer navigation group membership is not treated as sufficient evidence of acoustic sameness.
9. Existing completions remain accessible; old participation is not silently converted to verified singing ability. Any changed progress contract receives the current required privacy review rather than being hidden in a curriculum patch.
10. Playback controls, word tools, choice/replay separation, focus order, readable Hebrew and outline visibility work on keyboard and small screens in both themes. Practice continues without microphone permission or an account.

Prepared performance, delayed retention and preparation transfer require future authorized observation; passing UI/unit tests does not establish them. No learner pilot, recording collection or automatic scoring is introduced.

## Current source and content status

Rechecked study main at `02d8af2`, which has delivered SC2 public service-text code since the initial `4a99b7f` review. Diff inspection found no change to the Torah/haftarah lesson catalogue, player, pools or reference contracts in that interval. No re-audit or rewrite of the new service implementation was needed.

The complete curriculum behavior, all existing lesson dispositions, exact candidate reference/unit metadata and implementation checks are specified. Actual clip audition and runtime visual/audio verification remain ordinary content/implementation QA, with no new Daniel listening gate for existing human recordings. The specialized teaching cues must fit the chosen recordings; avoid shipping the old unverified contour prose as a universal rule. Generated-chant release gates remain separate.

No application files, dependencies, tests, branches, commits, deployments, other tasks or the parked highlighting candidate were changed by this planning lane. Daniel relayed the coordination message; Astra has not sent one or received an acknowledgment from Claude. The package is ready for Claude's reconciliation and bounded implementation assignment within its stream.
