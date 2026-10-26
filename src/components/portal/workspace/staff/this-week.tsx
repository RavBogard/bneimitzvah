"use client";
import { WorkspaceLink } from "../provider";
import { ceremonyCountdown } from "../reading";
import { serviceSlotName } from "../service-slot";
import { addDays, congregationToday } from "../../../../lib/readings/public-shabbat";

export type WeekStudent = { id: string; firstName: string; lastName: string; ceremonyDate: string; rehearsal1?: string | null; rehearsal2?: string | null; serviceSlot: string; disabledAt?: string | null; ceremonyDoneAt?: string | null };
export type WeekEntry = { key: string; student: WeekStudent; date: string };

/** The seven days starting today in the congregation's time zone. Dates are YYYY-MM-DD, so a plain string compare orders them. */
export function weekWindow(now: number = Date.now()) { const from = congregationToday(now); return { from, through: addDays(from, 6) }; }

/** The ceremonies and the rehearsals that fall in the week, soonest first, for students who are still active. */
export function weekAhead(students: readonly WeekStudent[], now: number = Date.now()): { ceremonies: WeekEntry[]; rehearsals: WeekEntry[] } {
  const { from, through } = weekWindow(now), inside = (date: string | null | undefined): date is string => !!date && date >= from && date <= through;
  const ceremonies: WeekEntry[] = [], rehearsals: WeekEntry[] = [];
  for (const student of students) {
    if (student.disabledAt || student.ceremonyDoneAt) continue;
    if (inside(student.ceremonyDate)) ceremonies.push({ key: `${student.id}:ceremony`, student, date: student.ceremonyDate });
    ([student.rehearsal1, student.rehearsal2] as const).forEach((date, index) => { if (inside(date)) rehearsals.push({ key: `${student.id}:rehearsal${index + 1}`, student, date }); });
  }
  const order = (a: WeekEntry, b: WeekEntry) => a.date.localeCompare(b.date) || `${a.student.lastName} ${a.student.firstName}`.localeCompare(`${b.student.lastName} ${b.student.firstName}`);
  return { ceremonies: ceremonies.sort(order), rehearsals: rehearsals.sort(order) };
}

function WeekList({ id, title, entries }: { id: string; title: string; entries: readonly WeekEntry[] }) {
  return <section className="this-week-list" aria-labelledby={id} data-testid={id}>
    <h2 id={id}>{title}</h2>
    {!entries.length ? <p className="needs-you-empty">None this week.</p> : <ul className="roster-list" aria-labelledby={id}>{entries.map(({ key, student, date }) => {
      const slot = serviceSlotName(student.serviceSlot);
      return <li key={key} className="roster-row" data-student-id={student.id}>
        <WorkspaceLink className="roster-row-main" href={`/workspace/admin/students/${encodeURIComponent(student.id)}/reading`}>
          <span className="roster-row-name"><bdi dir="auto">{student.firstName} {student.lastName}</bdi></span>
          <span className="roster-row-meta"><time dateTime={date}>{ceremonyCountdown(date).label}</time>{slot && <span>{slot}</span>}</span>
        </WorkspaceLink>
      </li>;
    })}</ul>}
  </section>;
}

/** The admin's "This week" after Needs you: the ceremonies and the rehearsals in the next seven days. */
export function ThisWeekLists({ students, now }: { students: readonly WeekStudent[]; now?: number }) {
  const { ceremonies, rehearsals } = weekAhead(students, now);
  return <>
    <WeekList id="this-week-ceremonies" title="Ceremonies this week" entries={ceremonies} />
    <WeekList id="this-week-rehearsals" title="Rehearsals this week" entries={rehearsals} />
  </>;
}
