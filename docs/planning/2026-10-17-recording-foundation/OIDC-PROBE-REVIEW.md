# Independent native OIDC probe review

Accepted for bounded integration at authored commit `a2d1efe32eb0da1574d5224cdb26ad8e898c0e09`, based on released `e9b0287`. No source blocker remains. This accepts the default-disabled metadata probe and synthetic verification; it does not claim actual provider access or environment isolation.

## Source and dependency findings

The six-file change adds the opt-in prebuild script, exact `@vercel/blob@2.8.2` dependency/lock and its tests/documentation. Application, public assets, schema, existing operators and audio behavior are unchanged. Script SHA256 is `0b5683bfe3c615ddef7a46fc01b829528575889950faccc063f16e9821e025db`.

Absent probe flags return silently before SDK loading. Partial/unknown flags fail closed. Enabled requests bind the known project/team/store, selected environment, issuer/audience/subject, fresh numeric time claims and exact native token before and after I/O. JWT decoding is diagnostic, not signature verification or application authorization. Static fallback is removed; endpoint, version, proxy, debug and unsafe TLS/process overrides are rejected. A ten-second total deadline covers loading and the bounded list operation; late completion cannot become a successful result.

The installed 2.8.2 distribution independently matches the public npm package inspected during review. Its explicit nonempty `oidcToken` and `storeId` branch returns before automatic OIDC lookup/refresh or static-token fallback. Transitive `@vercel/oidc@3.8.10`, `@vercel/cli-config@0.3.1` and `@vercel/cli-exec@1.0.1` imports define utilities, caches and a lazy JWKS resolver; credential reads, refresh POSTs and process launches are inside uncalled functions. The independent fresh-process regression below also checks this behavior directly.

The actual SDK list receives only explicit OIDC/store ID, limit1, the synthetic run prefix and abort signal. SDK retries are forced to zero before import/request (the pinned SDK otherwise defaults to ten). Negative success requires the pinned SDK's specific environment-denial class through public `BlobError` membership and its exact prototype constructor name. Generic forbidden, missing store, transport/service errors, malformed responses and expired/replaced identities fail. The private class is deliberately not imported through a package-internal path; a dependency change requires renewed review and may safely fail this classification. Closed output never includes returned object metadata or provider errors.

The [SDK reference](https://vercel.com/docs/vercel-blob/using-blob-sdk) supports explicit OIDC/store credentials without refresh. The [OIDC reference](https://vercel.com/docs/oidc/reference) documents global/team issuers and the owner/project/environment and time claims used here. Local Development labels do not establish hosting; root must obtain the documented native Development identity. Provider authentication supplies the eventual access evidence.

## Independent checks

- `node .local-logs/run-isolated.mjs oidc-probe-independent node --test tests/private-media-oidc-probe.test.mjs tests/isolation.test.mjs` — 13/13 passed, 364.87ms, on the stable authored working source before its commit. The subsequent author-only test edit shortened a synthetic static-token placeholder to satisfy repository policy; script/API behavior stayed unchanged.
- `node .local-logs/run-isolated.mjs oidc-probe-independent-tripwires node --test tests/private-media-oidc-review.test.mjs tests/isolation.test.mjs` — 4/4 passed, 290.34ms. Three isolation cases repeat the earlier check; the new independent case is distinct.
- That new test starts a scrubbed child with a disposable home, installs credential-path I/O, process-launch and non-SDK fetch tripwires before the actual SDK import, and disables external network using Undici MockAgent. All three selected modes verify the actual explicit Authorization/store headers and exact prefix/limit without logging them. Actual SDK response mapping yields Production allow and specific Preview/Development denials: three mocked requests, zero private-path I/O, zero launches and zero token-mint calls. Synthetic JWTs are not represented as signed native identities.
- `node .local-logs/run-isolated.mjs oidc-probe-review-guard node --test tests/never-in-repo.test.mjs` — 3/3 passed, 33.99s, including current candidate/index and forced-staging protection. Installed package metadata plus both public SDK implementation files also matched the independently fetched npm 2.8.2 package bytes exactly.
- `git diff --check` passed. Author separately reports final 16/16 focused, isolation and repository protection checks; that is attributed author evidence, not an additional independent run.

Review test SHA256: `fb18252370c4fadcd63f8a65dbd386342e5ee4810980171821f901807b9efa12`. Logs remain ignored under `.local-logs/oidc-probe-independent*.log`. No live provider/auth/environment operation, token mint, deployment, database access or object read/write was performed by this review.

## Remaining execution gates

Root owns required broader checks/exact hosted CI and native Production allow plus same-store Preview/Development denial. Missing variables, decoded JWTs, mocked results or generic403 do not satisfy those gates. The documented clean tracked-source CLI deployment direction uses nonsecret build-only flags, native hosted builds and Production `--skip-domain`; canonical alias and deployment identity/source require before/after verification. CLI automatic retries may duplicate metadata-only builds, a disclosed root-accepted operational limit; root must reconcile ambiguous creation instead of automatically retrying. Build logs must be bounded and filtered in memory to the exact closed result without publishing other log text. Development token acquisition is a separately reviewed in-memory operation, not env pull or CLI token output capture.

No configuration repair, store replacement, static-credential use, media activation or family-audio acceptance is authorized by this report. Upload retirement, ranges, cleanup and later receipt/schema work retain their separate gates.
