# Independent provider-disabled media transport review

Initial reviewed source: `b2f97c670d8ef4c53290885b3fb98c2be22e3e60`. Accepted repaired source: `a071e5f63bd1740df8d2dbdd76d93e64dbb3c806`; immutable confirmation results follow. Review ownership is only this note and the two new review-named app test files. Product repairs belong to the author.

## Findings and repairs

Four concrete defects were reported to root and author before acceptance:

1. The U pre-copy check read shadowable `byteLength`, then passed the original typed array to `Buffer.from`. A real oversized typed array with a shadowed small length reached the copy allocation before hash rejection. The repair reads intrinsic buffer/offset/length and copies a fresh bounded view. Independent tests retain the original oversized refusal and also verify an offset view whose public buffer/length/valueOf properties are hostile, with zero hook calls and exact dispatched bytes.
2. Metadata used `new URL(String(value.url))`. A JSON array containing the fixed URL was accepted as valid metadata. Both metadata lookup and PUT parsing must instead require a bounded actual string; the independent regression covers both paths.
3. Response error observers were installed after rejecting TLS/header/cap checks. An early-rejected response could later emit an unhandled raw error. The repair installs error/abort/close observation before those checks. The independent trace rejects the body, then emits a subsequent provider error and requires a closed result without an uncaught exception.
4. Retirement's original permit tag was required in TypeScript but optional in the shared runtime check. An omitted tag allowed dispatch and skipped the original-permit tag comparison. Retirement now validates that strong tag before credential acquisition/dispatch. The independent missing-tag case retains the zero-dispatch assertion.

The initial transport run passed7/9 and failed the first two regressions. Separate targeted runs reproduced the later two failures; source was not edited by this reviewer. Original logs remain ignored. The author preserved the initial frozen ref rather than rewriting it.

## Evidence and scope

- Independent transport tests exercise actual pinned Blob2.8.2 under `MockAgent.disableNetConnect()`, comparing normal slot27 PUT semantic headers/body/store normalization/condition/attempt0 and nonce shape, control metadata GET and direct OIDC private GET. The real SDK receives a bounded abort signal and retry0. No live network or provider credential is used. Author P/U/R SDK mapping evidence is separately attributed, not represented as an independent native test.
- Independent tests cover closed descriptors/accessors, zero-dispatch invalid input, odd fixed P31/R33 values, tag separation, status/error taxonomy, complete private GET length/MIME/tag/encoding/TLS/EOF/hash, owned response bytes, empty floods, progress idle, pre-dispatch elapsed time, post-settlement absolute time, abort and late response/socket events. Mocked TLS/event traces are not actual provider acceptance.
- The real public OIDC `getContext` accessor is exercised through concurrent AsyncLocalStorage request scopes. Distinct identities stay separate; an escaped credential fails outside its request scope, and environment/static values do not supply a missing context. Sync/async token-getter/mint functions are tripwired. Acquisition also runs with file/process tripwires. Canonical JWT/profile/time failures and post-await expiry/token replacement remain fixed-error refusals. Local claim decoding is not signature verification; host startup integrity remains an assumption.
- Package/lock review confirms the only dependency change from `c0fce534` is a root direct exact `@vercel/oidc`3.8.10 declaration, already resolved transitively; no resolved package version/integrity graph changes. Product code has no SDK byte/control execution, environment fallback, refresh, CLI or credential filesystem path.

Two reviewer fixture corrections are retained in history: Node ESM namespace spies were changed to mutable default module export spies; a valid offset-view positive test was given a distinct permit tag instead of incorrectly expecting an unchanged condition tag to succeed. A typed SDK fixture uses `Buffer.from(payload)` to satisfy the pinned SDK PutBody declaration while preserving the identical byte assertions. These corrections did not weaken a product assertion.

## Remaining boundary

This review covers an unwired, provider-disabled transport seam. It proves neither deployed getContext availability nor native direct OIDC GET or protected route behavior. The normal API remains confined to `recordings/v1/<asset>/chunk-NN`; accepted native synthetic objects live in a separate acceptance namespace. Any shared internal engine extraction and its protected fixed-read route require their separately reviewed source/operator and native evidence.

No receipt/authority/route/UI/schema/worker or actual sender is composed here. Confirmed outer commit before U, fresh caller authority/CAS after I/O, all increasing writers joining admission, original-ID/WAV finalization, proven account-independent cleanup and release gates remain mandatory. No actual learner audio, provider/control-plane/DB/browser operation, credential or operational journal was accessed by this reviewer.

## Immutable confirmation

Accepted the repaired source only after independent confirmation; original b2f remains unaccepted.

- Exact source Git blobs: `private-transport.ts` `b75cabf0c8aa20eebca7426836073116b5bffd43`; unchanged `runtime-oidc.ts` `1f67eed6223d70531f81251a5d0169fe435cf213`; unchanged `types.ts` `512b6e2e19de22f3457c7afb284f7d5f33cf874b`. Root package/lock delta was rechecked as only the exact direct OIDC declaration.
- Own final two review files: **15/15 PASS**,344ms, `.local-logs/media-transport-independent-frozen.log`.
- Relevant composed eight-file run: **161/161 PASS**,1.13s, `.local-logs/media-transport-independent-composed.log`: own15, author runtime/transport18, unchanged PCM/policy128. Command used the isolated runner with `npm run test:app -- tests/app/runtime-oidc.test.ts tests/app/private-media-transport.test.ts tests/app/runtime-oidc-review.test.ts tests/app/private-media-transport-review.test.ts tests/app/recording-pcm.test.ts tests/app/recording-pcm-review.test.ts tests/app/recording-policy.test.ts tests/app/recording-policy-adversarial.test.ts`.
- Final composed typecheck PASS, `.local-logs/media-transport-independent-type-final.log`. Author's repaired default production build is attributed/reused, not independently rerun for review-only files. Independent staged repository protection **3/3 PASS**,35.09s, `.local-logs/media-transport-independent-protection.log`; staged diff check clean.
- No remaining concrete source blocker in the bounded disabled seam. Root integration/exact hosted and later native request proof remain separate gates. This reviewer changed no author/product files.
