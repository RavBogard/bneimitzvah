"use client";
import type { ReactNode } from "react";
import { WorkspaceLink } from "../provider";
import { ceremonyCountdown } from "../reading";
import { NEEDS_YOU_TEXT, type NeedsYouRow, type NeedsYouStudent } from "./model";

type Open = (student: NeedsYouStudent, event: { currentTarget: HTMLElement }) => void;
/**
 * "Needs you" (1.9 N14, G10): ceremonies within eight weeks with something left to set up, soonest first, one row per thing
 * and one verb per row. Nothing is shown when nothing is left (that empty state has no approved words yet).
 */
export function NeedsYou({ rows, disabled, onEdit, onHonors }: { rows: readonly NeedsYouRow[]; disabled: boolean; onEdit: Open; onHonors: Open }) {
  if (!rows.length) return null;
  return <section className="needs-you" aria-labelledby="needs-you-heading" data-testid="needs-you">
    <h2 id="needs-you-heading">Needs you</h2>
    <ul className="roster-list">{rows.map(row => {
      const { student, condition } = row, id = encodeURIComponent(student.id), when = ceremonyCountdown(student.ceremonyDate), copy = NEEDS_YOU_TEXT[condition];
      let verb: ReactNode;
      if (condition === "no-tutor") verb = <WorkspaceLink href={`/workspace/admin/students/${id}/access`}>{copy.verb}</WorkspaceLink>;
      else if (condition === "invitation-expired" || condition === "needs-invitation") verb = <WorkspaceLink href={`/workspace/admin/invitations?student=${id}&role=parent`}>{copy.verb}</WorkspaceLink>;
      else if (condition === "no-reading" || condition === "reading-review") verb = <WorkspaceLink href={`/workspace/admin/students/${id}/reading`}>{copy.verb}</WorkspaceLink>;
      else verb = <button type="button" className="button-text" disabled={disabled} onClick={event => (condition === "no-service" ? onEdit : onHonors)(student, event)}>{copy.verb}</button>;
      return <li key={`${student.id}:${condition}`} className="roster-row needs-you-row" data-condition={condition} data-student-id={student.id}>
        <div className="roster-row-main"><span className="roster-row-name"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></span>
          <span className="roster-row-meta"><time dateTime={student.ceremonyDate}>{when.label}</time>{when.phrase && <span className="roster-row-days">{when.days > 1 ? `${when.days} days` : when.phrase}</span>}</span>
          <span className="needs-you-task">{copy.text && <>{copy.text} </>}{verb}</span></div>
      </li>;
    })}</ul>
  </section>;
}
