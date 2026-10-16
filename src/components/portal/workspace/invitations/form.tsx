"use client";
import type { FormEvent } from "react";
import type { RosterStudent } from "../api";
import { inviteRoleNames, type InviteDraft, type InviteRole } from "./api";

export function InvitationForm({ draft, change, students, ready, pending, blocked, review }: {
  draft: InviteDraft; change(value: InviteDraft): void; students: RosterStudent[]; ready: boolean; pending: boolean; blocked: boolean; review(): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); review(); }
  const active = students.filter(row => !row.disabledAt);
  return <section className="invitation-compose" aria-labelledby="invite-compose-title"><h2 id="invite-compose-title">Invite a person</h2>
    <p>Choose the recipient and one role explicitly. Creating a student record or entering a contact email never grants access. Each parent or student invitation links one selected student.</p>
    <form onSubmit={submit}>
      <div className="invitation-form-fields"><div><label htmlFor="invite-role">Invitation role</label><select id="invite-role" value={draft.role} disabled={pending} onChange={event => change({ ...draft, role: event.target.value as InviteRole, studentId: "" })}>{Object.entries(inviteRoleNames).map(([role, name]) => <option key={role} value={role}>{name}</option>)}</select></div>
        <div><label htmlFor="invite-email">Recipient email</label><input id="invite-email" type="email" autoComplete="off" maxLength={254} value={draft.email} required disabled={pending} onChange={event => change({ ...draft, email: event.target.value })} /></div></div>
      {draft.role !== "tutor" && <div className="invitation-student"><label htmlFor="invite-student">Student to link</label><select id="invite-student" required value={draft.studentId} disabled={!ready || pending} onChange={event => change({ ...draft, studentId: event.target.value })}><option value="">Choose a student</option>{active.map(row => <option key={row.id} value={row.id}>{row.firstName} {row.lastName} — {row.ceremonyDate}</option>)}</select>
        {ready && !active.length && <p>No active student is available. Create a student record before inviting a parent or student.</p>}</div>}
      <p className="field-help">{draft.role === "student" ? "A student uses their own verified mailbox. Do not use a parent’s mailbox to create a child identity." : draft.role === "parent" ? "A parent may use the same mailbox for siblings. Send a separate invitation for each child; acceptance is always explicit." : "A tutor invitation grants the tutor role only. Student assignments are managed separately."}</p>
      <button className="button-secondary" disabled={!ready || pending || blocked}>Review invitation</button>
    </form>
  </section>;
}
