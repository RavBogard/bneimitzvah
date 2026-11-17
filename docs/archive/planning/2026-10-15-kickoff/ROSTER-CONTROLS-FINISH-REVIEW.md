disposition: fix

Inputs: independent Sol finish review for Astra, 2026-10-16. Code-first extension; no approved comp, shipping raster or separate quality-bar card supplied. The existing Annotated score contract and DESIGN.md govern. No source implementation, server, browser session, detector rerun or Git mutation was performed.

## persistence

Pass. PRODUCT.md, DESIGN.md and the existing workspace surface brief persist Daniel's selected Annotated score direction and seed75c22686. The three new admin wrappers mount the intended role-gated relationship/import workspaces. The narrow roster links and CSS extend the incumbent system. The planned roster inventory addition to the surface brief remains the documenter's integration step.

All six required current captures exist and were opened: roster-assignment-review-desktop.png, roster-long-review-mobile.png, roster-unknown-mobile.png, csv-review-desktop.png, csv-review-mobile.png and csv-unknown-mobile.png under `.impeccable/review/`. They show the expected loaded states, document top, complete page flow and sensible desktop/390px phone widths, without blank regions or clipped content. The old return's skip-link capture limitation is stale: that artifact is absent in these captures. The local Next development badge is capture tooling, not a product design element.

Read the approved roster plan/return, PRODUCT.md, DESIGN.md, workspace brief, finish-reviewer contract and craft floor; inspected both component groups, consequence construction, CSV preview/commit/recovery, three route wrappers, roster/CSS diff. The single existing detector result is reused as supplied: 0 primary findings and 19 incumbent palette/type advisories. Automated pass counts supplied by Astra support behavior but do not substitute for this visual assessment. This review does not establish a full keyboard/screen-reader audit or independent security clearance.

## fidelity

| Element or promise | Assessment | Evidence and consequence |
| --- | --- | --- |
| TYPE | match | Incumbent system type, restrained heading steps and readable body remain consistent with DESIGN.md. Long unbroken names wrap in review and records rather than clipping. |
| MATERIAL | match | Flat working field, fine rules, native controls and no simulated physical decoration match the established Operate world. |
| GROUND | match | White page and control fields, ink text, muted supporting text and restrained burgundy actions match the named incumbent palette. |
| Navigation and task structure | match | Compact masthead, role navigation, task title and adjacent admin destinations connect the three routes to the roster. No unapproved directory or account creation flow appears. |
| Identity presentation | contradicted | The approved plan calls for a short stable grant identifier when names collide and the full identifier in review. Every tutor/parent/student record instead prints the complete grant UUID; the phone tutor capture devotes two additional lines to it even for a unique name. The identifiers are technically valid but add implementation detail without helping ordinary selection. See F2. |
| Access-change consequences | match | Named person, selected student/date/status where applicable, full grant identifier, focused review heading and explicit Confirm/Cancel precede mutation. Copy distinguishes one-child link removal, parent child-practice permission and congregation-wide ordinary role revocation. Cantor copy separates its flag from student assignments. |
| Freshness and unavailable access | match | Source re-reads target snapshots before POST, rejects changed review fingerprints and blocks repeated actions after an unknown result. Disabled students allow cleanup while assignment/practice enabling is unavailable. Ineffective access uses the bounded truthful label rather than inventing a cause. |
| CSV review and duplicates | match | Exact raw draft remains the review source. Valid/invalid/duplicate counts, CSV record-number meaning and explicit duplicate creation semantics are present. Invalid rows block commit; changing duplicate choice discards review and requires a new preview. The conservative deadline starts before preview. |
| Unknown-import recovery | adaptation | The lack of receipt/idempotency lookup justifies the approved explicit roster reload, inspection and acknowledgment before another preview. Source retains exact draft and duplicate choice while unresolved, blocks automatic retries and clears duplicate override only on acknowledgment. The captured warning truthfully avoids claiming failure. |
| Retained draft inspection | contradicted | `csv-import/workspace.tsx` disables the textarea during unknown outcome. At up to 500 rows/1 MiB, only its visible portion can be inspected with keyboard; disabled controls cannot receive focus for scrolling, selection or copying. Preservation must also remain usable. See F1. |
| Phone review layout | adaptation | Single-column review metadata and wrapping actions follow the approved 640px stacking rule. The long-name stress case is tall but preserves the complete identity, consequence and independent cancel action. No truncation or new compact typography is warranted. |
| Cold loaded states | match | All current captures show complete loaded content and controls rather than skeletons. Source separately provides checking, empty, unavailable, saved/current-view-unavailable and unknown messages; protected previous lists are removed on failed reads. These other states are source-reviewed, not additional visual captures. |

