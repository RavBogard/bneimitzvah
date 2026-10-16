"use client";
import { inviteRoleNames, type Invitation } from "./api";

export function InvitationList({ rows, pending, blocked, select }: { rows: Invitation[]; pending: boolean; blocked: boolean; select(kind: "reissue" | "revoke", row: Invitation): void }) {
  return <ol className="invitation-records">{rows.map(row => <li key={row.id}><article aria-labelledby={`invite-${row.id}`}>
    <h3 id={`invite-${row.id}`}>{inviteRoleNames[row.role]}{row.student && <> for <bdi dir="auto">{row.student.firstName} {row.student.lastName}</bdi></>}</h3>
    <p className="invitation-recipient"><bdi dir="auto">{row.recipientEmail}</bdi></p>
    <dl className="invitation-record-details"><div><dt>Invitation</dt><dd>{row.status[0].toUpperCase() + row.status.slice(1)}</dd></div>
      <div><dt>Mail outcome</dt><dd>{row.delivery.status === "sent" ? "Sent — inbox receipt not verified" : row.delivery.status === "failed" ? "Failed — recorded by mail service" : "Unconfirmed — no background send is implied"}</dd></div>
      <div><dt>Created</dt><dd><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time></dd></div>
      <div><dt>Expires</dt><dd><time dateTime={row.expiresAt}>{new Date(row.expiresAt).toLocaleString()}</time></dd></div>
      {row.delivery.attemptedAt && <div><dt>Mail attempted</dt><dd><time dateTime={row.delivery.attemptedAt}>{new Date(row.delivery.attemptedAt).toLocaleString()}</time></dd></div>}
      {row.acceptedAt && <div><dt>Accepted</dt><dd><time dateTime={row.acceptedAt}>{new Date(row.acceptedAt).toLocaleString()}</time></dd></div>}
      {row.revokedAt && <div><dt>Revoked</dt><dd><time dateTime={row.revokedAt}>{new Date(row.revokedAt).toLocaleString()}</time></dd></div>}
    </dl>
    {(row.status === "pending" || row.status === "expired") && <div className="form-actions"><button className="button-secondary" disabled={pending || blocked} onClick={() => select("reissue", row)}>Review reissue</button><button className="button-text" disabled={pending || blocked} onClick={() => select("revoke", row)}>Review revocation</button></div>}
  </article></li>)}</ol>;
}
