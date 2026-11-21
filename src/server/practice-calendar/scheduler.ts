import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, exists, gt, lte, or, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { AccessDatabase, AccessRequest, AccessTransaction } from "../access/types";
import * as s from "../db/index";
import { withTenantTransaction } from "../db/runtime";
import { prunePracticeBatch } from "./maintenance";
import { RAW_RETENTION_MS, serverInstant } from "./policy";

const MAX_TENANTS = 25, MAX_STUDENTS = 50, MAX_ROWS_PER_STUDENT = 200;
type Cursor = { afterTenant: string | null; afterStudent: string | null };
const BEGINNING: Cursor = { afterTenant: null, afterStudent: null };

async function eligibleStudents<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, after: string | null, now: Date, limit: number) {
  const student = s.student, event = s.practiceEvent, day = s.practiceDay;
  const anniversary = sql<boolean>`portal_practice_anniversary_due(${student.ceremonyDate}, ${now.toISOString()}::timestamptz)`;
  const afterRaw = new Date(now.getTime() - RAW_RETENTION_MS);
  const hasRaw = exists(tx.select({ id: event.eventId }).from(event).where(and(eq(event.tenantId, tenantId), eq(event.studentId, student.id),
    or(lte(event.receivedAt, afterRaw), anniversary))));
  const hasExpiredDates = and(anniversary, exists(tx.select({ day: day.practiceDay }).from(day).where(and(eq(day.tenantId, tenantId), eq(day.studentId, student.id)))));
  return tx.select({ id: student.id }).from(student).where(and(eq(student.tenantId, tenantId), after ? gt(student.id, after) : undefined,
    or(hasRaw, hasExpiredDates))).orderBy(asc(student.id)).limit(limit);
}

/** Keeps its cursor with the cleanup transaction so an interrupted invocation resumes cleanly. */
export function createPracticeSweep<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; cronSecret?: string; now?: () => number; studentsPerRun?: number;
  prune?: typeof prunePracticeBatch<Q>;
}) {
  const now = input.now ?? Date.now, prune = input.prune ?? prunePracticeBatch;
  const studentsPerRun = input.studentsPerRun ?? MAX_STUDENTS;

  async function run(hostTenant: string) {
    return withTenantTransaction(input.db, { tenantId: hostTenant }, async tx => {
      await tx.execute(sql`select set_config('app.practice_sweep', 'retention', true)`);
      const [state] = await tx.select().from(s.practiceSweep).where(eq(s.practiceSweep.id, "retention")).for("update", { skipLocked: true });
      if (!state) return { busy: true, processed: 0, retry: false };
      const checkpoint = (cursor: Cursor) => tx.update(s.practiceSweep).set(cursor).where(eq(s.practiceSweep.id, "retention"));
      const afterTenant = state.afterTenant, afterStudent = state.afterStudent;
      const tenants = await tx.select({ id: s.tenant.id }).from(s.tenant)
        .where(afterTenant ? or(gt(s.tenant.id, afterTenant), afterStudent ? eq(s.tenant.id, afterTenant) : undefined) : undefined)
        .orderBy(asc(s.tenant.id)).limit(MAX_TENANTS + 1);
      let processed = 0, retry = false;
      let lastTenant: Cursor = BEGINNING;
      for (const tenant of tenants.slice(0, MAX_TENANTS)) {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
        const remaining = studentsPerRun - processed;
        const candidates = await eligibleStudents(tx, tenant.id, tenant.id === afterTenant ? afterStudent : null, new Date(serverInstant(now())), remaining + 1);
        for (const student of candidates.slice(0, remaining)) {
          try {
            const state = await tx.transaction(sp => prune(sp, tenant.id, [student.id], MAX_ROWS_PER_STUDENT, now));
            retry ||= state.more;
          } catch {
            // A failed savepoint leaves records eligible for the next sweep and lets other students proceed.
            retry = true;
          }
          processed++;
        }
        if (candidates.length > remaining) {
          let cursor: Cursor = { afterTenant: tenant.id, afterStudent: candidates[remaining - 1]?.id ?? (tenant.id === afterTenant ? afterStudent : null) };
          // Zero remaining can reach a new tenant. Resume it from the preceding fully scanned tenant.
          if (!cursor.afterStudent) cursor = lastTenant;
          await checkpoint(cursor);
          return { busy: false, processed, retry: true };
        }
        lastTenant = { afterTenant: tenant.id, afterStudent: null };
      }
      await checkpoint(tenants.length > MAX_TENANTS ? lastTenant : BEGINNING);
      return { busy: false, processed, retry: retry || tenants.length > MAX_TENANTS };
    });
  }

  return Object.freeze({
    async cron(request: AccessRequest, hostTenant: string) {
      if (!input.cronSecret || input.cronSecret.length < 32) throw new AccessUnavailable();
      if (request.headers.has("cookie") || request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
      const expected = Buffer.from(`Bearer ${input.cronSecret}`), actual = Buffer.from(request.headers.get("authorization") ?? "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AccessDenied(401);
      return run(hostTenant);
    },
  });
}
