# Independent canonical capture review

**Accepted bounded source `2709c18`.** Reviewed the controller, production worklet, author fixture/22 cumulative cases and return. No product correction was required. The recorder remains an unwired local mechanism, not a recording upload or authorization feature.

New independent `tests/http-browser/recording-capture-review.test.ts` covers seven distinct cases:

- Idle, stop-before-start, disposed and pre-aborted controllers request no microphone or AudioContext; network/persistence/object-URL side effects are trapped.
- A delayed real fake-microphone permission result from disposed take A is stopped without replacing or stopping new live take B. B produces real PCM and can complete normally.
- Actual AudioContext resume held across abort cannot restore a take or return successful start.
- Concurrent stop calls share one flush; abort while close acknowledgement is held after valid PCM/flush cannot return the already constructed Blob. Tracks/context end, and exactly one stop message is sent.
- An actual synthetic worklet transfers contiguous 4096+7-frame buffers. Every reconstructed signed sample, canonical WAV size/type/frame duration and independent SHA passes the accepted server verifier.
- A real worklet's mismatched final frame total fails closed without a partial Blob.
- The exact production worklet runs across long irregular three-channel partitions with transferable-buffer detachment. All 10,937 signed little-endian samples match independently specified values across full chunks/tail; every output/channel remains zero, including after stop. Repeated stop emits no extra PCM.

The author evidence already covers actual sample-rate mismatch, aggregate frame/chunk/ten-minute limits, malformed protocol, track/visibility/dispose, setup/flush/close liveness and cancellation. Source inspection confirms fixed caps on both sides, no resampling claim, finite-input downmix/clamping, no monitoring signal, and cleanup fences before success. Independent cases complement that evidence rather than claiming a repeated full author batch.

## Measured results and limits

- Initial independent run: six passed, one failed, 3.24 seconds. The new-take success check used a fixed 50ms delay without establishing PCM readiness; the failed assertion retained only `ok:false`, not its error discriminator. No product defect was established. The test now waits for an actual PCM message before requiring successful stop, preserving all late-A/new-B identity, live-track and cleanup assertions. Affected confirmation: one passed, six unselected, 2.11 seconds. This is cumulative seven-case acceptance, not a claimed single final 7/7 run.
- Commands: `node .local-logs/run-isolated.mjs recording-capture-independent node node_modules/vitest/vitest.mjs run --config vitest.http-browser.config.mts tests/http-browser/recording-capture-review.test.ts --reporter verbose`; same command with label `recording-capture-independent-confirmation` and `-t "late permission"` for the correction. Both logs are ignored.
- Final composed `npm run typecheck` passed through isolated runner label `recording-capture-review-final-typecheck`; child-isolation meta-tests 3/3 passed under label `recording-capture-review-isolation`. Product/author source diff against `2709c18` is empty; no caps or assertions were weakened.
- Actual full installed Chromium, synthetic microphone, local ephemeral loopback fixture only. Fixed routes, origin-whitelisted browser traffic, disabled service workers/downloads and process-level loopback fetch guard; no Next server, SQL, shared3191, credentials, provider or persistent fixture. All browser contexts/browser/server close and temporary transpiled module/home are cleaned in finally; both runner processes exited.

This proves byte framing/arithmetic and bounded browser lifecycle behavior for the tested synthetic Chromium paths. It does not establish physical microphone quality, speaker/listening quality, phone/Safari/Firefox behavior, production AudioWorklet CSP/Permissions-Policy, workspace conceal/unmount/authority wiring, upload/private playback or durable deletion. Client facts remain untrusted until server verification. Exact integration CI and later deployed mechanism checks remain root-owned gates.
