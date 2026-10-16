# Private owner admin commands — 2026-10-16

Implemented Astra's accepted `OWNER-ADMIN-PLAN.md`. Owned changes are
`scripts/manage-admin.{mjs,d.mts}`, two focused app test files,
`tests/postgres/owner-admin.integration.ts`, the accepted-plan amendment and the
private operator section in `PROVIDER-SETUP.md`. No schema, application route,
runtime privilege, provider setup, real account operation, commit or push.

Prepare/apply use a dedicated direct table-owner client, then transaction-local
restricted role and CRC RLS. The enabled tenant locks first, followed by stable
user/membership/grant locks and context updates last. The existing append-only
bootstrap binding must be singular and well formed; owner identity, active grant
and enabled membership must agree. Another admin is not another owner. The bound
owner grant cannot be targeted, even if another usable admin exists; revocation
also checks a remaining verified/enabled active admin.

Bounded exact-key review descriptors bind target verification/user update time,
membership absence or ID/authority revision/state and complete admin history
(at most 64 grants). Timestamp strings preserve database microsecond precision;
review lifetime is exactly ten minutes. Apply validates the reviewed SHA256,
recaptures current authority, compares the canonical typed projection and checks
expiry again after lock waits. Expected-absent membership creation and explicit
fresh-row regrant are supported. Revoked history/contexts are never restored.
Conditional revocation, tied-context closure and one owner-attributed audit commit
atomically. Replays and competing commands cannot add another effect/audit.

CLI input/review reads are limited to 16 KiB and malformed UTF-8/JSON is refused.
Review files are exclusive new files outside the checkout; symlink/junction
ancestors, linked inputs and changed parent identities deny. Independent review
found a containment bug for in-checkout names beginning `..`; the component-based
fix and synthetic `..review.json` read/write regression close it. Existing output
files remain untouched. There is no execution on import. Fixed error boundaries
drop SQL, identities, connection details, driver causes and hostile error accessors.

Filesystem limits are explicit: private directory ownership/ACLs are an operator
precondition. Canonical-path, link and parent-identity checks do not eliminate
malicious same-user TOCTOU rename races. POSIX 0600 is requested when creating the
file; it cannot establish Windows ACL privacy. Use an owner-only directory outside
the checkout, not a shared/adversarial directory. The CLI arguments contain paths
and a reviewed digest, not credentials or identity values; tests use isolatedEnv.

Focused owner/bootstrap checks passed **17/17**. Final file/isolated CLI checks
passed **4/4** on Windows, with the POSIX FIFO case skipped there; an actual WSL
Node 24 FIFO probe passed using isolatedEnv. The read helper rejects nonregular
files before open, uses nonblocking/nofollow flags where available and compares
opened file identity, preventing a FIFO from bypassing the byte bound through a
blocking open. Final typecheck passed. Root ran the real PostgreSQL 16.15 gate:
**4/4**, using disposable unique databases and actual restricted runtime roles.
It covers unchanged privileges/role/context cleanup, exact grant/revoke/regrant,
two competing absent-membership grants and revokes with one effect/audit, stale
verification/ambiguous owner binding, and an actual lock-observed admin capability
finishing before private revoke. Subsequent admin/study access denies without role
union; a retained tutor grant continues to authorize its own mode. Evidence:
`.local-logs/owner-admin-postgres.log`, `.local-logs/owner-admin-unit.log`.

Root's independent review accepted the containment correction with no remaining
blocking source finding at this scope. Final isolation/repository checks passed
**4/4** (`.local-logs/owner-admin-guard-final.log`). Shared integration passed
**127 Node + 347 app tests**, one POSIX-only Windows skip, typecheck/build,
**25 authenticated-browser checks** and **6 production-page checks**. The four
new owner PostgreSQL tests passed separately from the previous 24-test checkpoint.
Hosted CI and publication remain pending. No real operator execution or owner
recovery/transfer is implied.
