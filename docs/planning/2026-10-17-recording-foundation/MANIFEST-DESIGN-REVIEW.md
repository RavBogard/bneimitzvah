# Manifest storage / ordinary-PUT proof — independent design review

Reviewed the root manifest spec at HEADb9dbc1714930917c04b8c0ec83e9545a7f6827ce against accepted source contracts and pinned SDK2.8.2. Design only: no implementation, tests, credentials, database/provider/private-state operations or source changes. Root retains architecture and operational release. This review accepts the architecture and ONLY the next bounded two-key synthetic proof, not receipt/schema/runtime/worker or recording activation.

## Conclusion

No remaining architecture blocker. Server-mediated complete <=1MiB ordinary objects with no browser provider write capability remove the exposed multipart-creation/unfinished-part lifecycle. Pinned createPutMethod branches into multipart only for multipart===true; explicitly false uses ordinary PUT. This does not assert provider-internal implementation, physical backup erasure or cancellation of an already accepted write. The previous delegated proof stays held and is not needed to justify this smaller authority surface.

The manifest binds exact count/order/even lengths, immutable first body hashes, per-slot ETags and whole canonical facts. The28-object ceiling is correct for28,800,044 canonical bytes (27 full chunks plus488,492 bytes), not the broader32MiB generic media cap. No client path/hash claim becomes authority. Verification outside SQL locks followed by same-version fresh atomic receipt/original-ID registrar/audit preserves the accepted transaction seam. The unchanged30-second verifier deadline and bounded two-buffer prefetch are appropriate fail-closed constraints; completing network work inside them remains a later implementation fact.

## Retirement premise and known race branches

Odd31-byte P and33-byte R versus exclusively even legal chunks eliminate the prior marker/body-equality loophole. Create-only P, never resetting its key/ETag and retaining R permanently prevent deliberate ABA through reinitialization. Require observed strong ETag changes: U's B differs from A, and installed R differs from both A and the value it replaced. Exact private-origin bytes/hash/length checks establish current state; an ETag or HEAD alone is insufficient.

Both described OCC outcomes are legitimate finite observations. If R(A) succeeds, the old A-bound U must specifically fail precondition and R remain current. If U succeeds, R(A) must specifically fail precondition; only that known outcome permits the bounded verify-B and conditional R(B) step. Unknown/network/auth/expiry/timeouts are not this branch and cannot cause automatic replay or cleanup. A later stale-A check must leave R unchanged. Published OCC plus honestly observed races is an explicit provider trust premise, not a theorem about every future execution.

The implementation must START R asynchronously while U's positive prefix is actually held, then release U under the bounded schedule. Never await R settlement before releasing U or infer a provider lock from a pending request. Freeze what each evidence class actually observes: creating a promise is not dispatch, TLS connected/flushed is not remote header acceptance, HTTP100 is remote acknowledgment but not proof of backend condition-evaluation time. Root must judge actual native evidence; if it cannot establish the prescribed held-write evidence, return inconclusive. Deterministic offline request/socket traces prove code ordering only; they cannot supply provider semantics.

## Small implementation precisions

- Disabled selection means ALL new opt-in fields absent. Any partial/wrong new selection or combined new/legacy flag families must fail before the earlier prebuild scripts can write. Complete legacy-only opt-in can still pass silently through the new disabled script. Preserve existing scripts/predicates unchanged, and change only the exact composed prebuild assertion alongside ordering.
- Explicit OIDC/store, multipart:false, addRandomSuffix:false, conditional headers and no body/options passthrough must apply to both ordinary SDK and held raw TLS paths. No native dependency, global dispatcher/transport interception or endpoint override is justified. Real SDK serialization under blocked-network mocks should pin the copied raw protocol.
- The conservative6MiB body-attempt/32-application-call/120-second bounds look feasible for two1MiB cases including stale writes and known-conflict R writes. Count partial/failed attempts and keep per-await/byte-progress/empty-read/monotonic fences. They are per-process limits; no global wire/duplicate-build/billing bound follows.
- Retain closed outcomes on late context failure or uncertain write; track and settle/destroy/discard held handles before returning, with no subsequent operation or success. Physical cancellation is not claimed. Temporary credentials, ETags, paths and raw responses never enter output.

The previous synthetic SDK-control-JSON and CLI duplicate-build concessions remain explicitly limited to this generated non-audio acceptance. They must not carry into production byte paths or establish quiescence. The cost paragraph is root's engineering estimate with allowance/shared-usage caveats, not an independently measured bill or new spending approval from this review. Logical-take limits versus physical chunks/markers still need the later accounting contract.

Accepted for the root-authorized bounded implementation with those precision requirements. Separate author/independent mocked tests, exact integration gates, root-only operator review and actual native two-key observations remain necessary. No evidence in this note claims actual ordinary-write retirement has already passed, receipt cleanup is complete, or student recording save exists.

Reviewed spec SHA256: `96341bbef715a6c4c66e4ead54c2a8ba659493b34b9b8d44f8c0df48a5574634`.
