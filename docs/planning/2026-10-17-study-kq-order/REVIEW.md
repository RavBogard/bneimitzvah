# Independent KQ child-order review

Scope: frozen `b97a5dfcfb036a373a7d3759bbcc6c3bbdb70c36`, based on reviewed/released `8f8abc5`, in `codex/study-kq-order`. Only the narrow normalizer delta and relevant synthetic tests were reviewed. No product, private corpus, provider, browser, database or schema operation was performed by this reviewer.

The semantic lookup itself is correct: exactly two non-whitespace element children must include one exact `span.mam-kq-k` and one exact `span.mam-kq-q`; with only two children, duplicates cannot satisfy both searches. Both children pass existing attribute/namespace validation before lookup. Existing Hebrew/nonempty/bracket, nested-markup and plaintext checks remain. Recognized presentational markup remains recognized; arbitrary semantic nesting, missing/empty sides and standalone ketiv remain rejected. Either order produces the same canonical alternative segment, preserving the existing DTO/cache/client contracts rather than introducing an order-bearing format.

Initial independent synthetic run: **24/25 passed**,198ms. All four two-pair order permutations passed with adjacent text, multiword qere, maqaf, a trivial form and a paragraph marker. Canonical segments and complete projections were equal; spoken indices were contiguous, and every word reconstructed exactly from its own segment/field spans. Duplicate/missing/empty/extra sides, comments, mixed semantic classes, wrong tags, extra attributes, nested semantics and encoded direction/control characters rejected as expected. Composed typecheck passed.

One inherited strict-control defect was reproduced at the changed KQ boundary: encoded `&#xfeff;` in a whitespace-only sibling is removed by `/^\s*$/` before `plain()` can enforce its explicit forbidden-BOM rule. Thus a pair containing this forbidden control is accepted, although a raw BOM or a BOM inside either side rejects. This is not introduced by the new order lookup and does not establish an authorization or reading-index defect; it prevents acceptance of the stated strict control contract until corrected. The implementer/root were notified, and the owned regression remains. Coverage was expanded to all three sibling positions in both orders (six variants). The proposed correction reuses existing `plain(value,true)` validation before whitespace classification; no new markup or semantic allowance is needed.

```text
node .local-logs/run-isolated.mjs study-kq-independent-first npm run test:app -- tests/app/study-kq-order-review.test.ts
node .local-logs/run-isolated.mjs study-kq-independent-typecheck npm run typecheck
```

## Correction and final acceptance

**Accepted at corrective freeze `9c757d34c216f56a864c0164f6e5f3a939c74ecf`.** The only further product change calls existing `plain(value,true)` before the unchanged whitespace-only classification. Therefore decoded forbidden controls cannot be discarded before validation; ordinary whitespace and both recognized side orders remain supported. No general sanitizer, extra semantic markup or side inference was added. The initial24/25 failure above remains historical evidence, not relabeled as a test defect.

Independent final commands:

```text
node .local-logs/run-isolated.mjs study-kq-independent-final npm run test:app -- tests/app/study-normalize.test.ts tests/app/study-sefaria.test.ts tests/app/study-annotations.test.ts tests/app/study-trivial-review.test.ts tests/app/study-kq-order-review.test.ts
node .local-logs/run-isolated.mjs study-kq-independent-typecheck-final npm run typecheck
```

**149/149 passed across five files,538ms; typecheck passed.** This includes all30 independent cases plus the author/existing119 cases, covering canonical normalized-cache and closed client-parser roundtrips, reversed selected/unassigned chapter recovery, and continued rejection of malformed unselected structures. All tests use invented text/HTML and mocked provider responses; no live fetch was performed. Source normalizer Git blob `0f3a5a90823e1629713b2edc84980a350dd0a348`; independent test blob `52029e4f128910e7648c2679d517568c565946a4`, SHA-256 `e3a458635da53be062f33c83474ccb175bcc954497d4b6ffa2527147648f0f3b`. `git diff --check` passes.

No unresolved blocker remains for this narrow repair. Missing/empty KQ and standalone ketiv remain held; no exceptional private structure is inferred from this synthetic review. No frontend, schema, PostgreSQL, browser, private corpus/audio, provider, broad suite or production work was added. Root owns final integration and the exact hosted gate.
