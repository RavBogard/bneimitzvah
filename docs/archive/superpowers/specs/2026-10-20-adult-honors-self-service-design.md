# Adult self-service honors

## Settled decisions (Daniel, binding)

On2026-10-20 Daniel approved adult Beit Mitzvah students managing their own honors form and their honorees' private blessing links, with staff oversight, matching parent capabilities for a child. This resolves the former adult-policy hold. Child-student and delegated practice authority stays unchanged. Generated voices and student recordings remain parked.

## Principal and authorization

Use the existing base student mode only for the selected student's own live role grant and exact live student_identity binding, with stored student_kind=adult checked after the existing student/identity/grant locks. Never infer authority from names, contacts, email or UI flags; never manufacture a guardian or cast a student as a parent. Preserve tenant, cookie, Origin, cancellation, final session/credential expiry and current transaction boundaries. Child, other adult/student/tenant, tutor, missing/revoked identity or grant and delegated practice must refuse.

Apply this gate before honors read/save/receipt and every blessing-link mutation/receipt/status/replay callback. Retain existing parent/admin authority. Guest lockIssuer independently verifies the original adult issuer's stored identity/grant/kind as well as existing bearer/material/context/epoch/revocation/expiry conditions. Receipt replay never recovers a plaintext URL. Post-COMMIT refusal does not claim rollback.

## Persistence and invalidation

Add explicit nullable student-identity attribution to honors_version, honoree_link and honoree_operation, with the existing tenant/id/student/grant composite student_identity foreign key and disjoint parent/admin/student actor-shape checks. Parent uses guardian only; admin uses neither; student uses student identity only. Retain original role/grant/user/membership/tenant keys and tenant RLS. Update internal schemas/types without exposing identity IDs in public DTOs. Add student-kind changes to permanent honoree student-epoch invalidation so adult→child→adult cannot restore a former link. Do not bump epochs or rewrite existing rows merely by upgrading.

## Migration sequencing

The active main source and accepted production ledger end at0023_honoree_links. Use ordinary next sequential0024_adult_self_honors on this separate feature branch. This is a new adult migration, not any historical parked recording migration with the same number. Preserve all existing SQL/journal entries/snapshots/hashes; derive only a new snapshot from active0023. Include no parked SQL/journal entries. Future parked work must be rebased/renumbered before integration. A dedicated release/source/catalog review and native0023→0024 upgrade proof precede any production operation; historical0023 operators must retain safe refusal on newer source.

## Bounded implementation

First finish backend authority/persistence and meaningful synthetic/native checks, with no new screens, production schema writes, real credentials/links/imports/invitations/mail/provider calls. Sol owns access/data/honors/honoree/schema/new migration and directly related tests. Root owns policy/design, independent auth/bearer review and final integration. Do not recursively delegate.

Then reuse the existing honors entry, sheet and link clients for adult base mode. A narrow server-projected own-adult eligibility flag on the student-list row may expose the affordance; each operation remains authoritative. Keep child/delegated affordances restricted, preserve private DOM/secret clearing, original action UUIDs, uncertain-save recovery and staff oversight. No new screen, navigation architecture or visual design is needed.

## Acceptance

Verify own-adult read/save/conflict/receipt, link issue/replace/revoke/status/receipt and scoped guest read; exact saved actor identity; unchanged parent/admin behavior; denials for every other principal/context; direct restricted DB constraints; kind/grant/identity races in both transaction orders; expiry/abort and permanent link invalidation; no plaintext recovery or secrets on denial. A real disposable0023→0024 upgrade must preserve populated parent/admin form/history/receipt/link rows and existing epochs. Fresh-schema-only evidence is insufficient. Independent authorization/bearer review, required hosted checks and a separately reviewed production release remain gates.

## Open items that wait on Daniel

No adult-honors policy question remains. Existing phone/listening acceptance for reference playback remains separate. No real recipient invitation or mail is authorized by this design.
