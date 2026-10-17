# Ketiv/qere child-order repair

Branch `codex/study-kq-order`, based on released `8f8abc5`. Only the normalizer, two existing synthetic test files and this return changed. The unrelated untracked calendar review note is preserved.

`normalizeHebrew` still requires exactly two non-whitespace children of `span.mam-kq`. It validates both elements/attributes, then identifies exactly one `span.mam-kq-k` and one `span.mam-kq-q` by their exact class instead of position. Either child order yields the identical written/read alternative. Existing nonempty, Hebrew, bracket, control and nested-markup checks remain. Duplicate classes/sides, missing/empty sides, extra children/non-whitespace text, unknown nested semantics or extra attributes reject. Standalone ketiv remains unsupported; no DTO/cache/projection/rendering change is made.

Synthetic regressions cover ordinary/reversed/mixed pairs, multiword qere and maqaf, exact text and reading reconstruction, contiguous spoken indexes and every source span, complete normalized-cache roundtrip and strict client-parser roundtrip. A reversed pair outside the selected verse no longer poisons its requested chapter page; malformed unselected pairs still reject. The incoming structure-only report informed the shape; no private MAM/index/audio content or live provider was read, and its aggregate counts were not remeasured.

- Final focused command: `node .local-logs/run-isolated.mjs study-kq-order-focused-final npm run test:app -- tests/app/study-normalize.test.ts tests/app/study-sefaria.test.ts tests/app/study-annotations.test.ts tests/app/study-trivial-review.test.ts`: **115/115**, four files. Log `.local-logs/study-kq-order-focused-final.log`.
- `node .local-logs/run-isolated.mjs study-kq-order-typecheck-final npm run typecheck`: **PASS**. Log `.local-logs/study-kq-order-typecheck-final.log`.
- `git diff --check`: **PASS**. Initial focused115 passed; initial typecheck required an explicit `return invalid()` for TypeScript to narrow the found children. The final exact source passed both checks; no guard or assertion was weakened.

Existing dependencies were reused and verified at pinned Next16.4.2/Vitest5.0.5/TypeScript7.0.2/parse5 8.0.1; no install/package changes. No broad app, native PostgreSQL, browser, provider, schema, generated-audio or production operation occurred. Mandatory independent review and root integration/release gates remain; no push/deploy by this worker.
