# Common recording capacity independent source review

Accepted for the bounded, provider-disabled application-writer contract at author commit `a53852c0449a64b6e9657de180145d10f71f912d`. No source corrections were requested or made. This review adds only two independent test files and this report. Root integration/exact hosted gates remain separate; this is not receipt/provider/runtime activation or production migration acceptance.

## Source and invariants

Reviewed the accepted [design](../../superpowers/specs/2026-10-17-recording-common-capacity-design.md), [design review](COMMON-CAPACITY-DESIGN-REVIEW.md), [author return](COMMON-CAPACITY-RETURN.md) and its11-path delta. Source Git blobs:

- `recordings/registration.ts`: `643efbc04cc00dd0582d1e93a31ec9e0f4d4b07a`.
- `recordings/capacity.ts`: `4534213a5e223feab3c34eec2a9f8b3e53a15654`.
- `data/recordings.ts`: `e8e7712157efeae8dc19c8dd2c0453b75f918292`.
- `data/recording-receipts.ts`: `0a4caddd4ff0b63260099b327d820840ccf0cb07`.
- `recordings/receipts.ts`: `5e3ad25502c5b2b483dc6e0106755df880bd395f`.

Both registrar APIs acquire the existing tenant admission mutex within fresh authority before ledger lookup and before any caller callback. Registration locks at most one actual scoped identity match. Implicit replay uses that row's real ID; a new insertion chooses one UUID before reservation checking and passes that exact ID into the only application insertion call. Supplied original IDs are validated unchanged. Retained tenant receipt reservations take precedence over exact replay; no head adoption, receipt consumption or second-key escape exists. A null INSERT refuses without a second lookup/replay. Only nonoverlapping exact live-state replay is exempt from new-cap arithmetic.

The common predicate retains exact bigint byte/take/original-ID limits. Primary audio and logical liabilities add ledger and unreleased receipt contributions, including deleting ledger rows; terminal receipt release never subtracts unrelated ledger liability. Original identities remain a distinct-ID union, and64 bytes per immutable slot remain a separate retained marker charge. Receipt actor/pipeline/hour/day predicates remain unchanged apart from factoring the retained-cap predicate. There is no inferred actor provenance for legacy rows.

Existing exact-identity private AccessDenied bridges preserve closed conflict/limit translation outside the unchanged authority sanitizer. Arbitrary SQL/audit/lookalike public errors remain unavailable; ordinary401/403/404 retain their meaning. Callback one-use/poison/synchronous-close/drain rules are preserved. The source callsite tripwire is useful review evidence, not a restriction on arbitrary trusted SQL privileges or callback SQL. No global provider-operation/spending/physical-request cap is implied.

Old fixture adaptations preserve their intended checks: privileged historical overlap is now owner seeded because guarded registration must refuse it; parent denial still asserts zero actual inserts; the deliberately obsolete bypass assertion becomes a measured wait/fresh denial while retaining its original independent retention assertions. No old schema, role/RLS rule, auth sanitizer or provider transport changed.

## Independent evidence

All test fixtures are synthetic and disposable. Test children use the existing isolated runner or the guarded local native runner. No real data, provider/remote database, production credentials, mail or operator operation was used.

- New `tests/app/recording-capacity-review.test.ts`: **5/5 PASS**,8.35s first focused run. Actual retained overlap proves additive bytes/takes, distinct IDs, marker charge and reservation-before-replay refusal. Terminal release retains marker/identity without subtracting ledger charge. A real insertion followed by a synthetic null return poisons caught caller work and rolls back both row and earlier audit. Reserved planned implicit ID never reaches INSERT. AccessDenied statuses and public error lookalikes retain their respective sanitizer behavior. Gate completion precedes callback, escaped scope cannot query again, and parent dashboard stops before the gate.
- Composed own/author capacity, original-ID normal/review and receipt normal/review: **35/35 PASS**,6 files,37.20s. `.local-logs/common-capacity-review-composed.log`.
- New `tests/postgres/recording-capacity-review.integration.ts`: **5/5 PASS**,3.42s test time/4.61s Vitest duration. `.local-logs/common-capacity-review-native.log`. **Six actual pg_blocking_pids edges** were observed: receipt-first→implicit registrar; original-ID callback→receipt; implicit and original-ID INSERTs→uncommitted competing uniqueness holder; date-first→maintenance; date-first→registrar. Receipt-first prevents premature ledger lookup, and the waiter freshly denies the1001st take. Original-ID callback owns admission before any registration SQL; its waiter observes committed ledger usage. Exact replays add no row/audit. Both APIs refuse the actual invisible-then-committed uniqueness collision without adopting or relooking up the row. Date-first holds student/head while maintenance owns admission and waits for that head; registrar waits outside its callback, then sees terminal release and succeeds after both settle.
- Callsite and isolation checks: **5/5 PASS**. `.local-logs/common-capacity-review-node.log`.
- Composed typecheck: **PASS**, `.local-logs/common-capacity-review-type-final.log`. No default build repeated for independent tests-only additions; author default-build PASS is attributed to its return, not claimed as an independent run.

Fresh local PostgreSQL16.15 used verified free loopback55443 and one unique checked `/var/tmp/bneimitzvah-capacity-review-<owned hex>` directory. The runner verified actual data directory/port/version/database before creating its generated anchor role and disposable fixture databases. A separate synthetic monitor connection measured date-first edges without queueing behind deliberately blocked owner SQL. Fixtures/connections were closed, cluster stopped and only that resolved owned path removed: **stopped:true/path removed:true**. No dotenv URL discovery, old directory adoption or shared database reset occurred. Ignored runner: `.local-logs/common-capacity-review-native.mjs`.

The author's distinct post-wait session-expiry and maintenance-first/date cases, exact historical-over-cap replay, byte/deleting-row boundaries, planned-ID equality, prior unawaited registrar drain and receipt suites were reviewed/reused as attributed evidence; their reported runs were not silently counted as independent native executions here.

## Honest corrections and remaining gates

Independent behavioral runs passed first time. First composed typecheck found only the review fixture's inferred Node UUID template type incompatible with a receipt's string asset ID. The fixture now uses the existing VerifiedRecordingDescriptor type, with all runtime assertions unchanged; final composed/type runs pass. No product finding or test assertion relaxation followed. The separate D ignored-operator finding/repair occurred outside this source checkout and is not part of this review.

Owned staged repository protection and final review commit are recorded below. Root owns final integration/exact CI. Future receipt finalization still requires its separately reviewed consumed-receipt/accounting and provider dispatch contract; this disabled internal gate does not authorize it.

Final owned staged repository-protection gate: **3/3 PASS**,35.59s; `.local-logs/common-capacity-review-protection.log`. Staged diff check is clean. Only the two new independent test files and this report enter the review checkpoint; reviewed author source remains byte-identical to `a53852c`.
