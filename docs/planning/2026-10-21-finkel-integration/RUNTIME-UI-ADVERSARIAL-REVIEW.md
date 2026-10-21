# Independent runtime and UI adversarial review

2026-10-21. Reviewer: architecture/backend worker, independently reviewing the runtime/config/dispatcher/client/UI changes implemented by the other worker. This review does not count my backend implementation or its self-tests as independently reviewed. Source hashes below identify accepted working bytes; final integration must compare the staged/committed source and CI candidate.

Verdict: GO for this bounded private-review runtime/UI slice, subject to the required exact-candidate integration gates. No production auth, tenancy, private-media or student-release bypass found in this owned review scope. This is not actual Finkel admission/listening acceptance.

## Scope and findings

Inspected trusted optional reviewer configuration and existing-store composition; closed route dispatch and the final response guard after runtime cleanup; client projection/fetch limits and exact same-origin body verification; admin role shell, five independent checks, uncertain-mutation handling, unsaved changes, playback cancellation, object-URL destruction, expiry/visibility/departure behavior and the synthetic browser fixtures.

Configuration fails closed for partial/foreign reviewer configuration, malformed or email-shaped user IDs, missing store and provider endpoint overrides. Actual immutable user IDs are bounded ASCII text, case-sensitive; tenant is the existing literal crc namespace. Review configuration remains independent of the student audio release flag. A disabled service imports/constructs no Blob request and cannot grant access. Dispatch exposes only named read/decision/revoke routes, retains normal cookie/host boundaries and invokes the internal finisher after the runtime scope has closed its pool. No public short-audio path, release/admission route, client provider URL or private response marker is introduced.

The browser consumes only closed sanitized DTOs, bounds JSON/audio, verifies audio length/SHA, rejects redirects/wrong content type, and creates only a local object URL. It aborts and destroys playback on expiry, concealment, blur, departure, reload, selection change, revocation or failed authority checks. It never silently resumes on return. All five checks remain separate. Success still says studentReady=false and timing=unavailable. Uncertain save responses require status readback; conflicting revisions clear stale state. Hebrew is rendered as React text, never HTML. The client is not an authority source for target/text hashes; the independently reviewed backend remains responsible for manifest identity and authorization.

One concrete test-harness finding: the initial native UI beforeEach attempted owner DELETE of intentionally immutable controls/history. Owner triggers correctly rejected it. The other worker changed the fixture to fresh batch IDs and normal prior revocation; no production immutability was weakened. Final UI native V5 passed all five tests with explicit Windows/WSL PG59476 and browser3187 clearance, zero leftover databases/roles and owned cluster/workspace/HOME cleanup. Earlier failed functional/aggregate-cleanup receipts remain preserved; this review does not attribute their port-check cause without evidence.

The backend's post-COMMIT expiry finding came from the other worker's separate review. I implemented its service and internal-guard repair, so those backend files are expressly excluded from my independent implementation verdict. Here I inspected only the other worker's dispatcher wiring to that guard. The separate BACKEND-ADVERSARIAL-REVIEW.md is the authority for backend acceptance.

## Evidence and limits

Independently ran tests/app/reference-review-client.test.ts and tests/app/reference-review-runtime-config.test.ts: 9/9 passed. Local evidence: .local-logs/finkel-independent-runtime-ui-units-v1.log. Inspected native UI assertions for actual generated synthetic playback, desktop/phone no-overflow, separate persisted checks, departure/quiet return, unsaved navigation, revocation of held fetch and synchronous expiry. Reused the other worker's completed native V5 result; did not duplicate the native browser run. Root separately accepted desktop/phone captures.

Runtime source/CI/deployment/provider and real-batch admission are separate gates. The internal final guard denies elapsed session/batch deadlines and aborted requests after pool cleanup; it does not open another authorization pool. Final live DB authorization locks necessarily end before response delivery. Already delivered private bytes cannot be recalled. Actual whole-clip privacy/text/musical/rights/listening acceptance and future fine timings remain open.

## Accepted source hashes

