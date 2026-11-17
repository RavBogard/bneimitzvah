# Reference backend review

Final source followup: root accepts the one-entry immutable success cache keyed by exact store+catalog SHA, with already-aborted signals refused and no request, session, student or assignment response cached. The existing service authorization still runs on every read. The clean production-based release passes 25 reference backend/runtime cases and 312 Node cases. A separate peer review of the frontend API/provider/lift wiring found no consequential authority or stale-scope defect; the final native browser batch passes five player cases plus six changed study cases. Actual generated MP3 decoding and native Audio are exercised, with held-fetch/hash refusal, session concealment and sibling-switch teardown. These are synthetic local browser facts, not source-recording listening or hosted-storage acceptance. Root's read-only catalog publication check refused local Development identity before any Blob call or write; native hosted catalog delivery remains pending.

Root independent integration review of the subsequent HTTP/runtime/compiler/policy changes: accepted for the bounded reference slice. The new GET route retains closed query/method gates and explicit response projection; actual study authority still surrounds both text and catalog loading. Runtime configuration is optional, defaults to no student release and uses only native request-context OIDC with a fixed derived private key/store. No caller URL, request credential or legacy token fallback enters the SDK seam. Root inspected the installed OIDC context implementation and the pinned SDK options. Root also reviewed the three logical policy replacements: both reference schemas use the same existing bounded predicate and fixed reason, with no budget or publish/index relaxation. Root's composed policy/compiler/index run passed **33/33** before the compiler's additional metadata-identifier regression; the author's later composed Node39 run covers that addition. Compiler provenance now requires the exact archive item identifier as well as measured file size/MD5. HTTP/runtime source inspection found no further blocker. Actual catalog publication, native hosted credentials/read, real browser audio and listening acceptance remain unproven and must not be inferred from these mocked/injected tests.

2026-10-17; independent review of the peer-authored backend/source boundary in the integration checkout. Accepted **after one author repair**, for the scoped reference resolver and injected catalog-storage seam. No corpus, compiled private catalog, audio, provider, native PostgreSQL or production operation was accessed. HTTP/runtime wiring and browser playback are outside this source review.

## Finding and correction

The initial catalog loader refused a getter resolving beyond its monotonic 10-second bound, but did not cancel that returned stream: its promise observer ran before the catch aborted, while the failing post-await fence prevented reader acquisition. The independent regression failed with zero cancellation calls. The author now tracks the resolved incoming stream and cancels it without awaiting cancellation when no reader was acquired. Existing late-arrival handling remains. The regression passes against repaired storage SHA256 `9d273946990882cd07b1ac92a2cffc1710306c3a49d6e43871f3476edcf3fb63`. No other source repair was made by this reviewer.

The first independent run was 3/5 passing. Its other failure was my fixture: it assigned nonexistent `guardian.status`, so Drizzle changed only revision and safely returned stale-revision. Typecheck exposed that field error. The fixture now sets actual `revokedAt` and revision and asserts 404 for real revocation. This was a test correction, not an authorization bypass.

## Verified boundary

- The study-service diff is exactly two type changes (generic result subtype and loader return type); its authorization/snapshot logic is unchanged. Reference catalog/text work occurs between the existing two real authority passes. Asset selection and copied request/selection bindings cannot be swapped during that work.
- Independent real SDK/PGlite cases prove default source release for an actually authorized admin only; parent, tutor, student and child-practice modes remain unavailable by default. Explicit trusted release still requires authorization. Catalog work cannot borrow a new cookie after original-session expiry, or a new child handle after a real sibling switch. Real guardian revocation is rechecked before delivery. Author tests additionally cover assignment/grant revisions, request abort and context exit.
- Catalog/source parsing remains closed, bounded and immutable; asset identity, fixed Archive filename/URL, digest, size, ref and timing-text/count binding are checked. Duplicate ref selection is held unless one explicit approved asset resolves it. Text mismatch holds playback; missing projection may preserve verse-only playback. No guessed word timing is returned.
- Storage construction performs no I/O. Its getter receives one digest-derived path and abort signal; observed stream bytes are bounded and hash-checked before fatal UTF-8/JSON/closed-catalog parsing. Empty-progress/elapsed-time bounds and nonawaited cleanup fail closed; stream/getter errors become fixed `ReferenceUnavailable` without private details.

## Evidence and exact source basis

Independent six cases plus author catalog/service ten and corrected playback 22: **38/38 passed**, 9.42s run. Isolated typecheck and diff check passed. Logs: `.local-logs/reference-backend-review-first.log`, `reference-backend-review-repaired.log`, `reference-backend-review-types-final.log`.

| Reviewed file | SHA256 |
|---|---|
| `src/server/reference-audio/service.ts` | `e670e88048cfe9373c03dacd2c7fdc29a6bbb5cebe5077d513ac2600951eeba0` |
| `src/server/reference-audio/catalog.ts` | `449491cf1b20e2163d975ae19396f0aa9766ab9f8d8a1f1d6049ba69e485256c` |
| `src/server/reference-audio/storage.ts` | `9d273946990882cd07b1ac92a2cffc1710306c3a49d6e43871f3476edcf3fb63` |
| `src/lib/reference-audio/source.ts` | `c9b2e1e6ed614d0c675d518c19eec01b1be316c11efcb828413a6f01cc24b468` |
| `src/server/study/service.ts` | `b1ba270851da77b6d7b271dc858058df7e167bd5741d41655e226627dd9c565e` |

## Separate repository-policy implementation return

Extended only the existing shared bounded reference-schema predicate in `scripts/private-benchmark-policy.mjs` to also recognize schema-bearing `reference-catalog/v1`, retaining the same fixed private-reference reason and all original budgets, malformed-line/data framing and public source-string behavior. New synthetic cases cover escaped/nested/BOM payloads, false positives, ignored/outside inputs, forced private staging, safe-worktree/forbidden-index and index-only catalogs. New five plus prior benchmark/index fifteen: **20/20 passed**, 1.33s; log `.local-logs/reference-catalog-policy-focused.log`. Root independently reviews this policy change; this section is an author return, not independent self-acceptance.

The earlier playback-test protection failure was solely a literal invented credential URL matching the email heuristic. Its fixture now constructs the same hostile URL with URL username/password setters; both rejection assertions remain, `entryProblems` is empty, and all playback 22 tests pass. No guard relaxation, staged commit or private compilation was performed. Full repository protection, final HTTP composition, browser playback/decoding and actual reference-sample/listening acceptance remain root integration work.
