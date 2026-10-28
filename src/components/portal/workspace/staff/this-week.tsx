"use client";
import type { ReactNode } from "react";
import { WorkspaceLink } from "../provider";
import { ceremonyCountdown } from "../reading";
import { serviceSlotName } from "../service-slot";
import { cardFacts, CHIP_TEXT, linkRequestLine, nextEventLine, NEEDS_YOU_EMPTY, TASK_TEXT, type ChipCondition, type NeedsYouStudent, type StudentStatus, type TaskCondition, type WeekCard } from "./model";

type Open = (student: NeedsYouStudent, event: { currentTarget: HTMLElement }) => void;
/**
 * This week (admin walk 2026-10-28): one card per student, the soonest next rehearsal or Beit Mitzvah first. A card names the student, says
 * when the next date is (a ceremony's service too), who teaches and how many verses are got, then shows at most two chips for what is wrong,
 * each leading to its fix, and one line per piece of setup left. Link requests waiting are a single line above the list. With nothing to show,
 * it says what was checked (Daniel's wording), unless the facts couldn't be read (`read` false): then only the dates show.
 */
export function ThisWeekCards({ cards, statuses, linkRequests = 0, read = true, disabled, onEdit, onHonors }: { cards: readonly WeekCard[]; statuses: ReadonlyMap<string, StudentStatus>; linkRequests?: number; read?: boolean; disabled: boolean; onEdit: Open; onHonors: Open }) {
  return <section className="needs-you" aria-label="This week" data-testid="this-week-cards">
    {linkRequests > 0 && <p className="accounts-line" data-testid="link-request-line"><WorkspaceLink href="/workspace/accounts">{linkRequestLine(linkRequests)}</WorkspaceLink></p>}
    {!cards.length ? (linkRequests === 0 && read && <p className="needs-you-empty">{NEEDS_YOU_EMPTY}</p>) : <ul className="roster-list">{cards.map(card => <Card key={card.student.id} card={card} status={statuses.get(card.student.id)} disabled={disabled} onEdit={onEdit} onHonors={onHonors} />)}</ul>}
  </section>;
}

function Card({ card, status, disabled, onEdit, onHonors }: { card: WeekCard; status: StudentStatus | undefined; disabled: boolean; onEdit: Open; onHonors: Open }) {
  const { student, next } = card, id = encodeURIComponent(student.id), slot = next.kind === "ceremony" ? serviceSlotName(student.serviceSlot) : null;
  const where: Record<ChipCondition, string> = { "no-tutor": `/workspace/admin/students/${id}/access`, "needs-parent": `/workspace/admin/invitations?student=${id}&role=parent`, "behind": `/workspace/admin/students/${id}/reading`, "reading-review": `/workspace/admin/students/${id}/reading` };
  return <li className="roster-row needs-you-row" data-student-id={student.id} data-chips={card.chips.join(" ")} data-tasks={card.tasks.join(" ")}>
    <div className="roster-row-main">
      <span className="roster-row-name"><WorkspaceLink href={`/workspace/admin/students/${id}/reading`}><bdi dir="auto">{student.firstName} {student.lastName}</bdi></WorkspaceLink></span>
      <span className="roster-row-meta" data-testid="week-date"><time dateTime={next.date}>{nextEventLine(next)} · {ceremonyCountdown(next.date).label}</time>{slot && <span>{slot}</span>}</span>
      {status && cardFacts(status).length > 0 && <span className="roster-row-meta">{cardFacts(status).map(line => <span key={line} data-testid="student-fact">{line}</span>)}</span>}
      {card.chips.length > 0 && <span className="needs-you-chips">{card.chips.map(chip => <WorkspaceLink key={chip} className="roster-chip needs-you-chip" href={where[chip]} data-chip={chip}>{CHIP_TEXT[chip]}</WorkspaceLink>)}</span>}
      {card.tasks.length > 0 && <ul className="needs-you-tasks">{card.tasks.map(task => <li key={task} className="needs-you-task" data-task={task}>{taskLine(task, student, id, disabled, onEdit, onHonors)}</li>)}</ul>}
    </div>
  </li>;
}

function taskLine(task: TaskCondition, student: NeedsYouStudent, id: string, disabled: boolean, onEdit: Open, onHonors: Open): ReactNode {
  const copy = TASK_TEXT[task];
  const verb = task === "no-reading" ? <WorkspaceLink href={`/workspace/admin/students/${id}/reading`}>{copy.verb}</WorkspaceLink>
    : <button type="button" className="button-text" disabled={disabled} onClick={event => (task === "no-service" ? onEdit : onHonors)(student, event)}>{copy.verb}</button>;
  return <><span className="needs-you-task-text">{copy.text}</span> {verb}</>;
}
