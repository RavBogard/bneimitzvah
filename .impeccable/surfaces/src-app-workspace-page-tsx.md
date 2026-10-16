---
version: 1
slug: "src-app-workspace-page-tsx"
primary_target: "src/app/workspace/page.tsx"
related_targets: ["src/app/workspace/layout.tsx","src/components/portal/workspace/provider.tsx","src/components/portal/workspace/students.tsx","src/components/portal/workspace/reading.tsx","src/components/portal/workspace/roster.tsx"]
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
