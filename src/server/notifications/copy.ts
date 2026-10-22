import { WEEKDAYS } from "./schedule";
import { HIDDEN as HIDDEN_MARKS } from "../study-guides/validation";

/**
 * The exact words of every notification (plain, warm, short; English only). A subject never names a
 * student; a body names only the first names of the students this recipient may already see.
 */
export type Message = Readonly<{ subject: string; text: string }>;
export type Links = Readonly<{ portal: string; settings: string; unsubscribe: string }>;
export type DigestStudent = Readonly<{
  firstName: string; practicedDays: number | null; ceremonyDate: string | null; serviceLine: string | null;
  rehearsals: readonly string[]; lessons: readonly Readonly<{ lessonDate: string; author: string; summary: string }>[]; verseNotes: number;
}>;

// Names come from accounts and the roster: one plain line, no control, bidi or invisible marks, bounded.
const HIDDEN = new RegExp(String.raw`[\p{Cc}` + HIDDEN_MARKS.source.slice(1, -1) + "]", "gu");
export function plainName(value: unknown, max = 60): string | null {
  if (typeof value !== "string" || !value.isWellFormed()) return null;
  const text = value.replace(HIDDEN, " ").replace(/\s+/g, " ").trim();
  if (!text || text.includes("@") || [...text].length > max) return null;
  return text;
}
/** A greeting name: the first word of the account's name, or none. */
export function greetingName(value: unknown) { const name = plainName(value, 120); return name ? plainName(name.split(" ")[0], 40) : null; }
const greeting = (name: string | null) => name ? `Hi ${name},` : "Hello,";
function paragraph(value: string, max: number) {
  const text = value.toWellFormed().replace(HIDDEN, " ").replace(/\s+/g, " ").trim();
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const days = (n: number) => n === 1 ? "1 day" : `${n} days`;
function footer(why: string, stop: string, links: Links) {
  return ["--", why, `${stop}: ${links.unsubscribe}`, `Email settings: ${links.settings}`].join("\n");
}

export function tutorDraftMessage(input: { product: string; tutorName: string | null; studentFirstName: string; links: Links }): Message {
  return {
    subject: "A new translation draft to read",
    text: [
      greeting(input.tutorName), "",
      `${input.studentFirstName} saved a translation draft in ${input.product}. Sign in to read it:`, "",
      input.links.portal, "",
      "You'll get at most one of these a day for each student.", "",
      footer(`You're getting this because you're ${input.studentFirstName}'s tutor in ${input.product}.`, "Stop draft emails", input.links),
    ].join("\n"),
  };
}

function digestBlock(student: DigestStudent): string[] {
  const lines = [student.firstName];
  if (student.practicedDays !== null) lines.push(student.practicedDays === 0 ? "- No practice was recorded in the last 7 days." : `- Practiced on ${days(student.practicedDays)} of the last 7.`);
  if (student.ceremonyDate) {
    lines.push(`- Ceremony: ${longDate(student.ceremonyDate)}${student.serviceLine ? ` · ${student.serviceLine}` : ""}`);
  }
  if (student.rehearsals.length) lines.push(`- Rehearsal${student.rehearsals.length === 1 ? "" : "s"}: ${student.rehearsals.map(longDate).join("; ")}`);
  if (student.lessons.length) {
    lines.push("- Lesson notes:");
    for (const lesson of student.lessons) lines.push(`  ${shortDate(lesson.lessonDate)}, ${lesson.author}: ${paragraph(lesson.summary, 300)}`);
  }
  if (student.verseNotes > 0) lines.push(`- New tutor notes on ${student.verseNotes === 1 ? "1 verse" : `${student.verseNotes} verses`} of the reading. Sign in to read them.`);
  return lines;
}
export function weeklyDigestMessage(input: { product: string; recipientName: string | null; students: readonly DigestStudent[]; audience: "parent" | "self" | "both"; links: Links }): Message {
  const blocks = input.students.flatMap((student, i) => [...(i ? [""] : []), ...digestBlock(student)]);
  const why = input.audience === "self" ? `You're getting this because you turned on weekly updates in ${input.product}.`
    : `You're getting this because you're a parent of a student in ${input.product}.`;
  return {
    subject: "Your weekly Beit Mitzvah update",
    text: [greeting(input.recipientName), "", "Here is this week's update.", "", ...blocks, "", `Sign in to see more: ${input.links.portal}`, "",
      footer(why, "Stop weekly updates", input.links)].join("\n"),
  };
}

export function practiceReminderMessage(input: { product: string; studentFirstName: string; practicedDays: number | null; ceremonyDate: string | null; weekday: number; links: Links }): Message {
  const lines = [greeting(input.studentFirstName), "", "This is your weekly reminder to practice your reading. A few minutes counts."];
  if (input.practicedDays) lines.push("", `You practiced on ${days(input.practicedDays)} of the last 7.`);
  if (input.ceremonyDate) lines.push("", `Your ceremony is on ${longDate(input.ceremonyDate)}.`);
  lines.push("", `Open your reading: ${input.links.portal}`, "",
    footer(`You're getting this because you asked ${input.product} for a practice reminder every ${WEEKDAYS[input.weekday]}.`, "Stop reminders", input.links));
  return { subject: "Your weekly practice reminder", text: lines.join("\n") };
}
