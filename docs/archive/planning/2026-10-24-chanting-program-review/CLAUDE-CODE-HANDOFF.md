# Coordination handoff: the whole chanting program

24 October 2026. **Curriculum package approved by Daniel.** After receiving the completed package Daniel replied “Approved.” [IMPLEMENTATION-PACKAGE.md](IMPLEMENTATION-PACKAGE.md) records approval of the design, proposed curriculum copy and acceptance criteria for implementation in Claude's existing release stream. Astra owns product direction and final integration review; active Learn file ownership and 1.9/2.0 integration stay with Claude. No second implementation stream or learner pilot is started here.

Daniel previously authorized curriculum-design work alongside 1.9/2.0 and requested a relay message. Read [PARALLEL-WORK.md](PARALLEL-WORK.md) for that boundary, overlap map and message, then [TEACHING-SEQUENCE.md](TEACHING-SEQUENCE.md) and [WORKED-FIRST-READING.md](WORKED-FIRST-READING.md) for the first concrete designs. The later approval above supersedes their draft status. No acknowledgment by the active Claude stream has been received in this task.

Daniel now confirms the message was sent and has instructed Astra to continue. The detailed planning lane is complete in [IMPLEMENTATION-PACKAGE.md](IMPLEMENTATION-PACKAGE.md): all 24 lesson specifications, practice/feedback recipes, passage/independence tasks, actual catalogue starter references and focused implementation acceptance checks. Current source baseline is `02d8af2`; existing Torah/haftarah content is unchanged, while 2.0 SC2 has advanced. No application source was edited. Existing human recordings need no new Daniel listening-release approval; example/cue review is routine QA, with no actual audition claimed here.

Read [REVIEW.md](REVIEW.md), then [PROGRAM-ARCHITECTURE.md](PROGRAM-ARCHITECTURE.md), [ENTRY-POINTS-AND-SUPPORT.md](ENTRY-POINTS-AND-SUPPORT.md), [READINESS-AND-VALIDATION.md](READINESS-AND-VALIDATION.md) and [EVIDENCE.md](EVIDENCE.md). These files are in `C:/Users/dsbog/bneimitzvah/docs/planning/2026-10-24-chanting-program-review/`; the active worktree may not contain them. Read them there or copy only this planning folder, preserving ongoing changes.

## The larger question Daniel asked

Can all of the learning take a person from wanting to chant Torah to being capable of doing it, and does its structure reflect sound practice? The review's judgment is that existing assets and recognition lessons support parts of that journey, but the integrated preparation/production/feedback/transfer chain and outcome evidence are incomplete.

This is above the level of the introductory quiz fix. The earlier 24-lesson/exercise map remains useful evidence, while this review proposes a capability-led structure for the whole program.

## Preserve current authority and scope

- Public defaults are substantially the same for everyone; signed-in users own/customize dated readings; shared reading links allow open viewing without sign-in.
- Assume basic Hebrew phonetic ability (Daniel's clarification). Review different starting abilities and knowledge: new to chanting, ear-experienced, partial/rusty trope knowledge, experienced preparation. These are flexible profiles; do not assign one fixed rank, require initial literacy teaching or expose a reading owner's profile through a public link.
- Move the first same/different family comparison out of the introduction; teach sounds first and give easier supported recognition afterward.
- Ear-first and trope-based preparation are valid routes. No new record-yourself feature, automated accuracy scoring, generated voice, family logistics or D'var workflow.
- Preserve the approved visual direction, source/licensing rules, account/privacy boundaries and existing human-testing gate.
- The detailed program architecture, capability rubric and evaluation procedure are proposals, not mission amendments or new learner-facing grading.

## Coordination decisions before code

1. **Define the claimed outcome and entry paths.** Basic Hebrew phonetic decoding is settled as the entry assumption. Distinguish a prepared reading, transferable preparation and scroll-performance conditions. Map useful starts and support for different prior chanting abilities, including skippable familiar work and targeted repair. Do not accidentally promise sight-reading of any text or require an entrance exam.
2. **Map one complete miniature task.** Model → supported attempt → useful feedback → repair → joined reading → less support → later return. Identify the existing tools that supply each part and the instructional links still missing.
3. **Settle the feedback function.** The app does not hear the learner. Specify guided self-comparison and the role of optional competent listening without silently requiring a tutor for every public user or implying that self-report proves accuracy.
4. **Align existing milestones.** P4 improves delivery, N17 supplies relevant reading context, N18 supplies independent attempts and N19 supplies review/fading. These do not alone specify flexible entry, word-to-chant application, joining, practice method, recovery or delayed transfer. Reconcile them under the program structure and active ownership rather than opening a parallel roadmap.
5. **Align Hebrew/service work.** Word-specific support remains useful; a complete literacy bridge is outside this core promise. Reuse supplementary support where suitable and identify its limits. Do not count gated-off or text-only work as delivered pronunciation teaching or advance deferred prayer audio.
6. **Agree how the outcome will eventually be checked.** Use authentic prepared performance, another suitable preparation task and a delayed return under normal resources. Retain technical tests as technical evidence. No learner pilot starts without the existing authorization.

## Implementation implications to evaluate later

Likely reuse includes the existing reader, text/word tools, reference playback, tikkun views, Up close, lesson components and review infrastructure. The required change is their instructional connection and evidence semantics. Do not assume the answer is a replacement frontend or more exercise types.

Before an eventual bounded assignment, review current source/PR ownership. The analysis baseline was main `4a99b7f`; later integrated work may change gaps and file locations. Do not automatically merge the old unvalidated highlighting draft or copy the dirty consultation checkout.

## Current status

The source-based structural review and independent capability assessment are complete. No outcome validation or new actual-audio audition is claimed. No application edits/tests/commits/deployments occurred in this review; no Claude Code message or coding assignment was sent. The next action is product/architecture reconciliation with that stream, before coding.
