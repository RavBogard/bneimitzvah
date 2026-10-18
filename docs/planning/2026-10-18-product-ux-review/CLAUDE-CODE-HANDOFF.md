# Claude Code handoff: implement the product UX review

Prepared 18 October 2026. Start here. This document is a self-contained assignment from Daniel's product consultation; the accompanying review documents supply the detailed rationale and acceptance criteria.

## User authorization and division of work

Daniel approved implementing the UX recommendations and asked to hand implementation to Claude Code. Astra remains the product consultant and should not write implementation code or supervise every small step. Another coder is active in this project. Keep this work separate and economical.

**You own:** frontend UX implementation, focused verification, documentation of your changes, and reviewable commits on an isolated UX branch.

**The existing coding/integration stream retains:** shared backend contracts, database/schema/migrations, authentication and permission policy, source/material activation, infrastructure and integration/deployment to main. Do not duplicate or interrupt its current work.

This separation is a work-ownership convention, not a claim that frontend and backend have no dependencies. If an approved outcome needs a server capability that does not exist, document the precise dependency and continue independent UI work. Do not fabricate success, broaden permissions or silently change the API to finish a screen.

The intended result is the approved UX roadmap implemented in bounded, reviewable milestones. Do not stop after making a plan or renaming a few buttons. Do not automatically implement every missing product capability listed in the audit: that inventory also includes work owned by the other stream, policy holds and later-release features.

## Repository and isolated setup

- Repository: `C:/Users/dsbog/bneimitzvah`.
- Review pack: `C:/Users/dsbog/bneimitzvah/docs/planning/2026-10-18-product-ux-review/`.
- Read the current `AGENTS.md`, `CLAUDE.md`, `docs/planning/2026-10-15-kickoff/MISSION.md`, current release/coordination return, and `PRODUCT.md`. Later explicit user rulings supersede older contradictory checkpoint text. Preserve unrelated work.
- Create a **new Git worktree and branch**, for example branch `claude/product-ux` in a separate checkout. Start from current committed main after identifying the active integration baseline. Do not reset, stash, switch branches in, or clean the active coder's checkout. Do not reuse a branch/worktree owned by another task merely because its name looks suitable.
- The review's source baseline was `3f1c357d7ebadb2419e50196145ad1f5625dddcc`; it is a dated reference, not an instruction to reset to that commit. Reconcile only relevant changes since then. Avoid another full audit.
- The review documents were created **locally and uncommitted**. A fresh worktree or clone may not contain them. Copy this handoff and its eight companion Markdown files from the review folder, or extract the supplied ZIP into the same relative folder in your worktree. Do not copy the entire dirty checkout. Commit the brief/docs with your branch if appropriate.
- Use your own local ports and disposable test data. Do not stop another coder's server, share a mutable test database, alter production data, or start broad provider operations as part of UI verification.
- No worktree, branch or coding process was started by Astra for this handoff. You must perform your isolated setup.

## Read only what is needed

Start with [README.md](README.md), [INFORMATION-ARCHITECTURE.md](INFORMATION-ARCHITECTURE.md) and [ROADMAP.md](ROADMAP.md). Read the relevant UX findings and validation scenarios as each milestone begins. Consult [INVENTORY.md](INVENTORY.md) and [EVIDENCE.md](EVIDENCE.md) for availability, roles and provenance. [JOURNEYS.md](JOURNEYS.md) describes complete tasks.

Avoid loading all historical logs or rerunning the whole audit. The review covered 17 page routes, three landing handlers, 24 in-page surfaces and 16 role journeys. Its 19 findings already identify the intended outcomes. Source-derived findings still need verification in the current implementation; historical screenshots do not establish current behavior.

## Product contract

The target is **easy and intuitive for a person comfortable with ordinary iPhone apps**. Users should recognize choices, understand whose information they are seeing, complete a task without learning internal terminology, and know what saved.

Organize around person and task. Students open their assigned reading directly. Parents see a selected-child overview with explicit entry into that child's practice. Tutors stay in the student they are teaching. Administrators see the next unfinished student-setup task.

