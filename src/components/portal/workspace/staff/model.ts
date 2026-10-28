// Release 1.9 N14/N15: the staff screens' pure rules, unit-tested without a browser.
// Wording is Daniel's (PLAN Strings: tier A, tier B "Keep all"); the This week chips and lines are decided here (2026-10-28 walk) and listed in the PR.

export type FamilyState = "joined" | "invited" | "expiring" | "expired" | "none";
export type StudentStatus = { id: string; tutors: number; family: FamilyState | null; reading: "none" | "confirmed" | "review"; honors: boolean; tutorName: string | null; got: number; total: number };
export type NeedsYouStudent = { id: string; firstName: string; lastName: string; ceremonyDate: string; rehearsal1?: string | null; rehearsal2?: string | null; serviceSlot: "morning" | "havdalah" | "unknown"; disabledAt: string | null; ceremonyDoneAt?: string | null };
/** The nearest rehearsal or ceremony that has not passed, and how many days away it is. */
export type NextEvent = { kind: "rehearsal" | "ceremony"; date: string; days: number };
/** The conditions that show as a chip on a student's card, most urgent first; a card shows at most MAX_CHIPS. */
export type ChipCondition = "no-tutor" | "behind" | "needs-parent" | "reading-review";
/** The conditions that stay a one-verb line under the card: setup, not who needs attention. */
export type TaskCondition = "no-reading" | "no-service" | "honors";
/** One student's card on This week: the next rehearsal or ceremony, what is wrong (at most two chips) and what is left to set up. */
export type WeekCard = { student: NeedsYouStudent; chips: ChipCondition[]; tasks: TaskCondition[]; days: number; next: NextEvent };
export const MAX_CHIPS = 2;

/** The window This week looks at: ceremonies from today through eight weeks out. */
export const NEEDS_YOU_DAYS = 56;
/** A rehearsal or ceremony within this many days is "this week". */
export const WEEK_DAYS = 6;
const DAY_MS = 86_400_000;
/** Whole days from today (the viewer's calendar date) to an ISO date. */
export function daysUntil(date: string, now = new Date()) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS);
}
/** AD-12: a ceremony entered on a Sunday is probably a typo. */
export function isSunday(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(value.getTime()) && value.getUTCDay() === 0;
}

/** Within this many days of the next rehearsal or ceremony, a student with less than half the verses got is behind. */
export const BEHIND_WITHIN_DAYS = 14;
/** The nearest rehearsal or ceremony from today on; a rehearsal that has passed is ignored. */
export function nextEvent(student: Pick<NeedsYouStudent, "ceremonyDate" | "rehearsal1" | "rehearsal2">, now = new Date()): NextEvent {
  const events: NextEvent[] = [];
  for (const date of [student.rehearsal1, student.rehearsal2]) if (date) { const days = daysUntil(date, now); if (days >= 0) events.push({ kind: "rehearsal", date, days }); }
  events.push({ kind: "ceremony", date: student.ceremonyDate, days: daysUntil(student.ceremonyDate, now) });
  return events.sort((a, b) => a.days - b.days || (a.kind === "rehearsal" ? -1 : 1))[0];
}
/** "Rehearsal today", "Rehearsal tomorrow", "Rehearsal in 5 days"; the same for "Beit Mitzvah". */
export function nextEventLine(next: NextEvent) {
  const what = next.kind === "rehearsal" ? "Rehearsal" : "Beit Mitzvah";
  return next.days <= 0 ? `${what} today` : next.days === 1 ? `${what} tomorrow` : `${what} in ${next.days} days`;
}
const CHIP_ORDER: ChipCondition[] = ["no-tutor", "behind", "needs-parent", "reading-review"];
const TASK_ORDER: TaskCondition[] = ["no-reading", "no-service", "honors"];
/**
 * This week (admin walk 2026-10-28): one card per active student who has a rehearsal or ceremony in the next seven days or something to
 * set right, soonest next rehearsal or ceremony first. A card shows at most two chips, most urgent first: no tutor, behind (fewer than half
 * the verses marked Got it, within two weeks of the next date), a parent to invite (no invitation, an expired one, or one the invitations
 * service names via `needsInvitation`), a reading to confirm. No reading, no service date and no honors form stay as one-verb lines.
 * Disabled and ceremony-done students are never listed, nor is anyone whose ceremony is past or beyond eight weeks with nothing this week.
 */
