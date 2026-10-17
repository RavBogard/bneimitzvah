# Same-key read-only diagnosis — author return

Bounded implementation from checkpoint40f1d79 and accepted single-write-read diagnostic spec. Native write proof8caaeda remains failed/requires-review at verify; neither that round nor its objects/journal were replayed, reset, cleaned or changed. Canonicalbc and protected operations are root-owned. No actual provider/credential/DB/journal operation occurred here.

## Changes

Only the single-write script adds PRIVATE_MEDIA_SINGLE_READ_PROBE + separately guarded runPrivateMediaSingleReadProbe and exact CLI read-only-v1 branch before writer dispatch. Same three ephemeral SINGLE_WRITE flags derive only the fixed store's acceptance/<target-run>/single-write/normal.bin. Partial/unknown/combined flags fail before identity/SDK; all absent remains silent. Direct writer(read-only flags) still refuses. No package/prebuild/old tests changed. Existing writer function and selection compare byte-identically with8caaeda (excluding surrounding added whitespace); old probe bodies are unchanged.

Read-only SDK member path is list before/after, GET-only issueSignedToken/presignUrl and same-key head. Tests install throwing mutation getters (put/delete/copy/rename/multipart/etc) and require zero accesses. Fresh full native context/environment guards, explicit OIDC/store, retry0 and exact2.8.2 checking remain. Lazy facade never reads/copies NODE_OPTIONS and forwards future guard keys. The existing synthetic SDK control-JSON exception is not production transport approval.

Closed schema private-media-single-read/v1 has readOnly:true,ok,phase,outcome(observed|failed),observations only. HEAD class is size metadata alone, not byte proof. contentLengthExpected is exactly1048576 independently of actual body classification. Full GET omits Range/If-Match and observes MIME, Content-Length presence/exactness, content encoding, nonempty structurally confined URL/exact string agreement and HEAD/GET ETag agreement as booleans. Missing length or compressed-wire versus decoded length may be observed without pretending equality. Redirects/unconfined/missing response URL, malformed/above-cap declared length, unexpected status, unknown body, missed EOF, late identity/endpoint/token/deadline failure all refuse observed success.

Only GET200 plus exact bounded known P31/U1MiB/R33 whole SHA/EOF, confinement and both actual metadata checks yield observed. Bytes/hash/header values/URLs/ETags/IDs/errors are never output or persisted. Hashing streams decoded bytes and does not retain body chunks. HEAD-missing is recognized only by pinned SDK class; other failures stop. A diagnostic observation cannot establish original B, reconstruct historical transient response headers, prove retirement or turn the original write round into a pass.

Limits: one normal key,8 application provider calls (normal5),60s total/10s await/5s byte-progress idle,64 empty reads,1MiB actual decoded body. Unexpected status bodies are cancelled immediately; no error-body accumulation. Absolute monotonic post-await checks defeat delayed timer settlement; grant/token freshness stays checked. Abort/cancellation is bounded best effort, late fetch bodies are discarded and cannot start subsequent work or emit another result. No write/cleanup/retry path exists.

## Verification

- Initial author9/10 PASS; query-normalization fixture sorted an already sorted URL, so urlExact correctly remained true. Corrected ONLY that fixture to reverse query order; author10/10 PASS1.02s, no predicate relaxation.
- Composed79/79 PASS1.83s: `node .local-logs/run-isolated.mjs single-read-composed node --test tests/private-media-single-read-probe.test.mjs tests/private-media-single-write-probe.test.mjs tests/private-media-single-write-review.test.mjs tests/private-media-object-probe.test.mjs tests/private-media-object-review.test.mjs tests/private-media-oidc-probe.test.mjs tests/private-media-oidc-review.test.mjs tests/private-media-oidc-diagnostic-review.test.mjs tests/private-media-oidc-hosted-review.test.mjs tests/isolation.test.mjs`.
- `node .local-logs/run-isolated.mjs single-read-type npm run typecheck`: PASS; `single-read-build npm run build`: default production build PASS.
- Isolated Git comparison confirms frozen writer function/selection unchanged from8caaeda. Root-owned STATE and reviewer-owned test/report excluded from author commit.

Independent adversarial execution/review, exact integration CI and separately reviewed root-only read operator/native diagnosis remain gates. No enabled script, source push, release or native operation performed.

## Pre-freeze root HEAD precision

Root required confinement of HEAD metadata identity/size while keeping differences observational. Added exact HEAD key/private-origin path/no query and safe nonnegative size<=1MiB; arbitrary unknown within-cap size classifies other, not failure. Bounded missing/weak/different ETags only make agreement false; no writer expected-B/expected-size/MIME gate was introduced. Both raw tag values are limited to256 characters. Author metadata fixture was expanded with actual HEAD pathname/URL; added a focused negative-route/size/tag plus matching-weak-tag observation case. No frozen failure or write-proof change.

Final author11/11 PASS1.12s; final composed80/80 PASS via single-read-final-composed, with single-read-final-type and single-read-final-build PASS. Earlier79/type/build and first guard apply to the prior draft; final protection is run on the tightened staged bytes. Independent nine groups remain separate pending evidence. Original writer/selection unchanged comparison still applies (only the separately appended read section changed).

Final tightened staged protection3/3 PASS (single-read-final-guard); final diffcheck clean. No additional source changes after those checks.
