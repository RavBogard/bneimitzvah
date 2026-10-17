# Identity-v2 write-proof implementation review

Accepted frozen source `1cf87a1d54ce419305e017d80d0c0a5055ff30d3` (script Git blob `70b27d9f1df69ca407971fd9c77495c8f57fec91`) for the bounded synthetic identity-v2 derivative. No independent source blocker, failing regression or corrective source change was found. The old failed write and completed read remain separate immutable evidence; no native result or normal release is accepted by this review.

## Source boundary

The independent Git comparison confirms that the **entire source prefix** before the new identity constant equals `92585f2ade456e240429966a5592918c5080089b` before its CLI block, permitting only whole-source CRLF/LF normalization. Thus original imports/helpers/selection/writer/read runner remain unchanged, rather than merely comparing selected function signatures. All spawned Git/CLI children use `isolatedEnv` and awaited cleanup. CLI dispatch selects exact identity-v2 and its own closed refusal schema; direct old writer invocation still refuses the new mode.

The new runner validates exact flags/store/run and mixed legacy flags before entering the frozen writer. Its live Proxy changes only the validated mode; other keys and existing guard setters/deletes forward to the original environment. It adds no global mode/fetch/dispatcher mutation or hosted NODE_OPTIONS read. Only the existing accepted static-token deletion/retry-zero guard effects remain. Initial and newly introduced override rejection, frozen native post-await guards and EOF-time session expiry remain effective.

The local fetch wrapper is installed after spreading trusted dependencies, preserving the identity guard even with a test fetch. It accepts only the writer's normal/held confined GETs with its original strong If-Match and closed options, then adds exactly `Accept-Encoding: identity`. It requires the present exact response URL and rejects every Content-Encoding, including empty or literal identity, before handing the response to the unchanged verifier. Its catch cancels bodies which the frozen writer never receives; cancellation is nonawaited and rejection/throw is contained. A late response cannot restore success or start another mutation.

The old verifier retains exact200/MIME/Content-Length/strong tag and HEAD equality, full expected EOF/length/hash, byte cap, empty-read/progress deadlines and freshness checks. No range fallback, relaxed decoded-body acceptance, weak-tag conversion or extra key is added. The final versioned projection changes schema only; earned checks, failure/inconclusive/reconciliation state, phase/race/evidence are preserved. The existing held raw transport and SDK PUT/signing/metadata semantics are untouched.

## Independent checks

Own isolated command:

`node .local-logs/run-isolated.mjs identity-write-independent node --test tests/private-media-identity-write-review.test.mjs`

**8/8 passed, 2.04s**; log `.local-logs/identity-write-independent.log`. The groups cover full frozen-prefix comparison/actual CLI dispatch, direct mode refusal and inherited deadline caps; late encoded/unencoded response cancellation with throwing or never-settling cancellation; encoding rejection before reads/retirement; malformed/missing/oversized length, weak/different tags, wrong MIME/status and same-length hash corruption; event-loop-starved idle/deadline and finite empty reads; newly introduced guards and EOF expiry without mode/global-fetch/options access; and exact old/new failure-result comparison after an earned ordinaryVerified check.

Composed isolated command:

`node .local-logs/run-isolated.mjs identity-write-independent-composed node --test tests/private-media-identity-write-probe.test.mjs tests/private-media-identity-write-review.test.mjs tests/private-media-single-read-probe.test.mjs tests/private-media-single-read-review.test.mjs tests/private-media-single-write-probe.test.mjs tests/private-media-single-write-review.test.mjs tests/private-media-object-probe.test.mjs tests/private-media-object-review.test.mjs tests/private-media-oidc-probe.test.mjs tests/private-media-oidc-review.test.mjs tests/private-media-oidc-diagnostic-review.test.mjs tests/private-media-oidc-hosted-review.test.mjs tests/isolation.test.mjs`

**109/109 passed, 2.91s**; log `.local-logs/identity-write-independent-composed.log`. This execution includes the author's complete both-winner synthetic protocol/inconclusive cases and the unchanged real pinned SDK/MockAgent and closed-adapter regressions; it does not claim native-provider behavior. No independent run failed or required fixture adjustment. Product source remained unchanged throughout.

Author evidence, attributed separately: author11/11 and composed98/98, final typecheck/default build passed, staged protection3/3 passed32.92s. Independent staged protection3/3 passed (log `.local-logs/identity-write-independent-protection.log`); final diff checks are clean.

## Limits and next gate

Only synthetic mocks and isolated local processes were used. No actual/default operator invocation, provider/DB access, credential/operational-journal access, real media, deployment or cleanup occurred. Independent fixtures intentionally stop before retirement when validating early failure; complete protocol coverage above comes from the composed author's synthetic model and prior transport cases. No live global dispatcher is installed; existing actual-SDK tests use a network-blocked MockAgent only inside their test process.

The current read's encoding/length/tag differences do not locate the historical verify failure or recover original B. Root still owns exact integration/CI, a separately reviewed fresh source-pinned operator/journal and authorization for any one native identity-v2 round. Old failed/observed rounds cannot be replayed or reclassified. Even a later successful identity-v2 round cannot activate actual learner media/receipt/worker/UI transport, and normal release retains its separate gates. Unrelated root/author files and all prior helpers/state remain unchanged.
