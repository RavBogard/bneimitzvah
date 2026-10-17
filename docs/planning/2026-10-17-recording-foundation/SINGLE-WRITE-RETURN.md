# Trusted ordinary single-write proof — author return

Root-approved manifest architecture at8a15a7a; this source is only the next default-silent synthetic acceptance script. It adds no recording receipt, schema, route, worker, browser write capability or real media. No provider/credential/DB/journal operation occurred.

## Source and fixed contract

New `scripts/private-media-single-write-probe.mjs` runs only with exact three PRIVATE_MEDIA_SINGLE_WRITE_PROBE_ flags (mode single-write-v1, fixed store, canonical run UUID). New prebuild selection executes FIRST: absent flags is silent; partial/unknown or combined new+legacy flags fail before SDK/legacy object writes. Old metadata/object bodies are unchanged. Package composition and the existing test's exact prebuild literal are the only existing-file changes.

Two server-derived opaque keys; nonaudio P31/U1MiB/R33 fixed bodies distinguish markers from every permitted even recording chunk. Normal calls use public SDK2.8.2, explicit fresh OIDC/store, retries0 and multipart:false. Reuse the accepted full environment/native-context guard before/after every asynchronous continuation; actual metadata permission pre/post uses the current lazy forwarding facade without reading/copying NODE_OPTIONS. SDK control-JSON retains the explicit bounded-synthetic trusted-provider exception, not an app transport guarantee.

The closed Node HTTPS adapter mirrors pinned ordinary PUT at vercel.com:443 /api/blob/?pathname with API13, current explicit OIDC/store, exact semantic content/access/overwrite/condition/cache headers, fresh request nonce and attempt0. Only fixed known body choices/slots are accepted, no arbitrary endpoint/header bag. TLS verification and fresh nonpooled socket are explicit; Content-Length and Expect100 are the only transport additions. Independent actual-SDK MockAgent mapping is a separate reviewer gate. No global transport hook, live auth snapshot or signing material is captured.

Tracked U sends a positive8192-byte prefix after verified TLS; R dispatch must reach verified TLS and body-flush evidence before U.finish releases the remainder. U is never released after unknown/failed dispatch. Bounded results accept only known precondition_failed412 JSON or verified successful object facts. Both known OCC branches are modeled: R wins; or U wins/R(A) known412, verify exact B then conditionally R(B). No unknown outcome retry/cleanup exists. Fresh full private-origin byte length/hash/ETag checks confirm U and permanent R. Stale-A fails before retirement and after BOTH final markers. ETags must change from A and replaced B.

Closed schema private-media-single-write/v1: ok,phase,outcome,writeAttempted,requiresReconciliation,race,evidence,checks. Four checks ordinaryVerified/staleDenied/ordinaryRetired/heldRetired; race none/retirement-won/upload-won; evidence none/prefix-flushed/continue. Only100continue observed before U release can pass; prefix-flushed alone yields inconclusive (root reviews actual evidence). Output contains no run/key/URL/header/ETag/token/body/error. Both final markers remain; no DELETE/MPU/delegation.

Bounds: two keys,6MiB conservative outgoing body-attempt budget (includes rejected/stale/partial attempt ceilings and signing JSON),32 application provider calls (worst modeled branch28),120s total/10s per await/5s byte-progress idle,64 empty reads. Absolute monotonic fences apply even if event loop delays timers; response/control/error buffers8192/4096, full object body exactly expected and hashed. Native request resources abort/destroy on failure, late events cannot start another action or report success. Synthetic SDK JSON and CLI duplicate-build exceptions do not establish global request counts, quiescence, erasure or real-media readiness.

## Checks and honest draft history

- Initial author run4/9 passed: mock metadata list omitted hasMore. Correcting that fixture exposed an actual origin-comparison normalization bug in new code; fixed by using new URL(...).origin. Author9/9 subsequently passed,1.32s. No actual operations occurred during diagnosis.
- Before freeze, reviewer draft source feedback identified raw412 must require the pinned precondition_failed code and raw body progress must be checked before delayed data resets its idle clock. Both were tightened before independent execution; evidence was also frozen before releasing U so late100 cannot upgrade it.
- Final composed61/61 PASS1.69s: `node .local-logs/run-isolated.mjs single-write-composed node --test tests/private-media-single-write-probe.test.mjs tests/private-media-object-probe.test.mjs tests/private-media-object-review.test.mjs tests/private-media-oidc-probe.test.mjs tests/private-media-oidc-review.test.mjs tests/private-media-oidc-diagnostic-review.test.mjs tests/private-media-oidc-hosted-review.test.mjs tests/isolation.test.mjs`.
- Staged repository protection3/3 PASS32.27s via single-write-guard; final diffcheck clean.
- `node .local-logs/run-isolated.mjs single-write-type npm run typecheck`: PASS.
- `node .local-logs/run-isolated.mjs single-write-build npm run build`: default production build PASS, prebuild silent. No enabled proof/native claim.

Independent tests/review, exact integration CI, separately reviewed root operator and one explicitly authorized native round remain. No source push/deploy. Root-owned spec and reviewer-owned files remain outside this commit.

## Independent protocol finding and bounded repair

The first independent actual-SDK comparison found c332's raw store wire header incorrectly retained `store_`; the SDK strips that prefix in resolveBlobAuth and uses the normalized ID in BOTH x-vercel-blob-store-id and request-ID prefix. Corrected those two adapter fields; ordinary public-SDK calls continue to receive the original fixed full store ID. The author assertion now independently requires the normalized wire ID/nonce prefix. No other protocol or authorization rule changed.

Author repair confirmation17/17 includes the independent eight groups,1.62s. First author repair attempt introduced a test-only JavaScript replacement-string expansion/syntax error; restored the owned test from its committed version and applied a literal callback replacement, preserving all assertions. Independent first SDK comparison failure and harness retry0 correction remain separately attributed in its review.

Final repaired composed69/69 PASS via single-write-repair-composed (same prior command plus tests/private-media-single-write-review.test.mjs); typecheck and default production build PASS via single-write-repair-type/build. Independent peer rerun awaits this immutable repair. No provider/native/credential/journal operations.
