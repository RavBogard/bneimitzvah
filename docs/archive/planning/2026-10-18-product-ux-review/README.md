# CRC Beit Mitzvah — full product UX review

**18 October 2026 · Consultant report · Analysis and recommendations only**

**Subsequent instruction:** Daniel approved implementation by Claude Code, with Astra remaining the consultant and another active coding stream retaining integration ownership. Use [CLAUDE-CODE-HANDOFF.md](CLAUDE-CODE-HANDOFF.md) for the isolated implementation assignment. The report below records the consultation; its original no-implementation status is historical, not a block on that later authorization.

**Verdict: the product has valuable capabilities, but too many routine tasks require users to understand how the system works. Reorganize it around complete user journeys, beginning with reading assignment.** Better dropdowns will help; the larger improvement is knowing what to do, why it is suggested, and when the job is finished.

Daniel's brief is “easy and intuitive for an iPhone-tech/level user.” He delegated the order of analysis and favored reorganizing existing features into clearer journeys. This report makes those recommendations without changing the application or treating proposals as approved implementation.

## Project status at review time

The reviewed main/release source is `3f1c357d7ebadb2419e50196145ad1f5625dddcc`. The final honoree release record and a successful production deployment readback corroborate that baseline. Some older STATE paragraphs describe superseded checkpoints; they are not the current release verdict.

| Status | What it means for this review |
| --- | --- |
| Substantial core product released | Account/role workspaces, reading assignments, study tools, staff management and family honors have released surfaces. This is not proof of novice usability or full revised 1.0 completion. |
| Listening still subject to acceptance | Human reference playback remains held from general student release pending Daniel's real-source and phone acceptance. |
| Honoree foundation deployed; real use held | Guest/link-management code is deployed, but the accepted release has no approved activated material or real links. Material activation is a separate step. |
| Reading simplification not deployed | The earlier date-assisted selector work is a separate candidate. It can inform the design; it is not the live baseline or a completed response to this consultation. |
| Important journeys incomplete | Operational integrations, minimum settings/onboarding and portions of the learning/printing scope still need a complete ordinary journey established. Adult honors self-edit remains a policy gap. |
| Explicitly outside revised 1.0 | Generated chant, student recording upload, offline/PWA and notification extras remain parked or later. |

No defensible percentage-complete figure follows from these facts. The product should be judged by completed role journeys, content availability and release acceptance rather than its number of components or passing technical checks.

## The five most consequential conclusions

