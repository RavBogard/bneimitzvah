# Private media OIDC metadata probe

Bounded source implementation from deployed `e9b0287`; no provider operation, credential retrieval, environment pull, store change or deployment was performed. Root's current probe spec is copied unchanged. Independent source review and exact hosted CI remain required before root executes actual probes.

## Source and behavior

- `scripts/private-media-oidc-probe.mjs`: absent flags return silently before importing the SDK. The new `prebuild` hook invokes this script; `build` remains `next build`.
- Exact dependency `@vercel/blob@2.8.2`; lock changes only add the dependency and its resolved dependency graph. Existing package entries are unchanged.
- Closed ephemeral flags: `PRIVATE_MEDIA_OIDC_PROBE_MODE` (`production-allow`, `preview-deny`, `development-deny`), `PRIVATE_MEDIA_OIDC_PROBE_STORE_ID` (fixed owned store), and `PRIVATE_MEDIA_OIDC_PROBE_RUN_ID` (canonical UUID v4). Unknown/partial flags and CLI arguments fail closed.
- Matching project/team/environment, native token shape, documented global/team issuer, audience, subject, issued/not-before/expiry and deployment labels are checked before and after I/O. JWT decoding is diagnostic, not signature verification. Local development labels do not prove hosting; only root's actual issued token and provider result can establish that evidence.
- Reject SDK API URL, API version and alternative-proxy overrides (including `NEXT_PUBLIC_` variants), debug flags, Node hooks/custom CA and disabled TLS verification. Remove static Blob fallback before SDK import; explicitly pass only OIDC token, fixed store, limit 1, synthetic prefix and abort signal. Set SDK retries to zero. The maximum deadline is ten seconds, including SDK loading; late loading cannot start a request after timeout.
- The pinned SDK maps provider environment denial to its non-exported `BlobOidcEnvironmentNotAllowedError`. Recognition requires its public `BlobError` base and exact prototype constructor name. Generic access denial, store/config errors and transport failures cannot pass a negative probe. This source-specific mapping must be reviewed if the SDK changes.
- Only five fixed output fields are emitted: `ok`, `mode`, `environmentMatch`, `expectation`, `outcome`. Returned object metadata and provider errors are discarded. This is metadata permission evidence only; it does not establish upload, retirement, byte verification, playback or cleanup behavior.

## Author verification

`node .local-logs/run-isolated.mjs private-media-probe-final-focused node --test tests/private-media-oidc-probe.test.mjs tests/isolation.test.mjs`: **13/13 pass**, 372.01 ms. Ten probe groups plus three isolation cases; ignored log `.local-logs/private-media-probe-final-focused.log`.

Coverage includes silent default child execution with SDK imports/network forbidden, rejected arguments, closed flags/identity, override refusal, static fallback removal, exact list scope, positive/negative expectations, post-await expiry/token change, hostile exceptions, malformed metadata, stalled I/O, late import and bounded deadline options. An actual installed SDK uses an Undici `MockAgent` with all network disabled: specific provider environment denial passes, generic 403/store 404/503 fail, successful metadata access is unexpected for Preview, and each response consumes exactly one request with no retry.

Initial focused run was **11/12**: the actual SDK mock expected an extra trailing slash in `/api/blob/`, so its interceptor did not match. Corrected only that mock path to the SDK's `/api/blob`; confirmation passed 12/12. Added explicit hostile-error/argument/import-blocking checks afterward; final 13/13 above. No external request was possible in the SDK mock.

The first staged repository guard rejected the test's long synthetic static-token placeholder as a credential pattern. Replaced that dummy value with `unused`, retaining the static-fallback-removal assertion; no policy changes. Final combined command adds `tests/never-in-repo.test.mjs` to the focused command above: **16/16 pass**, log `.local-logs/private-media-probe-final-guard.log`, including publish candidates and index. `git diff --check` passes. No app/native/browser sweep is needed for this unwired Node seam locally; root owns the required complete CI and actual context probes. No claim of provider isolation has been made from these offline tests.
