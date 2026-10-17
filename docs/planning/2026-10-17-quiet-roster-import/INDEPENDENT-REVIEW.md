# Quiet roster import — independent review

Accepted for the bounded local milestone. Root reports successful new and existing browser cases and broader integration checks below; final repository/commit and hosted CI gates remain with integration. No production import, migration, invitation or deployment was performed.

## Reviewed source

Base `adb635c7ab067e89798c168fb323a8e3d274d23e` plus the owner's frozen working changes, including the final exact-header repair. This is working-tree evidence, not an assertion that the changes already have a commit. Key SHA-256 fingerprints:

- `0019_quiet_roster_intake.sql`: `d69c412ef74cb7ea461747126c24c237ffab893acf83cab4843f2ddaa7e6f464`
- `meta/0019_snapshot.json`: `c90f8cc9b2522d6bcb3b24190c5c2051b565c6edda880f33efc186456c974038`
- `students/validation.ts`: `af721b9e7b7ada84c15c6fddfe355ba23f7fcbf7cc3b11ebc42a057ee18813ac`

The four CSV formats require exact cell counts and labels. Full intake preserves slot, Hebrew name, both guardian contacts and closed administrative metadata. Supplied parashah remains a label. Tutor matching uses existing verified, eligible tenant grants, binds relevant name/grant/membership state and stores only a pending proposal. Confirmation writes students and payload-free audit entries. Ordinary edits preserve omitted intake; nonadmin projections remain the explicit five-field student view. Secondary contacts participate in student-invitation denial at issue, reissue, preview and acceptance.

Migration 0019 adds three nullable student columns and bounded, closed metadata checks; it adds no relationship, invitation, outbox or authority objects. Historical migrations were not edited. The corrected tutor query locks membership/grant rows without introducing global target-user locks. Existing tenant authority locking supplies same-tenant write serialization.

Root's merged-header finding was consequential: joining header cells could accept a quoted merged optional label and silently discard fields. The final predicate compares array length and each cell. The owner reports all four malformed formats rejected and individually quoted headers accepted (9 focused normal/client tests passed). No duplicate independent regression was added. Earlier client/server strict-shape incompatibility and the overly broad target-user lock were corrected before this acceptance.

## Independent execution

- Repository protection: `node .local-logs/run-isolated.mjs local-data-guard-independent node --test --test-name-pattern "local private data|ignored local data" tests/never-in-repo.test.mjs` — 2/2 passed, 1.59s. Includes ignored-source exclusion and forced-index rejection; no policy exemption.
- `node .local-logs/run-isolated.mjs quiet-roster-independent-app npm run test:app -- tests/app/quiet-roster-import-review.test.ts` — 5/5 passed, 13.61s. Covers stale tutor rename/revocation/ambiguity, excluded foreign/unverified/disabled tutors, expiry after the first audit with full rollback, late secondary-contact invitation denial and nonadmin projection after separate explicit links.
- `node .local-logs/run-isolated.mjs quiet-roster-independent-typecheck-corrected npm run typecheck` — passed with both new independent test files and rich client types. An initial reviewer helper type mismatch was corrected. This check preceded the final header predicate repair; its signatures did not change. The repaired positive path was exercised by the following run.
- `node .local-logs/run-isolated.mjs quiet-roster-private-dryrun node node_modules/vitest/vitest.mjs run --config .local-data/quiet-roster-review/vitest.config.mts` — 1/1 passed, 3.35s, after the header repair. Uses actual preview/confirm and restricted runtime through disposable PGlite; captured synthetic auth setup precedes mail/fetch guards.

Actual private-file results: 34 valid, zero validation failures, 34 disposable students created. Pending tutor outcomes: 0 matched, 20 unmatched, 0 ambiguous; no real tutors were fabricated. Missing second-guardian name: 2; missing email: 5; preview warning rows: 5. Counts across every public table changed only by `student +34` and `audit_event +34`. Mail, fetch and reading-provider attempts were zero. Every normalized supplied field and administrative note was compared in memory, all known facts passed, and both original source hashes remained unchanged. The supplied individual time stayed in private notes; no global time changed. Fixture closed. Private inputs and detail reports remain ignored; stdout contains aggregate facts only.

## Test ownership and remaining evidence

Independent app file SHA-256: `9ca592c0515c86c7052ee5feead2cb5b90e94d9eac3213b70b28e0c90b844998`.

Independent browser file `tests/http-browser/quiet-roster-import-ui.test.ts` SHA-256: `ebb6e40508d467e7818ab500dccb33af48e613efc41814b04b2958946107f8d9`. It is synthetic only: desktop/mobile real preview and confirmation, exact pending/missing-contact wording, matched/unmatched outcomes, student/audit-only deltas, no authority POST, roster navigation through the strict parser, overflow assertions and two ignored captures. Execution and visual review are attributed to root below; no independent browser run is claimed.

No blocking source finding remains within this scope. Final source commit and staged protection must be recorded by integration before concluding the milestone. Local PGlite evidence does not claim production application or real tutor matching.

## Root integration evidence (reported, not independently rerun)

Root reports the new synthetic browser file passed 2/2 across desktop/mobile. Root inspected both captures together and accepted layout and copy, with no horizontal overflow or UI correction. The isolated browser helper restored server bytes, removed its owned temporary role and left tsconfig unchanged.

Root also reports full app 840 passed plus one existing skip across 96 files, Node 208 passed, and typecheck/build passed. These are integration-owner results rather than additional independent executions.

The existing seven-case roster browser file initially had one failure: an exact assertion still expected the previous invalid-row wording. The only correction updates that expected literal to the intentional expanded wording. Independent diff inspection confirms `exact: true`, visibility and zero-confirm-button assertions remain intact. Root's corrected full seven-case rerun passed 7/7 (`.local-logs/quiet-roster-legacy-corrected-browser.log`), with server bytes restored and the owned temporary role removed; no product source changed. Cumulative browser coverage is nine passing cases: the two new cases in their initial run and the seven existing cases in the corrected rerun. This is not a claim of a single nine-case green run, nor an independent browser execution by this reviewer.

The CI adjustment was independently reviewed: only the PostgreSQL job timeout changes from 10 to 15 minutes. All services, options, commands and gates remain unchanged. No retest was needed for that line-only change.

Independent review is complete and at rest. Root owns byte-copying this report, staged repository protection, the final source commit and review-branch hosted CI. Main and production are outside this milestone.