Preserve the existing Hebrew-first interface, clear vowels/cantillation, useful phrase colors and tools beside the reading. Do not commission a new visual identity. The review notes conflicting historical style names; this is not an invitation to reopen that decision.

Preserve Torah and haftarah prominence, custom verse selection, required attribution, role boundaries and truthful save states. Keep expert options available without requiring them for ordinary work. Avoid new dashboards, metrics, mascots, rewards, chatbots or unrelated features.

## Milestones and ownership boundaries

Work sequentially in bounded commits. Use the actual current file structure; paths below describe responsibilities rather than permission to overwrite whole files. You are not alone in the codebase. Other changes must be preserved and accommodated.

| Milestone | Own and change | Acceptance / boundary |
| --- | --- | --- |
| 1. Reading assignment | Reading editor, its preview/selectors and directly related presentation. Primary area: `src/components/portal/workspace/reading-editor.tsx` and companion reading-preview components/styles. | UX-03; scenarios V03–V04. Reuse date/service; present truthful suggestions; familiar portion/book/chapter/verse choices; custom-first and multi-range support; optional aliyah divisions; one meaningful review; exact saved result. Date changes flag review rather than replace readings. Preserve existing server preparation/confirmation and authority checks. |
| 2. Context and navigation | Role entry, selected child/student context, reading toolbar and navigation composition. | UX-01/02/05/06/09; V01/02/05/07. Student stays direct-to-reading; role and person are distinct; parent practice is explicit; sibling switch is reachable; listening actions say what they do and reflect actual availability. Do not change auth or delegated-practice policy. |
| 3. Predictable editing | Presentation and controlled navigation of existing forms, save/status/error copy and recovery actions. | UX-10/11; interruption checks. Consistent protection of dirty forms; clear Editing/Saving/Saved/Unconfirmed states; one safe recovery action. Preserve uncertainty, original intent and existing server guarantees. No blanket autosave or new private browser persistence. |
| 4. Student setup and access | Contextual links, readiness summaries, People/invitation presentation and CSV review/error explanations. | UX-15/16/17; V09/10. Distinguish contact saved, invitation sent and access accepted. Make per-student vs congregation-wide removal scope clear. Imports send no mail and never match identities silently. Backend/provider work remains other-stream owned. |
| 5. Honors and guest recovery | Family-form grouping, existing-person reuse within that authorized form, optional-field help, link-readiness presentation and guest recovery copy. | UX-12/13/14/19; V11–V13. Preserve actual aliyah groups, changed-ceremony review, saved-version printing, link lifetime and copy-now behavior. Adult self-edit is not automatically authorized. Real material activation is separate. |
| 6. Study/service/output coherence | Existing service chooser, verse/word/source tools, English/personal translation/teacher-note labels, lesson notes and available print affordances. | UX-04/07/08/18; V06/08/14. Assigned material first, optional depth second; clear return to verse; source editions and rights remain truthful; note audience clear. Do not build missing integrations or invent unavailable source/print capabilities. |
| 7. Integration-ready UX handoff | Focused evidence, current branch checks and a short immutable milestone return. | Full relevant journey works; documentation distinguishes synthetic evidence from actual phone/source acceptance. Existing integration owner receives exact commits and conflicts/dependencies. No independent main push/deployment from this UX stream. |

Apply the shared save/recovery rules while implementing milestone 1; do not knowingly introduce inconsistency and postpone fixing it. Prioritize guest interruption messaging before real guest activation if the integration stream is approaching that milestone.

### Special ownership boundary: guest page

The guest view currently lives partly in `src/server/http/honoree-landing.ts`. It is a security-sensitive boundary despite containing UI. You may propose narrowly scoped presentation/copy changes, but do not alter token handling, caching, expiry, concealment behavior, scope, or access mechanics. Any substantive change to those controls belongs with the existing owner and requires the existing independent adversarial review. Do not weaken the privacy contract to simulate seamless resume.

## Reuse the existing reading candidate

There is already a separate reading-assignment candidate:

- Checkout: `C:/Users/dsbog/.codex/worktrees/reading-assignment-flow/bneimitzvah`.
- Branch: `codex/reading-assignment-flow`.
- Recorded final checkpoint: `c590bc014843ad9fee9467fbb999ac2e57ffdf76`.
- Earlier implementation/review commits: `c82d53d`, `3c8fcb1`.

