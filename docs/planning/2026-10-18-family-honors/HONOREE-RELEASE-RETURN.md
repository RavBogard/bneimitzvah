# Honoree database release preparation — 2026-10-18

## Native reference installed after independent review

The preparation below records the earlier model-only checkpoint. The reference now contains actual owned PostgreSQL 16.15 catalogs, with exact byte SHA256 `438276fcb901b723853152f42b05c83b462313b9d3e3e66219be866c0ee0fe2c` and after-catalog canonical SHA256 `640ae4499198878a35b4b3d8fb1a405118e74b85bae13248bd7e20899d5320bb`. The SQL and historical references are unchanged.

The first capture failed without localizing its validation phase. A second diagnostic capture preserved actual before/after catalogs and localized the failure to ordering of trigger metadata during validation. All SQL definitions matched. The repaired comparator proves complete trigger-record multisets, including duplicates, before aligning the expected old-table sequence with the immutable capture. It changes no database schema or actual captured objects. Independent review verified the strict delta, historical catalog composition, preserved old-data digests/roles, exact three reading and one group zero-epoch backfill, and empty capability tables; altered, missing and duplicate trigger records still fail. Original failures, unchanged diagnostic bytes and cleanup evidence remain preserved privately. The installed reference was derived from those reviewed actual catalogs; no synthetic model was substituted and no redundant third capture was run.

This is reference installation, not final operator acceptance or production deployment. Fresh exact-commit manual PostgreSQL acceptance, CI, production check/apply and deployment remain required. PostgreSQL 16 fixture evidence does not establish the production PostgreSQL 18 TLS/channel-binding checks. The [approved material checkpoint](HONOREE-MATERIAL-RETURN.md) is separate; migration still creates no approvals or guest links.

The first integrated candidate1865c69 was held by Windows CI: the new offline fixture test read CRLF checkout bytes instead of the committed LF native reference. The test-only correction reads that fixture from one resolved immutable Git commit and explicitly proves that a JSON-equivalent CRLF variant is still rejected before target access. Runtime source/reference checks and native pins remain unchanged. Focused checks pass14/14. The earlier unused final-test manifest and failed hosted result are retained; final acceptance must use the corrected committed candidate and a fresh manifest.

Production remains31481c56bd32c6a26ffda206b09864f332f15d33 with23 ledger rows through0022. Management122a35f7fa4eea45c690d8be7f96bc80025ee5a2 passes all four [hosted39124427440 jobs](https://github.com/RavBogard/bneimitzvah/actions/runs/39124427440), but has not deployed. The [dedicated release design](../../superpowers/specs/2026-10-18-honoree-release-design.md) pins122a35f as immutable source for0023.

## Accepted preparation, not a runnable production release

Six new files implement the0023-only source, target, catalog, ledger, data and outcome contract; offline tests; disposable fixture; and explicitly invoked manual acceptance. All historical operators/references/helpers, SQL and journals remain unchanged. Every old public row/column, including populated honors, sources and recording metadata, remains in preservation proof. Exact zero-epoch sets derive from all students and the latest nonempty honors groups. Link, operation and material-release tables must remain empty.

Normal production source validation refuses the explicit MODEL ONLY reference and unset actual byte/catalog pins before target access. A distinct internal capture-source seam proves exact committed preparation and historical references before disposable creation. There is no release CLI override. Root must checkpoint this preparation before an actual owned PostgreSQL catalog capture, independently review that evidence, install/pin its bytes, then create the separate final exact-commit release checkpoint.

One independent review held the first structural validator: synthetic CHECK(false) and a current-link index on token_hash WHERE false were incorrectly accepted. The bounded support/test repair now checks all nine named CHECK expressions/conkeys and all eleven complete index definitions/flags against the immutable SQL contract, plus exact primary/unique constraint types and keys. No SQL or normalization relaxation. Author focused isolated checks pass17/17 in44.25s; independent probe accepts the unmodified model and rejects116 constraint/index mutations, including both originals. Original hold/probe evidence is retained. These are offline model checks, not native catalog proof.

Native canonical-expression expectations remain strict model expectations until the server deparse actually matches. The fixture and manual acceptance have only passed syntax checks. No new PostgreSQL cluster, native acceptance, catalog capture, production check, migration or material activation has run at this checkpoint.

## Outcomes and permission

Recognizing applied ledger/catalog state is separate from proving initial zero epochs and empty capabilities. Later legitimate mutations yield observed-applied-initial-state-unverified, never permission to replay or reset. Lost COMMIT acknowledgment remains unknown; acknowledged commit with later drift remains committed-verification-conflict. Cleanup failure preserves the substantive outcome. Check-only is default; apply stays explicit, one connection/advisory lock, existing owner/tenant/PG18/direct TLS/PLUS guards and execution bounds.

Daniel explicitly approved existing CRC booklet before/after Torah blessings, including English and required credits, for invited CRC honorees' private expiring own-aliyah links. No booklet publication or audio sharing. Exact source/notices and same-transaction projector integration follow separately; migration creates no approvals or invitations. No real roster import, notification/mail, new provider scope/spending, generated voice or student-recording activation accompanies preparation.

## Next action and local evidence

Root selects the committed preparation, reviews and generates the complete dependency freeze, repins/reviews the owned capture wrapper, and authorizes one disposable capture. Actual reference review/install, exact-commit manual acceptance, hosted CI and production check/apply/deployment remain subsequent distinct gates.

Ignored evidence: honoree-release-offline-final-v2.log (initial16 pass); honoree-release-source-independent-review.md (original hold); honoree-release-offline-exact-contract-v1.log (repair17 pass); independent delta probes/repair report; capture source review and preparation notes. The captured reference does not exist yet. Licensed bodies, source notices, private artifacts, family data and credentials remain outside Git. This checkpoint does not complete1.0.
