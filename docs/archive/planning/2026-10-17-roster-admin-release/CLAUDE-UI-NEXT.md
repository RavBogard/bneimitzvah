# Claude UI assignment — quiet practice calendar

Assigned by Codex, 2026-10-17, under Daniel's direction to keep both Claude sessions working. This is a new bounded implementation checkpoint, not permission to deploy.

## Start and ownership

Preserve frozen `design/song-session-admin-roster` at `3bc99ea`. In your existing `C:/Users/dsbog/bneimitzvah-song` checkout, create a new `design/practice-calendar` branch from that ref. Do not change the frozen branch. Codex is integrating it independently in the managed checkout on `codex/roster-admin-release`; do not duplicate that integration or migration work.

You own a client adapter and components under `src/components/portal/workspace/practice-calendar/`, focused calendar tests, and the smallest necessary reading/service workspace hooks and scoped CSS. You are not alone: preserve other work, avoid server/schema/auth/import/invitation/dialog changes, and do not recursively delegate. If the new hook would require a backend change, document the dependency and continue the independent calendar work.

## Deliverable and boundaries

Implement a quiet, accessible private calendar of dates practiced using the deployed 0018 backend. Start with the current student and explicitly selected linked-child practice views; do not add navigation or a separate dashboard. Follow the accepted interface language already in your branch. Other authorized views may use the same dates-only component when an existing surface provides a suitable placement; no new staff dashboard is needed for this checkpoint.

Read `docs/superpowers/specs/2026-10-16-practice-calendar-design.md`, `src/lib/practice-calendar/types.ts`, `src/server/http/practice-calendar.ts`, existing workspace access/lifecycle/client conventions, and this assignment first.

- Calendar GET is read-only and returns `serverDay` plus dates. All modes, including linked-child practice, see dates only in this component. Do not implement raw-event UI or call the raw-event GET.
- Wire online `visit` reports only for an explicit user opening/selecting a currently authorized confirmed verse or current service unit. Use the exact assignment/revision/ref or catalog/plan/revision/unit binding and a fresh event UUID. Initial GET/render must not manufacture a visit. An automatic restoration or refresh is not a new user action.
- Use the freshly read Chicago `serverDay` as `expectedDay`; never substitute the browser's timezone/date. No offline queue, retry after failure, midnight rewrite, duration, score, leaderboard, or mastery/progress inference. A stale day/material requires a fresh read and a new explicit action. The uniform acknowledgement does not promise raw-event storage.
- Scope requests and private UI to the current actor, selected mode/student/context and material revision. Abort and clear on authority/session/student/material changes; concealed or expired views cannot retain calendar or pending details. Preserve drafts, existing session reconciliation, reading controls and other work.
- Do not send `play` or `record` events before the separately reviewed real audio/recording paths exist. Do not change retention or add a scheduler, provider, dependency or production operation.

## Acceptance and return

Use synthetic automated tests for strict DTOs, explicit-action-only writes, exact material bindings, dates-only modes, stale day/material, late responses and session/child switches. Include an authenticated browser case and desktop/mobile overflow and keyboard checks for the changed surface. Keep the repository guard, typecheck and build green. Coordinate before using Codex's local PostgreSQL/port lane; your own isolated fixture is fine.

Return a frozen ref, exact changed files, checks and failures, screenshots, open dependencies and one short continuation note in your existing song-session return. Do not push main, deploy, apply migrations, import real students, send mail or change shared original-checkout STATE/COORDINATION. Codex owns integration and independent privacy review. Do not broaden scope to fill time.
