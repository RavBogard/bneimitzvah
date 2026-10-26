// Release 1.9 N14/N15: the staff screens' pure rules, unit-tested without a browser.
// Wording is Daniel's (PLAN Strings: tier A, tier B "Keep all", and the 2026-10-26 Needs-you rows), word for word.

export type FamilyState = "joined" | "invited" | "expiring" | "expired" | "none";
export type StudentStatus = { id: string; tutors: number; family: FamilyState | null; reading: "none" | "confirmed" | "review"; honors: boolean };
export type NeedsYouCondition = "no-tutor" | "invitation-expired" | "needs-invitation" | "no-reading" | "reading-review" | "no-service" | "honors";
export type NeedsYouStudent = { id: string; firstName: string; lastName: string; ceremonyDate: string; serviceSlot: "morning" | "havdalah" | "unknown"; disabledAt: string | null; ceremonyDoneAt?: string | null };
export type NeedsYouRow = { student: NeedsYouStudent; condition: NeedsYouCondition; days: number };

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

/** The order rows take inside one student: the setup path (tutor, family, reading, service, honors). */
const ORDER: NeedsYouCondition[] = ["no-tutor", "invitation-expired", "needs-invitation", "no-reading", "reading-review", "no-service", "honors"];
/**
 * One row per thing to do, each with one verb, for active students whose ceremony is within eight weeks; soonest first.
 * A child's family with no invitation at all needs one; so does any student the invitations service names (N22's
 * /api/admin/invitations/needed, passed as `needsInvitation`). A family whose invitation expired gets "Send a new one" instead.
 * Disabled and ceremony-done students are never listed.
 */
export function needsYouRows(students: readonly NeedsYouStudent[], statuses: ReadonlyMap<string, StudentStatus>, now = new Date(), needsInvitation: ReadonlySet<string> = new Set()): NeedsYouRow[] {
  const rows: NeedsYouRow[] = [];
  for (const student of students) {
    if (student.disabledAt || student.ceremonyDoneAt) continue;
    const days = daysUntil(student.ceremonyDate, now), status = statuses.get(student.id);
    if (days < 0 || days > NEEDS_YOU_DAYS || !status) continue;
    const add = (condition: NeedsYouCondition) => rows.push({ student, condition, days });
    if (status.tutors === 0) add("no-tutor");
    if (status.family === "expired") add("invitation-expired");
    else if (status.family === "none" || status.family !== null && status.family !== "joined" && needsInvitation.has(student.id)) add("needs-invitation");
    if (status.reading === "none") add("no-reading");
    if (status.reading === "review") add("reading-review");
    if (student.serviceSlot === "unknown") add("no-service");
    if (!status.honors) add("honors");
  }
  return rows.sort((a, b) => a.days - b.days || a.student.ceremonyDate.localeCompare(b.student.ceremonyDate) || a.student.id.localeCompare(b.student.id) || ORDER.indexOf(a.condition) - ORDER.indexOf(b.condition));
}

/** What a row says, then its one verb (the link or button text). Approved 2026-10-26 and in tier B. */
export const NEEDS_YOU_TEXT: Record<NeedsYouCondition, { text: string; verb: string }> = {
  "no-tutor": { text: "No tutor yet.", verb: "Choose a tutor." },
  "invitation-expired": { text: "The family's invitation expired.", verb: "Send a new one." },
  "needs-invitation": { text: "", verb: "Needs a parent invitation" },
  "no-reading": { text: "No reading yet.", verb: "Assign the reading." },
  "reading-review": { text: "Reading needs review", verb: "Confirm reading is still right" },
  "no-service": { text: "No service date yet.", verb: "Set the service." },
  "honors": { text: "Honors not started.", verb: "Open the honors form." },
};

/** The roster row's status chips, from the same facts. Each chip is the first words of an approved row (see the PR's gaps). */
export function statusChips(student: Pick<NeedsYouStudent, "serviceSlot" | "disabledAt" | "ceremonyDoneAt">, status: StudentStatus | undefined): string[] {
  if (!status || student.disabledAt || student.ceremonyDoneAt) return [];
  const chips: string[] = [];
  if (status.tutors === 0) chips.push("No tutor yet");
  if (status.family === "expiring") chips.push("Expires tomorrow");
  if (status.reading === "none") chips.push("No reading yet");
  if (status.reading === "review") chips.push("Reading needs review");
  if (student.serviceSlot === "unknown") chips.push("No service date yet");
  return chips;
}

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
export function familyLine(value: { joined: readonly string[]; invited: boolean }) {
  if (value.joined.length) return value.joined.map(name => `Family: ${name} (joined)`);
  return value.invited ? ["Family: invitation sent, not yet accepted"] : [];
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
