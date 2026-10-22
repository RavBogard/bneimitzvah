# Claude connections page and Maven unlink — decided here (release 1.1, 2026-10-22)

Two follow-ups left open by the 1.0 release: [MCP decided](../2026-10-21-torah-study/MCP-DECIDED.md) had "no per-connection list in the portal yet", and [Maven intake decided](../2026-10-21-maven-intake/DECIDED.md) had "Undoing a wrong link" waiting. Both are staff-only; nothing here is student-visible. The MCP and Maven rulings there all hold.

## Claude connections

- **Where.** `/workspace/claude`, titled "Claude connections". An admin reaches it from the admin nav ("Claude", after Settings); every staff member (admin or tutor) from a line under the role list on the account page. It works whether or not `PORTAL_MCP_ENABLED` is set, so a connection can always be ended.
- **Who sees what.** A tutor sees and ends only their own connections. The rabbi or an admin sees their own and, under "Other staff", every other live staff connection in the congregation, and may end any of them. Parents, students and anonymous callers are refused (403/401). Another congregation's connection, a missing one, or (for a tutor) someone else's all answer 404 and change nothing.
- **What a row shows.** Client name, the staff member's display name (others only; a name containing an at sign is shown as "A staff member", so no address ever leaves the server), when it was approved, when it ends (30 days after approval), what it may do in plain words ("Read", "Study guides", "Roster") and "Scheduled routine" when ticked. No ids beyond the connection's own, no client hash or redirect.
- **Not shown: last used.** The portal does not record when a connection was last used (tokens are stored only as hashes with their issue time). Showing the newest token's issue time would be a guess, so the page shows approval and end dates instead. Recording use would be a migration and a write on every request; not done.
- GATE: ending a connection needs a sign-in from the last 15 minutes — proceeded because the portal's other access changes (inviting, and removing tutors, parents or student sign-ins: `manage-invites`, `manage-relationships`) already require it, and the brief said to follow the existing fresh-auth rules. The page says: "Ending a connection needs a recent sign-in. Sign out, sign in again, then end it within 15 minutes." Listing needs no fresh sign-in.
- **Immediate effect.** Ending sets `mcp_connection.revoked_at` (already granted to the runtime in 0028, set-once by trigger). Every MCP request, every tool call and every token exchange or refresh re-locks the connection and refuses a revoked one, so its access and refresh tokens stop working on the next request. A tool call already running holds a share lock on the connection; the revoke waits for it to finish and wins from then on.
- **Audit.** One `mcp-connection.revoke` row per revocation that actually ends a live connection (mode and grant of the person who ended it; target the connection). Ending one that already ended answers `{ ok: true, ended: false }` and writes nothing.

## Undoing a wrong Maven link

- **Append-only revocation.** `student_source_identity` keeps every row. An unlink stamps the current row once with `revoked_at`, who (user, membership, admin grant and role), the channel (`web` or `mcp`) and, through the MCP, the connection. A trigger allows only that one change, from current to revoked; nothing may be changed afterwards, not even by the owner, so a link is never revived. Linking again inserts a new row.
- **Uniqueness among current links.** The two unique constraints became partial unique indexes on `revoked_at is null`: one current link per Maven record and per student; history does not count.
- **Exact pair.** Both paths take the student and the Maven Contact Id it is linked to now. If that is not the student's current link nothing changes (`not-linked`; the MCP tool also says what the student is linked to now, or null). A stale request therefore never unlinks a newer link.
- **Serialized with applies; no old plan survives an unlink.** An unlink takes the roster intake's per-tenant advisory lock, then locks the row. A roster plan token now also binds how many Maven links have ever been undone in the congregation (a number that only grows); apply re-reads it under the same lock and refuses the plan (`plan-token-refused`, nothing written) if any unlink happened since the proposal. Without this, the plan that made an exact-match link (no fields changed) would see the same row state after the unlink and quietly link the same wrong student again, or create a second student (auditor finding, fixed). A new proposal shown to the rabbi is what links again.
- **Portal.** In the admin roster's student sheet a "Maven record" section appears only for a linked student: the Contact Id, since when, and "Unlink from Maven" with a confirm. Authority is the admin's `manage-students` (as for editing a student; no fresh sign-in, since an unlink gives no one access). Reading a link is admin-only (`read-relationships`).
- **MCP.** `unlink_maven_record` (admin, `portal:roster`, attended only; a routine never holds the scope and the tool refuses an unattended connection itself), with the rabbi's grant re-locked (`lockRabbi`), as `apply_roster_changes` does. The server instructions name it under the roster intake.
- **Audit.** `source-identity.revoke` (acting student, target the link row). The student record is not changed and gets no new revision.

## Migration 0033_source_identity_unlink

Journal idx 33, after `0032_notifications` (merged first, 2026-10-22), with a later `when` and its snapshot (`meta/0033_snapshot.json`) chained from 0032's. The audit list keeps every earlier action, including 0032's `notification-preference.set` and `notification.unsubscribe`, and adds `mcp-connection.revoke` and `source-identity.revoke`. A test checks that every journal `when` is strictly increasing, since the Drizzle migrator skips a migration stamped earlier than the last one applied.

## Open items that wait on Daniel

- None blocking. If ending a connection should not need a fresh sign-in (it removes access rather than granting it), that is a one-line change to the service.
