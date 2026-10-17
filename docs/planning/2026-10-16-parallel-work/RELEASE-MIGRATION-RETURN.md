# Release migration operator return

Final source freeze: **c5f3e19e62e2e0d290554eabcf9f9e665cb4aba3**, after selector dbc470ecf7c77f60cf421cea97da32b823f1d3a0. Includes initial31836dd, configured startup correction0d11420a77d8351423f910c3e761346e6be21d6e and strict channel-binding2a96fc6acca8c3d723de1385c5de33ff494d978d. Ownership: the six files listed below only, plus this original report. No frontend/backend product changes, historical migration edits, production connection, provider operation or private target read by this implementer.

## Closed operation and source provenance

Default is read-only check; CLI is `node scripts/release-migrate.mjs --expected-commit <exact40hex> --target <protected-private-JSON>` with optional final `--apply`. No credentials in arguments/output. Fixed sanitized result has ok/phase/outcome/apply and, on success, ledgerRows. No driver errors, private identifiers or row contents are serialized.

SourceContract checks exact HEAD/ancestor and clean migration/operator paths before private file access or DB construction. The complete journal/snapshots/SQL tree must exactly match Git4ad7e0c110cb30819b948429a7b65a1fcc5e35f9, including working bytes. All operator files and unchanged db-migrate.mjs match committed Git blobs. Source is rechecked before migration and after commit. Managed Windows CRLF files deliberately fail; root prepares a separate exact-LF artifact. Never normalize historical SQL or rewrite the ledger.

Only a full ordered attested15-row historical prefix or exact19-row applied ledger is accepted. Intermediate/unknown/duplicate histories reject. Historical LF/CRLF choices are permitted only for previously attested indices<11 or13, then pinned to the single representation in the private15-row manifest. Rows15-18 require exact GitLF hashes/timestamps. Already19 remains check-only/noDDL even with --apply.

Reference catalog was generated from exact unchanged Git4ad SQL in disposable PostgreSQL16.15:23 baseline tables/2 functions,31 final tables/8 functions. All metadata fields are hashed, including owner, RLS/FORCE, columns/nullability/defaults, constraints, grants, indexes, policies, trigger attributes/WHEN and full function metadata/source. Full ignored capture is `.local-logs/release-reference-full.json`; compact public reference carries sourceCommit/migrationsSHA256 provenance. PG18 contype=n rows are excluded only after matching validated/enforced single-column attnotnull; structural nullability remains checked. No broad SQL/deparser normalization. Unknown objects, columns or privileges reject. Root later reported all PG18 table/type fields match; only the precise historical function-source representation required the amendment below.

## Private target contract

Closed JSON keys:

```text
{
 version:1,
 migrationUrl:string, // direct postgres[ql], sslmode=require, optional channel_binding=require
 expected:{hostname:string,database:string,owner:string,ownerOid:string,
   runtimeRole:string,serverMajor:18,tenantId:"crc",
   canonicalOrigin:"https://beitmitzvah.centralreform.org"},
 historicalPrefix:Array<{id:number,hash:string,createdAt:number}>, // exactly15 ordered entries
 provenance:{sourceCommit:"4ad7e0c110cb30819b948429a7b65a1fcc5e35f9",
   method:"owner-readonly",observedAt:string} // UTC ISO milliseconds
}
```

URL must match expected direct *.neon.tech host (no pooler), owner/database and port5432/default. Reject fragments, unknown/duplicate query keys, alternate sslmode or channel_binding values. Optional binding is only require; it is never silently stripped. Owner OID is a decimal string, identifiers bounded ASCII. Private input is <=16KiB. No protected target URL/value was read here; root derives it from its separately protected exact readonly attestation.

ReleaseClient(target) pins pg8.23.1 hooks. Required binding rejects non-PLUS SASL/MD5/cleartext before password retrieval, then records PLUS only after pg validates server-final signature. assertReleaseTransport(client,target) requires encrypted+authorized TLS and completed required PLUS immediately after connect, before ANY SQL. Preference enableChannelBinding alone is insufficient. Root separately reported a successful actual production READONLY verified-TLS PLUS probe; that is attributed root evidence, not this implementer's local proof. Disposable loopback tests explicitly override the transport assertion, never public CLI behavior.

## Lock, transaction and recovery boundary

One direct owner client holds fixed try-advisory lock[214137,151819], with bounded statement/lock/query/connection/whole-operation timeouts. Identity rechecks current/session/database owner OIDs, PG major, CRC canonical binding, runtime-role closure/privilege boundary and closed public CREATE ACL. Client idle errors have a scoped listener/failure fence through cleanup, preventing uncaught raw details.

Startup path is public,pg_catalog for unchanged unqualified migration DDL. Read-only repeatable snapshots set LOCAL pg_catalog,public and ROLLBACK restores creation path. Public schema ownership must be expected owner or pg_database_owner; only expected/schema owner CREATE ACLs allowed. Advisory functions explicitly pg_catalog-qualified.

