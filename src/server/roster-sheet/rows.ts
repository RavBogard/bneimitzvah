import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { confirmedReadings } from "../data/portal";
import { readingView } from "../portal/service";
import * as s from "../db/index";

export const ROSTER_HEADER = Object.freeze(["Student", "Hebrew name", "Date", "Slot", "Parashah", "Torah verses", "Haftarah verses", "Tutor", "Rehearsal 1", "Rehearsal 2"]);
const SLOT: Record<string, string> = { morning: "Morning", havdalah: "Havdalah", unknown: "" };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Plain text only; the writer sends RAW values, so nothing is ever read as a formula. */
const cell = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 500) : "";

/** The staff roster, one row per current student in ceremony order: names, dates, readings, tutors. No contact data. */
export async function rosterRows<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string): Promise<string[][]> {
  const students = await tx.select().from(s.student).where(and(eq(s.student.tenantId, tenantId), isNull(s.student.disabledAt)))
    .orderBy(asc(s.student.ceremonyDate), asc(s.student.lastName), asc(s.student.id)).limit(1000);
  const rows: string[][] = [[...ROSTER_HEADER]];
  for (const student of students) {
    const tutors = await tx.select({ name: s.user.name }).from(s.tutorStudent)
      .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.tutorStudent.tenantId), eq(s.roleGrant.id, s.tutorStudent.tutorGrantId), isNull(s.roleGrant.revokedAt)))
      .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId), isNull(s.membership.disabledAt)))
      .innerJoin(s.user, eq(s.user.id, s.membership.userId))
      .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, student.id), isNull(s.tutorStudent.revokedAt))).orderBy(asc(s.user.name));
    let parashah = "", torah = "", haftarah = "";
    for (const row of await confirmedReadings(tx, tenantId, student.id)) {
      let reading; try { reading = readingView(row, student.ceremonyDate); } catch { continue; }
      if (reading.kind === "torah") {
        torah = reading.ranges.join("; ");
        parashah = String(object(object(object(row.snapshot).source).reading).parashah ?? "");
      } else haftarah = reading.ranges.join("; ");
    }
    const extra = student as unknown as Record<string, unknown>;
    rows.push([`${student.firstName} ${student.lastName}`, student.hebrewName ?? "", student.ceremonyDate, SLOT[student.serviceSlot] ?? "", parashah, torah, haftarah,
      tutors.map(t => t.name).join(", "), typeof extra.rehearsal1 === "string" ? extra.rehearsal1 : "", typeof extra.rehearsal2 === "string" ? extra.rehearsal2 : ""].map(cell));
  }
  return rows;
}
