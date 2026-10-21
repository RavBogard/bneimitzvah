import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessRequest } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { withTenantTransaction } from "../db/runtime";
import * as s from "../db/index";
import type { MusicBroker, MusicResult } from "./contract";
import { ensureIntent } from "./intent";

/** Fixed-CRC outbox worker. Only already authorized scheduling intent is executable. */
export function createServiceScheduler<Q extends PgQueryResultHKT>(input: { db: AccessDatabase<Q>; broker: MusicBroker; cronSecret?: string; now?: () => number }) {
  const now = input.now ?? Date.now;
  const transaction = <T>(action: Parameters<typeof withTenantTransaction<Q, T>>[2]) => withTenantTransaction(input.db, { tenantId: "crc" }, action);
  async function claim() {
    return transaction(async tx => {
      const [job] = await tx.select().from(s.serviceCeremony).where(and(eq(s.serviceCeremony.tenantId, "crc"),eq(s.serviceCeremony.scheduleConflict,false),
        or(eq(s.serviceCeremony.state, "pending"), eq(s.serviceCeremony.state, "unavailable")), lte(s.serviceCeremony.nextAttemptAt, new Date(now())),
        or(isNull(s.serviceCeremony.leaseUntil), lte(s.serviceCeremony.leaseUntil, new Date(now()))),
        sql`exists (select 1 from student_ceremony link join student learner on learner.tenant_id=link.tenant_id and learner.id=link.student_id where link.tenant_id='crc' and link.ceremony_id=${s.serviceCeremony.id} and learner.disabled_at is null)`))
        .orderBy(asc(s.serviceCeremony.nextAttemptAt), asc(s.serviceCeremony.id)).limit(1).for("update", { skipLocked: true });
      if (!job) return null;
      const token = randomUUID();
      await tx.update(s.serviceCeremony).set({ leaseToken: token, leaseUntil: new Date(now() + 30_000) }).where(eq(s.serviceCeremony.id, job.id));
      return { ...job, leaseToken: token };
    });
  }
  async function process(job: NonNullable<Awaited<ReturnType<typeof claim>>>, signal: AbortSignal) {
    let result: MusicResult | null = null;
    try {
      result = await input.broker.ensure(ensureIntent(job), signal);
      if (result.status !== "ambiguous" && result.setlistId && job.setlistId && result.setlistId !== job.setlistId) result = null;
    } catch { /* Source errors are retryable, with no roster rollback or diagnostic retention. */ }
    return transaction(async tx => {
      const attempts = job.attempts + 1, state = result?.status ?? "unavailable";
      const [saved] = await tx.update(s.serviceCeremony).set({ state, attempts,
        nextAttemptAt: new Date(now() + Math.min(86_400_000, 60_000 * 2 ** Math.min(attempts - 1, 10))), leaseToken: null, leaseUntil: null,
        candidates: result?.status === "ambiguous" ? result.candidates.map(c => c.setlistId) : [],
        ...(result && result.status !== "ambiguous" && result.setlistId ? { setlistId: result.setlistId, projection: result.projection ?? null } : { projection: null }),
        revision: job.revision + 1,
      }).where(and(eq(s.serviceCeremony.tenantId, "crc"), eq(s.serviceCeremony.id, job.id), eq(s.serviceCeremony.leaseToken, job.leaseToken), eq(s.serviceCeremony.revision, job.revision))).returning({ id: s.serviceCeremony.id });
      if (!saved) await tx.update(s.serviceCeremony).set({ leaseToken: null, leaseUntil: null }).where(and(eq(s.serviceCeremony.tenantId, "crc"), eq(s.serviceCeremony.id, job.id), eq(s.serviceCeremony.leaseToken, job.leaseToken)));
      return Boolean(saved);
    });
  }
  async function run(options: { budgetMs?: number; maxJobs?: number } = {}) {
    const budgetMs = Math.min(options.budgetMs ?? 20_000, 20_000), maxJobs = Math.min(options.maxJobs ?? 500, 500), deadline = Date.now() + budgetMs;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), budgetMs);
    let attempted = 0, completed = 0;
    try {
      while (attempted < maxJobs && Date.now() < deadline && !controller.signal.aborted) {
        const jobs: NonNullable<Awaited<ReturnType<typeof claim>>>[] = [];
        for (let i = 0; i < 4 && attempted + jobs.length < maxJobs && !controller.signal.aborted; i++) { const job = await claim(); if (!job) break; jobs.push(job); }
        if (!jobs.length) break;
        attempted += jobs.length;
        const settled = await Promise.allSettled(jobs.map(job => process(job, controller.signal)));
        completed += settled.filter(result => result.status === "fulfilled" && result.value).length;
      }
    } finally { clearTimeout(timer); }
    return { attempted, completed };
  }
  async function drain(request: AccessRequest) {
    if (!input.cronSecret || input.cronSecret.length < 32) throw new AccessUnavailable();
    if (request.headers.has("cookie") || request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    const expected = Buffer.from(`Bearer ${input.cronSecret}`), candidate = Buffer.from(request.headers.get("authorization") ?? "");
    if (candidate.length !== expected.length || !timingSafeEqual(expected, candidate)) throw new AccessDenied(401);
    return run();
  }
  return Object.freeze({ run, drain });
}
