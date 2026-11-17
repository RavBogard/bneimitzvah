# Independent canonical PCM verifier review

**Accepted within the source-only seam at `9113d96a9a77e2860c3f9ac92febe2133cb2f2a9`.** Reviewed the root canonical PCM design and actual `src/server/recordings/media-wav.ts`; no product/spec edit was made by this reviewer. No private media, provider, UI, storage, database or production operation occurred. Root still owns integration/exact hosted gates.

The design is a defensible canonical subset: exactly44 bytes of RIFF/WAVE header, one16-byte PCM fmt chunk and one data chunk, signed little-endian16-bit mono24000Hz. Every header byte belongs to a checked field. RIFF/data arithmetic, nonempty even payload and <=14400000 frames are checked before duration rounding. Actual received length must agree at EOF; extra chunks, truncation and trailing bytes reject. SHA256 covers exact received header and body, including correct typed-array offsets; there is no client duration/hash/Content-Length proof or opaque compressed decoder assumption. Silence is valid. The maximum canonical recording is28800044 bytes/600000ms, inside the unchanged32MiB engineering ceiling.

The verifier retains only its44-byte header, counters and incremental hash state. It returns a frozen closed internal result, or shared fixed `invalid-recording-media`; raw source/cancellation/abort errors are not reflected. Per-read removable timers/listeners race pending reads against abort and the earlier idle/total deadline; monotonic clock checks also run on settlement. Empty chunks do not renew progress and have a64-chunk bound. Timing options can only tighten fixed5s idle/30s total caps. Failure cancellation is fire-and-forget with rejection consumption; reader release does not await an uncooperative cancel hook.

## Independent execution

```text
node .local-logs/run-isolated.mjs recording-pcm-independent-first npm run test:app -- tests/app/recording-pcm-review.test.ts
node .local-logs/run-isolated.mjs recording-pcm-independent-composed npm run test:app -- tests/app/recording-pcm.test.ts tests/app/recording-pcm-review.test.ts
node .local-logs/run-isolated.mjs recording-pcm-independent-typecheck npm run typecheck
```

Own **23/23 passed on the first run,205ms**. Composed **36/36 passed,189ms**, including independent execution of the author's thirteen normal cases. Composed typecheck and `git diff --check` pass. Ignored logs retain these exact labels; no failures were hidden or corrected after execution.

Independent cases use actual `ReadableStream` objects and an independently constructed literal canonical header, not verifier parsing/constants. They cover all53 split points of a nontrivial signed-sample file in offset backing-buffer views, exact full-file digest, every fixed-field mutation, early EOF/trailing/odd/empty/overflow framing, one-frame minimum, known duration-rounding boundaries and legal silence. The composed normal cases additionally stream the ten-minute maximum from one reused64KiB buffer without a giant retained/committed fixture.

Actual stream adversaries cover pending-read abort, source errors/wrong chunk types, pre-abort, rejected/thrown cancellation, synchronous empty floods, and idle/total deadlines. Idle/slow-drip clock cases use deterministic fake timers/performance rather than claiming real30s/provider timing evidence. Crucially, cancellation promises are held unresolved until after assertions that the verifier already returned and released its reader; cleanup then resolves the synthetic hook. Many-read success checks removable listeners, zero remaining verifier timers and reader unlock. All samples/headers are generated in test memory; no audio file is committed.

## Boundary and remaining work

Independent comparisons show the only added product source is `media-wav.ts`. DB/schema/migrations, HTTP, runtime, existing recording policy, authority, registrar and public metadata DTOs are byte-identical to accepted `dd199f5`. The module is not imported by any runtime/HTTP path. `audio/wav` is deliberately not yet a valid current ledger registration format: root requires a later new migration/policy review rather than rewriting pushed0020. Existing WebM/MP4 declarations remain unchanged and do not gain byte-verification claims.

This result proves canonical framing, media facts, hash and bounded verifier resource cleanup; it does not prove microphone sample rate/quality, immutable storage identity, capture ownership, authority after external waits, upload completion, playback or physical deletion. Browser capture/resampling and private-media pipeline remain the separately identified seams. No new product or spending/licensing/listening permission is inferred.

Reviewed source Git blob `24b1a2a5c75c0fc3c42d8f8973bd4011e50bd0a1`; independent test blob `340fc8c4ff09f8aef808952f33b54bf578927753`, SHA256 `b7df4d5cc82174337848bcc478fe3e8e25a4b511eb677c4ac784bc7eb83dcc48`. No unresolved blocker or source change is requested. Independent work is at rest.