Independent finish scores, 10 = fully resolved within this slice: usability **8/10**, hierarchy **7/10**, mobile **8/10**, controls/state clarity **9/10**, accessibility **7/10**, scope discipline **9/10**. The material deductions are F1 and F2; typography/palette redesign and unrelated study changes are outside this verdict.

## ceiling

Reached for this bounded operational extension after the two material fixes below. The established world supplies its native devices through quiet rules, spacing, explicit status words and touch-sized actions. Additional imagery, ornamental depth, motion, font changes or global token work would not improve this admin task. One bounded fix batch followed by one scored confirmation is sufficient.

## material_fixes

1. **F1 — P2, accessibility/usability, severity 2/4:** In `csv-import/workspace.tsx`, preserve the unknown draft as a focusable read-only textarea rather than a disabled textarea, so keyboard users can scroll/select/copy the entire retained CSV; keep editing, file replacement, duplicate choice, preview and commit blocked until the existing explicit recovery completes. Accept when a long unresolved draft can be inspected by keyboard, its exact value remains unchanged, and reload/acknowledgment still requires a fresh preview.
2. **F2 — P2, approved-plan fidelity/hierarchy, severity 2/4:** In `relationships/workspace.tsx`, remove full UUIDs from ordinary identity records; show a short stable grant suffix when displayed names collide within the relevant available collection, preserving meaningful distinctions in the tutor picker. Retain the full identifier in `AccessReview`. Use only existing DTOs. Accept when unique-name cards lose the technical metadata row, same-name records/picker options remain distinguishable, and review still exposes the exact full grant identifier with its consequence.

## keep

Keep complete wrapped identities, the quiet incumbent visual system, explicit child-versus-congregation consequences, full identifiers at review, exact uncertain-draft preservation, duplicate opt-in semantics and deliberate roster inspection/acknowledgment before any new import preview.

## verdict

Single scored confirmation, 2026-10-16; this supersedes the initial fix disposition for F1/F2. Reopened all six current capture paths above; each remains valid. This pass scores only the two requested fixes and regressions caused by their batch. No detector rerun or further implementation was performed.

- **F1 — resolved, remaining severity 0/4.** The current phone CSV captures show the retained 24-row draft, including its lower records, with the unknown-outcome warning and locked file/duplicate/preview controls. Source now keeps the unknown textarea enabled and read-only. The inspected browser case checks exact draft equality, enabled/read-only state, keyboard focus, Control+End scrolling and Control+Home return without changing the value, then explicit roster inspection/acknowledgment and a new duplicate-aware preview with no second commit. The final actual-SDK/restricted-PostgreSQL log reports 31/31 passing across 11 files, including this case.
- **F2 — resolved, remaining severity 0/4.** Refreshed tutor record captures remove the UUID metadata row, and the unique-name assignment picker shows the name alone. Both desktop assignment review and phone cantor review still visibly expose the complete grant identifier and consequence. The shared identity-label helper uses existing DTO names, adds an eight-character stable suffix only for colliding names, and extends it if needed to distinguish matching suffixes; the focused test covers unique and colliding labels and retention of the full review identifier. The fix preserves complete wrapped names and the existing action layout.
- **Fix-batch regressions:** none observed in the six refreshed captures or the inspected F1/F2 source/test ranges.

## remaining

Clear for F1/F2. This ship verdict covers the scored fixes, not a new audit of the whole surface; the original review's security, full accessibility and release-evidence limits remain. No further polish batch is requested.

disposition: ship
