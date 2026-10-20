---
version: 1
slug: "src-components-portal-workspace-honors-sheet-tsx"
primary_target: "src/components/portal/workspace/honors/sheet.tsx"
related_targets: ["src/components/portal/workspace/students.tsx","src/components/portal/workspace/roster.tsx","src/components/portal/workspace/honors/fields.tsx","src/components/portal/workspace/honors/print.tsx","src/components/portal/workspace/honors/honors.module.css"]
---

# Private family honors sheet

Mode: Operate. A local extension of the existing workspace, based on the blank October2026 CRC binder and the accepted private honors contract. Full family fields belong to the selected base guardian, administrator, or the student's own live adult identity (Daniel, 2026-10-20). The server-projected list affordance never replaces authoritative operation checks. Existing Song session world and code-first workflow remain fixed. No honoree, practice, recording, source-text or navigation redesign belongs here.

## Direction contract

THESIS: Families assign people to the ceremony's real roles and actual aliyah spans. Flexible ordered groups preserve the way CRC conducts the service.

OWN-WORLD: Inherit the workspace's flat lake, white/cool canvas, fine rules, Bricolage interface and native sheet controls. Preserve existing typography and tokens.

STORY: Open Family honors for one student, fill the ceremony groups and Hebrew names, explicitly save, and recover an uncertain save without losing the original intent. Changed ceremony or reading details receive a clear review step.

FIRST VIEWPORT: A student/date/slot heading and brief draft guidance lead into ruled ceremony sections inside the existing side-sheet composition. A stable footer contains Save honors and plain-language status. On phone the sheet uses the available width; controls remain reachable above the safe area.

FORM: Precisely specified local extension; no concept tournament or replacement world. Inherit world seed 8ac4194f. The signature interaction is the explicit review of old versus current aliyah spans, keeping every named group until it is assigned or removed deliberately.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Behavior and acceptance

- Base parent selected-child, enabled admin roster, and server-eligible own-adult base student entries only. Child students, delegated child practice and tutors gain no honors controls. Reuse the existing sheet and private-link ownership/clearing; no new main navigation.
- Ordered flexible groups; actual aliyot, multiple people, English and Hebrew names. Keep each aliyah person's English/Hebrew name visible; additional parent Hebrew names/relationship may use an explicit disclosure. Unknown names remain optional. No transliteration, contact information or blessing prose.
- Quiet same-owner tab return preserves unsaved fields, focus and scroll. Real denial/identity/scope changes clear private state. In-flight saves block edits and accidental dismissal. Dirty and uncertain departures use existing reviewed ownership/guard patterns, never localStorage or autosave.
- A changed date with identical actual spans can use one explicit review acknowledgement. Changed/missing spans require explicit mapping choices or removal; do not remap by ordinal, discard unmatched groups or pretend an old span is current.
- Admin Print saved form uses a freshly verified committed snapshot and its actual stored ceremony/span labels, with a clear needs-review marker when appropriate. No unsaved draft is printed as the saved form. Use safe text nodes/React escaping and fixed local print markup; no HTML interpolation, external document upload or third-party assets.
- Prototype completely before one bounded detector/capture round. Synthetic data only; desktop/phone in light/dark, including flexible groups, Hebrew names and changed-reading review. Fresh finish review and surface inventory update are required. No global typography rewrite or additional visual pass without a concrete finding.
