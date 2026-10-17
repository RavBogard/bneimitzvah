# Single-read implementation review

Accepted frozen source `f9ed95c0f10e63df746bf7bd2de4dfe7d1c486d2` for the bounded diagnostic. No source blocker or corrective source change was found in this independent review. This acceptance neither repairs the failed native write proof nor authorizes its replay, cleanup, promotion, or normal release.

## Source and authority

The old `selection()` and entire `runPrivateMediaSingleWriteProbe()` source spans equal checkpoint `8caaeda2e24269f4c3b8d872a69d4942931371f2`; the automated comparison permits only checkout line-ending differences. The source diff adds the separate read function/constants and the CLI's exact `read-only-v1` branch before writer dispatch. Direct writer invocation still rejects that mode. Partial, expanded and mixed flag sets stop before token access or SDK import; the default stays silent.

Only existing full native context assertions, positive metadata permission before/after, a bounded fixed-key GET grant, local presigning, one HEAD and one confined GET are reachable. Mutation SDK getters remain unread in the independent positive path. The actual pinned SDK under a network-blocked MockAgent uses explicit native authorization and the normalized fixed store, sends exactly GET-only signing scope for the derived normal key, and completes real presigning/HEAD mapping. Assertions inspect synthetic headers in memory; none are printed or retained in the report.

Pre-freeze root tightening confines HEAD pathname/origin/path and caps safe size and both ETag values. HEAD classes remain size metadata only. Neither expected MIME/length, original B ETag, nor exact serialized URL equality becomes a prerequisite for collecting current observations. A complete known body requires EOF/hash within the decoded-byte cap; GET200, nonempty structural URL confinement, fresh authority and both positive metadata checks are still mandatory. The result is a separate frozen six-key read schema, with no write-proof checks or write-attempt field.

## Independent verification

Command, from the managed checkout:

`node .local-logs/run-isolated.mjs single-read-independent node --test tests/private-media-single-read-review.test.mjs`

Result: **9/9 passed, 520.62ms**. Log: `.local-logs/single-read-independent.log`. No initial independent failure, retry, test correction, or source fix occurred after the immutable freeze.

Distinct checks cover:

- Historical writer/selection equality and an actual isolated CLI child selecting the read result before native identity refusal; every spawned process receives `isolatedEnv` and the temporary home is cleaned in `finally`.
- Read selection fences and direct-writer refusal; zero mutation-member reads while a known permit is observed despite size-only HEAD, missing length, MIME/encoding, ETag and query-order disagreement.
- Rejection of overbroad, wrong-key/store or inconsistent-expiry grant scopes and unconfined/duplicate-query signing URLs before object fetch.
- Decoded bytes exceeding 1MiB despite a small declared wire length, plus oversized declarations rejected before reader access; bounded empty reads and monotonic idle checks after event-loop-starved settlement.
- Monotonic SDK deadline refusal, identity expiry at EOF, and cancellation of a fetch settling after timeout without another metadata call or any change to the terminal result.
- Actual pinned SDK GET-only grant/presign/HEAD behavior under `MockAgent.disableNetConnect()`.

The encoding/header disagreement uses an already-decoded synthetic response; it does not claim a native compressed-provider response was exercised. The source preserves byte-progress deadlines, finite empty reads, nonawaited cancellation and post-await context fences. Fixed failures expose no raw error, key, URL, token, header, hash or body.

Author evidence, attributed rather than independently repeated: new normal11 plus prior69 composed **80/80 passed**, typecheck/default build passed, staged repository protection3/3 passed. Independent isolation3/3 passed (157.07ms), and the staged repository protection3/3 passed (see `.local-logs/single-read-review-isolation.log` and `.local-logs/single-read-review-protection.log`). Final diff checks are clean.

## Evidence limits and remaining gate

There were no provider calls, credentials, operational journals, database operations, real media or deployment actions in this review. All generated response bodies are synthetic and MockAgent prevents external SDK network access. Product source remains unchanged from `f9ed95c`.

The previous native failure remains an unresolved historical observation. A future read may describe the current key, not recover the old transient headers or original B ETag, establish held-race/retirement assurance, or convert the failed write proof into a pass. Root owns the separately reviewed read operator, exact integration gates and any explicitly authorized native diagnosis. Existing protected rounds and unrelated root/author files remain unchanged.
