"use client";
import { inviteRoleNames, type Invitation } from "./api";

// Short dates; the year appears when it isn't this year, and the exact time is in the tooltip.
const day = (value: string) => { const date = new Date(value); return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).format(date); };
const stamp = (label: string, value: string) => <span>{label} <time dateTime={value} title={new Date(value).toLocaleString()}>{day(value)}</time></span>;
const statusNames = { pending: "Not accepted yet", accepted: "Accepted", expired: "Expired", revoked: "Revoked" } as const;
const mailNames = { sent: "Email sent", failed: "Email failed", pending: "Email unconfirmed" } as const;

export function InvitationList({ rows, pending, blocked, select, copy }: { rows: Invitation[]; pending: boolean; blocked: boolean; select(kind: "reissue" | "revoke", row: Invitation, opener: HTMLElement): void; copy(row: Invitation): void }) {
  return <ol className="invitation-records people-list">{rows.map(row => {
    const status = statusNames[row.status], mail = mailNames[row.delivery.status];
    const when = row.acceptedAt ? stamp("Accepted", row.acceptedAt) : row.revokedAt ? stamp("Revoked", row.revokedAt) : stamp(row.status === "expired" ? "Expired" : "Expires", row.expiresAt);
    return <li key={row.id} className="people-row invitation-row"><article aria-labelledby={`invite-${row.id}`} className="invitation-row-body">
      <h3 id={`invite-${row.id}`}>{inviteRoleNames[row.role]}{row.student && <> for <bdi dir="auto">{row.student.firstName} {row.student.lastName}</bdi></>}</h3>
      <p className="invitation-recipient"><bdi dir="auto">{row.recipientEmail}</bdi></p>
      <p className="people-status"><span className={`invite-status invite-status-${row.status}`}>{status}</span><span className={row.delivery.status === "failed" ? "invite-mail-failed" : undefined}>{mail}</span>{stamp("Sent", row.createdAt)}{when}{row.expiresTomorrow && <span className="invite-expires-soon" data-testid="invite-expires-tomorrow">Expires tomorrow</span>}{row.delivery.attemptedAt && <span className="sr-only">Email attempted {new Date(row.delivery.attemptedAt).toLocaleString()}</span>}</p>
      {(row.status === "pending" || row.status === "expired") && <div className="people-actions invitation-row-actions"><button className="roster-action" aria-label={`Send again to ${row.recipientEmail}`} disabled={pending || blocked} onClick={event => select("reissue", row, event.currentTarget)}>Send again</button><button className="roster-action" data-testid="invite-copy-link" aria-label={`Copy link for ${row.recipientEmail}`} disabled={pending || blocked} onClick={() => copy(row)}>Copy link</button><button className="roster-action people-danger" aria-label={`Revoke invitation to ${row.recipientEmail}`} disabled={pending || blocked} onClick={event => select("revoke", row, event.currentTarget)}>Revoke</button></div>}
    </article></li>;
  })}</ol>;
}
