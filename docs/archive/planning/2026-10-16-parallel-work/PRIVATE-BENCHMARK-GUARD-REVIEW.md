# Independent private benchmark guard review — 2026-10-16

**Accept the frozen repair below.** The escaped-JSON gap reported in `GUARD-INTEGRATION-REVIEW.md` is resolved for the supported decoded records, including leading-BOM exports. No blocking finding remains in this bounded patch. Root can run its exact-tree integration gates; this review does not apply the UI/voice union to any live branch.

The reviewer changed no implementation source, author tests, active Claude checkout, font bytes, recording files, Git index or branch. Owned additions are this report, `tests/private-benchmark-policy-adversarial.test.mjs` and ignored `.local-logs/private-benchmark-review/` evidence. Inputs were synthetic or existing public test/config/font assets; no network, provider, model, recording or private corpus operation occurred.

## Source disposition

- Root `scripts/repo-policy.mjs` has only the helper import and one fixed-finding call added to `entryProblems`. Existing path, attachment, credential, email, licensed-marker, binary, migration-metadata, font-integrity and candidate/index logic is unchanged. The root's original single-family font-pair function is also unchanged; UI's family-aware union still belongs to later integration.
- `scripts/private-benchmark-policy.mjs` retains voice's exact literal schema-family matcher for DATA paths, including malformed literal data. It additionally decodes valid JSON, walks nested objects/arrays iteratively and checks actual decoded string `schema` values. JSON/JSONL/NDJSON and existing data extensions receive line-record fallback after whole-content parsing fails; malformed neighboring lines cannot hide a separately valid private record.
- A whole JSON object/array is recognized under source extensions. Ordinary declarations, quoted fixture strings, comments and JavaScript blocks remain source. JSON-looking text that fails to parse under a source extension is intentionally outside the decoded-record rule; data paths still retain the inherited literal rule.
- Fixed limits are 4 MiB of original UTF-8 text, 64 bracket-nesting levels and 100,000 traversal nodes across whole/line records. Over-budget data-like input rejects with a fixed finding. Brackets/escaped quotes in JSON strings do not consume structural depth. Malformed prefixes that defeat the preliminary lexical depth estimate still encounter the iterative traversal depth/node bounds for parsed line records. No recursive walk or candidate-derived diagnostic escapes the helper.
- The reviewer identified the leading-BOM edge during source review. Root explicitly chose to protect common BOM-framed exports; the author corrected it before the first independent execution. Only a leading U+FEFF of the whole content or individual line record is removed for inspection. The original three UTF-8 BOM bytes still count toward the byte bound; quoted/content BOMs and legitimate BOM-prefixed source code are preserved. No broad encoding normalization is introduced.

The exported helper receives strings from the existing `entryProblems` conversion. It is an internal content inspector, not an unknown-value transport validator or a replacement for the whole repository guard.

## Executed evidence

**42/42 focused Node tests pass on the frozen root repair**, including seven reviewer-authored adversarial groups. Hashes were stable before and after execution. This run happened after the BOM correction and matches the final author freeze; the local filename `initial-focused.log` reflects the driver stage label, not a pre-correction test failure.

**44/44 pass in a fresh OS-temp union overlay** using the repaired root policy/helper plus UI's previously saved two-family registry, bytes, notices, attributes and expanded font tests. Only the `missingFontPair` body was replaced with the previously reviewed family loop. This reuses the saved snapshot from the earlier guard review, avoiding active UI files. Overlay: `C:/Users/dsbog/AppData/Local/Temp/decoded-schema-font-union-qwUp7q`; combined policy SHA-256 with LF source newlines: `ce841d87d9130d78a1a87be775af8d7d9204f92fd627b674b3cd9b5abd1a5b0e`.

Executed checks cover:

