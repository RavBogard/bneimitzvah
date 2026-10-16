---
version: 1
slug: "src-app-workspace-page-tsx"
primary_target: "src/app/workspace/page.tsx"
related_targets: ["src/app/workspace/layout.tsx","src/components/portal/workspace/provider.tsx","src/components/portal/workspace/students.tsx","src/components/portal/workspace/reading.tsx","src/components/portal/workspace/roster.tsx","src/app/workspace/admin/students/[studentId]/reading/page.tsx","src/components/portal/workspace/admin-reading.tsx","src/components/portal/workspace/reading-editor.tsx","src/components/portal/workspace/reading-proposal.ts","src/components/portal/workspace/student-label.ts","src/app/workspace/admin/invitations/page.tsx","src/components/portal/workspace/invitations/workspace.tsx","src/components/portal/workspace/invitations/form.tsx","src/components/portal/workspace/invitations/review.tsx","src/components/portal/workspace/invitations/list.tsx","src/components/portal/workspace/invitations/api.ts"]
---

# Role workspaces

Mode: Operate. Primary target /workspace. Related surfaces: student, parent, tutor, child-practice and admin student-roster pages. This extends the reviewed Annotated score system; Daniel's confirmed direction and composition constraints are settled, so no context/init/world-choice round is repeated.

## Direction contract

THESIS: The selected student's actual confirmed reading references lead, with the role and child context unmistakable. A conventional operational workspace replaces the former unavailable destination without inventing a dashboard, passage or tool.

OWN-WORLD: Existing white field, ink, burgundy actions, teal confirmed notices, fine rules and system UI typography. Reference hierarchy and a quiet neighboring tools area carry Annotated score; color always has words.

STORY: Students enter their uniquely linked reading directly. Parents inspect a linked child read-only and explicitly enter or leave child practice. Tutors choose an assigned student. Admins view and edit actual congregation records, with revision conflicts before overwrite.

FIRST VIEWPORT: Compact masthead and explicit role navigation precede the task heading. Student references occupy the larger desktop column; practice availability sits beside them. Phone layout stacks those regions. Admin roster uses an ordinary named table with a separate inline editor, touch-sized controls and clear disabled state.

FORM: Continuation of Annotated score, Daniel's selection from direction seed75c22686. Code-first; no approved comp or shipping raster. Signature interaction: selecting a student changes only that workspace, and a serialized child switch clears the old subject before the next reading is revealed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## State and privacy boundaries

All displayed data comes from cookie-authenticated same-origin APIs. Confirmed Torah/haftarah references, source status/attribution and date-review flags are preserved. Hebrew text/audio tools remain explicitly unavailable. Parent practice handles exist only in mounted tab memory; copy/paste of a URL or reload cannot restore them. Context commands serialize, late reads are discarded, and uncertain mutations never retry automatically or restore old authority.

Focus, visible return and pageshow hide/inert the retained subtree until fresh data checks complete. An opaque server session binding allows same-session draft/selection retention; a changed or failed binding discards the subtree. Admin contacts stay in the authorized roster. No session IDs, handles, contacts or drafts enter logs, URLs or persistent browser storage. Exact current role/relationship authority remains server-side.

Review requires actual SDK/browser lifecycle, two-tab and stale-response evidence plus desktop/phone captures. No new font or asset decision is made here; Hebrew mark-rendering typography remains a separate verified-source task.

## Reading assignment editor inventory — 2026-10-16

The tutor reading panel and the admin student's reading route extend this surface with an inline reference editor below the current confirmed projection. Parent, student and child-practice views do not mount it. The current assignment remains distinct from a proposed replacement; preparation, explicit calendar selection when required, review and confirmation have separate labels and actions. Selected-student names and ceremony dates reconcile with authoritative reading reloads, while the old assignment's labeled confirmation date remains history.

The editor continues existing system typography, white/ink/burgundy colors and flat rules. Its form is capped at 44rem; the two-column reading/method selectors stack at the existing 640px breakpoint. Custom ranges use a vertically resizable, labeled textarea with inherited type, a burgundy caret and the existing 6px control corner. Calendar-choice buttons wrap; the proposal is separated by a quiet rule. These are surface-local compositions and existing-control adaptations, not new global tokens.

Prepared review shows exact references, verse count, calendar source availability/time and separately identified maftir. Input or baseline changes discard the confirmable review. Conflict/uncertain-result copy retains the draft and requires explicit authoritative reload; successful confirmation reports a verified current assignment. Hebrew text, audio and study tools remain unavailable in this extension. Implementation and bounded finish evidence are linked from `docs/planning/2026-10-15-kickoff/READING-UI-RETURN.md` and `READING-UI-FINISH-REVIEW.md`; this inventory does not establish authorization or release approval.

## Invitation management inventory — 2026-10-16

The admin roster links to `/workspace/admin/invitations`. Its inline composition separates the recipient/role/student form, an explicit action review, the latest action outcome and paged invitation records. Parent and student invitations select one active student; tutor invitations show no student target. Reviewed issue, reissue and revocation actions share a focused heading, complete identity details, a burgundy confirmation action and a visible cancel action. Creating a student or entering contact details is explicitly distinguished from granting access.

The extension reuses incumbent system type, controls, white/ink/burgundy colors and fine rules. Forms retain the 44rem measure; two-column form fields and record metadata stack at the existing 640px breakpoint. Review identity values and list values wrap long unbroken text while retaining bidi isolation. Open sections and ruled list records continue the flat operational system, without introducing global tokens or a new card vocabulary.

Invitation lifecycle and mail outcome have separate labels. Sent mail does not promise inbox receipt; failed mail names explicit reissue, while uncertain mutations block repeated actions until explicit reload and review. Supporting implementation and bounded visual evidence are recorded in `docs/planning/2026-10-15-kickoff/INVITATION-UI-RETURN.md` and `docs/planning/2026-10-15-kickoff/INVITATION-UI-FINISH-REVIEW.md`. The independent verdict resolves the scored responsive identity-value fix; this inventory adds no auth, delivery, publication or student-release approval.
