// Release 1.9 N14/N15: the staff screens' pure rules, unit-tested without a browser.
// Wording is Daniel's (PLAN Strings: tier A, tier B "Keep all", and the 2026-10-26 Needs-you rows), word for word.

export type FamilyState = "joined" | "invited" | "expiring" | "expired" | "none";
export type StudentStatus = { id: string; tutors: number; family: FamilyState | null; reading: "none" | "confirmed" | "review"; honors: boolean; tutorName: string | null; got: number; total: number };
export type NeedsYouCondition = "no-tutor" | "behind" | "invitation-expired" | "needs-invitation" | "no-reading" | "reading-review" | "no-service" | "honors" | "link-request";
export type NeedsYouStudent = { id: string; firstName: string; lastName: string; ceremonyDate: string; rehearsal1?: string | null; rehearsal2?: string | null; serviceSlot: "morning" | "havdalah" | "unknown"; disabledAt: string | null; ceremonyDoneAt?: string | null };
/** The nearest rehearsal or ceremony that has not passed, and how many days away it is. */
export type NextEvent = { kind: "rehearsal" | "ceremony"; date: string; days: number };
/** One student's row: everything that needs the rabbi, in setup order, under the date that makes it urgent. */
export type StudentNeed = { student: NeedsYouStudent; conditions: Exclude<NeedsYouCondition, "link-request">[]; days: number; next: NextEvent };
/** Link requests waiting are the one row that belongs to no student (Readings for everyone E4): a count, opening Account requests. */
export type LinkRequestNeed = { student: null; condition: "link-request"; days: number; count: number };
export type NeedsYouRow = StudentNeed | LinkRequestNeed;

/** The window "Needs you" looks at: ceremonies from today through eight weeks out. */
export const NEEDS_YOU_DAYS = 56;
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

/** The order a student's conditions take: the setup path (tutor, practice, family, reading, service, honors). */
const ORDER: Exclude<NeedsYouCondition, "link-request">[] = ["no-tutor", "behind", "invitation-expired", "needs-invitation", "no-reading", "reading-review", "no-service", "honors"];
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
/**
 * One row per active student whose ceremony is within eight weeks and who has something to set up, ranked by what needs the rabbi:
 * first students with a rehearsal or ceremony within two weeks who have no tutor or are behind, then everyone else, soonest next
 * rehearsal or ceremony first. Behind means fewer than half the verses marked Got it. A child's family with no invitation at all
 * needs one; so does any student the invitations service names (N22's /api/admin/invitations/needed, passed as `needsInvitation`).
 * A family whose invitation expired gets "Send a new one" instead. Disabled and ceremony-done students are never listed.
 */
export function needsYouRows(students: readonly NeedsYouStudent[], statuses: ReadonlyMap<string, StudentStatus>, now = new Date(), needsInvitation: ReadonlySet<string> = new Set(), linkRequests = 0): NeedsYouRow[] {
  const rows: StudentNeed[] = [];
  for (const student of students) {
    if (student.disabledAt || student.ceremonyDoneAt) continue;
    const days = daysUntil(student.ceremonyDate, now), status = statuses.get(student.id);
    if (days < 0 || days > NEEDS_YOU_DAYS || !status) continue;
    const next = nextEvent(student, now), conditions: StudentNeed["conditions"] = [];
    if (status.tutors === 0) conditions.push("no-tutor");
    if (next.days <= BEHIND_WITHIN_DAYS && status.total > 0 && status.got * 2 < status.total) conditions.push("behind");
    if (status.family === "expired") conditions.push("invitation-expired");
    else if (status.family === "none" || status.family !== null && status.family !== "joined" && needsInvitation.has(student.id)) conditions.push("needs-invitation");
    if (status.reading === "none") conditions.push("no-reading");
    if (status.reading === "review") conditions.push("reading-review");
    if (student.serviceSlot === "unknown") conditions.push("no-service");
    if (!status.honors) conditions.push("honors");
    if (conditions.length) rows.push({ student, conditions: conditions.sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y)), days, next });
  }
  const urgent = (row: StudentNeed) => row.next.days <= BEHIND_WITHIN_DAYS && (row.conditions.includes("no-tutor") || row.conditions.includes("behind")) ? 0 : 1;
  const sorted = rows.sort((a, b) => urgent(a) - urgent(b) || a.next.days - b.next.days || a.student.ceremonyDate.localeCompare(b.student.ceremonyDate) || a.student.id.localeCompare(b.student.id));
  // Link requests belong to no ceremony, so they come first: someone is waiting to be linked.
  return linkRequests > 0 ? [{ student: null, condition: "link-request" as const, days: 0, count: linkRequests } satisfies LinkRequestNeed, ...sorted] : sorted;
}

/** What a row says, then its one verb (the link or button text). Approved 2026-10-26 and in tier B. */
export const NEEDS_YOU_TEXT: Record<StudentNeed["conditions"][number], { text: string; verb: string }> = {
  "no-tutor": { text: "No tutor yet.", verb: "Choose a tutor." },
  "behind": { text: "Behind on practice.", verb: "Open the reading." },
  "invitation-expired": { text: "The family's invitation expired.", verb: "Send a new one." },
  "needs-invitation": { text: "", verb: "Needs a parent invitation" },
  "no-reading": { text: "No reading yet.", verb: "Assign the reading." },
  "reading-review": { text: "Reading needs review", verb: "Confirm reading is still right" },
  "no-service": { text: "No service date yet.", verb: "Set the service." },
  "honors": { text: "Honors not started.", verb: "Open the honors form." },
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
