"use client";
import type { FormEvent } from "react";
import type { RosterStudent } from "../api";
import { inviteRoleNames, type InviteDraft, type InviteRole } from "./api";

export function InvitationForm({ draft, change, students, ready, pending, blocked, review }: {
  draft: InviteDraft; change(value: InviteDraft): void; students: RosterStudent[]; ready: boolean; pending: boolean; blocked: boolean; review(): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); review(); }
  // N21: a student whose ceremony is done is not on the active roster, so is not offered here.
  const active = students.filter(row => !row.disabledAt && !row.ceremonyDoneAt);
  return <section className="invitation-compose people-card" aria-labelledby="invite-compose-title"><div className="people-card-head"><h2 id="invite-compose-title">Invite someone</h2>
    <p>They get an email link, sign in with that address and accept. Nothing changes until they do.</p></div>
    <form onSubmit={submit} className="invitation-form">
      <fieldset className="roster-choice" disabled={pending}><legend>Invitation role</legend>{(Object.entries(inviteRoleNames) as [InviteRole, string][]).map(([role, name]) => <label key={role}><input type="radio" name="invite-role" value={role} checked={draft.role === role} onChange={() => change({ ...draft, role, studentId: "" })} />{name}</label>)}</fieldset>
      <div className="roster-form-grid"><div className="roster-field"><label htmlFor="invite-email">Recipient email</label><input id="invite-email" type="email" autoComplete="off" maxLength={254} value={draft.email} required disabled={pending} onChange={event => change({ ...draft, email: event.target.value })} /></div>
        {draft.role !== "tutor" && <div className="roster-field"><label htmlFor="invite-student">Student to link</label><select id="invite-student" required value={draft.studentId} disabled={!ready || pending} onChange={event => change({ ...draft, studentId: event.target.value })}><option value="">Choose a student</option>{active.map(row => <option key={row.id} value={row.id}>{row.firstName} {row.lastName} — {row.ceremonyDate}</option>)}</select>
          {ready && !active.length && <p className="field-help">No active students yet. Add a student before inviting a parent or student.</p>}</div>}</div>
      <p className="field-help">{draft.role === "student" ? "Use the student’s own email, not a parent’s." : draft.role === "parent" ? "A parent can use one email for siblings. Send one invitation per child." : "Once they accept, they become a tutor. Then assign students to them from each student’s People page."}</p>
      <button className="button-primary admin-pill invitation-review-button" disabled={!ready || pending || blocked}>Review invitation</button>
    </form>
  </section>;
}
