# Plain MAM trivial-wrapper repair

Based on released `0ce58b6`, branch `codex/study-trivial-markup`; separate checkout from the unshipped recording ledger/migration0020. This change adds no schema, DTO, cache-policy, projection, frontend or provider behavior.

`src/server/study/normalize.ts` now recognizes the reviewed `span.mam-kq-trivial` shape only when its sole child is a plain text node containing Hebrew without bracket alternatives. Existing NFC/whitespace/control checks apply. It emits one text segment rather than inventing written/read alternatives. Unknown classes, extra attributes, nested elements/comments and malformed input still fail closed. Ordinary ketiv/qere remains unchanged; empty/missing alternatives remain unsupported pending source-structure review.

Evidence: the earlier source-only synthetic probe demonstrated that one rejected unassigned verse makes the requested chapter page fail with `invalid-response`. The permitted existing edge fixture contains two trivial wrappers with text-node children and no brackets; only structure was inspected, no fixture text was copied into this change. The voice stream's private aggregate verse/chapter counts were not independently verified and are not claimed here.

Focused synthetic tests cover exact text/reading reconstruction, no duplicated alternatives or spoken words, contiguous indexes, immutable segments, strict shape/control rejection, unchanged exceptional-alternative rejection, selected trivial text and recovery when an unassigned trivial verse occurs in the same fetched chapter. Hostile/unreviewed unassigned markup still rejects the chapter.

- `node .local-logs/run-isolated.mjs study-trivial-focused node node_modules/vitest/vitest.mjs run --config .local-logs/vitest-study.mts tests/app/study-normalize.test.ts tests/app/study-sefaria.test.ts`: **77/77**, two files, 434ms. Log `.local-logs/study-trivial-focused.log`.
- `node .local-logs/run-isolated.mjs study-trivial-typecheck npm run typecheck`: **PASS**. Log `.local-logs/study-trivial-typecheck.log`.
- `git diff --check`: **PASS**. Independent review and broader/exact hosted release gates are pending.

The checkout reuses the existing installed dependencies through an ignored junction; no packages were installed/updated and Vitest cache is isolated under this checkout's ignored logs. No private MAM source, recording/audio, production, provider or credential access occurred. Root owns final integration, review and release; no push/deploy was performed by this worker.
