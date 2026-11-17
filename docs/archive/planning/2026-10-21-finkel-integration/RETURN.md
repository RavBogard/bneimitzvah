# Finkel integration return

## Current milestone — isolated baseline and importer, 2026-10-21

Candidate worktree: `C:/Users/dsbog/.codex/worktrees/finkel-integration/bneimitzvah`, based on released service/schema-0025 checkpoint `49808297c3769cad5994d3af3507b4dbe8afe115`. Primary checkout remains separate.

- Reviewed pure importer `116b3ed63c103d1523f24c89b0ef14400bbc7ba4` cherry-picked without conflict as `92e7b82`. Declaration-only parser remains uncomposed and makes no media-integrity, listening, timing or student-release claim.
- Signed-deadline browser test now starts reading the genuine preparation response body immediately when that response arrives. `Promise.all` retains navigation, metadata and JSON failures. Previously the CDP body lookup waited until DOM/metadata readiness and sometimes found an expired resource handle. Exact returned deadline, actual playback, synchronous expiration, disabled Play and clean-media assertions remain.
- Initial-metadata terminal discrepancy remains unresolved. Preserved merged-main CI `39555089451` failed the navigation case before held audio/navigation began: valid 100-reference response, 124,662 bytes consumed through EOF, no application abort/cancel, reader released, but Chromium reported `ERR_ABORTED`. Cleanup correctly failed too. This does not support a runtime retry or a claimed application fix. Existing real requestfinished barrier and failure propagation remain unchanged.

Verification: unchanged whole exploration file 8/8; repaired whole file 8/8 in separate fresh native Windows/WSL PostgreSQL clusters. Both runs verified zero leftover fixture databases/roles, stopped/removed their owned cluster/workspace, clear ports and removed isolated HOME. Importer 11/11, normal Next typegen/TypeScript and repository protection 3/3 passed with isolated HOME cleanup. Passing native runs do not establish the cause or resolution of the intermittent hosted Chromium failure.

Ignored receipts in this worktree: `.local-logs/finkel-baseline-ci-failed.log`, `finkel-baseline-native-{runner.mjs,config.mts,report.json,vitest.json}`, corresponding `finkel-repair-native-*`, and `finkel-import-gates-report.json` plus per-check logs. Dependencies installed locally, no shared dependency junction. No production operations, uploads or release changes.

## Private review candidate — source freeze

The new private exact-reviewer backend, additive migration 0026 and narrow administrator review surface are implemented. Runtime construction stays disabled without trusted CRC reviewer configuration. It reuses the existing private Blob store, independently of the student reference catalog, and never changes student-release flags. Only admitted scripture whole clips appear, at most eight per batch. Every decision binds five separate checks to exact manifest, media, text and target hashes. Private source metadata and storage coordinates do not enter the interface.

Source review found and corrected a final expiry gap across asynchronous COMMIT and runtime pool cleanup; internal identity-bound barriers now suppress stale responses afterward. See [BACKEND-ADVERSARIAL-REVIEW.md](BACKEND-ADVERSARIAL-REVIEW.md) for the independent scope, finding, evidence and exact accepted hashes. The backend owner separately reviews the runtime/UI seam. The paired UI finish record is [UI-FINISH-REVIEW.md](UI-FINISH-REVIEW.md).

Verification at freeze: backend owner app 17/17 and native PostgreSQL 10/10; client/config/disabled-dispatch 9/9; native whole UI V5 5/5 with all owned database/role/cluster/workspace/Windows+WSL port/HOME cleanup verified. Earlier failed runs remain separately retained. Astra accepted the final desktop/phone synthetic visual fixes; one detector run has zero primary findings and five typography advisories. These are local synthetic checks, not physical-phone or listening acceptance. Astra owns broad Windows integration gates and final exact branch CI.

Next: finish reciprocal review records, stage only the bounded source and documentation, commit, then exact hosted checks. Separately prepare and review an operator admission runner for four paired scripture clips before any real upload, migration or admission. No production operation has occurred in this candidate. Service material and curated trope lessons follow; generated voices/uploads/invitations/real-roster backfill remain outside this slice. Phrase/verse timing and individual student release remain closed.
