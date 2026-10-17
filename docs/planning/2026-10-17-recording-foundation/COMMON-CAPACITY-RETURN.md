# Common capacity gate source return

Implemented the accepted internal common-capacity design on base `df88793d7763a257d7e976ec8ee0f1c37bfefb1f`. Independent implementation review and root integration/hosted gates remain required. No schema, sanitizer, media transport, route, runtime, worker, provider or manifest-finalizer change; no production/native provider operation.

## Behavior and API

`recordings/capacity.ts` owns the existing exact bigint retained-byte/take/original-ID bounds. Receipt admission keeps its active/hour/day predicates and reuses this predicate; marker accounting is unchanged. Historical ledger rows, including deleting rows, remain additive to unreleased receipt liability without invented actor/rate attribution or overlapping-row subtraction.

Both registrar methods acquire existing tenant admission inside fresh authority, before any ledger work or caller callback. The exact-ID path locks at most one actual scoped OR(id,asset) match and requires the returned ID to equal the supplied ID. Implicit asset replay preserves the existing ID. A genuinely new implicit row chooses one UUID under the mutex, checks its ID and asset against immutable retained receipt reservations, and passes that same ID to `insertWithId`. Reservation collision wins even for otherwise-exact replay. Failed INSERT never replays/adopts, regenerates or retries. The unused internally generating wrapper is removed.

Only a nonoverlapping exact private/submitted replay bypasses new-cap checks; it creates no audit or added liability even above historical caps. New insertion samples database actual time after waits, rereads primary aggregates and checks exact projected student/tenant bytes, takes and IDs before INSERT/audit. Existing fresh-after-await checks and callback one-shot/poison/synchronous-close/drain remain. `RecordingRegistrationLimit` is a new server-internal fixed exception (`code: "limit"`) for either API, translated only from a per-operation exact private AccessDenied identity outside the unchanged auth sanitizer. Existing conflicts/auth denial and arbitrary SQL/audit failures remain distinct.

The callsite tripwire keeps the one low-level insertion call in the reviewed registrar and rejects common new helper/direct-table/raw-INSERT bypasses. It is a source-review aid, not a SQL privilege boundary; trusted callback SQL and arbitrary privileged SQL are not sandboxed. Future finalization still needs its separately reviewed consumed-receipt accounting contract.

## Verification

All commands use the checkout-local `.local-logs/run-isolated.mjs` scrubbed environment, or the separately guarded local native runner.

- Focused first run: new app6 + original-ID10 = **16/16**, 23.40s. Final composed run of capacity, ledger, original-ID, receipts, schema normal/review files: **52/52 across9 files**, 45.95s. Log `.local-logs/common-capacity-composed.log`.
- `node --test tests/recording-capacity-callsite.test.mjs tests/isolation.test.mjs`: **5/5**. `.local-logs/common-capacity-node.log`.
- Final typecheck and default build: **PASS**. `.local-logs/common-capacity-type-final.log`, `common-capacity-build.log`.
- Actual fresh disposable PostgreSQL16.15: corrected new capacity4 + existing original-ID5 = **9/9**, 12.44s (new4 testtime4.39s); new cases measure **5 actual pg_blocking_pids edges**. Receipt-first and registrar-first each leave only the final allowed take; the waiter freshly denies. Callback is not entered before mutex and remains unentered after real session expiry. Maintenance releases only eligible never-opened liability before registrar succeeds; independently blocked date work then settles. Exact replay adds no audit/charge. Existing blocked original-ID rollback/drain/expiry cases remain green. `.local-logs/common-capacity-native.log`.
- Affected existing receipt native10 were **10/10**, 15.12s in the initial native batch, including its original retention wait and the new measured admission→registrar wait/fresh capacity denial. Cumulative accepted native cases **19**, with the corrected4 counted once. `.local-logs/common-capacity-native-initial.log` preserves that batch.
- Native runner `.local-logs/common-capacity-native.mjs` checked free loopback55441, exact unique `/var/tmp/bneimitzvah-common-capacity-<owned hex>`, PostgreSQL16.15/data directory/port/database. Both fresh runs stopped their cluster, removed only their checked owned paths, closed fixtures and cleaned isolated homes: **stopped:true/path removed:true**. No shared cluster reset, dotenv/remote URL discovery or provider action.

Necessary old fixture adaptations were root-approved: parent denial spies actual `insertWithId` with the same zero-call assertion; the deliberately forbidden historical reservation/ledger overlap is now privileged owner-seeded, preserving all refusal and primary aggregate assertions; only the deliberate bypass half of the combined native retention test was replaced with a measured mutex wait and fresh denial, leaving retention assertions intact.

## Honest first failures

The first runner invocation omitted its `node` selector and failed before Vitest executed; the corrected invocation produced the16/16 result. First typecheck found stale checkout dependencies missing already-merged C packages and two new fixture/null-return typing issues. An isolated locked `npm ci --ignore-scripts --no-audit --no-fund` refreshed dependencies without package/lock changes; precise descriptor/nullable primitive types corrected those issues. First native batch was old10 pass/new4 fail solely because new final audit expectations omitted synthetic `context.enter` setup audit. All new behavioral assertions/waits had succeeded. Baseline-aware assertions preserve exact unchanged/one-new-create checks; corrected4 + existing5 pass as above. No product repair followed the first focused source run.

Repository protection and final source freeze are recorded below after the owned staged gate. No claim of native runtime transport acceptance or activated uploads follows from this checkpoint.
Final owned staged repository-protection gate: **3/3 PASS**,34.79s; .local-logs/common-capacity-protection.log. Final git diff --cached --check clean. Only the11 owned/approved paths enter the source commit; independent implementation acceptance remains pending.
