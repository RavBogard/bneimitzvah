"use client";
import type { ReactNode } from "react";
import { WorkspaceLink } from "../provider";
import { linkRequestLine, nextEventLine, NEEDS_YOU_EMPTY, NEEDS_YOU_TEXT, studentFacts, type NeedsYouRow, type NeedsYouStudent, type StudentNeed, type StudentStatus } from "./model";

type Open = (student: NeedsYouStudent, event: { currentTarget: HTMLElement }) => void;
/**
 * "Needs you" (1.9 N14, G10, and the 2026-10-28 admin walk): one row per student, the ones who need the rabbi most first. Each row names the
 * next rehearsal or ceremony, who teaches, whether a parent joined and how many verses are got, then lists what is left to do, one verb each.
 * Link requests waiting are one row of their own. With nothing left, it says so (Daniel's wording). It is not shown at all when the facts couldn't be read.
 */
export function NeedsYou({ rows, statuses, disabled, onEdit, onHonors }: { rows: readonly NeedsYouRow[]; statuses: ReadonlyMap<string, StudentStatus>; disabled: boolean; onEdit: Open; onHonors: Open }) {
  return <section className="needs-you" aria-labelledby="needs-you-heading" data-testid="needs-you">
    <h2 id="needs-you-heading">Needs you</h2>
    {!rows.length ? <p className="needs-you-empty">{NEEDS_YOU_EMPTY}</p> : <ul className="roster-list">{rows.map(row => {
      if (row.student === null) return <li key="link-request" className="roster-row needs-you-row" data-condition="link-request">
        <div className="roster-row-main"><span className="needs-you-task"><WorkspaceLink href="/workspace/accounts">{linkRequestLine(row.count)}</WorkspaceLink></span></div></li>;
      return <StudentRow key={row.student.id} row={row} status={statuses.get(row.student.id)} disabled={disabled} onEdit={onEdit} onHonors={onHonors} />;
    })}</ul>}
  </section>;
}

function StudentRow({ row, status, disabled, onEdit, onHonors }: { row: StudentNeed; status: StudentStatus | undefined; disabled: boolean; onEdit: Open; onHonors: Open }) {
  const { student } = row, id = encodeURIComponent(student.id);
  return <li className="roster-row needs-you-row" data-student-id={student.id} data-conditions={row.conditions.join(" ")}>
    <div className="roster-row-main">
      <span className="roster-row-name"><WorkspaceLink href={`/workspace/admin/students/${id}/reading`}><bdi dir="auto">{student.firstName} {student.lastName}</bdi></WorkspaceLink></span>
      <span className="roster-row-meta"><time dateTime={row.next.date}>{nextEventLine(row.next)}</time>{status && studentFacts(status).map(line => <span key={line} data-testid="student-fact">{line}</span>)}</span>
      <ul className="needs-you-tasks">{row.conditions.map(condition => {
        const copy = NEEDS_YOU_TEXT[condition];
        let verb: ReactNode;
        if (condition === "no-tutor") verb = <WorkspaceLink href={`/workspace/admin/students/${id}/access`}>{copy.verb}</WorkspaceLink>;
        else if (condition === "invitation-expired" || condition === "needs-invitation") verb = <WorkspaceLink href={`/workspace/admin/invitations?student=${id}&role=parent`}>{copy.verb}</WorkspaceLink>;
        else if (condition === "no-reading" || condition === "reading-review" || condition === "behind") verb = <WorkspaceLink href={`/workspace/admin/students/${id}/reading`}>{copy.verb}</WorkspaceLink>;
        else verb = <button type="button" className="button-text" disabled={disabled} onClick={event => (condition === "no-service" ? onEdit : onHonors)(student, event)}>{copy.verb}</button>;
        return <li key={condition} className="needs-you-task" data-condition={condition}>{copy.text && <>{copy.text} </>}{verb}</li>;
      })}</ul>
    </div>
  </li>;
}