export function weekCards(students: readonly NeedsYouStudent[], statuses: ReadonlyMap<string, StudentStatus> | null, now = new Date(), needsInvitation: ReadonlySet<string> = new Set()): WeekCard[] {
  const cards: WeekCard[] = [];
  for (const student of students) {
    if (student.disabledAt || student.ceremonyDoneAt) continue;
    const days = daysUntil(student.ceremonyDate, now), status = statuses?.get(student.id), next = nextEvent(student, now);
    // With the facts unread (statuses null) the cards still show this week's dates; with them read, a student missing from them is skipped.
    if (days < 0 || statuses && !status || (days > NEEDS_YOU_DAYS && next.days > WEEK_DAYS)) continue;
    const chips = new Set<ChipCondition>(), tasks = new Set<TaskCondition>();
    if (status) {
      if (status.tutors === 0) chips.add("no-tutor");
      if (next.days <= BEHIND_WITHIN_DAYS && status.total > 0 && status.got * 2 < status.total) chips.add("behind");
      if (status.family === "expired" || status.family === "none" || status.family !== null && status.family !== "joined" && needsInvitation.has(student.id)) chips.add("needs-parent");
      if (status.reading === "review") chips.add("reading-review");
      if (status.reading === "none") tasks.add("no-reading");
      if (student.serviceSlot === "unknown") tasks.add("no-service");
      if (!status.honors) tasks.add("honors");
    }
    if (chips.size || tasks.size || next.days <= WEEK_DAYS) cards.push({ student, chips: CHIP_ORDER.filter(chip => chips.has(chip)).slice(0, MAX_CHIPS), tasks: TASK_ORDER.filter(task => tasks.has(task)), days, next });
  }
  return cards.sort((a, b) => a.next.days - b.next.days || a.student.ceremonyDate.localeCompare(b.student.ceremonyDate) || a.student.id.localeCompare(b.student.id));
}

/** A chip's words, and where it leads. */
export const CHIP_TEXT: Record<ChipCondition, string> = { "no-tutor": "Needs a tutor", "behind": "Behind on practice", "needs-parent": "Needs a parent", "reading-review": "Reading to confirm" };
/** What a setup line says, then its one verb: "Honors not started" with its verb inline after it, "Open the honors form". */
export const TASK_TEXT: Record<TaskCondition, { text: string; verb: string }> = {
  "no-reading": { text: "No reading yet", verb: "Assign the reading" },
  "no-service": { text: "No service date yet", verb: "Set the service" },
  "honors": { text: "Honors not started", verb: "Open the honors form" },
};

/** "3 link requests waiting", "1 link request waiting". */
export const linkRequestLine = (count: number) => `${count} link ${count === 1 ? "request" : "requests"} waiting`;
/** What the empty Needs you says: what was checked, so an empty list never reads as nothing looked at (Readings for everyone E4). */
export const NEEDS_YOU_EMPTY = "Nothing needs you this week: no readings to review, no link requests, no invitations waiting.";

/** The roster row's status chips, from the same facts. Each chip is the first words of an approved row (see the PR's gaps). */
export function statusChips(student: Pick<NeedsYouStudent, "serviceSlot" | "disabledAt" | "ceremonyDoneAt">, status: StudentStatus | undefined): string[] {
  if (!status || student.disabledAt || student.ceremonyDoneAt) return [];
  const chips: string[] = [];
  if (status.family === "expiring") chips.push("Expires tomorrow");
  if (status.reading === "none") chips.push("No reading yet");
  if (status.reading === "review") chips.push("Reading needs review");
  if (student.serviceSlot === "unknown") chips.push("No service date yet");
  return chips;
}
/** "Tutor: Dana Walkman" or "No tutor yet" (a second tutor adds "and 1 more"). */
export const tutorLine = (name: string | null, tutors: number) => name === null || tutors === 0 ? "No tutor yet" : `Tutor: ${name}${tutors > 1 ? ` and ${tutors - 1} more` : ""}`;
/** "Parent: joined" or "Parent: not joined yet"; nothing for an adult, who has no parent record. */
export const parentLine = (family: FamilyState | null) => family === null ? null : family === "joined" ? "Parent: joined" : "Parent: not joined yet";
/** "6 of 12 verses got"; nothing until a reading is assigned. */
export const progressLine = (got: number, total: number) => total > 0 ? `${got} of ${total} ${total === 1 ? "verse" : "verses"} got` : null;
/** The facts a staff row shows under a student's name: who teaches, whether a parent joined, and how far along the verses are. */
export const studentFacts = (status: StudentStatus): string[] => [tutorLine(status.tutorName, status.tutors), parentLine(status.family), progressLine(status.got, status.total)].filter((line): line is string => line !== null);

