import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

export async function availableRoles<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, membershipId: string) {
  return tx.select({ role: s.roleGrant.role, id: s.roleGrant.id, revision: s.roleGrant.revision }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId),
    eq(s.roleGrant.membershipId, membershipId), isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.role)).for("share");
}

export async function confirmedReadings<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string) {
  // Lock the confirmed assignment versions before reading their verses. A
  // concurrent replacement cannot splice new verses into an old revision.
  const assignments = await tx.select({ id: s.assignment.id, kind: s.assignment.kind, basis: s.assignment.basis, ref: s.assignment.ref,
    revision: s.assignment.revision, snapshot: s.assignment.proposalSnapshot, aliyahStarts:s.assignment.aliyahStarts }).from(s.assignment).where(and(
    eq(s.assignment.tenantId, tenantId), eq(s.assignment.studentId, studentId), eq(s.assignment.status, "confirmed"),
    inArray(s.assignment.kind, ["torah", "haftarah"]))).orderBy(asc(s.assignment.kind)).limit(3).for("share");
  if (assignments.length > 2) throw new Error("Excess confirmed readings");
  const rows = [];
  for (const assignment of assignments) {
    const verses = await tx.select({ ref: s.assignmentVerse.verseRef }).from(s.assignmentVerse).where(and(
      eq(s.assignmentVerse.tenantId, tenantId), eq(s.assignmentVerse.studentId, studentId), eq(s.assignmentVerse.assignmentId, assignment.id)))
      .orderBy(asc(s.assignmentVerse.ordinal)).limit(1001);
    if (verses.length > 1000) throw new Error("Excess confirmed verses");
    rows.push({ ...assignment, verses: verses.map(verse => verse.ref) });
  }
  return rows.sort((a, b) => (a.kind === "torah" ? 0 : 1) - (b.kind === "torah" ? 0 : 1));
}