1. Fully Unicode-escaped keys and schema values, escaped slashes, nested arrays/objects, prototype-shaped JSON keys and quote/bracket strings. Parsed data does not modify `Object.prototype`.
2. Mixed valid/invalid JSON lines, including unmatched closing brackets or an unfinished quote before a later valid record; malformed neighbors cannot hide a private record or over-budget parsed tree.
3. Exact/over UTF-8 byte bounds, a fully escaped private marker at the final allowed byte boundary, original BOM-byte accounting, exact/over depth/node bounds and cumulative line-record nodes. Large pure-helper cases are isolated from inherited email scanning.
4. Whole raw JSON under source extensions versus legitimate code/schema declarations, fixture strings and source blocks. Public config/fixtures remain compatible in author coverage. Literal malformed-data detection remains data-only.
5. Leading BOM at whole/line records and source-extension raw JSON; BOMs inside strings remain content. An actual Git inspector fixture rejects BOM+escaped JSON in `trope/bom.json` and `trope/bom.mjs` both as candidates and staged blobs hidden by safe replacements.
6. Fully escaped private data at six admitted engine/fixture/source/font-notice paths, as untracked candidates, staged blobs behind safe replacements and index-only deleted files. The union overlay exercises both exact `OFL.txt` paths through their pinned-asset notice branch. Font candidates/index bytes still need exact pins; both families' correct official bytes, notice pairing and autocrlf round trips pass.
7. Existing attachment raw-tab/index handling, staged/candidate credential independence, generic read/Git errors, metadata checks, renamed/altered/symlink fonts and ordinary sensitive-content rules remain green.

All test/Git subprocesses receive `tests/helpers/isolatedEnv.mjs`'s environment. Review Git mutations are confined to OS-temp fixtures. Logs and hashes are in `.local-logs/private-benchmark-review/{initial-results.json,initial-focused.log,initial-bom-repro.json,union-results.json,union-focused.log}`; reproducible drivers are `run.mjs` and `union.mjs` beside them. The previous voice private-path review is reused; this patch changes no output-path code.

## Limits preserved explicitly

The author's earlier 4-MiB unbroken-token `entryProblems` probe stalled in the inherited email regex and its identified child was stopped after approximately 84 seconds. The author documented that failed/interrupted attempt and substituted whitespace filler for full-inspector boundary tests. This reviewer did not repeat that uncontrolled case. Pure-helper at/over byte tests still execute. These decoder budgets **do not establish a resource bound for existing repository reads, regex scans or the entire guard**; email-regex performance remains a separate bounded follow-up.

The schema guard remains defense in depth: unmarked per-passage private output, malformed escaped records that never decode, serialized JSON inside ordinary strings, and arbitrary source code are not generally classified as private records by this patch. Existing private output-path containment remains essential. Strict decoded JSON plus leading-BOM framing is the contract; this review does not add other encodings, alternate delimiters, relaxed JSON syntax or a broad secret-scanner rewrite.

No full Node/app suite, actual root repository guard, type/build, hosted CI, deployment or release was run by this reviewer. Those exact-final-tree checks remain root's integration work. UI later commits require comparison with the saved font pins from `GUARD-INTEGRATION-REVIEW.md`; this synthetic overlay does not attest to a changing UI branch.

## Frozen SHA-256 pins

Actual worktree bytes:

| File | SHA-256 |
| --- | --- |
| `scripts/repo-policy.mjs` | `faf1c4af7fd728888f02befef328ff3f623180b6fc2d3d3e1eaef970f7cce8bf` |
| `scripts/private-benchmark-policy.mjs` | `9c2666693bd1e45c2258547be51a7de049a8dc1018b42431015e5ac7f2e85d45` |
| `tests/private-benchmark-policy.test.mjs` | `2fb73c43b33be673c7e4edd5a95a3e89f4ccee5ca4f962b85ab25ec9c163c299` |
| `tests/private-benchmark-policy-adversarial.test.mjs` | `d457a58cffe371eb61f2067f59167e26d869fb09a0da77d0de933f0d0afea4b8` |

**Integration recommendation:** preserve this helper import/call, helper file and both new test files. When voice's checkpoint is integrated, retain this equivalent literal check inside the helper rather than adding a duplicate direct schema check/constant. Carry UI's per-family registry/function/assets/notices/attributes/tests together as already reviewed. No implementation correction is requested on the frozen repair; root can proceed with final gates.