| File | SHA-256 of working bytes |
| --- | --- |
| src/server/runtime/config.ts | 4ce437f3b5eb6053c3ae063e9bc184c9504a0fe6067f89c4c854e2fec2b5925b |
| src/server/runtime/composition.ts | fa4c9fd534b2fc39c31bbd4645b7ed8ba57146b685689b7d25b03b8fc083865f |
| src/server/http/dispatch.ts | ed4f390e92667eb82cc1a49cfb862d6a11f26ea57aeb88adfd802b20d9a81f59 |
| src/components/portal/workspace/reference-review/api.ts | 18b33311a69dfe34add27a091ce240668a867c505c1937f14789ec5263f1b638 |
| src/components/portal/workspace/reference-review/workspace.tsx | 356bdc81224aa9c7c2e218c746499d7f9fc81fda768ccc83a1e7410b07e6f49c |
| src/components/portal/workspace/reference-review/review.module.css | 1bfc55e07d030b96bca8286916dff18d32eefacd9b4f34aa4bdcec38e29e9bda |
| src/app/workspace/admin/reference-review/page.tsx | 9d4ea86b694392d3c7492e0b280531506ec9a8c4e9e2d3a413f47b4da2bae260 |
| src/components/portal/workspace/admin-nav.tsx | cd561214f3721a9e692a46799f0f3c7da14b29189e483603e7168dbd7b31ba17 |
| tests/app/reference-review-client.test.ts | 2d295bbf5f4e015c4731a804b3a74050026a441c90ebb7228df0a92949637707 |
| tests/app/reference-review-runtime-config.test.ts | 41774e209a2fbdc0614c41d5bdc57821bd3fa0ccc9e634c4cf24786ffee3b91f |
| tests/http-browser/reference-review-ui.test.ts | 34f9c1125368bb2e1dbdbdb3c5edb3076110f8657265021801876db200182e58 |
| tests/http-browser/fixture.ts | ed28dc24bdb3838f41aaed831e831d8be43fe424c44a675f163121fff3f7e047 |
| tests/http-browser/server.ts | ee25a465a85d76da8a279df87e7f7cf1e2e4c388ea645941f58ec157b8e3188d |
| tests/app/portal-routes-fixture.ts | 5ae0033041f74e19aa7d1bc4816bb4d24a8752f72895d48598f601977b886f9a |

## 2026-10-21 canonical-text and credit amendment

A second independent pass found that the private review UI displayed canonical MAM Hebrew without its edition/source/license/change attribution. The original GO missed this admission-readiness issue. Actual canonical text had not been admitted. The implementation worker added a static MAM-only credit using the existing studyEditions.mam constant, plus the truthful collection-level credit “Teaching collection shared by Cantor Josh Finkel.” It makes no performer claim, displays no JPS translation/credit, retains safe HTTPS/new-window links and does not consume any private provenance strings. I independently reviewed this correction and its DOM/SSR test: GO.

PhaseA also exposed a real canonical-reader blocker: one English verse outside the selected haftarah excerpt used Sefaria’s inert poetry/indentAllDouble wrapper. The unchanged reader correctly rejected the whole chapter under its previous closed class contract. The worker added only the literal indentAllDouble token to the existing English inert class allowlist. No tags, attributes, Hebrew semantics or text interpretation changed. Synthetic tests preserve nested text and ordinary line breaks, reject unknown/prefix classes and title/style/onclick, and retain Hebrew refusal. I independently reviewed the exact four-file source/test diff: GO.

Independently ran normalization, Hebrew trivial-markup, review-client and credit suites in the isolated canonical-text checkout: 86/86 passed. Evidence: .local-logs/canonical-text-and-credit-independent-review-v1.log. No licensed source text or real media was added to the repository. Existing integration/CI/provider gates still apply; phaseA must rerun against the final integrated reader source rather than bypassing its validation.

These hashes supersede the earlier workspace.tsx hash for this amendment and add the three other reviewed files. Other previously accepted runtime/UI sources remain unchanged.

| File | SHA-256 of amended working bytes |
| --- | --- |
| src/server/study/normalize.ts | 53744ac8d6cfd6872f6a29fea423067458913714cc49ed9871f8b08c48e5a8cb |
| tests/app/study-normalize.test.ts | a85eecb01149e22e5d344b5d2b765409acb819ce8e8e63368dbcd1358596b663 |
| src/components/portal/workspace/reference-review/workspace.tsx | d565e2ed11af94576e58447e3d91570d881d7376b88e8b2738217ffbd87f4a38 |
| tests/app/reference-review-credits.test.ts | b41d6ac85e73cbf50d4a636c4b4a1e8027febe6d3d45d6de0b54250095c3eccd |
