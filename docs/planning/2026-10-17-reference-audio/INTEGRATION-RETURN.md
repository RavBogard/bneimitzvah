# Reference-index tooling integration return

Branch `codex/reference-audio-contract-integration`, based on independently reviewed study repair/released tree `8f8abc5`. Root integrated only frozen tooling `b528a50` and `4ea7284` as `6cfef82` and `d63cdc4`; no older app, moving frontend, recording0020 or calendar code was copied from the retired voice checkout.

## Boundary and changes

The corrected `reference-index-contract.mjs` / `reference-index-check.mjs` and their 24 synthetic tests required no further implementation change. The three original root repros now reject invalid envelopes without consumable records, disable highlighting without actual reading-text binding while preserving eligible playback, and reject verse order that contradicts declared split-range order. Declared nonoverlapping backward parts remain explicitly represented/warned by the reviewed tooling; arbitrary undeclared reordering is not accepted.

The shared bounded private-content predicate in `scripts/private-benchmark-policy.mjs` now rejects schema-bearing `pockettorah-verse-index/v1` data with the fixed reason `private reference-audio index`. It reuses the existing single call from `entryProblems`, JSON decoding/traversal budgets, escaped-key detection, BOM framing and data-file JSONL fallback. Existing benchmark predicates, publish candidates/index independence, `.local-data/` path-only/no-read-first rules, font registry protections and repository policy remain intact. No repository allow-list or broad regex was weakened.

Three ordinary policy regressions cover direct/nested/escaped/BOM JSON under allow-listed and source extensions, malformed/line-JSON framing, public source strings without false positives, and index-only prohibited data after a safe working-copy replacement. Every temporary Git child uses `isolatedEnv` and awaited cleanup.

## Verification

- Corrected contract24 plus focused policy/review cases: **38/38**, 1.62s. Command `node .local-logs/run-isolated.mjs reference-contract-focused node --test tests/reference-index-contract.test.mjs tests/repo-policy.test.mjs tests/repo-policy-review.test.mjs`; log `.local-logs/reference-contract-focused.log`.
- Original three root defects independently reprobed with invented words/times only: **3/3** fixed outcomes. Command `node .local-logs/run-isolated.mjs reference-root-repros node .local-logs/reference-root-repros.mjs`; log `.local-logs/reference-root-repros.log`.
- `node .local-logs/run-isolated.mjs reference-full-node npm run test:node`: **243/243**, 34.88s, no skips; log `.local-logs/reference-full-node.log`. This is the expected240 with three added policy regressions.
- After staging source/tests/return, `node .local-logs/run-isolated.mjs reference-staged-protection npm run check:repo`: **3/3**, 29.82s; log `.local-logs/reference-staged-protection.log`. Actual candidate/index, private-directory no-read-first and forced-staging checks pass. The final count annotation in this return was separately checked through the same `entryProblems` predicate before commit; other staged bytes are unchanged.
- Staged `git diff --check`: **PASS**. Native PostgreSQL, browser, app tests/typecheck/build were not rerun for this tooling-only delta; no app/TypeScript source changed.

No private index, recordings/audio, private MAM cache, provider, production credential or real family data was accessed. No reference player, hosting/registry approval, upload/storage, licence/spend decision, generated chant or production release is implemented/approved by this checkpoint. Private aggregate coverage/quality/provenance reports in the incoming handoff are owner-reported and were not rerun or independently verified here. The structure-only exceptional-MAM report is evidence for a separate parser decision; this tooling change does not alter that parser.

Root coordinates mandatory independent repository-protection review and final integration/hosted gates before publication. No push, provider operation or deployment was performed by this worker.
