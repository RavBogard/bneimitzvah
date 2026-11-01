import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase, AccessRequest } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { withTenantTransaction } from "../db/runtime";
import * as s from "../db/index";
import type { MusicBroker, MusicResult } from "./contract";
import { ensureIntent } from "./intent";
import { MusicIntentSuperseded } from "./broker";
import { ceremonyLocalDate } from "./scheduling";
import { detailsDigest, loadCeremonyDetails } from "./details";

/** Fixed-CRC outbox worker. Only already authorized scheduling intent is executable. */
export type DetailsPlan = { ceremonyId: string; localDate: string; students: number; omittedNames: number; torahRef: boolean; haftarahRef: boolean; rehearsals: number };
export type DetailsReport = { mode: "send" | "dry-run"; upcoming: number; unchanged: number; skipped: { tooManyStudents: number; noStudents: number }; due: DetailsPlan[]; sent: number; failed: number };

/**
 * `details: "send"` (PORTAL_MUSIC_DETAILS_ENABLED) also sends each upcoming linked ceremony's card details whenever
 * their fingerprint changes; the first pass is the back-fill. Without it the worker is unchanged.
 */
export function createServiceScheduler<Q extends PgQueryResultHKT>(input: { db: AccessDatabase<Q>; broker: MusicBroker; cronSecret?: string; now?: () => number; details?: "send" }) {
  const now = input.now ?? Date.now;
  const transaction = <T>(action: Parameters<typeof withTenantTransaction<Q, T>>[2]) => withTenantTransaction(input.db, { tenantId: "crc" }, action);
  async function claim() {
    return transaction(async tx => {
      const [job] = await tx.select().from(s.serviceCeremony).where(and(eq(s.serviceCeremony.tenantId,"crc"),or(eq(s.serviceCeremony.scheduleConflict,false),eq(s.serviceCeremony.originalConnectionPending,true)),
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
    let superseded=false;
    try {
      result = await input.broker.ensure(ensureIntent(job), signal);
      if (result.status !== "ambiguous" && result.setlistId && job.setlistId && result.setlistId !== job.setlistId) result = null;
      if(result && result.status!=="ambiguous" && result.setlistId && result.setlistId===job.excludedSetlistId)result=null;
    } catch(error) {superseded=error instanceof MusicIntentSuperseded;/* Source errors retain no diagnostics. */}
    return transaction(async tx => {
      const attempts = job.attempts + 1, state = superseded?"review_required":result?.status ?? "unavailable";
      const [saved] = await tx.update(s.serviceCeremony).set({ state, attempts,
        ...(result&&result.status!=="ambiguous"&&result.setlistId?{originalConnectionPending:false}:{}),
        nextAttemptAt: new Date(now() + Math.min(86_400_000, 60_000 * 2 ** Math.min(attempts - 1, 10))), leaseToken: null, leaseUntil: null,
        candidates: result?.status === "ambiguous" ? result.candidates.map(c => c.setlistId) : [],
        ...(result && result.status !== "ambiguous" && result.setlistId ? { setlistId: result.setlistId, projection: result.projection ?? null } : { projection: null }),
        revision: job.revision + 1,
      }).where(and(eq(s.serviceCeremony.tenantId, "crc"), eq(s.serviceCeremony.id, job.id), eq(s.serviceCeremony.leaseToken, job.leaseToken), eq(s.serviceCeremony.revision, job.revision))).returning({ id: s.serviceCeremony.id });
      if (!saved) await tx.update(s.serviceCeremony).set({ leaseToken: null, leaseUntil: null }).where(and(eq(s.serviceCeremony.tenantId, "crc"), eq(s.serviceCeremony.id, job.id), eq(s.serviceCeremony.leaseToken, job.leaseToken)));
      return Boolean(saved);
    });
  }
  /** One pass over upcoming linked ceremonies. A dry run reads and reports counts only: no names, no sends, no writes. */
  async function syncDetails(mode: "send" | "dry-run", deadline: number, signal?: AbortSignal): Promise<DetailsReport> {
    const today = ceremonyLocalDate(now());
    const ceremonies = await transaction(tx => tx.select({ id: s.serviceCeremony.id, localDate: s.serviceCeremony.requestedDate })
      .from(s.serviceCeremony).where(and(eq(s.serviceCeremony.tenantId, "crc"), isNotNull(s.serviceCeremony.setlistId), gte(s.serviceCeremony.requestedDate, today)))
      .orderBy(asc(s.serviceCeremony.requestedDate), asc(s.serviceCeremony.id)).limit(200));
    const report: DetailsReport = { mode, upcoming: ceremonies.length, unchanged: 0, skipped: { tooManyStudents: 0, noStudents: 0 }, due: [], sent: 0, failed: 0 };
    for (const ceremony of ceremonies) {
      if (Date.now() >= deadline || signal?.aborted) break;
      // sentAt is fixed BEFORE the details are read, and never below the last accepted send: when a drain and an after-write
      // run overlap, the one that read later always carries the later sentAt, so stale details can never win the receiver's fence.
      const found = await transaction(async tx => {
        const [stored] = await tx.select({ digest: s.serviceCeremony.detailsDigest, sentAt: s.serviceCeremony.detailsSentAt }).from(s.serviceCeremony)
          .where(and(eq(s.serviceCeremony.tenantId, "crc"), eq(s.serviceCeremony.id, ceremony.id)));
        const sentAt = new Date(Math.max(now(), (stored?.sentAt?.getTime() ?? 0) + 1));
        return { stored, sentAt, loaded: await loadCeremonyDetails(tx, "crc", ceremony.id) };
      });
      if ("skipped" in found.loaded) { report.skipped[found.loaded.skipped]++; continue; }
      const { sentAt } = found, fingerprint = detailsDigest(found.loaded.details);
      if (fingerprint === found.stored?.digest) { report.unchanged++; continue; }
      const { details, omittedNames } = found.loaded;
      report.due.push({ ceremonyId: ceremony.id, localDate: ceremony.localDate, students: details.students.length, omittedNames,
        torahRef: Boolean(details.torahRef), haftarahRef: Boolean(details.haftarahRef), rehearsals: details.rehearsals?.length ?? 0 });
      if (mode === "dry-run") continue;
      try { await input.broker.details({ ceremonyId: ceremony.id, sentAt: sentAt.toISOString(), ...details }, signal); }
      catch { report.failed++; continue; /* Unrecorded: the next drain sends it again. */ }
      await transaction(tx => tx.update(s.serviceCeremony).set({ detailsDigest: fingerprint, detailsSentAt: sentAt })
        .where(and(eq(s.serviceCeremony.tenantId, "crc"), eq(s.serviceCeremony.id, ceremony.id), or(isNull(s.serviceCeremony.detailsSentAt), lte(s.serviceCeremony.detailsSentAt, sentAt)))));
      report.sent++;
    }
    return report;
  }
  type RunResult = { attempted: number; completed: number } | { attempted: number; completed: number; details: { sent: number; failed: number } };
  async function run(options: { budgetMs?: number; maxJobs?: number } = {}): Promise<RunResult> {
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
      // Details follow setup, so a ceremony linked in this run is described in the same run.
      if (input.details === "send" && !controller.signal.aborted && Date.now() < deadline) {
        const details = await syncDetails("send", deadline, controller.signal).catch(() => null);
        if (details) return { attempted, completed, details: { sent: details.sent, failed: details.failed } };
      }
    } finally { clearTimeout(timer); }
    return { attempted, completed };
  }
  /** The cron credential check, run before any query option is read. */
  function authorize(request: AccessRequest) {
    if (!input.cronSecret || input.cronSecret.length < 32) throw new AccessUnavailable();
    if (request.headers.has("cookie") || request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    const expected = Buffer.from(`Bearer ${input.cronSecret}`), candidate = Buffer.from(request.headers.get("authorization") ?? "");
    if (candidate.length !== expected.length || !timingSafeEqual(expected, candidate)) throw new AccessDenied(401);
  }
  async function drain(request: AccessRequest, options: { detailsDryRun?: boolean } = {}) {
    authorize(request);
    if (options.detailsDryRun) return { details: await syncDetails("dry-run", Date.now() + 20_000) };
    return run();
  }
  return Object.freeze({ run, drain, authorize, syncDetails });
}
