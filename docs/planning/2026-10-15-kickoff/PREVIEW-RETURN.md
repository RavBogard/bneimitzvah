# Staff reading preview — 2026-10-16

Scope: checkpoint 13(b) of PLAN-CODE-2026-10-15.md. Admins and assigned tutors can browse a whole regular Torah portion, calendar haftarah, or explicitly entered references before changing an assignment. Verse selection and student aliyah cuts remain the next checkpoint.

## Implementation

- Separate prepare/page POST routes require current staff `set-reading` authority and cookie Origin checks. They never broaden the assigned-text route or mutate assignments.
- A distinct five-minute encrypted preview binding fixes the actor/session, authority, student/date/slot/calendar, assignment revision, canonical references and calendar provenance. Authorization and expiry are checked again after external work and final lock waits. Pagination retains the original expiry.
- Existing Sefaria planning, normalization, cache and credits retain the 100-verse/eight-chapter page limits, two concurrent requests, five-second request/eight-second page deadlines, chapter/page byte caps and 1,000-verse total cap. Calendar hashes describe references/provenance; each page reports its actual fetched text hashes and credits.
- The Annotated score panel supports chapter navigation, page controls, calendar aliyah orientation and separately identified maftir. Unresolved calendar cases offer manual references. Drafts survive browsing; context changes, expiry and stale manual responses clear the preview. No transliteration or generated audio is added.
- New service/UI/API and focused tests are in `src/server/students/preview.ts`, `src/components/portal/workspace/reading-preview.tsx`, `preview-api.ts`, `tests/app/reading-preview.test.ts`, `preview-ui.test.ts` and `tests/http-browser/reading-preview-ui.test.ts`, with narrow runtime/HTTP/shared-parser wiring. No migration or provider configuration change.

## Verification and remaining release work

Independent security review accepts the bounded source; see PHASE2-SECURITY-REVIEW.md. Author checks passed 81 focused cases, typecheck/build and four repository/isolation guards. The first authenticated browser run exposed a real optional-maftir projection mismatch (503); a failing HTTP regression established the cause. The narrow repair preserves the shared strict validator, passes 12 focused checks plus typecheck/build/guards, and passes all three unchanged authenticated browser cases on rerun.

The browser cases cover pagination/chapter navigation, unchanged draft and assignment, manual fallback, delayed manual replies, access revalidation and parent exclusion. Fresh synthetic desktop (1440px) and mobile (390px) full-page captures and detail crops are private under `.impeccable/review/`. The single detector run reported advisory incumbent palette/type differences and an existing 0.875rem step reused for boundary labels; no new mechanical component finding.

All 152 engine tests and the clean frozen-source app rerun (463 passed, one existing skip) pass. The initial full app run overlapped the projection repair and reported its regression failure; that result is retained rather than treated as final-source evidence. Independent visual review found no material defect in the supplied captures and requested only the missing workspace inventory/related targets. The documenter added that bounded inventory while preserving global design files, and the reviewer scored the documentation fix resolved with disposition **ship** at that scope. Exact-commit hosted checks, production deployment and matching native authentication canary remain pending. Production remains `799e119` until those gates pass.

Daniel remains the only human tester. Refreshed administrator-workspace use and actual email fallback delivery/sign-in remain separate human acceptance checks. Full product and generated chant are incomplete.
