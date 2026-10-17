"use client";
import { inviteRoleNames, issueReview, type InviteDraft, type Invitation } from "./api";

export type InvitationReview = { kind: "issue"; draft: InviteDraft; target: ReturnType<typeof issueReview> } | { kind: "reissue" | "revoke"; row: Invitation; fingerprint: string };
// Shown in the invitation sheet, which focuses the heading once the sheet is open.
export function InvitationActionReview({ review, valid, pending, confirm, cancel }: { review: InvitationReview; valid: boolean; pending: boolean; confirm(): void; cancel(): void }) {
  const role = review.kind === "issue" ? review.target.selection.role : review.row.role;
  const email = review.kind === "issue" ? review.target.selection.email : review.row.recipientEmail;
  const student = review.kind === "issue" ? review.target.student : review.row.student;
  return <section className="invitation-action-review access-review" aria-labelledby="invite-action-title"><h2 id="invite-action-title" tabIndex={-1}>{review.kind === "issue" ? "Check before sending" : review.kind === "reissue" ? "Send this invitation again?" : "Revoke this invitation?"}</h2>
    <dl className="invitation-details"><div><dt>Recipient</dt><dd><bdi dir="auto">{email}</bdi></dd></div><div><dt>Role</dt><dd>{inviteRoleNames[role]}</dd></div>{student && <div><dt>Student</dt><dd><bdi dir="auto">{student.firstName} {student.lastName}</bdi></dd></div>}</dl>
    {review.kind === "issue" && review.target.student && <p className="field-help">Ceremony date: <time dateTime={review.target.student.ceremonyDate}>{review.target.student.ceremonyDate}</time></p>}
    <p className="access-consequence">{review.kind === "revoke" ? "The link stops working. No email is sent. Anything they have already accepted stays in place."
      : review.kind === "reissue" ? "A new link, good for 72 hours, goes to the same person. The old link stops working, even if the new email fails."
      : "They get a link that works for 72 hours. They must sign in with this email and accept before anything changes."}</p>
    {!valid && <p role="status">This is being checked again, or it changed. Reload and review the current invitation before continuing.</p>}
    <div className="form-actions"><button className={`button-primary admin-pill${review.kind === "revoke" ? " roster-danger" : ""}`} disabled={!valid || pending} onClick={confirm}>{pending ? (review.kind === "revoke" ? "Checking and revoking…" : "Checking and sending…") : review.kind === "issue" ? "Send invitation" : review.kind === "reissue" ? "Send new invitation" : "Revoke invitation"}</button><button className="button-secondary admin-pill" disabled={pending} onClick={cancel}>Cancel</button></div>
  </section>;
}
