import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessTransaction } from "../access/types";
import { withTenantTransaction } from "../db/runtime";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { integer, uuid } from "../student-work/validation";
import * as data from "../data/practice-calendar";
import { retention, serverInstant } from "./policy";

/** Called inside a tenant transaction, with the same lock-and-recheck rules for every caller. */
export async function prunePracticeBatch<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentIds: string[], limit: number, now: () => number) {
  const students = await data.lockStudents(tx, tenantId, studentIds); serverInstant(now());
  let remaining = limit, more = false;
  for (const student of students) {
    const fresh = () => retention(student.ceremonyDate, serverInstant(now()));
    fresh();
    if (remaining > 0) remaining -= await data.deleteRaw(tx, tenantId, student.id, fresh, remaining);
    const state = fresh();
    if (remaining > 0 && state.expired) remaining -= await data.deleteDays(tx, tenantId, student.id, () => fresh().expired, remaining);
    fresh();
    more = await data.hasExpired(tx, tenantId, student.id, fresh) || more; fresh();
  }
  serverInstant(now()); return { more };
}

/** Trusted internal composition for callers that already know their bounded batch. */
export function createPracticeCalendarMaintenance<Q extends PgQueryResultHKT>(input: { db: AccessDatabase<Q>; now?: () => number }) {
  const now = input.now ?? Date.now;
  return Object.freeze({
    async run(supplied: { tenantId: string; studentIds: readonly string[]; limit?: number }): Promise<{ more: boolean }> {
      const row = closedObject(supplied, ["tenantId", "studentIds"], ["limit"]);
      if (typeof row.tenantId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.tenantId) || !Array.isArray(row.studentIds) || row.studentIds.length < 1 || row.studentIds.length > 25) throw new HttpBoundaryError();
      const studentIds = row.studentIds.map(uuid).sort(); if (new Set(studentIds).size !== studentIds.length) throw new HttpBoundaryError();
      const tenantId = row.tenantId, limit = row.limit === undefined ? 1000 : integer(row.limit, 1, 1000);
      return withTenantTransaction(input.db, { tenantId }, tx => prunePracticeBatch(tx, tenantId, studentIds, limit, now));
    },
  });
}