Before apply, fresh snapshots compare exact ledger/schema/roles and bounded per-table counts/server-side digests (no family rows leave DB). Existing migrateDatabase(client) owns BEGIN/COMMIT; there is no outer migration transaction. Final verification checks exact19 catalog/history, unchanged old roles/data and empty eight new tables. Capture limit100000 rows/table fails closed rather than expose data.

A migration exception is unknown outcome: no automatic retry or destructive rollback. Once migrator returns, postcommit mismatch is committed-verification-conflict; committed work cannot be rolled back by this wrapper. Legitimate concurrent runtime writes can change digests despite the cooperating operator lock, so mismatch requires fresh check/reconciliation and is not proof of corruption. SQL failure rolls back its own transaction. App rollback can retain compatible additive schema; no down migration or ledger rewrite is offered. PITR settings are optional/unverified and NOT a blocker for this bounded additive transactional cutover per root's readiness ruling. No backup/provider/spend action requested.

## Measured failures and corrections

- Initial pure12/14: two mock-harness defects (dependency replacement, fake Git reading mutable bytes); corrected14/14 passed.
- First reference generation exposed a real draft metadata bug: pg_get_expr cannot deparse trigger WHEN with OLD and NEW. Only non-null WHEN capture uses full pg_get_triggerdef; generation then passed.
- Peer independently reproduced uncaught idle EventEmitter failure with synthetic marker. Scoped listener/fence and regression fixed it; peer independently confirmed closed output/no marker. Pure15/15 and actual initial PG9/9 passed11.62s (earlier9/9 at30.86s).
- The initial318 return incorrectly called startup options nonbehavioral. Root found pg_catalog-first path directs unqualified DDL into pg_catalog, missed by a fixture omitting parsed options. That claim is withdrawn;318 alone is not accepted live. Actual configured non-superuser repro failed with pg_catalog schema/unknown migration result. Corrected public-first startup plus CREATE ACL guard passed pure15/15 and full configuredPG10/10,10.18s; separate actual PUBLIC CREATE mutation confirmation1/1,2.50s. Peer independently repeated configured case1/1,2.72s at0d11420.
- Strict transport amendment2a96fc6: pure20/20, including real pinned-pg PLUS selection, fallback-before-password rejection, bad signature/unverified TLS rejection and zero SQL on failure. Actual configured loopback1/1,2.78s retained namespace/ACL coverage, not TLS/PLUS proof. Peer independently accepted source and20/20 pure.
- Root actual PG18 default check safely refused preflight. Its protected readonly comparison found ONLY portal_immutable_audit and portal_immutable_columns prosrc exactly equal Git0002 bodies with CRLF, matching chosen attested prefix[2]. No production write occurred.

## Selected historical function reference

Final amendmentdbc470e embeds only those two source-generated LF metadata records already pinned by baseline/final full-record hashes. Source preflight binds each name/empty arguments and source to exact unchanged Git4ad0002 dollar body, and its full-record hash to BOTH original catalogs. Export selectedReference(source,target,ledgerLength) chooses the LF reference or derives only expected source CRLF according exclusively to chosen attested prefix[2]. It transforms NO observed catalog, SQL, function or ledger. Other fields/literals/functions/tables/privileges remain exact. Wrong mapping/representation rejects.

Final pure **21/21 pass**, command `node .local-logs/run-isolated.mjs release-selected-function-pure node --test tests/release-migrate.test.mjs`; ignored release-selected-function-pure.log. Rejection cases include wrong selected LF/CRLF, changed literal/source whitespace/security/grants/mapping.

Final actual configured PostgreSQL **11/11 pass,18.08s**, command `node .local-logs/release-pg-isolated.mjs --test tests/postgres/release-migrate.integration.mjs`; ignored release-selected-functions-pg.log. Includes real migration0002 CRLF history15-to19, exact prefix/old row preservation, already-applied/noDDL, wrong attestation denial, retained LF startup/public CREATE denial, different-physical-client lock refusal, late0018 SQL failure rollback, unexpected runtime grants, legitimate committed-write conflict and lost-COMMIT-ack/fresh-check reconciliation. Runs are distinct; no fabricated cumulative single-run claim.

Runner asserted known disposable loopback PostgreSQL16.15/data directory/database, used fresh owned anchor/unique DB/owner/runtime roles, closed fixtures and reported owned anchor removed:true. No shared login/password/cluster settings changed; only standard validated NOLOGIN prerequisite may be created on empty CI service. Exclusive PG lane released. UI privacy file is independently owned/untracked and excluded from operator commits.

## Reuse, remaining gates and hashes

Trusted exports: RELEASE_LOCK, verifyIdentity(client,target), releaseSnapshot(client,source,target), ReleaseClient(target), assertReleaseTransport(client,target); sourceContract/parseTarget/checkLedger/selectedReference from support; catalog capture/verify/role/data helpers. Private activation must use the SAME client/session lock throughout selected19-schema/history/identity checks and SERIALIZABLE import, with transport assertion before SQL. No check-only-then-lock gap or generic operation framework. The previously accepted old import core is unchanged.