/** A This week card's facts: who teaches (no line when no one does, the chip says so) and the verses got; whether a parent joined is a chip when it needs doing. */
export const cardFacts = (status: StudentStatus): string[] => [status.tutors > 0 ? tutorLine(status.tutorName, status.tutors) : null, progressLine(status.got, status.total)].filter((line): line is string => line !== null);

/** Sorts students by ceremony date, soonest first, then by name (G10: "students sorted by ceremony date"). */
export function byCeremony<T extends { ceremonyDate: string; lastName: string; firstName: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.ceremonyDate.localeCompare(b.ceremonyDate) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));
}

const TORAH_SHORT: Record<string, string> = { Genesis: "Gen", Exodus: "Exod", Leviticus: "Lev", Numbers: "Num", Deuteronomy: "Deut" };
/** "Genesis 23:1" -> "Gen 23:1"; after the first, a verse in the same book shows chapter and verse only ("Gen 23:1, 23:10, 24:7"). */
export function verseList(refs: readonly string[]) {
  let book = "";
  return refs.map(ref => {
    const match = /^(.+?) (\d+:\d+)$/.exec(ref); if (!match) return ref;
    const name = TORAH_SHORT[match[1]] ?? match[1];
    if (name === book) return match[2];
    book = name; return `${name} ${match[2]}`;
  }).join(", ");
}
/** "Genesis 23:10" -> "23:10" (the verse as the tutor's note label names it). */
export const chapterVerse = (ref: string) => /(\d+:\d+)$/.exec(ref)?.[1] ?? ref;
/** TP-01: "Noa is still working on 3 verses: Gen 23:1, 23:10, 24:7". */
export function stillWorkingLine(firstName: string, refs: readonly string[]) {
  return `${firstName} is still working on ${refs.length} ${refs.length === 1 ? "verse" : "verses"}: ${verseList(refs)}`;
}
/** AD-04: "Teaches 3 students: Noa, Eli, Leah". */
export function teachesLine(names: readonly string[]) {
  return `Teaches ${names.length} ${names.length === 1 ? "student" : "students"}: ${names.join(", ")}`;
}
/** TP-12: the family line on the tutor's student page. Names come from the server already sanitized; never an address. */
export function familyLine(value: { kind?: "child" | "adult"; joined: readonly string[]; invited: boolean; neverInvited?: boolean }) {
  if (value.joined.length) return value.joined.map(name => `Family: ${name} (joined)`);
  // "Family: not joined yet" (decided here): invited before, but that invitation expired or was withdrawn.
  return value.invited ? ["Family: invitation sent, not yet accepted"] : value.neverInvited ? ["Family: not invited yet"] : value.kind === "child" ? ["Family: not joined yet"] : [];
}
/**
 * G12 (TP-05): a child's family can't name aliyah honorees until the Torah reading is divided into aliyot. Worked out only from
 * the reading the tutor already sees and the student's kind: no honors data, so no honoree name, is ever read for it.
 */
export function waitingForDivisions(kind: "child" | "adult" | undefined, readings: readonly { kind: "torah" | "haftarah"; aliyahStarts: readonly string[] | null }[]) {
  const torah = readings.find(row => row.kind === "torah");
  return kind === "child" && torah !== undefined && torah.aliyahStarts === null;
}
export const waitingLine = (firstName: string) => `${firstName}'s family is waiting for aliyah divisions to name aliyah honorees.`;
/** TP-15: how many of the seven honors sections a saved form has filled in. */
export const HONORS_SECTIONS = 7;
type Named = { englishName?: string | null };
export function savedSections(form: { openingArk: readonly Named[]; generationToGeneration: readonly Named[]; undressingTorah: readonly Named[]; aliyot: readonly { participants: readonly Named[] }[];
  redressingTorah: readonly Named[]; closingArk: readonly Named[]; parentalBlessing: { participation: null | "yes" | "no" } }) {
  const named = (people: readonly Named[]) => people.some(person => person.englishName?.trim());
  return [named(form.openingArk), named(form.generationToGeneration), named(form.undressingTorah), form.aliyot.some(group => named(group.participants)),
    named(form.redressingTorah), named(form.closingArk), form.parentalBlessing.participation !== null].filter(Boolean).length;
}
export const honorsRowLine = (saved: number) => `Family honors · ${saved} of ${HONORS_SECTIONS} sections saved`;
