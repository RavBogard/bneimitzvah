# Identity-representation write proof â€” author return

## Source and scope

Based on root architecture checkpoint0cfdd8a and accepted identity design (spec blob653775b2). Bounded three-file source slice: scripts/private-media-single-write-probe.mjs, new tests/private-media-identity-write-probe.test.mjs and this return. Root/peer files are preserved. No provider/credential/journal/operator/database action, actual upload, route/UI/schema/package/dependency change or push.

The original single-write function/selection and read-only runner remain byte-identical to53a31dd (normalized only for checkout LF/CRLF comparison in tests). Their APIs and behavior remain available. CLI gains the exact separately selected mode single-write-identity-v2; new export PRIVATE_MEDIA_IDENTITY_WRITE_PROBE carries schema private-media-single-write-identity/v2 and all unchanged fixed writer limits/phases/store. runPrivateMediaIdentityWriteProbe uses the existing dependency seams.

## Behavior

Validate exact three existing flags, mode/store/canonical run UUID and mixed-old-probe refusal before identity/SDK/fetch work. Default remains silent. A lazy live facade translates only the validated mode for the old writer; it never copies environment values, inspects NODE_OPTIONS or changes the process mode/global fetch/dispatcher. Future guard keys remain visible. Only existing native guard effects (unused static-token deletion and retries0) are preserved.

The local verification GET wrapper accepts the frozen confined normal/held URL and exact original closed request options/strong If-Match, then adds ONLY Accept-Encoding: identity. It requires a present exact response URL and refuses ANY Content-Encoding header (including empty or identity) before the old verifier receives the response. Rejected or late-aborted response bodies are cancelled with caught nonawaited cleanup, including rejecting/nonsettling cancellation. SDK/PUT adapter traffic is unchanged.

All old200/MIME/exact Content-Length/strong tag/metadata tag/body EOF/hash/deadline/context checks remain unchanged. Output changes only schema, preserving all check/race/evidence/outcome/reconciliation values; inconclusive stays inconclusive. No decoded encoded-body fallback, range retry, weaker tag, alternative key or automatic cleanup replay.

## Verification and history

- Author11/11 first-pass: .local-logs/identity-write-author.log,2552.42ms. No failing author case or product correction after a frozen review. A pre-freeze exact-key comparison tightening was followed by the final composed run.
- Final composed98/98 across11 files: .local-logs/identity-write-final-composed.log,2784.76ms. Includes prior OIDC/object/write/read author+independent suites and new11. Covers both mocked OCC winners, prefix-only inconclusive evidence, every Content-Encoding form, missing/nonexact URL, rejected/nonsettling cancellation, unchanged status/MIME/length/strong-tag/hash refusal, late fetch cleanup, lazy guard propagation, exact CLI and old source preservation. No native-provider behavior claim.
- Final typecheck exit0: .local-logs/identity-write-final-typecheck.log.
- Final disabled/default production build exit0: .local-logs/identity-write-final-build.log.
- Staged repository protection3/3 PASS: .local-logs/identity-write-staged-guard.log. Final diff check passes; this result-only return update is rechecked before commit.

Independent identity source/adversarial review and root broader/exact hosted gates remain pending. Failed source8c/native round stays failed and immutable. The known-U read/header observations do not pass the held-write premise. No new native round, replay, release or real learner-media readiness is authorized by this return; root owns all operation and integration decisions.
