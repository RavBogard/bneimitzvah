# Independent backend adversarial review

Reviewed 2026-10-21 by the Sol implementation owner of the browser repair and runtime/UI seam. I did not author the new backend service, private getter, manifest validator, SQL schema/migration, repository functions or their tests. The other Sol independently reviews my config/composition/dispatcher/UI. Astra owns final integration.

**Verdict: accepted local source after the P1 correction below.** No unresolved backend access/media blocker was found in the reviewed scope. This is source and synthetic verification acceptance; production migration, actual private-object admission, Daniel's listening, phrase timing and student release are separate gates.

## Finding and repair

P1: the original final session/batch/signal checks ran inside the transaction callback. Asynchronous COMMIT could finish after those deadlines, allowing buffered media to escape afterward. The backend owner repaired this with synchronous post-COMMIT actor checks, post-await batch checks, and an internal object-identity response barrier. The HTTP dispatcher now applies the finish check synchronously after its runtime scope finishes pool cleanup. No request-supplied header carries the barrier. An already committed review decision remains committed if its reply is suppressed; clients must read back rather than infer rollback or automatically retry.

I reviewed the repaired service, isolated WeakMaps and HTTP boundary. Each conflict has its own bound result identity; early manifest/generation conflicts retain their actor/batch barriers. Lists filter expired batches again at final response time. Successful media/decision responses are suppressed after session expiry, batch expiry or disconnect during runtime cleanup.

## Staged metadata finding

The first staged guard stopped before protection because snapshot 0026 broadened three inherited practice-event identifier checks even though the additive SQL did not change that table. The owner restored only that inherited check from snapshot 0025. Independent comparison now proves all 43 existing table objects and all existing top-level metadata are identical, with exactly the two new review tables added. The new reviewer ID remains bounded text in those new tables. No executable SQL, runtime or test changed in this repair. The failed guard and pre-repair snapshot remain retained; Astra rebinds the final integration gate instead of claiming the earlier source pin passed.

## Access, media and SQL checks

- Exact CRC tenant and case-sensitive configured BetterAuth user ID, live verified identity, membership and administrator grant precede all private getter calls. Cookie-only identity, practice-context refusal, exact host resolution, CSRF and fresh mutation-session requirements reuse existing reviewed access machinery. Actor session/membership/grant identities and revisions are compared across provider I/O.
- Only admitted hash-bound manifests and member asset keys resolve media. Native request OIDC and the existing private store are pinned; static credentials, endpoint overrides, arbitrary paths, public URLs, range delivery and caching gain no fallback. Full bounded bytes, exact length and SHA are verified before response creation, then authority is rechecked.
- The new tables force tenant RLS. Runtime cannot admit a batch; it can revoke existing controls and append decisions. SQL triggers prevent rebinding, resurrection, decision edits/deletes and writes to expired/revoked generations. All five checks reject JSON null. Measured PostgreSQL lock edges serialize concurrent decisions/revocation; stale revisions conflict and request IDs are payload-bound.
- The wire projection omits private source metadata and actor/session/grant fields. Student-ready remains false and timing unavailable. No admission or release HTTP route is present, and no student source selection is changed.

## Evidence and limits

Reused backend owner evidence: app 17/17 and native PostgreSQL V3 10/10. Native regression cases delay actual COMMIT after media/decision I/O and advance the wall clock; expired media is denied, while an already committed decision remains in the audit ledger with its response denied. The native V3 report verifies zero leftover fixture databases/roles, stopped and removed owned cluster/workspace, clear selected PostgreSQL port on Windows/WSL and removed isolated HOME. Original V1 aggregate port-check failure is retained; V2 and V3 selected-port cleanup are distinct evidence.

Receipts: `.local-logs/finkel-review-core-native-v3-{runner.mjs,config.mts,report.json,vitest.json}`, `.local-logs/finkel-backend-tests-v5.log` (17/17), and `.local-logs/finkel-backend-reviewed-source.json`. The separate UI native V5 passed 5/5 with explicit Windows/WSL database and browser-port cleanup; it does not substitute for this backend review.

No private collection, real recording, provider delivery, production migration or actual-phone/listening acceptance is claimed. Exact branch CI and Astra's broad integration gates remain required. Existing intermittent hosted exploration metadata ERR_ABORTED remains explicitly unresolved and is not relabeled as fixed by these passes.

## Exact accepted working-source SHA-256

These hashes bind the reviewed working files before Git's transport newline normalization. No code changes are authorized after this freeze without re-review of the affected boundary.

| File | SHA-256 |
| --- | --- |
| src/server/reference-review/batch-contract.ts | `59f4ec9fc1753630a3dca1d5a75fe4f3081ec7c1eca153f3be4ff71a4c75d786` |
| src/server/reference-review/batch-storage.ts | `711b57ce35f1b6e2dc4ad85628d6778ccef398b560d0bc3b59392cfb1b81d7f7` |
| src/server/reference-review/private-blob.ts | `521bfc14098d8d0b9c689e7b679a3e6bc01e940e9c57a0722eefeaba310f482d` |
| src/server/reference-review/response-barrier.ts | `1e5b999df5af425ea4d45d9adb6d2236ef6aecac06ec283d724d6b93c555e327` |
| src/server/reference-review/service.ts | `09a92d0936ee26c8956ba157a692441e2bb21581d4e1942af9357e8f71c12ad6` |
| src/server/data/reference-review.ts | `6190e42727d761892c3485a15fff8db124537d4e0e304eae580c03eee3cf584e` |
| src/server/db/reference-review-schema.ts | `6a1b0b88900b5a614b64586bbc846f10b7d03c631306eb5a75b249fb68a1bd45` |
| src/server/db/migrations/0026_finkel_private_review.sql | `6a645d8db095c5e0a426a99dd5fe21e10a10e952aabb3282e601229847d1eedb` |
| src/server/http/reference-review.ts | `2467aa09af314ef757dcac1485f52358425e50ae5e6f232dbebb9c310deec222` |
| tests/postgres/reference-review.integration.ts | `dcd4c6251e9a73db698a96da5b62570fd9e8bce329895c34830cce7b6b0531a1` |
| tests/app/reference-review.test.ts | `05f0dcd1fb9fd882cdee4f7b11908449c87b0065fd0368885ab2bc6fadb9b7ce` |
| tests/app/reference-review-private-blob.test.ts | `4f847d05dd4e63bf391b23853500ca21e9e94a822a974bb60f459f91f67de765` |
| src/server/db/index.ts | `55a8d2b9d605edb076e95b63deb920b0d41f88d0a7668c2652551102c4dac1b2` |
| src/server/db/migrations/meta/_journal.json | `4eef126110f07da9655232ef1353c3f881d42c0c529e3b4833664c4b907f7c35` |
| src/server/db/migrations/meta/0026_snapshot.json | `96d3423509342476b9964f40b15bc43f825713363bfa37e5db4809578c28591e` |
| tests/helpers/reference-review.ts | `2112968059f87556ab19a3372914fa56f87986b155ebb1e41765dac49ae4308d` |

