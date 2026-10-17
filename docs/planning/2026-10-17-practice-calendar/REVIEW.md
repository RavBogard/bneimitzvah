# Independent calendar integration review

Scope: frozen calendar `75dbf54` (Claude `d8644ef`) on reviewed MAM `8f8abc5`, followed by corrective source `daebd92e5d1e8d9736726901895636a6c77a45bb`. No recording migration 0020 is present in this candidate. Review covers the eleven calendar integration files and the narrow correction, not a new backend or whole-project audit.

## Findings and correction

Two source findings were independently reproduced before correction:

- A definite own-student visit denial (401/403/404) left the calendar ready with retained private dates. Calendar requests intentionally bypass provider refresh-on-denial; the store therefore must clear locally. The correction calls `configure(null)`, aborting pending work, removing dates and disabling local subsequent loads/visits without an automatic refresh loop.
- Stale-material suppression used one boolean whose scope omitted service-plan revisions. After one stale service visit, a later plan revision could fail without requesting fresh material. The correction uses a per-material-version set, including the complete service catalog/plan identity and revision or verse kind/assignment identity and revision. Same-material refreshes and unrelated successful visits do not renew the allowance; new material gets one reload.

Initial independent app run: **11 passed, 4 failed** (existing ten passed, independent late-result test passed; the three denial variants and new service revision failed). After correction: **17/17 passed** across the same five independent regressions and twelve author client tests. No independent test assertion was removed to obtain this result.

## Source conclusions

The client requests only the dates-only calendar, never raw event GET. Strict response parsing binds mode/student/window and rejects additional DTO fields. Visits use a new UUID and the server's returned day; only explicit successfully opened assigned verses or selected service units report `visit`. Automatic load, service choice restoration and access refresh do not report activity. Exact assignment or catalog/plan/unit metadata is carried to the existing server authority checks. There is no offline queue, automatic resend, duration, play/record inference, or role escalation.

The provider retains pre/post session checks and child handle/generation/route fences. Calendar work participates in existing conceal/clear lifecycle; store generations and aborts reject late sibling/context results. Parent/tutor/admin views do not gain this calendar placement through overlapping grants. These conclusions are bounded source findings; runtime evidence is recorded separately below.

## Independent checks

Commands in `C:/Users/dsbog/.codex/worktrees/study-markup-repair/bneimitzvah`:

```text
node .local-logs/run-isolated.mjs calendar-independent-app-first node node_modules/vitest/vitest.mjs run --config .local-logs/vitest-study.mts tests/app/practice-calendar-review.test.ts tests/app/practice-calendar-client.test.ts
node .local-logs/run-isolated.mjs calendar-independent-final-app node node_modules/vitest/vitest.mjs run --config .local-logs/vitest-study.mts tests/app/practice-calendar-review.test.ts tests/app/practice-calendar-client.test.ts
node .local-logs/run-isolated.mjs calendar-independent-typecheck-final node node_modules/typescript/bin/tsc --noEmit
```

Final client run: 17/17, 192 ms. Final composed typecheck passes, including the new service browser file. A first typecheck caught an owned fixture's string-vs-Buffer seed error; only that fixture was corrected, with no product change. Logs remain ignored under `.local-logs/`.

## Runtime and remaining gates

The initial coordinated five-case browser batch failed **0/5 before calendar assertions**: all cases stopped at synthetic sign-in navigation after Turbopack reported that `next/package.json` resolved outside its checkout root through the external dependency junction. This provides no calendar behavior result. Exact server bytes were restored and the owned diagnostic role removed. Root authorized a real checkout-local `npm ci`; the junction itself was moved into ignored logs without changing its target, and the install completed (203 packages, 56 s), with package-lock and application configuration unchanged. No Turbopack-root workaround or assertion weakening was used.

With real local dependencies, the five-case batch completed **3 passed / 2 failed**, 60.57 s. The existing calendar three passed. The two independent service failures were owned test defects: querying persisted events immediately after observing a request (before the second 200 commit acknowledgement), and targeting a child card absent in practice mode rather than the existing `Switch practice to Synthetic Sibling` button. The test now waits for the actual second 200 before querying, uses the real switch control, and checks the parent chooser/URL after return (parent remount intentionally has no selected child). Exact bindings, request counts, persisted targets, zero raw GET, held-response completion and sibling privacy assertions remain. Product source is unchanged. Final composed typecheck passes after these corrections.

Affected service confirmation passed **2/2, 13.96 s**, at unchanged `daebd92`. Thus cumulative actual coverage is existing three passed plus corrected service two; it is not a single five-green run. The service cases verified actual restricted PostgreSQL service bindings and persisted target rows, no initial/restored visits, held same-authority concealment, committed old-child POST followed by real sibling switch, completed late response handling without marking the sibling, no raw GET, and parent chooser/URL clearing. Both runtime attempts reported exact server-byte restoration and owned diagnostic role removal. Final diffs of server, tsconfig, package-lock and Next configuration are empty. The exclusive native/browser lane is released.

```text
node .local-logs/frozen-browser-isolated.mjs practice-calendar-independent tests/http-browser/practice-calendar-ui.test.ts tests/http-browser/practice-calendar-service-review.test.ts
node .local-logs/frozen-browser-isolated.mjs practice-calendar-local-deps tests/http-browser/practice-calendar-ui.test.ts tests/http-browser/practice-calendar-service-review.test.ts
node .local-logs/frozen-browser-isolated.mjs practice-calendar-service-corrected tests/http-browser/practice-calendar-service-review.test.ts
node .local-logs/run-isolated.mjs calendar-independent-typecheck-complete node node_modules/typescript/bin/tsc --noEmit
```

Final independent test Git blobs: app `c4884cd6dddd8cdb0b7c901878d70d9235da1865`; browser `89b941a8adae4316bcbd74c4e855852dc984444d`. Final browser file SHA-256: `286095923bc4b1d632656ced1e582b1ee1551a7007b7b75b1f602a8d28492c96`.

**Accepted for this bounded source/runtime integration review.** No unresolved blocker remains in the reviewed calendar delta. No independent broader suite or production claim is made. Root owns visual acceptance and final integration/hosted gates; Daniel's concrete student-visible calendar review remains required before production exposure. The source review reuses the accepted backend authority/retention contract; this task neither changes it nor independently reruns its full PostgreSQL suite.
