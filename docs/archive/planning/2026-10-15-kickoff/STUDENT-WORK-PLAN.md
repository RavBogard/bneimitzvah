# Student translations and tutor notes — approved backend slice 2026-10-16

Approved by Astra/root for this bounded backend implementation. Basis: MISSION 12 and the
approved auth capability matrix. Scope is saved per-verse student translations
and student-visible plain-text staff notes. No chatbot, generated commentary,
MCP summaries, recording, public cache or assignment editing.

## Accepted implementation choices (Astra, 2026-10-16)

Uniform explicit per-verse CAS applies to both drafts and notes. Currently
assigned verses expose authorized history across older/re-added assignment
revisions to every authorized read mode. Notes use append-only, student-visible
corrections; no private flag, edit or retraction. Frontend autosave remains later
work. Independent adversarial review and real PostgreSQL gates precede acceptance;
the implementation handoff is `STUDENT-WORK-RETURN.md`.

Schema amendment approved during implementation: context UUID is server-derived,
immutable historical attribution, without an FK to ephemeral practice contexts or
auth sessions. Their existing cascade cleanup must remain functional. Durable
membership/user, typed grant, assignment/student and exact guardian/student/parent
grant FKs enforce retained lineage. The existing capability locks and validates
the live context at each operation; the UUID is never an authority grant. No
context table, cleanup policy or durable registry is added.

## Authority and assignment boundary

Draft writes use the existing literal `practice-write` capability: own student or
active child practice only. Parent mode reads linked work; assigned tutors/admins
read and give feedback through notes, never edit student translations. Note writes
need a new literal staff `note-write` capability with the same live student/link
checks, data-write intent and same-origin mutation guard. Child practice grants no
staff role union. All modes read only student-visible notes; there is no private
staff visibility flag in this slice.

Every page, history, receipt read and mutation supplies current kind/assignment
ID/revision. Inside one capability transaction, lock the confirmed assignment
before its verse rows, re-expand canonical ranges and verify exact ordered refs.
Each requested verse must belong to that live assignment. A foreign/unrelated
student remains 404; assignment drift is fixed 409; invalid input 400; unavailable
data 503. Return conflicts as callback results, not custom exceptions that the
identity wrapper would turn into 503. Recheck session/context expiry after waits.
No provider or other network work runs in these transactions.

Current assignments update in place and their verse rows are deleted/reinserted.
Historical work therefore keeps a stable composite FK to assignment/student plus
immutable observed assignment revision/ref; it must not FK to mutable revision
or `assignment_verse`. Removed verses cannot be read through history, receipt or
guessed record IDs. Their data remains stored without becoming an access grant.

## Storage and optimistic writes

Add append-only `translation_draft` and `tutor_note` tables. Both carry tenant,
student, canonical verse, positive stream version, observed assignment ID/revision,
text, creation time and server-derived attribution. Draft uniqueness is exactly
`(tenant_id, student_id, verse_ref, version)` across assignment revisions. Notes use
their own corresponding per-verse version stream. Request fields are closed;
clients never choose tenant, actor, guardian, visibility, author or stored version.

Store real actor user/membership/grant/mode, acting student and, for child practice,
guardian/context IDs. A parent-assisted draft remains attributable to that parent.
Staff notes identify the staff author and target learner, never masquerade as
student writing. Use tenant composite student/assignment/actor/grant FKs (context
attribution follows the ephemeral-lifecycle amendment above),
the existing exact guardian/student/parent-grant tuple, typed role checks and mode
shape checks. History references remain valid after authority is revoked.

Use the accepted first-insert uniqueness path, without a mutable head table or
upgrading tenant/student SHARE locks. After live assignment validation, inspect
the indexed latest version and require `expectedVersion` (zero means no draft).
Attempt only `expectedVersion + 1` using `INSERT ... ON CONFLICT DO NOTHING
RETURNING`. A competing insertion wins one version; the loser rechecks its scoped
operation receipt, otherwise returns 409. It never advances automatically to the
next version. Notes use the same explicit version/CAS contract for a predictable
ordered feedback stream. Audit only a newly inserted version, in that transaction.

