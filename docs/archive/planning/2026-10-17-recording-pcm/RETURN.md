# Canonical recording PCM verifier

Base: reviewed ledger integration `dd199f5`. This is an unwired byte-verification seam; it creates no asset and makes no ownership, upload, phone-capture or playback claim.

`src/server/recordings/media-wav.ts` exports `verifyCanonicalRecordingWav`, closed success/failure types and frozen format/bound constants. It accepts only the exact 44-byte, 24kHz mono signed 16-bit PCM WAV subset. SHA256 covers every received byte; byte count, frame count and rounded-up duration derive from actual framing through EOF. Only the header and incremental digest are retained.

Fixed limits are ten minutes, 32MiB, five seconds idle, thirty seconds total and 64 consecutive empty chunks. Timeout options only shorten those deadlines. Per-read timers/listeners are removed after settlement; failures initiate cancellation without awaiting it and release the reader. All input/source failures return the same sanitized result. The root-owned canonical PCM design is included unchanged.

Author verification (isolated credentials-free child environment):

- `node .local-logs/run-isolated.mjs recording-pcm-author npm run test:app -- tests/app/recording-pcm.test.ts`: 13/13 pass, including the maximum file streamed from a reused chunk, exact independent hash, framing/limits, empty flood, abort, idle timeout, nonsettling/rejected cancellation and reader release.
- `node .local-logs/run-isolated.mjs recording-pcm-typecheck npm run typecheck`: pass, including the independent review test draft. Initial typecheck found optional-number narrowing errors after strict timeout validation; explicit numeric narrowing corrected them before freeze.
- `git diff --check`: pass.

Independent adversarial review remains pending at this author checkpoint. No broad, native PostgreSQL, browser, provider or production run was needed or performed. Existing policy, ledger migration, runtime and HTTP paths are unchanged. Canonical-format activation requires its own additive policy/schema and upload-pipeline review.