1. **Assignment should start from the ceremony already on file.** Show a truthful date/service-based reading suggestion, make passage selection recognizable, let staff choose verses, and show one meaningful final review. Manual syntax, source preparation and advanced divisions should not be the entrance exam. Torah and haftarah both need this treatment. See UX-03 and the [proposed assignment journey](INFORMATION-ARCHITECTURE.md#flagship-journey-assign-torah-or-haftarah).

2. **Give each role a clear starting task and stable person context.** Students open their reading; parents see the selected child's preparation and a clear practice action; tutors stay with the student they are teaching; administrators see what remains to set up. Keep account, role and child switching understandable. See UX-01, UX-02, UX-05 and UX-06.

3. **Make saving and leaving predictable everywhere.** Some forms protect drafts while student details can clear them. Recovery language exposes receipts, revisions and multiple retry choices. One familiar save vocabulary and a guided uncertainty path would reduce lost effort and anxiety. See UX-10 and UX-11.

4. **Connect administrative steps into a complete setup journey.** A contact saved, an invitation sent and a person actually granted access are different outcomes. The product should display those distinctions and the next unfinished step in the student's context. Access removal must state its scope before the consequential confirmation. See UX-15–UX-17.

5. **Treat family preparation as a sequence that can be paused.** Organize honors into ceremony sections, reduce repeated name entry, explain optional fields, and separate entering people from preparing their blessing links. Before real honoree use, address the confusing unavailable state after a routine phone app switch. See UX-12–UX-14 and UX-19.

The [finding register](FINDINGS.md) contains **19 consolidated findings: 10 P1 and nine P2**. These are expert-assessed priorities, not 19 observed failures by real users. Each identifies its evidence and confidence. P1 on a held journey means address it before activation, not that today's users were observed failing that journey.

## What is working and should survive

The product is meaningfully specific to reading preparation. Hebrew, phrase color, Torah/haftarah context and word/verse tools give it a useful identity. Preserve the existing Hebrew-first reading design and the direct-to-reading student experience.

The careful handling of permissions, source attribution, changed assignments and uncertain saves is valuable. The recommendation is to express these protections in understandable tasks. The distinctions between student self-checks, tutor assessments and practice days are also worth preserving; they should not be flattened into a questionable readiness score.

The signed-out entry is comparatively straightforward: Google or email, without a password. Fresh public inspection confirms the available choices and an ordinary phone-width layout. Its outdated product name and generic support wording are narrower improvements than the assignment and navigation problems.

## Recommended structure and order

Organize the product around **person → task → clear result**. Keep the reading central for students; place tools beside the relevant word or verse. Give families a selected-child overview and ceremony tasks. Give staff a student-centered workspace connecting readings, service parts, lessons and authorized people management.

The recommended order is: reading assignment; role navigation and practice entry; consistent save/recovery behavior; student setup/access/imports; family honors and guest recovery; coherent study/service/output journeys; integrated validation. Apply the shared reliability rules during the first redesign, and respect existing activation gates throughout. The [roadmap](ROADMAP.md) explains dependencies and acceptance outcomes.

## Coverage and confidence

This assessment covers **17 page routes, three additional landing handlers, 24 in-page surfaces and 16 role journeys** across children, adults, parents/siblings, tutors, administrators, honorees and office Sheet consumers. It examines first use, returning use, incomplete setup, interruptions, ceremony changes and handoffs—not only successful form submission.

Two independent assessments supplied journey/findings and inventory/evidence; the primary consultant synthesized the recommendation. Current source, recorded release evidence, dated synthetic captures and fresh signed-out public browser inspection support the analysis. A scoped design scan is documented separately; its 30 token advisories are not 30 UX defects and did not determine priorities.

**This is a complete scoped expert product review, not a completed live usability study.** No fresh authenticated production walkthrough, real honoree session, actual iPhone/Safari, VoiceOver, comprehensive contrast measurement or novice task study was performed. Historical or candidate screenshots are labeled accordingly. The [validation plan](USABILITY-VALIDATION.md) states what still needs demonstration, with Daniel as the sole human tester until existing testing conditions permit more people.

## Documentation guide

| Document | Use it for |
| --- | --- |
| [INVENTORY.md](INVENTORY.md) | Every current route/surface, role boundary, availability distinction and incomplete journey. |
| [JOURNEYS.md](JOURNEYS.md) | Sixteen complete tasks, including triggers, proposed flow, recovery and recognizable success. |
| [FINDINGS.md](FINDINGS.md) | Nineteen prioritized, evidence-linked problems and the outcomes each recommendation should produce. |
| [INFORMATION-ARCHITECTURE.md](INFORMATION-ARCHITECTURE.md) | Recommended role navigation, detailed assignment flow, task language and shared interaction rules. |
| [ROADMAP.md](ROADMAP.md) | Recommended sequence, dependencies, completion gaps and ownership of genuine policy decisions. |
| [USABILITY-VALIDATION.md](USABILITY-VALIDATION.md) | Fourteen goal-based scenarios, measurable proposed criteria and device/accessibility/recovery checks. |
| [EVIDENCE.md](EVIDENCE.md) | Release/source/browser provenance, scan details, confidence limits and source links. |

## Decisions and handoff

- **Recorded user direction:** full product analysis; consultant role only; primary consultant chooses the sequence; preferred reorganization of existing features into clear journeys.
- **Consultant recommendation:** adopt the structure and order above while preserving the approved visual world and existing authority boundaries.
- **Unresolved product matters:** adult honors responsibility, actual source/material readiness, operational integration ownership and Daniel's release acceptance. They do not prevent documenting the recommended experience.
- **Work completed in this continuation:** consultant documents, read-only product/source/public-browser review, and scoped evidence work. No application edits, test runs, server/harness startup, merges, commits, deployments, invitations or material activation.
- **Prior work:** the reading-editor candidate predates Daniel's consultant-only correction and remains separate. This review neither continues nor releases it.
- **Next appropriate use:** use this pack as the product brief for later authorized design/implementation and evaluate complete journeys against its criteria. There is no automatically authorized implementation queue.

Questions skipped: Daniel already delegated prioritization and selected journey reorganization; no further preference question is needed to complete this consultation.
