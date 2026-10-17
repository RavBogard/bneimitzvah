# Receipt service slice B

Provider-disabled internal service atop unchanged schema A (`ad1d8c3` + independent `be4dddd`). No route, runtime composition, provider/sender, finalization, legacy registrar, auth sanitizer, schema, role provisioning or schedule changes.

## Implementation

- New `data/recording-receipts.ts`, `recordings/receipts.ts`, and `recordings/receipt-validation.ts`. The factory takes trusted bounded `storeGeneration`; closed callers supply request UUID/declaration or exact receipt/slot revisions. Existing real student/child-practice authority supplies all immutable snapshots; own-student relationship revision stays NULL.
- Admission serializes the tenant mutex and counts primary receipt rates, active student AND tenant-user AND tenant pipelines, unreleased audio/logical liability, existing ledger usage (including deleting rows), and retained distinct original IDs. A separate 64-byte-per-slot marker aggregate persists after terminal release. Bigint arithmetic preserves exact fixed limits. Exact request replay preserves reserved identities; mismatches conflict. A present ledger identity/asset collision is locked before the head and refused, never adopted. At most one present ledger row is locked per logical head; no absent-row lock.
- Preparation writes hash/permit ETag once. Opening permanently records the operation UUID/true bit, then awaits the entire existing authority transaction and acknowledged OUTER COMMIT. Only afterwards can it return a private factory-local opaque permission; consumption deletes it before its captured wall/session/context-expiry/retention freshness check. No callback, sender, inner transaction result or durable true-bit replay can issue another permission. Unknown acknowledgement gives unavailable and no permission; liability follows actual committed state.
- Authorized retirement preserves liability. The separately named TEST-ONLY maintenance factory requires a trusted injected transaction adapter and binds one head per transaction, ordered mutex → one existing ledger if any → head → ascending slots. No SQL handle escapes. One-shot, poison, close/drain and escaped-closure rules roll back caught/repeated/unawaited operations. Only already-retiring, complete, never-opened heads can terminalize/release; immutable keys/markers/IDs/rates remain. No production adapter/login is supplied.
- Own conflict/limit bridges use exact private AccessDenied instances, translated outside authority. Existing 401/403/404 remain; unknown SQL/commit errors never become conflicts or success.

## Verification

Commands used the ignored isolated runner and synthetic fixtures only:

- `receipt-service-app-expanded`: normal app **9/9 PASS**, 17.17s. Covers exact slots/replay, immutable preparation, opaque/single-use/post-commit permissions, lost acknowledgement and final freshness, fixed bigint quota rejection, mode/tenant/revocation/child-switch denial, maintenance poisoning/lifetime, date liability and retained terminal marker charge.
- `receipt-service-composed`: B + unchanged schema A/independent A + original-ID/independent original-ID, **28/28 PASS**, five files, 26.37s. The cap-injection case exercises service refusals without pretending to be a many-row native fixture.
- Final fresh LOCAL PostgreSQL 16 fixture, `receipt-service-native.mjs`: **10/10 PASS**, 9.36s. Seven measured `pg_blocking_pids` edges across independent student/actor/tenant quota races, both opening/closure orderings, session401 and retention404 waits. Actual UPDATE rollback and committed-but-lost COMMIT acknowledgement issue zero fake-sender scheduling; durable true state is observed separately. Same-UUID admission reconciles one original identity after lost acknowledgement. Later legacy collisions refuse and deleting ledger rows remain charged alongside reservations.
- Native held aggregate versus the unchanged original-ID registrar explicitly demonstrates the existing increasing-writer bypass: legacy registration can commit while receipt admission is paused. This is evidence of the activation blocker, not universal quota enforcement.
- Owned native lane 55441 used a freshly created uniquely named loopback cluster. Port/database/data-directory/version identity was verified before fixture bootstrap. Each run stopped its cluster and removed its checked owned path; no shared/stale cluster was adopted.
- Final composed typecheck and default production build PASS. Repository staged/publish-set protection **3/3 PASS**, 35.13s; `git diff --cached --check` clean.

Logs remain ignored: `.local-logs/receipt-service-{app-expanded,composed,type-final,build,native}.log` (native runner writes its own log). No real data, external provider, remote database or operations journal was accessed.

## Failure history

The initial app run failed 7/7 through the existing sanitizer: two scalar ORM selects lacked a FROM source. Correcting the query construction produced 6/7; the remaining test tried to spy on the frozen real practice factory. A test-local method facade fixed that fixture, giving 7/7 before expanding to nine. The first native run passed 6/7; its sole failure incorrectly expected no audit rows despite the fixture's prior `context.enter`. Comparing the baseline preserved the no-new-audit assertion. Subsequent expanded native runs passed 9/9 and final 10/10. An initial native typecheck caught a synthetic WAV descriptor passed to the unchanged compressed-only legacy registrar; only that fixture was corrected. No auth/schema/legacy policy was widened to make tests pass.

## Remaining boundary

Independent B adversarial review and root integration/CI remain. This is receipt-only serialized admission observed alongside current ledger rows: the unchanged legacy registrar bypasses this gate. Joining every increasing writer is mandatory before any route/provider/finalization activation. No claim of universal physical-request bounds, provider billing cap, completed upload, deletion worker or real recording readiness is made. Transport C is separately owned and unwired.
