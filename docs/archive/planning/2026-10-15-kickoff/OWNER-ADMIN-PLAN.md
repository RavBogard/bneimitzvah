# Private owner admin operations — proposed 2026-10-16

Accepted by Astra, 2026-10-16: explicitly expected-absent membership creation is
allowed for the exact verified target; deliberate fresh-row regrant requires the
exact reviewed revoked-history state. The immutable owner grant remains protected
permanently in this command; transfer/recovery stay excluded. Implementation and
verification are recorded in `OWNER-ADMIN-RETURN.md`.

The design below derives from the approved
auth spec's permission matrix (“Sole owner script initially”) and immutable owner
binding. This adds no app route, admin invitation, SDK hook, runtime grant,
database privilege or owner-transfer mechanism.

## Existing authority

`scripts/bootstrap-owner.mjs` requires a direct table-owner connection, switches
transaction-locally to `portal_runtime`, binds CRC RLS, locks the tenant, and binds
the initial verified identity through an append-only `owner-bootstrap` audit.
It rejects alternate owners, unbound admin history and revoked owner authority.
`relationships/service.ts` refuses all admin-grant revocation. Existing grant
identity/revocation triggers, partial active-grant uniqueness, revisions and audit
actions suffice; no schema change is proposed.

## Proposed contract

Add `scripts/manage-admin.mjs` and its typed declaration, exporting a narrow
prepare/apply API for synthetic tests. Do not import it from application code.
Use the existing private `DATABASE_MIGRATION_URL` direct-connection convention.
Reject pooler URLs, masked `SET ROLE` sessions and ordinary runtime credentials;
require direct ownership of all tables this operator touches before reducing
privileges to the existing runtime group inside each transaction.

Prepare accepts a closed input: operation `grant` or `revoke`, fixed tenant `crc`,
expected bootstrap audit ID, expected owner user ID, exact target user ID, and
target membership/grant identifiers where present. No arbitrary SQL, role,
tenant, email search, name matching, URL, callback or capability selector.

Return a bounded private review descriptor containing those exact identities,
owner grant ID/revision and membership authority revision, target membership
state/revision, target admin grant state/ID/revision, operation and short expiry
(proposed ten minutes). For first grant, explicitly represent absent membership
and/or absent admin history. Include the latest revoked grant tuple if deliberate
new issuance is supported. No names, contacts, auth tokens or session material.

The CLI can write this descriptor to an explicitly selected private file outside
the checkout. Apply requires the complete descriptor plus `--confirm-digest`
matching its canonical SHA256; a generic `--confirm` is insufficient. The digest
confirms the reviewed bytes, not authority. Apply independently reauthorizes and
compares every expected field under locks; it trusts neither prepare-time state
nor possession of a review file. Expired/stale plans require another prepare.
No signing service, stored bearer token or new secret is necessary.

## Transaction and invariants

1. On one direct client, BEGIN, SET LOCAL ROLE, bind only CRC, then lock the enabled
   CRC tenant FOR UPDATE. This is the same first authority lock used by existing
   writes and serializes bootstrap/owner changes and application capabilities.
2. Require exactly one well-formed bootstrap event, not merely one DISTINCT actor.
   Its actor user/membership/admin-grant/target must agree with each other and the
   supplied immutable owner pin. Validate the owner is verified, membership
   enabled and bound admin grant active. Never create/adopt another bootstrap
   event, infer ownership from any admin grant, or recover a disabled owner here.
3. Lock owner/target user rows in stable ID order, then their CRC memberships in
   stable ID order, then relevant admin grants in stable ID order. No application
   session is impersonated: the direct private operator credential is the entry
   authority. Recheck all prepared identities, revisions and states. Context
   updates are last; unrelated tenant/global identities are never mutated.
4. Grant inserts a fresh admin-grant UUID only for the exact verified target.
   Existing disabled membership is a denial, never re-enabled. If approved,
   explicit expected-absent membership may be created atomically. An active admin
   is a conflict. Never clear `revoked_at`, rewrite grant identity or revive any
   context. A deliberately approved regrant must be a new row with explicitly
   confirmed revoked-history state, not automatic restoration.
5. Revoke targets only the exact active admin grant and expected revision; update
   revoked time/revision conditionally. Deny the immutable owner's grant even
   when other admins exist. Require at least one remaining usable admin (verified
   identity, enabled CRC membership, active admin grant), independently of raw
   grant count. Keep owner identity singular; granting another CRC admin does not
   make another platform owner. Revoke contexts tied to that grant last, matching
   existing revocation behavior; preserve other grants, relationships and sessions.
6. Append one existing `grant.issue`/`grant.revoke` audit in the same transaction,
   actor bound to the verified owner grant and target bound to the affected grant.
   Use a distinct `owner-admin` target type, never `owner-bootstrap`. Commit all
   changes together. Audit failure rolls everything back. Retry after a committed
   apply returns stale/conflict, not another grant/audit; prepare can inspect again.

The tenant lock and conditional revisions handle competing prepared commands;
no distributed lock or advisory-lock namespace is needed. These invariants apply
to reviewed paths; possession of unrestricted database-owner credentials already
permits bypassing application safeguards through arbitrary SQL.

## Acceptance and decisions

Synthetic tests: closed descriptor/digest/expiry; exact owner/target/revisions;
missing/duplicate/malformed owner binding; absent/unverified/disabled targets;
owner or last-usable-admin denial; stale/replayed apply; no revival; atomic audit;
fixed errors with no identity, SQL, driver cause or connection disclosure. CLI
subprocesses use `isolatedEnv`; success prints only fixed status categories.

Real PostgreSQL tests must prove normal/masked runtime refusal, FORCE RLS scope,
role/context reset after commit/rollback, two competing grants or revokes with
one effect/audit, mutation winning between prepare/apply, no deadlock with existing
capability lock order, and an in-flight admin operation finishing before revoke
while subsequent admin/study access denies. Assert existing runtime privileges
are unchanged. Independent adversarial review is mandatory before reporting done.

Resolved choices: expected-absent membership creation and deliberate fresh-row
regrant with exact history confirmation are allowed as stated above. Neither
permits restoring a revoked row. Owner transfer,
disabled-owner recovery and emergency removal of the owner's admin grant remain
separate unresolved recovery policy, outside this command.