## Autosave and unknown outcomes

Each logical write has a client UUID retained across transport retries. Co-locate
its receipt with the immutable version row: unique tenant/student/actor/mutation
UUID, canonical request digest, base version and committed version. The digest
binds operation, verse, assignment binding, normalized text and selected mode;
stored actor fields are server-derived. Check live assignment/verse before any
replay lookup. Same UUID and identical canonical request acknowledge the original
commit; different content/scope conflicts. Both unique indexes use the no-op
conflict path so concurrent identical retries cannot abort the transaction or
duplicate an audit.

Receipts distinguish `committedVersion` from `currentLatestVersion`. Replaying an
old successful save after newer work never presents its contents as the current
head. A separately authorized read-only receipt lookup uses the current assignment
binding and same actor/verse; it may confirm a historical commit only while that
verse is currently assigned. Unknown/removed/revoked scopes reveal no old content.

Client contract: one in-flight save per learner/assignment/verse; retain the latest
unsent edit in memory. On timeout, recover receipt/current latest before another
logical write. Retry the identical UUID/body, never manufacture a new UUID for an
uncertain old save. If newer work exists, pause for conflict resolution; do not
silently rebase onto its version. Context/assignment switches discard late results
and clear the old autosave binding. No localStorage or service-worker persistence
is proposed. UI implementation is a later assignment.

## Bounds, history and database gates

Accepted defaults: text at most 4 KiB UTF-8, JSON body 32 KiB; preserve Unicode and
whitespace, normalize line endings only, reject malformed Unicode/NUL/unsafe
controls. Empty draft `""` explicitly appends a cleared version; absence/version 0
is distinct. Notes must contain non-whitespace text. Render as escaped text nodes,
never HTML/Markdown execution. Work pages follow at most 10 assigned verses with
latest draft and three recent notes each; separate per-verse history pages have
at most 20 versions and a version cursor. Responses cap at 256 KiB. Indexed lookups
and bounded queries avoid loading complete histories.

Enable/FORCE tenant RLS. Runtime receives SELECT/INSERT only on version tables;
unconditional UPDATE/DELETE rejection triggers preserve history even if a later
grant is mistaken. Add bounded text/version/mode checks, tenant indexes and unique
mutation/version constraints. Extend the closed audit action check narrowly for
draft/note append; audit stores attribution/IDs only, no text/digest/token. Migration
tests must prove composite FKs, grants, triggers and rollback behavior. Application
tenant SQL stays in `src/server/data/` under existing capabilities.

Accepted PM defaults: currently assigned verses expose their
latest work and authorized history across older assignment revisions, marked with
their original binding; removing then re-adding a verse restores that visibility.
All authorized read modes, including linked parents/new assigned tutors, see that
history. Notes remain student-visible after their author's relationship ends.
Approved policy: notes are append-only corrections in this slice, with no
edit/retraction/private flag; if retraction is required, it needs an explicit
versioned visibility policy before implementation. Long-term retention/export and
offline recovery are separate decisions, not inferred deletion or local storage.

Acceptance: the complete role/tenant matrix, closed inputs, empty clear versus
absence, exact assignment/verse checks on every surface, immutable attribution,
bounded history and hostile plain text. Real PostgreSQL must show same-base saves
and identical UUID retries produce one version/audit, mismatched UUID payloads
conflict, lost acknowledgments recover original versus current latest correctly,
and assignment replacement/removal or revocation/context switch either waits for
an authorized transaction to commit or denies the later operation. Include first
version races, rollback then retry, cross-tenant FKs/RLS, retained-history privacy
and no staff draft mutation. Independent adversarial review precedes acceptance.

Implementation: new student-work service/validation/data and
schema modules, additive migration and focused synthetic/PostgreSQL tests; narrow
capability, runtime and literal HTTP adapters. Preserve the existing study-text
pipeline and leave frontend/recording/MCP work to later bounded assignments.
