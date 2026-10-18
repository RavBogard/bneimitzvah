# Selected source text — return point

## Current checkpoint

**Latest release:** the scalar backend now has its [inline explicit-edition reader](INLINE-SOURCE-READING-RETURN.md) deployed at exact0b98a2f, with all four CI39104065579 jobs, canonical identity and eight canaries passing. [Ordered extents](SOURCE-CONTENT-EXTENTS-RETURN.md) are accepted locally but not deployed. Historical backend evidence below retains its original scope.

The first backend slice is deployed at exact709a032982c7c57821ac7638cbeb6780c52d252b after all four [hosted jobs39100441095](https://github.com/RavBogard/bneimitzvah/actions/runs/39100441095) passed. Normal deployment dpl_aDFpdqSmGvniuSqsqMMhxtNSQyMy is READY/canonical with exact source/project/team/Production identity and eight public entry/denial canaries passing. It adds private `source-editions` and `source-text` reads for a source belonging to the student's current assigned verse. No SQL ran in this release. There is no content UI, new migration, provider cache, default edition or generated summary in709; the inline reader is a separate active branch.

The [design](../../superpowers/specs/2026-10-18-selected-source-content-design.md) defines two lanes: a retained citation under the current immutable assignment head, or a source resolved from the freshly observed related catalog. Each request captures the original live session, student, relationship and reading, performs public work outside the transaction, then checks authority and the original binding again. A changed current source head also invalidates assigned-source reads. The shared dispatcher grants ordinary read only; staff write and receipt behavior remain in the original source-assignment service.

Edition pages retain and hash the complete bounded512-entry catalog. Text requires an explicit, uniquely resolved actual-language/title pair, matching current edition and body provenance, and an approved Public Domain or CC0 profile. The first parser supports a complete numeric leaf with exact canonical string addresses and a single plain scalar. It preserves that scalar and credits the provider's text_only transformation. Ranges, parent nodes, named sections and other rights profiles remain outstanding coverage; the reader does not guess a first comment or flatten arrays.

## Verification and correction history

- Author extraction/focused65 checks passed, including existing source-assignment and discovery regressions. Final new composition35/35 and TypeScript pass. Initial author and reviewer fixture-method/type mistakes were corrected without relaxing authorization assertions; their failed logs remain private.
- Independent review reproduced a missing per-call synchronous deadline fence: a loader could exceed10 seconds while the aggregate20-second budget remained. The narrow repair adds an absolute call end checked after the result; the unchanged failing assertion now passes. Both body transport and public service enforce bounded work, with provider cancellation separate from the signal used for final authorization.
- Native PostgreSQL11/11 passed: the unchanged assignment9 plus two new content cases. They prove a clear/re-add can commit while the first request waits on public I/O and is then refused, and that committed tutor revocation outranks public-budget exhaustion. Existing lock-wait, lost-acknowledgement, audit, immutable-history and RLS checks remain. The owned cluster was stopped and removed; fixture listeners are absent.
- The accepted14-file source manifest is SHA256 `29e58e59d88c1399d9f562257c192e0b67aacb05d3392d32918edd7d45145a95`. The independent report is SHA256 `487ff89b2a29d28177a2e3727570a41a4ca97ed0787e21c4ba13bbbbdec6c313`. Final staged repository protection and integration checks belong to root's combined release gate.

## Bounded live observation

Root made exactly one further fixed public body GET through the frozen real reader and parser. That standalone check passed with a669-byte scalar; only closed facts, byte counts and hashes were retained, never the text or raw response. Evidence SHA256 is `ac1a2c9d7afb79dadddc933d08b260ea1c6f7d3b3333b86687498300f66c49e9`. It used a historical public metadata seed and does not prove a fresh catalog, an authenticated service round or general source coverage.

The original GET2 remains historically held: its numeric-address checks failed and its raw address values were not retained. The later pass does not rewrite that result. A first local helper setup failed before any request because the installed TypeScript7 package did not expose the assumed transpilation API; its zero-call result is preserved. Node's built-in transform and a separate no-I/O setup check passed before the one actual request. No automatic retry or fallback occurred.

## Next action and limits

The Sources explicit-refresh repairff52683 and backend709 release are complete: focused46/types, independent browser17/17, root production build, final staged protection6/6 and exact hosted checks pass. No database migration needs replaying. The separate inline reader is now implemented locally and undergoing independent acceptance under its [design](../../superpowers/specs/2026-10-18-inline-source-reading-design.md). Broader source coverage remains outstanding where the current leaf profile holds a source.

Reference playback remains administrator-only pending Daniel's actual-source word-tap/tab-return acceptance. Generated voices and student recordings remain parked. No roster import, mail, invitation, new spending or full1.0 completion is implied.
