# People with access, and Make tutor (2026-11-03)

Daniel asked: "a way to see everyone who has signed in and has an account, and quickly elevate them to being a tutor within the UI."

## Decided here (lead, logged)

- **Where:** the admin Accounts page (`src/components/portal/workspace/accounts/workspace.tsx`). Its admin-only "Members" card becomes "People with access". The request queue and approvers cards stay as they are. Pending requests already show the people who signed in and asked.
- **Who is listed:** every membership in the actor's tenant that is not disabled and has either an active `tenant_member` row or at least one active `role_grant`. One row per membership. Each row shows the name and the role chips Member, Tutor, Admin, Parent and Student (in that order, only the active ones), plus "Since <date>": the earliest of the member row's or the grants' creation dates. Names only, with no email, matching the members-view precedent ("No email, no counts").
  - Name source: the `tenant_member.display_name` if there is one, otherwise `user.name`. Sort by name, then by id. Limit 500.
  - Not listed: people who signed in and never asked. The portal keeps no tenant record of them (sessions carry no tenant). The gap goes in the report; there's no backfill.
- **Make tutor:** an admin-only action on any listed row that has no active tutor grant and no active student grant. Students include adult learners, who are also excluded: making them tutors means picking a different account. It uses two steps, as "End membership" does: "Make tutor", then "Make tutor now: <name>" or "Cancel".
  - Server: a new `POST /api/accounts/people/make-tutor` takes `{ membershipId }`. It is admin-only and needs a fresh session (the same 15-minute rule as `manage-invites`, since this grants authority without the person accepting) and `requireCookieMutation`.
  - In one tenant transaction, lock the membership and refuse 404 if it is missing, in another tenant, or disabled. Lock its grants. Refuse 409 `already-tutor` if a tutor grant is active, and 409 `student` if a student grant is active. Then insert a tutor `role_grant` with the existing `insertGrant` shape and write a `grant.issue` audit event.
  - A tutor grant this membership had before and that was revoked does not block the action: this is an explicit admin act, unlike an invitation replay.
  - Send no email. The person sees the tutor view on their next load.
- **No undo button** in this slice. The portal has no tutor-revoke path yet, and building one (with tutor_student links and approver designations) is its own slice. The confirm step is the guard. Listed as a gap.
- **Guard test:** `tests/accounts-structure.test.mjs` names the places that may insert grants. Add the new one there deliberately, with a comment citing this spec.
- **List endpoint:** extend `GET /api/accounts/members` in place (renaming would churn tests), or add `GET /api/accounts/people`. Pick the smaller diff. Either way it stays `read-accounts`, admin mode only, and private/no-store.

## Wording (lead's, decided; use exactly)

- Card heading: `People with access`
- Card intro: `Everyone with an account here. Make someone a tutor to give them the tutor view, then assign their students on each student’s page.`
- Row button: `Make tutor` (aria-label `Make tutor: <name>`); confirm `Make tutor now` (aria-label `Make tutor now: <name>`) and `Cancel` (aria-label `Keep as is: <name>`)
- Success: `<name> is now a tutor. Assign their students on each student’s page.`
- Fresh-session refusal (403 on this action): reuse the invitations UI's existing re-sign-in message and sign-in link if there is one; otherwise `For your security, sign in again, then make the tutor.` with the existing sign-in link.
- 409 already-tutor: `<name> is already a tutor. The list has been reloaded.`. 409 student: `A student account can’t also be a tutor. The list has been reloaded.`
- Empty list: `No one has an account here yet.`
- The existing "End membership" control stays, shown only on rows that have an active member row.

## Tests (targeted)

- App (Vitest/PGlite): the list includes member-only, grant-only and both kinds, excludes disabled memberships and other tenants, and sets chips correctly. Make tutor: admin with a fresh session succeeds and writes a grant and an audit event. Refused for a stale session (403), a tutor-mode actor (403), a cross-tenant membershipId (404), a disabled membership (404), an already-tutor (409) and a student (409). Two concurrent calls leave one active grant (the partial unique index) and return a clean 409, not a 500.
- UI: one deliberate wording test for the card, plus a behaviour test of the two-step confirm.