Exact old private operator review: `C:/Users/dsbog/bneimitzvah/docs/planning/2026-10-15-kickoff/SERVICE-OPERATORS-INDEPENDENT-REVIEW.md` (original checkout, not parallel-work/managed). Its final offline acceptance remains evidence for that core, not current19-schema activation authorization.

Remaining: peer independent final selector review, root fresh exact-LF default check-only/PG18 compatibility, final integration exactCI; root alone owns later live apply/deployment. No production acceptance claimed from localPG16. Concrete unexpected cross-version differences must fail and receive narrow review.

Final owned working-byte SHA256s:

```text
3fbd515c60a91ccaf0627264f2ea4258a28e13923acb93a1a6130fdc7c23dd18  scripts/release-migrate.mjs
9d57b983ef40c11516992b5bd22f6302afc51d83b988a6bd511ff469b6450656  scripts/release-migrate-support.mjs
2004c3e969baca9ea325fa59be77331417e3f23ee53b2b8f33ac4e0ed4a507f2  scripts/release-migrate-catalog.mjs
14cdd55bf0f01859e3d8b47cab7a1a7a1334517d99eade632892aecc37691049  tests/fixtures/portal/release-migrate-reference.json
863d41477125bcad511f198beff6d95724204d18bf0fe109aa100003b79a7066  tests/release-migrate.test.mjs
fa0d2114e9bb0c657b67cb6157ad98807596b4012c96088bdc6821a7c93aeb45  tests/postgres/release-migrate.integration.mjs
```

## Attributed final review and default live check

Peer independently accepted dbc470e source and21/21 pure, then executed the exact real-CRLF configured case1/1,3.07s with anchor cleanup=true; no independent full11 rerun claimed. Root then reported successful actual production **default check-only** at exact-LF dbc470e: `{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:15}`. Root verified real ReleaseClient TLS/PLUS, PG18 selected full catalog/history/roles/data and same-client lock/session cleanup, with no writes. Root's ignored log: release-candidate-20261016/.local-logs/root-production-checkonly-dbc470e.log. These are attributed peer/root results; this implementer did not connect to production. Final integration/CI still precedes root's later live apply/deployment.

## Unchanged repository-policy gate and fixture packaging

Root's actual staged never-in-repo scan refused the original public reference location and synthetic URL source literals (five findings duplicated across worktree/index). These were real integration-gate failures, not private credential leakage or permission to weaken policy. Root approved moving the byte-identical public schema deployment/test fixture to existing reviewed tests/fixtures/portal/release-migrate-reference.json. Commit **c5f3e19e62e2e0d290554eabcf9f9e665cb4aba3** changes that path in RELEASE_FILES/source reads/tests and builds synthetic URLs via URL username/password setters. Both prior non-synthetic-email findings originated in URL user-info syntax; fixture@example.test is already allowed. No guard regex, policy exemption, SQL, target schema or reference bytes changed.

Focused pure21/21 pass, release-reference-packaging-pure.log. Unchanged entryProblems reports no findings for all four current affected paths. Root-staged unrelated docs were preserved using an explicit-path commit. Peer independent packaging/guard review and a fresh exact-LF default source proof are pending; earlier actualPG11 and root PG18 readonly acceptance apply to unchanged migration/reference behavior, not a claim that this final path was already exercised live.

## CI historical ancestry prerequisite

Before publication, source inspection found default shallow actions/checkout would omit fixed4ad migration ancestry needed by new pure/PG tests. Root approved commit **cbd90af13dfcc6e9973605d2a303a5ce1bc01845**: fetch-depth0 only on unit matrix and postgres checkout steps, leaving public browser checkout unchanged. No test uses unpinned worktree SQL and production source pins remain intact. Peer independent workflow review is requested; exact hosted CI is still required. This commit preserves root's separately staged docs.

## Final packaging/history acceptance

Peer independently accepted c5f3e19 byte-identical fixture relocation/URL construction under unchanged policy, pure21/21 and actual candidate/index never-in-repo guard pass (release-packaging-independent-guard). Peer independently accepted cbd90af's exact two fetch-depth settings; no permissions or source pins weakened.

Root refreshed the exact-LF candidate to **cbd90af13dfcc6e9973605d2a303a5ce1bc01845**. Independent real defaultCore/defaultSource activation sentinel proof **PASS** there:1 artifact sentinel,0 protected target reads,0 clients/provider connections, no injected core/source. This exercises the final relocated-reference source guard rather than mocked or stale b292 paths; log catalog-default-source-final-independent.log. Source rechecks and pinned core/public projector passed before the intentional sentinel stop. No artifact read or DB operation. Earlier root actual PG18 migration check-only result remains attributed and behaviorally unchanged; no new live apply claimed. Final broad type/build/exact hosted gates remain root-owned.

Final root attribution: exact-LF cbd90af typecheck and production build **PASS**; unchanged repository candidate/index guard **PASS,36.88s**. Root fullapp828+1 existing skip/93 files/430.02s is recorded above or in the linked UI review, with runtime/app diff zero to cbd. Independent defaultCore/defaultSource sentinel at cbd passed as recorded. All local gates are now closed; exact final hosted CI and root deployment sequence remain pending, with no further reviewer test requested.
