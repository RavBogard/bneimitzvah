# Account departure finish review — 2026-10-16

Verdict: **accepted at the bounded source, regression and supplied-capture scope; no blocking finding.** Hosted CI and deployment verification remain integration gates. This review does not approve a student release or establish full-product completion.

## Reviewed scope and evidence

Independent reviewer read the working agreement, mission/state and current repair note, then reviewed the new `src/app/account/page.tsx`, the `autoEnterStudent` change in `src/components/portal/entry.tsx`, only the account-link destination change in `src/components/portal/workspace/provider.tsx`, and the account/discard regression in `tests/http-browser/student-work-ui.test.ts`. Targeted reads of the unchanged portal API, sign-out browser coverage and work coordinator established the boundaries and composition semantics.

Root supplied the actual SDK/PostgreSQL result: **12/12** browser cases passed across `student-work-ui` and `portal-ui`. Worker evidence records **23/23** focused checks, passing typecheck and one scoped Impeccable detector pass. The detector artifact `.local-logs/browser-leave-detector.json` contains `[]`. These checks were reused, not rerun by the reviewer; no source was edited.

## Auth/session and departure assessment

- `/account` uses the existing entry component with `autoEnterStudent={false}`. This changes a navigation preference, not authority. It still obtains and validates `/api/session` before rendering server-provided role links. Default `true` preserves ordinary student entry at `/`.
- The account link's native href and controlled-navigation argument both target `/account`. Ordinary navigation still passes through the existing departure guard and clears work before routing. Modified clicks follow the account href in another tab without discarding the original tab's work.
- Session requests, strict DTO parsing, generation/abort checks, focus/visibility revalidation and fixed error states are retained. The new page contains no student payload or server-side grant, and adds no URL, storage, token, provider or tenant handling.
- Sign-out remains the existing same-origin POST, acknowledgment check, pending gate and fixed failure handling. Existing `portal-ui` coverage clicks this same component's Sign out button and checks `/api/session` returns 401. The new account regression proves that a single-role student can reach an enabled sign-out control; it does not itself click that student's control. Reusing the unchanged action's existing coverage is sufficient for this navigation-only repair.
- The regression now requires the departure dialog to close, a signed-in account heading, an enabled Sign out button and exact `/account` pathname. It then waits for a real `/api/session` response after focus and requires the same usable state. This replaces the former transient `/` observation that could pass before the automatic return to the reading.
- Dispatching `compositionstart` before filling the final discard text gives the test a deliberate unsent edit: the existing coordinator suppresses draft scheduling and blur-save while composing. No `compositionend` is sent. The real PostgreSQL query checks that no draft version for the student/verse contains the discarded text after departure and revalidation. This proves discard of that unsent composition; it does not promise to undo an already committed autosave or an uncertain request.

## Visual finish

Reviewed `.impeccable/review/student-account-desktop.png` (1440×1000) and `student-account-mobile.png` (390×844) together. Impeccable context and the entry surface brief confirm **Annotated score**, code-first, Operate mode; no visual-world choice was reopened. This is a bounded independent finish assessment, not a full Impeccable `critique` command run.

Both captures retain the existing white field, quiet rules, restrained burgundy role link and legible hierarchy. The signed-in state, Student return link and labeled Sign out button are visible. The phone capture stacks in reading order with a full-width, touch-sized sign-out control and no clipped account content. The browser capture helper checks font readiness, paint, zero scroll and absence of horizontal overflow. No shipping raster is introduced.

Two nonblocking observations: the reused introduction still says “Sign in with the account on your invitation” while signed in, and a development indicator overlaps part of the phone footer. Neither obscures the account task or justifies broadening this repair. Keyboard/screen-reader behavior and 200% text enlargement were not newly exercised for this unchanged composition.

## Integration limits and next action

Root retains final integration, documentation of `/account` in the entry surface context, and exact-commit hosted CI/deployment checks. Production provider configuration, real Google/Resend delivery, full-product readiness and generated-chant release are outside this review. No new security or discard blocker was found in the reviewed diff.
