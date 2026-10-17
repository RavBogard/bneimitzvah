# Independent reference-index repository protection review

**Accepted, bounded repository-protection scope.** Reviewed frozen `082833b20fff835e96c86ee4c0283fe9078cf966` in `codex/reference-audio-contract-integration`, based on released/reviewed `8f8abc5` with only corrected tooling `6cfef82`/`d63cdc4`. No product or policy source was changed by this reviewer. No blocker found.

The five added policy lines recognize exactly schema `pockettorah-verse-index/v1` and return fixed `private reference-audio index`. They reuse the existing single `privateBenchmarkProblem` call in `entryProblems`; there is no second parser, added exemption, schema-prefix expansion or changed publication path. Shared decoded traversal covers escaped keys/values, nested objects/arrays and BOM framing. Existing data-only malformed-literal and per-line JSON fallback remain active. Public code declarations, comments and JSON-looking string values remain code/content, rather than fabricated schema-bearing records.

Inspection limits remain4MiB/64levels/100000nodes, with bounded iterative traversal and fixed diagnostics; no private snippets cross the result boundary. `scripts/repo-policy.mjs` is unchanged: worktree candidates and indexed blobs are inspected independently, allow-listed fixtures/font notices still receive content checks, and private `.local-data` classification precedes content conversion/read. Ignored local data is excluded from publication candidates; forced indexing is rejected without disclosing its file names. Font-byte/paired-family checks and benchmark-family protection remain intact.

Independent execution:

```text
node .local-logs/run-isolated.mjs reference-guard-independent node --test tests/repo-policy.test.mjs tests/private-benchmark-policy.test.mjs tests/private-benchmark-policy-adversarial.test.mjs tests/reference-index-guard-review.test.mjs
```

**35/35 passed, 1.91s**, no failures/skips; ignored log `.local-logs/reference-guard-independent.log`. The three new independent synthetic cases test every character escaped, prototype-shaped nesting, BOM whole/line framing, all reviewed data extensions, raw JSON under source extensions, nearby nonmatching schemas and code-string false positives. They retain the existing budgets and prove path-first classification with a content object that throws if converted. A disposable Git fixture verifies candidate, safe-replaced working copy with prohibited index, index-only, ignored private input and forced-index private-directory rejection. Every Git subprocess uses the actual `isolatedEnv` environment; temporary repository and environment cleanup are awaited in `finally`.

Reviewed predicate Git blob `d6235627d7b324b2c68700ea9b50f0d49255db11`; independent test blob `7cec00f93d779d6939ed27efaa90f46333019576`. `git diff --check` passes. No full Node rerun was needed: author's reported243/243 full Node, focused38, staged protection3 and root's original three synthetic repros remain separately attributed prior evidence. The corrected24-case standalone ingestion contract is reused unchanged, not represented as a new independent player/runtime review.

No actual private index, audio, licensed text, family data, provider or PostgreSQL was accessed. This acceptance does not authorize player delivery, hosting/registry, licence/spend decisions, generated chant, storage or production. Root owns final integration and exact hosted gates.
