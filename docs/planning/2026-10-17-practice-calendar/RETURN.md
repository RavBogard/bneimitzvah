# Calendar store correction return

Base frozen calendar integration: `75dbf54`, branch `codex/practice-calendar-integration`. Two independently reproduced client-state defects corrected, with no styling, copy, layout, server or provider changes.

- A visit returning definite 401/403/404 now disables the local selection immediately, aborts concurrent work and discards retained private dates. Pending acknowledgements cannot restore dates; later local loads/visits send nothing until a fresh external configure. No automatic access check, refresh loop or queued/replayed visit is introduced.
- Stale-material reload allowance is keyed to actual verse assignment kind/id/revision or service catalog id/identity and plan id/revision, within the selected student/context scope. Same-version failures across refreshes and successful unrelated visits do not renew it. A changed service plan/catalog or reading version gets its own allowance. Different units/verses within one material version do not each trigger reloads.

Owned source: `src/components/portal/workspace/practice-calendar/store.ts`; ordinary regression additions: `tests/app/practice-calendar-client.test.ts`. Independent reviewer file `tests/app/practice-calendar-review.test.ts` is preserved unchanged and is not part of the author's commit.

Verification:

- `node .local-logs/run-isolated.mjs calendar-store-focused node node_modules/vitest/vitest.mjs run --config .local-logs/vitest-study.mts tests/app/practice-calendar-client.test.ts tests/app/practice-calendar-review.test.ts`: **17/17**, 214ms (12 ordinary + 5 independently authored cases). Author executed these; independent browser/source acceptance remains a separate gate. Log `.local-logs/calendar-store-focused.log`.
- `node .local-logs/run-isolated.mjs calendar-store-typecheck npm run typecheck`: **PASS**; log `.local-logs/calendar-store-typecheck.log`.
- Impeccable context ran once for this target/check-out; hardening and craft-floor references read before edit. Scoped mechanical detector ran once: **no findings**, `.local-logs/calendar-store-detector.json`. Existing stale design-sidecar notice was unrelated; optional `impeccable document` refresh remains separate work, with no design documents changed here.
- `git diff --check`: **PASS**. No full app, native PostgreSQL, browser, provider or production operation was run by author for this correction.

Root owns final integration and broader gates; reviewer continues the distinct service-browser cases. Recording retention amendments belong to the separate ledger branch and are not mixed into this checkpoint.
