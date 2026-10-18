# Reading assignment flow — implementation return

Implemented the bounded date-assisted assignment flow in the isolated `reading-assignment-flow/bneimitzvah` checkout. No server/API/DB/auth changes.

- Editor opening loads suggestions using existing no-selection prepare; hidden/concealed editors do not load, and results are fenced by session binding, workspace epoch, baseline identity, request generation and visibility. Suggestions never write drafts or expose a confirm binding.
- One Passage dropdown offers Choose my own verses plus actual full/triennial/aliyah/calendar-haftarah options. Custom Book/start/end selectors use canonical numeric metadata. Explicit Review reading precedes Confirm assigned reading.
- Current assignments seed separate Torah/haftarah drafts; single ranges populate selectors, multiple/manual ranges remain untouched. Advanced references/aliyah boundaries and Hebrew preview are disclosed. Existing cut-only provenance, stale/uncertain-save blocks and explicit reload behavior remain.
- Final review leads with exact references/count/boundaries. Source timestamps and preserved context remain accessible in Calendar source details; consequential fallback, needs-review and maftir information remain visible.

Owned source: `reading-editor.tsx`, `reading-draft.ts`, minimal active prop wiring in `reading.tsx`, new `reading-selection.ts`, `reading-passage-select.tsx`, `reading-selection.module.css`. Focused canonical helper tests added; existing reading/preview/modal/service/study browser selectors were updated for the deliberate disclosures and Review reading label, retaining conflict/privacy/outcome assertions. Preview checks distinguish the exact no-selection automatic read from selection preparation/confirmation and retain unchanged assignment assertions.

Verification: focused reading selection/draft/proposal/preview tests **27/27 pass**; `npm run typecheck` and `git diff --check` pass. Logs: ignored `.local-logs/reading-focused-final.log` and `reading-typecheck-final.log`. Earlier focused run also passed 23/23 but emitted existing vendored source-map missing-file warnings; final focused run has no warnings. `npm ci` completed successfully; no dependency files changed.

Remaining: independent source/native browser review, actual desktop/phone/light/dark captures and existing authenticated browser regression acceptance, full integration checks, exact hosted CI and release decision belong to the primary. No browser/DB suite, push or deployment performed by implementer. No source screenshots were available before editing; preserve the incumbent design tokens and root-approved direction documented in DIRECTION.md.
