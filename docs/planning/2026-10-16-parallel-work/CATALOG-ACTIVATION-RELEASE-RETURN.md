# Private first catalog activation — author return

Status: private source accepted by independent source/offline review, a final actual CRLF confirmation and the default source proof on the refreshed final LF candidate. No production/artifact connection, activation or migration was performed by this author. Root owns actual private validation and cutover.

## Scope and exact private source

The entrypoint stays ignored at original `.local-logs/provider-bootstrap/service-catalog-activate-release.mjs`. Its operational copy uses the same relative ignored folder inside root's exact LF candidate. Static relative imports use that candidate's reviewed public migration guards. No arbitrary root-module import or generic operator framework is provided. Old accepted private helpers remain unchanged.

SHA-256:

- Entry point: `d7b30d3602d3c9883da27839e58aef942d15e129adce8406cdf9aae66b2d2892`.
- Offline tests: `f1d1679507d0b240a36ea80f0ab513a7eadeec75f244e3bfd09756d620b62550`.
- Synthetic 19-row integration tests: `804de444cef189a1db0475a93dbc4e4ad08bb74c31a205c5a59d1a29072a1cf8` (final reference path `tests/fixtures/portal/release-migrate-reference.json`; only that path changed after the original suite).
- Reused accepted core: `bc9f3a156f1c2a1636ac4491bcfa3abdb979656e906bf3ab3ff5c0e36cc60b61`, unchanged from [the accepted offline review](../2026-10-15-kickoff/SERVICE-OPERATORS-INDEPENDENT-REVIEW.md).

Only this source/hash/behavior report belongs in Git. No licensed artifact wording, feed/provenance bytes, private target or credentials are included.

## Guard and transaction contract

The CLI accepts exact expected commit and a protected target file, defaults to check-only, and requires explicit apply. Argument/source guards precede artifact validation; the existing exact artifact and producer pins, public parser and envelope validation precede target/credential lookup. Candidate source is checked against exact Git bytes, including the parser/projector/HTTP sources and unchanged accepted core.

The production factory is the reviewed `ReleaseClient(target)`, followed immediately by `assertReleaseTransport` before any SQL. One direct owner client and the same session advisory lock span the complete operation. Apply owns one SERIALIZABLE transaction with canonical CRC tenant/host locks; it requires the full 19-row ledger, selected historical reference, complete catalog, role/schema and server-side data digest guards. It never invokes the migrator or runs an import on a second connection after a check-only preflight.

Activation reuses the accepted core decision: exact immutable known catalog bytes/pins, at most its first active lifecycle, no other active generation, no withdrawn/superseded revival, and no existing plan before filling a missing lifecycle. At most one catalog and one lifecycle row are inserted. Old rows, unrelated tables/plans, schema, roles and ledger remain unchanged. An already active exact catalog rolls back as a true no-COMMIT no-op. Post-insert and post-COMMIT verification compare all old-row fingerprints excluding only the owned new IDs.

Closed results retain `importCommitAttempted` and `importCommitted` (`false`, `null` when unknown, or `true`). A lost real COMMIT answer stays unknown; post-COMMIT mismatch stays committed-verification-conflict. Cleanup does not claim rollback of committed data. No automatic retry, role grant, lifecycle replacement or withdrawal path is added.

## Public projector compatibility repair

The author found the first private draft failed its real default source phase: the old accepted core pins the public TypeScript projector with CRLF, while the exact Git candidate contains LF. Direct injected PostgreSQL composition had not exercised that default path.

Root approved a narrow bridge after exact Git-source validation: require the current LF fragment hash `ef91e4ec88737ea94db97f1e0dddd8de8ba8c62900495b423725b03732b78fa3`, derive only that public fragment's CRLF counterpart, and require the old exact core pin `e76362c9b8e47b0b097c8f9a88a4035f8d563123deba4b65beb8f8027fde74fe`. The unchanged accepted core receives this pinned public code. Unexpected/missing code or line endings fail closed; no fallback normalization is offered. No artifact, feed/provenance, SQL, ledger or observed catalog bytes are transformed.

## Author evidence and limits

- **7/7** offline tests pass (`.local-logs/catalog-activation-bridge-pure.log`): precredential order/closed output, source recheck after await, transport refusal before SQL, and exact public LF/CRLF projector pins with malformed/missing/altered-source refusal.
- Actual default `activationSource(realHEAD, acceptedCore)` from root's LF candidate `b292c05` passes with pinned public parser compilation and source recheck. No artifact or target function is called and no client is constructed (`catalog-default-source-proof.log`).
- Actual default `runActivation` core and source path (no core/source injection) reaches exactly one synthetic artifact sentinel. The sentinel intentionally stops execution before any protected data read: **one sentinel, zero target reads, zero clients, correct parser/projector pins, no commit attempt** (`catalog-default-source-sentinel.log`). Only the ignored entrypoint was copied into the running LF candidate; its Git/app files were untouched.
- Before the source-only bridge, the author executed **11/11** synthetic actual PostgreSQL cases, **27.86s** (`catalog-activation-author-pg.log`). They cover first activation, no-op, old-row/immutability preservation, lifecycle/mismatch/plan refusal, an observed tenant-row blocker plus competing advisory-lock refusal, late insert rollback, real COMMIT lost acknowledgement and committed unrelated-write conflict. Fresh owned fixtures and anchor closed/removed. No real artifact was loaded. These cases use trusted local composition and do not establish default CLI/source/TLS behavior; the separate default source proofs above address source compatibility.
- The independent reviewer executed the added exact-CRLF 19-row check/activation/no-COMMIT idempotence/wrong-attestation case: **1/1 pass, 3.91s**, `catalog-activation-crlf-independent.log`. It uses the shared selector and final `804de444` fixture, with the entrypoint unchanged at `d7b30d36`. The fresh owned fixtures and anchor were cleaned. Root expressly authorized this one bounded PostgreSQL case while its separate full app pass ran; no additional PostgreSQL or browser lane overlapped.

Independent evidence is recorded in `SERVICE-CATALOG-ACTIVATION-REVIEW.md`; the prior 11 cases above are author-executed, not an independently rerun full suite. Public wrapper packaging at `c5f3e19` preserves reference bytes and policy, and `cbd90af` changes only the two CI checkouts needed for pinned Git history. Neither changes this private source or its API. After root refreshed the exact-LF candidate to `cbd90af`, the independent reviewer reran the actual default core/source path without source/core injection: **one artifact sentinel, zero target reads, zero clients/provider calls**, with the exact `d7b30d36` entrypoint hash checked (`catalog-default-source-final-independent.log`). This closes the packaging checkpoint separately from injected PostgreSQL composition; the earlier author proofs at `b292c05` remain attributed above.

Root's migration wrapper actual read-only PG18 preflight is separate evidence. The helper requires the final full schema already present and will refuse a 15-row starting state. Actual artifact compatibility, check-only and activation against the protected production target remain root's operational gates after exact candidate acceptance.
