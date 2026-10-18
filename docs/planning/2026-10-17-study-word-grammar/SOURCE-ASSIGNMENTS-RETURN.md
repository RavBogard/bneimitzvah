# Verse source assignments — return point

## Current checkpoint

Local implementation and independent backend review are accepted. The guarded migration release remains pending. Production remains discovery release `dfe8da5ca4bbd3c7a51119e3e84b4ce3dc84ad68`. No 0021 production SQL, new assignment UI, source-body fetch, roster import or mail has run.

The [reviewed design](../../superpowers/specs/2026-10-17-verse-source-assignments-design.md) defines immutable citation sets per current reading revision and verse. Staff can replace up to32 selected citations. New selections are resolved from the server-validated full discovery catalog outside SQL; removals need no provider. Fresh authority and original request bindings are checked again before an atomic version/receipt/audit commit. A later valid login can reconcile a compatible committed receipt; a missing receipt remains unconfirmed. New reading revisions start empty.

Implementation lives in `src/server/study/source-assignments-service.ts`, its strict validation/HTTP boundary, `src/server/data/source-assignments.ts` and additive migration0021. The new `source-write` capability is limited to administrator/assigned tutor; current authorized readers can read, including explicitly linked child practice. Existing study authorization and public metadata transport remain unchanged. Shared full-catalog normalization preserves discovery hashes and pages.

## Verification and limits

- Author13 plus independent19 application cases pass32/32; existing discovery guards pass34/34. The independent first run had18/19: the oversized-body assertion expected400 instead of the correct413; the test was corrected and its first result preserved privately. Two earlier author fixture failures were also repaired and preserved.
- Disposable native PostgreSQL author3 plus independent6 pass9/9 on their first native run. Three measured database wait edges cover pending rollback/retry, expiry at a unique-key wait and reading replacement. Separate cases cover competing-intent outcomes and a lost actual commit acknowledgement. FK/RLS/runtime privilege/immutable history and atomic audit rollback pass. The sole owned cluster was stopped and removed.
- Root normal production build, final independent TypeScript and six isolation/protection checks pass. Release review caught CRLF working SQL versus LF Git bytes: only new0021 was normalized, its two migration cases passed again, and canonical-LF catalog evidence is being recaptured before operator use. The first CRLF captures remain preserved and cannot stand in for LF deployment proof. Exact hosted checks remain pending. Synthetic tests establish no actual source listening, linguistic acceptance or iOS hardware behavior.

## Next action

Save the accepted core checkpoint locally. Implement and independently review a pinned0021 release operator using the captured native before/after catalog, unchanged historical migrations and existing transport/identity/lock protections. Run exact hosted checks, check-only migration, explicit additive apply and read-only verification before exposing endpoints in the canonical deployment. Preserve honest unknown/post-commit verification outcomes; no destructive schema rollback.

Reference playback stays administrator-only with student release false pending Daniel's actual-source word-tap/tab-return check. Generated voices and student recordings remain parked. This checkpoint does not complete1.0.
