import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { digest } from "../students/bindings";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import type { VerseCounts } from "../../lib/readings/ranges";
import type { DetailsInput } from "./contract";

/**
 * What the music side's read-only Beit Mitzvah card shows for one ceremony (music contract BET-6).
 * Names, citations and dates only: never verse text, contacts, Hebrew names or notes. The receiver's
 * schema admits a reference only as one strict citation, so a reading that is not one contiguous
 * run of verses in one book is left out rather than approximated: a wrong citation is worse than none.
 */
export type CeremonyDetails = Omit<DetailsInput, "ceremonyId" | "sentAt">;

// The receiver's own patterns (centralreform.live src/lib/beit-mitzvah/contract.ts), checked here so a
// payload the receiver would refuse whole is never sent.
const NAME = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ '’&.-]*$/;
const CITATION = /^(?:[1-3] )?[A-Za-z]+(?: [A-Za-z]+)* \d{1,3}:\d{1,3}(?:[–-]\d{1,3}(?::\d{1,3})?)?$/;
const VERSE = /^(.+) ([1-9]\d*):([1-9]\d*)$/;

export function studentName(firstName: string, lastName: string): string | null {
  const name = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();
  return name.length <= 120 && NAME.test(name) ? name : null;
}

/** "I Samuel" is the catalog's spelling; the card reads "1 Samuel". */
const bookName = (book: string) => book.replace(/^III /, "3 ").replace(/^II /, "2 ").replace(/^I /, "1 ");

/** One citation for every verse given (the union over joint students), or null when they are not one contiguous run. */
export function citation(verseRefs: readonly string[], counts: VerseCounts = TANAKH_VERSE_COUNTS): string | null {
  const parsed = new Map<string, { book: string; chapter: number; verse: number }>();
  for (const ref of verseRefs) {
    const match = VERSE.exec(ref);
    if (!match) return null;
    parsed.set(ref, { book: match[1], chapter: Number(match[2]), verse: Number(match[3]) });
  }
  const verses = [...parsed.values()].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
  if (!verses.length) return null;
  const book = verses[0].book, chapters = counts[book];
  if (!chapters || verses.some(v => v.book !== book || v.chapter > chapters.length || v.verse > chapters[v.chapter - 1])) return null;
  for (let i = 1; i < verses.length; i++) {
    const before = verses[i - 1], next = before.verse < chapters[before.chapter - 1] ? { chapter: before.chapter, verse: before.verse + 1 } : { chapter: before.chapter + 1, verse: 1 };
    if (verses[i].chapter !== next.chapter || verses[i].verse !== next.verse) return null;
  }
  const first = verses[0], last = verses[verses.length - 1];
  const end = verses.length === 1 ? "" : first.chapter === last.chapter ? `–${last.verse}` : `–${last.chapter}:${last.verse}`;
  const text = `${bookName(book)} ${first.chapter}:${first.verse}${end}`;
  return text.length <= 60 && CITATION.test(text) ? text : null;
}

/**
 * The card's details from what the portal holds: active students' names, their confirmed readings and their
 * rehearsal dates. The slot is not sent: the portal knows only morning or Havdalah, which the music side
 * already holds and labels itself. Null when no active student has a name the receiver accepts.
 */
export async function loadCeremonyDetails<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, ceremonyId: string)
  : Promise<{ details: CeremonyDetails; omittedNames: number } | null> {
  const students = await tx.select({ id: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName, rehearsal1: s.student.rehearsal1, rehearsal2: s.student.rehearsal2 })
    .from(s.studentCeremony).innerJoin(s.student, and(eq(s.student.tenantId, s.studentCeremony.tenantId), eq(s.student.id, s.studentCeremony.studentId)))
    .where(and(eq(s.studentCeremony.tenantId, tenantId), eq(s.studentCeremony.ceremonyId, ceremonyId), isNull(s.student.disabledAt)))
    .orderBy(asc(s.student.lastName), asc(s.student.firstName), asc(s.student.id)).limit(7);
  const names = students.map(row => studentName(row.firstName, row.lastName)).filter((name): name is string => name !== null);
  if (!names.length || names.length > 6) return null;
  const ids = students.map(row => row.id);
  const verses = await tx.select({ kind: s.assignment.kind, ref: s.assignmentVerse.verseRef }).from(s.assignment)
    .innerJoin(s.assignmentVerse, and(eq(s.assignmentVerse.tenantId, s.assignment.tenantId), eq(s.assignmentVerse.assignmentId, s.assignment.id), eq(s.assignmentVerse.studentId, s.assignment.studentId)))
    .where(and(eq(s.assignment.tenantId, tenantId), inArray(s.assignment.studentId, ids), eq(s.assignment.status, "confirmed"), inArray(s.assignment.kind, ["torah", "haftarah"])))
    .limit(6 * 2 * 1001);
  const refs = (kind: "torah" | "haftarah") => citation(verses.filter(v => v.kind === kind).map(v => v.ref));
  const torahRef = refs("torah"), haftarahRef = refs("haftarah");
  const rehearsals = [...new Set(students.flatMap(row => [row.rehearsal1, row.rehearsal2]).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(0, 12);
  return { omittedNames: students.length - names.length,
    details: { students: names, ...(torahRef ? { torahRef } : {}), ...(haftarahRef ? { haftarahRef } : {}), ...(rehearsals.length ? { rehearsals } : {}) } };
}

/** The stored fingerprint: the details are resent only when this changes. */
export const detailsDigest = (details: CeremonyDetails) => digest(details);
