# People, round 2: Remove tutor, tutor-and-student, heading (2026-11-03)

These follow #166 (SPEC.md). Daniel's answers, 2026-11-03 popups (binding):
1. Keep the verified emails on People with access.
2. Build Remove tutor now.
3. A person may be both tutor and student. Allow it in both directions.
4. Rename the page "People".

## 1. Remove tutor

- **Where:** a row button on People with access, admin only, on rows with the Tutor chip. It takes two steps, as Make tutor does: `Remove tutor` (aria-label `Remove tutor: <name>`), then `Remove tutor now: <email or name>` (aria-label `Remove tutor now: <name>, <email>`) and `Cancel` (aria-label `Keep as tutor: <name>`). Use the `roster-danger` / `people-danger` styling, as End membership does.
- **Server:** `POST /api/accounts/people/remove-tutor`, body `{ membershipId }`. It needs a fresh admin session (the `manage-tutors` capability) and `requireCookieMutation`. In one tenant transaction, under the same tenant authority lock order as Make tutor:
  - Lock the membership: 404 if it is missing, in another tenant, or disabled. Lock its grants: 409 `not-tutor` if there is no active tutor grant.
  - Refuse 409 `self` when the target is the actor's own membership. An admin removing their own tutor role mid-session is a footgun; another admin can do it.
  - Set `revoked_at` on the tutor role_grant, every active `tutor_student` row on that grant, and any live `account_approver` designation bound to that grant (with `revoked_by_membership_id` = the actor).
  - Audit `grant.revoke` on the grant. Check the existing audit action vocabulary for revoking the links and the designation, and reuse its names.
  - Find every other table that keys on a tutor grant: grep `tutorGrantId`, `tutor_grant_id`, `roleGrantId` and `practice_context`, and the Claude MCP connections in `src/server/connections`. Make sure nothing keeps working on the revoked grant. A practice context or MCP connection bound to it must stop authorizing. Rely on the existing live-grant checks where they already exist, and show that with a test.
  - History is kept: revoke, never delete.
  - After removal, Make tutor works again. A revoked grant doesn't block it, as SPEC.md already says.
- **Success line:** `<name> is no longer a tutor. Their students keep everything they’ve done.` 409 not-tutor: `<name> isn’t a tutor any more. The list has been reloaded.` 409 self: `You can’t remove your own tutor role. Ask another admin.`
- **Existing Tutors page:** `/workspace/admin/tutors` exists, so check what it does. If it already has an unassign or remove path, reuse its server logic rather than duplicating it, and say so in the report.

## 2. Tutor and student both allowed

- Make tutor no longer refuses a student: drop the 409 `student` code from the server, the client and the tests. The button shows on Student rows too, still only with a verified email.
- No change is needed in student-invite acceptance or link approval, since they already allow it. Add one test showing a tutor can then be linked as a student, so the rule is pinned.
- Check that a membership holding both tutor and student grants works in the workspace role chooser (both roles offered). If anything assumed the two can't coexist (for example the `notALearner` learner-claim pool in `src/server/data/learner-claims.ts`), keep its current behaviour for tutors and note it in the report. Don't redesign it.

## 3. Heading and the small fix

- In `src/components/portal/workspace/accounts/workspace.tsx`, the admin page title changes from "Members" to "People". In `src/components/portal/shell/people-nav.tsx`, the nav label changes from "Members" to "People". Update the tests that match.
- Make tutor's confirm aria-label becomes `Make tutor now: <name>, <email>` (screen readers hear the email).
