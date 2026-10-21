# Browser observation checkpoint

Base: main `16bfb4debc06a440a0565d08e9aa350f79babd3d`.

Main CI `39605739789` failed three PostgreSQL HTTP browser checks: exploration initial metadata, signed proposal deadline response-body observation, and calendar service readiness. The original log is retained locally as `.local-logs/baseline-main-ci-39605739789-failed.log` (SHA256 `a34c5d7bcf5d42642ad7104ca75db8cd51f109064d14cc676ad70feb55094533`). The metadata cleanup failure remains part of that evidence.

The deadline test now captures bounded genuine authenticated preparation bytes at its exact endpoint and fulfills the same status, semantic headers and bytes, with a digest check. It avoids a second Chromium response-body lookup. Actual successful Hear, returned signed expiry, cached playback, timer-independent expiry and cleanup assertions remain required.

Calendar readiness retains its five-second successful request-completion barrier and every authority assertion. On failure it records only bounded counts, status, terminal state, elapsed times and initial UI booleans. There is no runtime change, retry or waived browser failure.

One native run of both complete files passed **12/12** in 50.38 seconds. Typecheck passed. Owned fixture databases and roles were zero after completion; cluster, workspace and temporary HOME were removed; selected PostgreSQL and browser ports were clear in Windows and WSL. Evidence: `.local-logs/browser-stability-native-v1-{report.json,vitest.json}` and `.local-logs/browser-stability-native-v1.log`. Independent peer review accepted the two exact test-file hashes and reused that run. Repository protection is required again against the staged candidate before commit.

The passing run did not reproduce the metadata or calendar failure and proves neither cause nor repair for those intermittent failures. Main CI metadata observations showed validated EOF without application abort/cancel before Chromium reported ERR_ABORTED. Pinned Playwright source shows explicit buffered fulfillment does not reference the disposed upstream API-response body; disposal timing alone does not establish a defect. The failed deadline observation happened before browser clock installation; no cross-file clock or session leak was found.

Next: exact new candidate CI. Any further metadata or calendar change requires fresh concrete evidence. Existing private publisher, owner operator and source packet pins remain untouched. Publication reconciliation, admission and activation remain held separately.
