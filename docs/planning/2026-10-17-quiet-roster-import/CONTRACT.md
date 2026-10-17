# Quiet roster import — 2026-10-17

## Settled decisions (Daniel, binding)

The private 34-row seed and full roster live outside the publish set under the original checkout's ignored `.local-data/roster/`. Never put their contents, contacts or notes in fixtures, logs, Git or this report. The ignore rule is now explicitly approved for commit; a path-only policy also rejects force-staged private data regardless of extension or contents.

Preserve exact five-column import and the existing explicit-kind six-column import. Accept the supplied full fourteen-column header as a second rich format. Student kind remains explicit, defaulting to child when omitted; an adult must have their own contact and may have no parent contact. Retain the existing child-contact requirement.

Import writes student rows and audit entries only. It must not issue invitations, send mail, create outbox records, create accounts or grants, or activate guardian/tutor relationships. Invitations remain a later explicit action by Daniel. The supplied tutor email list is not an authorization to invite or create anyone.

Store the supplied slot, Hebrew name, pending second guardian contact and remaining administrative intake details without losing them. Parashah is a display label only; reading proposals still derive from date and slot using the existing reviewed Hebcal path. Tutor name matching uses an existing eligible tutor grant in this tenant; ambiguous or unmatched names remain unassigned and are reported in preview. Notes are admin-only.

Dry-run the full private file through the actual preview/confirm path against a disposable local database only. Report aggregate created rows, tutor match outcomes, missing-second-parent rows and validation failures. Do not apply migrations, import or deploy to production for this task.

## Integration decisions

- Extend existing student storage rather than adding import-time relationship or invitation rows. Keep Hebrew name and pending second guardian email explicit; keep remaining intake details in a closed, typed, versioned administrative object. Ordinary edits must preserve intake details.
- A tutor match is a pending proposal stored on the student, not an active `tutor_student` relationship. This reconciles matching with Daniel's stricter student-and-audit-only write contract. The preview must say that assignment remains pending. Bind/revalidate the eligible name/grant snapshot on confirmation so a stale match cannot be silently applied.
- A second guardian contact confers no access. Existing explicit parent invitation acceptance creates the guardian link. Apply the existing prohibition on using a parent contact for student identity to both guardian contacts throughout invitation issue, reissue, review and acceptance.
- Existing non-admin student projections remain explicit and omit all administrative intake fields. Do not add a new screen or change navigation; offer the richer backend preview contract to Claude's current UI owner.
- Daniel's new per-record Havdalah time is an exception to preserve in private intake context; it does not authorize changing the global slot default. No real student facts are copied into public regression fixtures. Withdrawn students absent from the supplied file are not imported.

## Acceptance

Independent review covers repository protection, tenant-scoped matching, contact/authority separation, admin-only projection, silent import and stale preview behavior. Focused migration/import/invitation tests precede integration gates. The dry-run uses no production credentials, has no network/mail transport, preserves the original private files unchanged and produces only an ignored private detail report plus a safe aggregate summary.

## Open items that wait on Daniel

None for this local-only milestone. Invitation issuance and production roster application are separate future actions.