It predates the consultant-only instruction and was not deployed by this review. Inspect its bounded diff and return notes **read-only**. Reuse suitable ideas/changes in your isolated branch after comparing with current main and UX-03. Do not rerun its whole historical verification, reimplement useful selectors from scratch, merge its parent history wholesale, or assume its old test results certify your integrated branch. Do not edit that owned checkout without coordinating ownership.

The candidate improves suggestions/selectors but is not automatically the finished journey. Evaluate ceremony context, custom verse choice, multi-ranges, divisions, replacement review, changed dates and visible saved results.

## Protected boundaries and unavailable features

- No auth/tenant/schema/permission changes as a shortcut to UX completion. Existing independent adversarial review remains mandatory for relevant high-stakes changes.
- No student/family records, credentials, licensed source bodies, recordings or bearer links in repository content, screenshots or logs. Use approved synthetic fixtures.
- Student reference audio and honoree material were held at review time. Check the current accepted state; do not infer release from a visible control. Activation belongs to the existing stream and its applicable acceptance gates.
- Guest blessing scope is the narrowly approved text/English/credits, not the whole booklet, participant data or audio sharing.
- Adult honors self-edit remains a policy issue unless a later explicit ruling settles it. Improve the honest explanation without inventing parent/admin authority.
- Maven/owned Sheet/MCP and minimum settings/onboarding are not made operational by adding a navigation link. Record dependencies; leave provider/infrastructure work with its owner.
- Generated voices, student recording upload, offline/PWA and notification extras remain outside this assignment. Custom packet generation and general family logistics are not additions.
- Only Daniel tests as a human until existing product-completeness/testing conditions permit broader research. No unsolicited messages, invitations, real imports, new spending or licensing decisions.

## Verification and completion

Use [USABILITY-VALIDATION.md](USABILITY-VALIDATION.md) for goal-based acceptance. Exercise the current journey, not merely the component. Cover happy path plus missing data, changed ceremony, cancellation, unsaved departure, uncertain save, wrong person/access and unavailable material where relevant.

Run focused checks for changed behavior, then the repository-required broader checks at an integration boundary. Do not rerun unchanged checks solely to produce activity. Use existing synthetic fixtures and the project's environment-isolation helpers. Capture a few useful desktop/phone-width views and inspect readability/controls; do not label emulation as actual iPhone/Safari or VoiceOver acceptance.

Do not remove meaningful consequential confirmation to reduce clicks. Conversely, internal catalog loading/preparation should not be presented as separate user chores when the existing contracts allow the application to handle them.

A milestone return should be short:

1. Outcome and UX IDs covered.
2. Exact branch/commit, baseline, and changed files.
3. Focused/current verification and remaining device/content evidence.
4. Dependencies, overlaps, conflicts or permission-policy limits.
5. Next milestone and any decisions genuinely requiring Daniel.

Keep one `CLAUDE-UX-RETURN.md` in this review folder on **your branch**; link deeper evidence rather than copying logs into it. Do not overwrite the other stream's global STATE/coordination file during routine UX milestones. Supply the return for its integration owner to incorporate.

## Cost and collaboration discipline

Make routine reversible implementation decisions yourself. Do not ask Astra to inspect every edit, repeat the audit or babysit test runs. Escalate only a genuine product ambiguity, necessary shared-contract change, conflicting ownership or an existing unresolved policy/release gate.

Use one implementation stream by default. If the runtime supports delegation, use it only when authorized and independently useful, with explicit file ownership and acceptance checks. Do not recursively delegate or start several overlapping UX workers. Use a separate reviewer for the high-stakes cases required by repository policy.

If the current coding stream's exact assignment is unavailable, proceed only in the isolated worktree against the committed baseline. Record overlaps and keep shared-contract changes as dependencies. Do not claim coordination or approval that has not happened.

## Start now

Read the compact brief, identify the current baseline, create your isolated worktree, inspect the existing reading candidate, and implement milestone 1. Continue the approved UX milestones within these boundaries, keeping clean reviewable commits and a short return note. The existing coding stream remains the integration/deployment owner.
