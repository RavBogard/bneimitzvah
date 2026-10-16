# Controlled account departure repair — 2026-10-16

Status: source repair complete; focused local checks pass. Root's real
SDK/PostgreSQL browser run, captures and independent review are pending.

## Finding

Hosted run `38924808662` failed only the controlled-leave case in
`tests/http-browser/student-work-ui.test.ts`: its post-discard poll expected `/`
but observed `/workspace/student`. The preceding draft, text-outage and hidden
metadata/text/work barrier assertions passed. No timeout increase is justified.

The workspace's **Account and sign out** link targets `/`. `PortalEntry` redirects
every signed-in account whose sole role is student from that route to
`/workspace/student`. This is an account-navigation loop, not evidence that discard
failed: a fast poll can accidentally accept the transient `/` before the redirect.
It also prevents a single-role student from reaching the existing sign-out control.

## Implemented bounded repair

- Added `src/app/account/page.tsx`, rendering the existing `PortalEntry` with the
  explicit `autoEnterStudent={false}` prop. The prop defaults to true, preserving
  ordinary home entry directly to the assigned reading.
- Changed only the workspace account link's destination and controlled-navigation
  argument to `/account`. Departure guard, save/unknown semantics, authority,
  lifecycle handling and auth handlers are unchanged.
- Replaced the transient `/` poll with a closed departure dialog, usable signed-in
  account heading, enabled **Sign out** control and exact `/account` path. A new
  session response after a focus refresh must preserve that account state.
- The final synthetic discard remains in composition so blur/autosave cannot send
  it before the guard opens. A real PostgreSQL query requires zero versions with
  that explicitly discarded text. Real SDK sessions remain valid for later cases.
- Added capture targets `student-account-desktop.png` (1440×1000) and
  `student-account-mobile.png` (390×844) under ignored `.impeccable/review/`. The
  same actual SDK case checks ready state, fonts, paint, zero scroll and no
  horizontal overflow before capture. No styles or page composition changed.

Root owns architecture approval, shared-provider edit coordination, the disposable
PostgreSQL runner, required independent review and final hosted integration.

## Verification

- Focused local work-coordinator and portal-client suites: 23/23 passed.
- `npm run typecheck`: passed, including generated `/account` route types.
- One scoped Impeccable detector pass across the account page, entry component
  and provider: no findings (`.local-logs/browser-leave-detector.json`, exit 0).
- Actual SDK/browser verification and desktop/phone capture review remain required.
  Root owns the disposable PostgreSQL runner and will add the result here.

Root integration: actual student-work and portal SDK/PostgreSQL browser suites passed 12/12; production build passed. Root inspected desktop and phone captures, with sign-out visible and no horizontal clipping. Independent review is recorded in ACCOUNT-FINISH-REVIEW.md. Hosted verification remains pending.
