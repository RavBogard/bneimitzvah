# Settled decisions (Daniel, binding)

Student recordings are private until explicitly submitted, are accessible inside the exact linked-child practice view rather than the parent dashboard, and all expire one calendar year after ceremony. No automated pronunciation scoring. Continue through full product completion and deploy at will; new spending/licensing and generated-chant G3 gates remain. No media or family data enters Git.

## Root architecture decision — canonical PCM verification seam

The portal-controlled student recorder will produce a single canonical uncompressed WAV format: little-endian signed16-bit PCM, mono,24,000Hz, a44-byte RIFF/WAVE header with exactly one16-byte PCM fmt chunk and one data chunk. The existing ten-minute/32MiB engineering bounds remain. Ten minutes is28,800,044 bytes, inside that cap. This preserves a12kHz audio bandwidth and avoids choosing a new server codec/binary before a trustworthy validation mechanism exists. Reference/archive MP3 and generated chant are separate pipelines.

This changes an implementation mechanism, not the product's recording/privacy requirements. Existing policy's WebM/MP4 names are not evidence of implemented recording support. Do not claim those compressed formats verified by inspecting their MIME/container metadata. A future compressed upload requires an actual reviewed decoder. Before activation, add the new canonical format through a new migration and reviewed policy delta; do not rewrite pushed0020 or remove its accepted behavior.

The tradeoff is larger files than Opus/AAC. Store/transfer costs must account for PCM bytes rather than the earlier5MB illustration. Browser capture quality, sample-rate support and memory behavior require their own tests; this server seam does not establish phone capture compatibility. Capture implementation should use the actual AudioContext/worklet sample rate, request24kHz and fail clearly rather than silently writing a false header. Do not resample by dropping samples. Any fallback resampling requires a tested anti-aliasing method and explicit quality evidence.

## First bounded implementation

Add a server-only streaming verifier with no runtime/HTTP/provider wiring, SDK, schema or policy edit. Consume a `ReadableStream<Uint8Array>` with an AbortSignal and fixed engineering caps. Retain only the44-byte header and incremental SHA256 state, not the audio body. Return a closed internal result containing verified media type, actual byte count, frame count, rounded-up integer durationMs and exact bytes SHA256. No storage locator, user/session/authority, client-provided duration or hash is accepted as proof.

Validate every fixed header field: RIFF/WAVE/fmt/data identifiers, PCM format1, fmt size16, channels1, sample rate24000, byte rate48000, block align2, bits16, RIFF size=36+data size, nonempty even data size. Reject other chunks, extra bytes, truncation, size overflow and over-limit frames. Enforce limits against actual received bytes as well as declared sizes; do not trust Content-Length. Frame duration is derived from dataBytes/2 at24000 frames/sec; reject more than14,400,000 frames before integer rounding. Legal silence is valid audio. Cancel the source on abort/denial/limit and release the reader in all cases; provider/read errors become fixed internal failures, never reflected raw messages or URLs. A stream that stops making progress needs a bounded watchdog, and infinite empty chunks must not spin forever.

Keep a fixed total verification deadline as well as an idle watchdog and finite empty-read bound: progress alone must not allow infinite slow-drip work or starve timers. Failure cleanup must initiate cancellation without awaiting an adversarial never-settling cancel promise, and still release the reader. Test timeout injection may shorten, never enlarge, fixed production limits.

No persistent asset is created by this module. It neither invokes the trusted ledger registrar nor establishes ownership or publication permission. The later upload pipeline binds an immutable quarantined asset and a durable receipt, verifies bytes, then rechecks fresh current student/context/retention before registration. Hashes remain internal.

## Acceptance

Synthetic PCM only, created in tests and never committed as audio. Cover ordinary and minimum/maximum duration, arbitrary header/data chunk boundaries, odd/truncated/trailing/spoofed fields, declared/actual mismatch, every relevant fixed field, >32MiB/ten-minute limits without giant fixtures, exact SHA against an independently computed digest, cancellation, thrown stream errors, stalled/empty streams, stale abort and reader cleanup. No provider credentials, private files, frontend or production operation. Independent adversarial review follows the frozen source. Broader integration CI follows only if this seam is accepted.

Primary references: [Microsoft PCM format fields](https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/ns-mmeapi-waveformatex), [AudioContext sample rate](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/sampleRate), [AudioWorklet actual sample rate](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/sampleRate). The format bounds and canonical subset above are project architecture choices, not claims that every WAV file uses that layout.

## Open items that wait on Daniel

No new decision is required for this source-only verifier. Private storage provisioning still requires the concrete spend notice; generated-chant listening remains distinct. Student-visible release authority is already granted. Full capture/upload/playback/deletion is not completed by this seam.
