"use client";
import { useEffect, useRef } from "react";
import { inviteRoleNames, issueReview, type InviteDraft, type Invitation } from "./api";

export type InvitationReview = { kind: "issue"; draft: InviteDraft; target: ReturnType<typeof issueReview> } | { kind: "reissue" | "revoke"; row: Invitation; fingerprint: string };
export function InvitationActionReview({ review, valid, pending, confirm, cancel }: { review: InvitationReview; valid: boolean; pending: boolean; confirm(): void; cancel(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [review]);
  const role = review.kind === "issue" ? review.target.selection.role : review.row.role;
  const email = review.kind === "issue" ? review.target.selection.email : review.row.recipientEmail;
  const student = review.kind === "issue" ? review.target.student : review.row.student;
  return <section className="invitation-action-review" aria-labelledby="invite-action-title"><h2 id="invite-action-title" tabIndex={-1} ref={heading}>{review.kind === "issue" ? "Review before sending" : review.kind === "reissue" ? "Review replacement invitation" : "Review invitation revocation"}</h2>
    <dl className="invitation-details"><div><dt>Recipient</dt><dd><bdi dir="auto">{email}</bdi></dd></div><div><dt>Role</dt><dd>{inviteRoleNames[role]}</dd></div>{student && <div><dt>Student</dt><dd><bdi dir="auto">{student.firstName} {student.lastName}</bdi></dd></div>}</dl>
    {review.kind === "issue" && review.target.student && <p>Ceremony date: <time dateTime={review.target.student.ceremonyDate}>{review.target.student.ceremonyDate}</time></p>}
    <p>{review.kind === "revoke" ? "Revoke this exact invitation. No email is sent. Revoking an invitation does not remove a role or relationship already accepted."
      : review.kind === "reissue" ? "Create a new 72-hour invitation for the same recipient, role and student. The server revokes this exact previous invitation when it creates the replacement. The previous link will not be restored if delivery fails."
      : "Send a 72-hour invitation. The recipient must sign in with the matching verified email and explicitly accept before access is granted."}</p>
    {!valid && <p role="status">The target changed or is being rechecked. Reload and review the current record before continuing.</p>}
    <div className="form-actions"><button className="button-primary" disabled={!valid || pending} onClick={confirm}>{pending ? "Confirming action…" : review.kind === "issue" ? "Send reviewed invitation" : review.kind === "reissue" ? "Confirm reissue" : "Confirm revocation"}</button><button className="button-secondary" disabled={pending} onClick={cancel}>Cancel invitation action</button></div>
  </section>;
}
