# Independent practice-calendar foundation review — 2026-10-16

**Accepted within the bounded backend scope; no blocking finding.** This is independent source, app and restricted-PostgreSQL evidence, not a production migration or release approval. Broader integration checks and exact hosted CI remain separate gates.

## Exact scope and ownership

- Approved spec: `3caa231d9de9fcf2de7879a700ba52688ea69d04`; [independent contract review](PRACTICE-CALENDAR-DESIGN-REVIEW.md).
- Immutable product/schema/migration source: `28494a7efc32f1ebeb3bc0ab561f3ac50bce68bd`.
- Independent tests committed unchanged by author: `78c7b726cab9a6153902ef13ced47adde0cd7a08`.
- Reviewer owns this original report and `tests/app/practice-calendar-adversarial.test.ts` / `tests/postgres/practice-calendar-races.integration.ts`. Author owns product code, 0018, normal/policy tests and material-verifier composition. No reviewer product edits, recursive delegation, browser, provider, production apply or scheduler operation occurred.

Reused accepted evidence for unchanged lesson/progress/modal/access code. Review covered the changed policy, validation, service, data, HTTP, schema, SQL, snapshot/journal and narrow service-learning composition, without a whole-project audit.

## Source conclusion

Raw detail reads require own-student mode. Child practice can write and read dates; parent/tutor/admin remain dates-only even when roles overlap. DTOs expose sourceMode but no actor/session/context/grant identifiers, counters, audit receipts or licensed text. GETs do not record activity. Uniform day-only acknowledgement at a duplicate/mismatched UUID or the 512-row cap does not claim that a particular report was stored. First raw report remains immutable.

Writes reuse live practice capabilities and exact current assignment/canonical verse or active catalog/plan/selected-unit verification. Chicago expectedDay, real session/context expiry and overall retention are rechecked after waits, including duplicate/quota paths. The private AccessDenied-derived fence leaves the transaction before translation to a 409, so provisional raw/date inserts roll back. Reads filter again using fresh response-time retention. Raw detail has the strict rolling 90×24-hour UTC boundary; all history expires at Chicago midnight on the ceremony calendar-year anniversary, with February 29 clamping and internal year 10000 support.

The daily row serializes the raw-count cap; no count is retained on that row. Native SQL receipts use timestamp(3), a millisecond default and a Chicago day consistency CHECK, keeping the ISO cursor exact. Raw grants are SELECT/INSERT/DELETE only. Daily-row UPDATE privilege is restricted to the key column for locking and guarded by immutability. Both tables FORCE tenant RLS and enforce tenant/student/day relationships and closed target/source/action shapes.

The ceremony-date trigger is SECURITY INVOKER, scopes deletion to the affected tenant/student and samples clock_timestamp after the student lock. Expiry of either the previous or replacement date prunes both tables within the roster transaction. Maintenance is internal, takes at most 25 students and deletes at most 1000 total raw/date rows per invocation, with fresh clocks and a boolean continuation result. No endpoint, scheduler deployment or indefinite event audit was added.

Independent JSON comparison confirmed 0018.prevId equals 0017.id, only `public.practice_day` and `public.practice_event` were added, all prior table definitions and other snapshot sections are identical, and prior journal entries are unchanged. Historical migration SQL was untouched.

## Independent execution

Commands ran from the managed integration checkout against the frozen source:

```text
node .local-logs/run-isolated.mjs calendar-independent-app npm run test:app -- tests/app/practice-calendar-adversarial.test.ts
node .local-logs/run-isolated.mjs calendar-independent-typecheck npm run typecheck
node .local-logs/calendar-pg-isolated.mjs
```

- App: **7/7 passed, 12.62s**; ignored log `.local-logs/calendar-independent-app.log`.
- Composed typecheck: **exit 0**; ignored log `.local-logs/calendar-independent-typecheck.log`.
- Actual restricted PostgreSQL: **25/25 passed, 14.55s**, including **19 measured blocking edges** established by the existing waitForLock/pg_blocking_pids helper, not fixed sleeps; ignored log `.local-logs/calendar-independent-pg.log`.

App groups cover overlapping-mode/raw privacy and child handles; immutable UUID mismatch and uniform at-cap acknowledgement; old-day replay after raw purge; exact verse/service-unit eligibility; tied receipt pagination; strict 90-day/overall cutoff and bounded cleanup; Chicago DST, leap anniversary and year-9999 service behavior.

The measured PostgreSQL waits cover first-day uniqueness and competing 512th-slot writers; session expiry below/at cap and on UUID mismatch; expiry/midnight after a blocked INSERT with rollback of both provisional rows; midnight and overall expiry while waiting on the daily row; delayed raw/calendar filtering; assignment revision, catalog withdrawal and plan replacement; child-context expiry/switch; student-identity revocation; raw-read expiry; and maintenance using the post-lock clock. Assignment replacement is tested as a committed revision update ahead of the reader, not claimed as a new test of the separate confirmation HTTP flow.

Remaining PostgreSQL cases verify old-expired/new-expired/neither-expired ceremony changes; exact-student deletion and date/raw/day/audit rollback; actual restricted-role RLS/FKs/CHECKs/grants/immutability; and native submillisecond input stored at cursor-exact precision. Pagination crosses a 50-row boundary with equal receipt times, adjacent milliseconds and a UUID reused on another day, and matches database ordering without omissions or duplicates.

The inspected runner asserted the exact known disposable loopback cluster before creating a fresh owned anchor. Existing fixtures created fresh databases and restricted runtime roles; the anchor was bootstrap-only. Output confirmed **owned PostgreSQL anchor removed: true**, and fixtures closed. No shared role, server source or browser port was changed. Post-run HEAD was still the frozen source and tracked/source/migration diffs were empty. The lane was released before author broader checks started.

Test SHA-256 values at execution:

```text
app  2f297e65c75a21b62f8a46dd0f549f236ead1fae223f2cfe37216321256f1a72
PG   2f4a8a96c7851eaeaa33a37c828672f99d83ede8735a0634836e66aac5d33f1b
```

## Other evidence and remaining gates

Author-reported frozen focused checks: policy 8, normal HTTP/SQL/maintenance 4, migration upgrade/replay 1, service-learning 13, plus typecheck passed. Before freezing, author found and corrected two failures: rollback-fence masking and an unnecessary raw SELECT FOR UPDATE requiring an ungranted UPDATE privilege. The affected four tests then passed. These are author findings; the independent executions above used the corrected immutable source.

Author broader full-app/build checks are running after the independent lane release; exact hosted CI is pending. This report makes no claim about production cleanup scheduling, applied migration, persisted coverage of every reported action, recorded-media completion, offline behavior or browser UI. No additional source/test/browser round is requested absent a new failure.
