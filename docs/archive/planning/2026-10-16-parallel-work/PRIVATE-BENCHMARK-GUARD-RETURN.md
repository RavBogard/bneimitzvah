# Private benchmark guard return — 2026-10-16

Status: bounded root patch ready for independent review; no stage/commit performed. Recording files remain frozen and untouched by this assignment. Root/UI/voice integration is not performed here.

## Scope and implementation

Read [GUARD-INTEGRATION-REVIEW.md](GUARD-INTEGRATION-REVIEW.md) and its ignored union/reproduction/probe evidence in `.local-logs/parallel-guard-review/`. The reported escaped-key case is addressed in the original checkout through:

- `scripts/private-benchmark-policy.mjs`: preserves voice's literal data-only schema matcher (including malformed literal data), then decodes bounded valid JSON and line-delimited JSON to recognize escaped keys/values and nested object/array records. Schema families are `chant-benchmark-(input|pack|identity|run)/`, `chant-human-<lowercase-name>/` and `chant-listening-<lowercase-name>/`, matching the reviewed voice family syntax. A string merely mentioning a schema is not a record.
- `scripts/repo-policy.mjs`: only imports the helper and adds its fixed finding once in `entryProblems`. Existing candidate/index scanning, ordinary credential/license/email/binary/path rules and root font-pair logic are unchanged. Both index and worktree content, including exact font notices, reach the same helper. Existing font-byte integrity rules still run.
- `tests/private-benchmark-policy.test.mjs`: twelve synthetic regression groups covering the decoded boundary and actual Git staging behavior.

The helper checks JSON objects/arrays that parse as whole content even under source extensions. Ordinary JS/TS imports/declarations/test strings are not treated as records. DATA paths also retain the literal malformed-data rule and attempt each valid line independently after whole-content parsing fails; an invalid neighboring line cannot hide a valid private record. This includes JSON/JSONL/NDJSON and the existing CSV/TSV/TXT data-extension set. No decoded record or parse error is returned in diagnostics.

Independent-review correction: common exports with a leading UTF-8 BOM previously bypassed escaped-schema decoding because `JSON.parse` rejects that framing. Inspection now removes only an initial U+FEFF from the whole candidate and from individual JSONL records; it never modifies files or removes BOM characters inside quoted/content values. Whole raw JSON under source extensions gets the same framing recognition. Byte budgets count the original UTF-8 source, including the BOM's three bytes. Ordinary BOM-prefixed JavaScript remains source rather than data. This is a narrow framing correction, not a general encoding-normalization policy.

Fixed engineering budgets are 4 MiB UTF-8 source bytes, 64 bracket-nesting levels and 100,000 tree nodes across the full candidate (including all line records). A nonrecursive quote/escape-aware depth check precedes JSON decoding; traversal is iterative with bounded scheduled nodes. Data-like over-budget candidates fail closed with the fixed `private benchmark inspection budget exceeded` finding, rather than silently skipping escaped content. Malformed data may conservatively hit a budget too. Bounds limit this added decoder, not every inherited content scanner or repository read.

The root diff is deliberately separate from the later UI font union: **root `missingFontPair` is unchanged**. When UI is frozen, root still needs to carry its family-aware font-pair implementation, exact registry/assets/notices/attributes and tests together, while preserving this helper call. If voice's literal rule is also cherry-picked later, resolve that overlap by retaining this helper's compatible literal check without adding duplicate findings. No active Claude checkout or font/source asset was modified here.

## Verification

All subprocess test launches use `tests/helpers/isolatedEnv.mjs`. Synthetic Git mutations occur only in disposable OS-temp repositories; no original index/branch mutation, network/provider operation, real recording or private corpus was used.

- Initial corrected combined run: 33 passed. After the independent BOM correction, final combined focused Node run: **35 passed / 0 failed**, 8,619 ms reported duration. Files: `tests/repo-policy.test.mjs`, `tests/repo-policy-review.test.mjs`, `tests/font-assets-policy.test.mjs`, `tests/private-benchmark-policy.test.mjs`.
- `node --check` passes for all three changed/new source/test modules.
- New coverage includes nine schema families across admitted engine/fixture/config/exact-notice paths; escaped key/value and slash; nested arrays/objects; valid and mixed line records; raw JSON with source extensions; legitimate source declarations; actual public package/TypeScript/Impeccable configs and current JSON fixtures; exact/over byte/depth/node budgets (including cumulative line nodes); candidate-private/index-safe and candidate-safe/index-private directions; index-only deleted files; fixed diagnostics without payload echo.
- BOM correction coverage adds whole/individual-line framing, admitted and source-extension paths, original-byte budgets at/over the BOM-inclusive boundary, ordinary BOM-prefixed source and preservation of quoted BOM values. Both staged-direction/index-only regressions now use BOM-framed escaped private records, including a per-line BOM JSONL case.

Initial run limitation: an oversized unbroken synthetic string passed to full `entryProblems` exercised the inherited email regex's long-token performance before this helper. Only that identified test child was stopped after approximately 84 seconds; its run reported 23 other tests passed and the terminated file failed. The integration boundary test now uses whitespace filler to avoid broadening this assignment into email-regex repair; pure helper tests still use exact/over multi-megabyte strings and UTF-8 byte limits. The final 33-test run is green. This is a real inherited performance follow-up, not evidence that the entire existing guard is resource-bounded.

No actual-repository guard, complete Node/app suite, hosted CI, UI-family union or deployment is claimed by this focused return. Root owns final integrated-tree gates.

## Frozen source pins (SHA-256, actual worktree bytes)

| File | SHA-256 |
| --- | --- |
| scripts/repo-policy.mjs | FAF1C4AF7FD728888F02BEFEF328FF3F623180B6FC2D3D3E1EAEF970F7CCE8BF |
| scripts/private-benchmark-policy.mjs | 9C2666693BD1E45C2258547BE51A7DE049A8DC1018B42431015E5AC7F2E85D45 |
| tests/private-benchmark-policy.test.mjs | 2FB73C43B33BE673C7E4EDD5A95A3E89F4CCEE5CA4F962B85AB25EC9C163C299 |

## Next action

Root assigns independent adversarial review of this exact patch, then runs the original checkout's actual guard and required final integration gates. Keep the escaped-schema reproduction, index/candidate independence and font-integrity regression evidence in that review. UI/voice should be integrated only from their separately frozen checkpoints using the reviewed minimal union. Consider the inherited email-regex performance issue as a separately bounded follow-up; this patch does not change unrelated privacy/size policy.
