import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessDatabase, AccessRequest, AccessTransaction, ActiveMode } from "../access/types";
import { lockRoleGrant, lockStudent, lockStudentRelationship } from "../data/authority";
import * as data from "../data/notifications";
import { calendar } from "../data/practice-calendar";
import { lockVisibleStudentCandidates } from "../data/students";
import { currentSettings } from "../data/tenant-settings";
import { withTenantTransaction } from "../db/runtime";
import * as s from "../db/index";
import type { NotificationMessage, NotificationOutcome } from "../mail/transport";
import type { NotificationSettings } from "../settings/validation";
import { serviceSlotLine } from "../../components/portal/workspace/service-slot";
import { greetingName, plainName, practiceReminderMessage, tutorDraftMessage, weeklyDigestMessage, type DigestStudent, type Links, type Message } from "./copy";
import { addDays, chicagoDay, DEFAULT_DIGEST_WEEKDAY, dueOccurrence, KINDS, validWeekday, CATCH_UP_DAYS, type NotificationKind } from "./schedule";
import { openUnsubscribe, signUnsubscribe, UNSUBSCRIBE_TOKEN } from "./tokens";

type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
const DAY = 86_400_000;
/** A tutor's notice is sent soon after the draft; one the run finds later than this is dropped, not sent late. */
const TUTOR_NOTICE_WINDOW = 2 * DAY;
const MAX_ATTEMPTS = 3;
export type RunCounts = { sent: number; failed: number; unknown: number; skipped: number };
export type RunResult = Readonly<{ ok: true; enabled: boolean; at: string; deferred: number } & RunCounts>;
type Composed = Readonly<{ email: string; message: Message; unsubscribe: string }>;

const switchOn = (n: NotificationSettings, kind: NotificationKind) =>
  kind === "tutor-draft" ? n.tutorDraft === true : kind === "weekly-digest" ? n.weeklyDigest === true : n.studentReminder === true;
async function notificationSettings<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string): Promise<NotificationSettings> {
  return (await currentSettings(tx, tenantId))?.notifications ?? {};
}

/**
 * Notification delivery: the tutor's draft notice (queued in the student's own write, sent right
 * after it and by the morning run), the weekly digest and the practice reminder (both from the
 * morning run). Nothing is sent unless the deployment switch (`enabled`) and the congregation's
 * switch for that kind are both on. Every row is re-authorized when it is sent: congregation on,
 * member current, address verified, grant unrevoked, student current and the link live, and the
 * member's own choice not off. Content comes only through the relationships the portal itself
 * checks for that member's role.
 */
export function createNotificationDelivery<Q extends PgQueryResultHKT>(input: {
  db: AccessDatabase<Q>; origin: string; secret: string; enabled: boolean; cronSecret?: string;
  send: (message: NotificationMessage) => Promise<NotificationOutcome>;
  now?: () => number; pause?: (ms: number) => Promise<void>;
  limits?: Readonly<{ perRun?: number; deadlineMs?: number; spacingMs?: number; candidates?: number }>;
}) {
  if (input.secret.length < 32) throw new Error("Notifications unavailable");
  const now = input.now ?? Date.now, pause = input.pause ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const perRun = input.limits?.perRun ?? 40, deadlineMs = input.limits?.deadlineMs ?? 45_000, spacingMs = input.limits?.spacingMs ?? 600, candidateLimit = input.limits?.candidates ?? 500;
  const links = (tenantId: string, membershipId: string, kind: NotificationKind) => {
    const token = signUnsubscribe(input.secret, tenantId, membershipId, kind);
    // The page link keeps the capability in the fragment; the header link is what mail providers POST to.
    return { body: Object.freeze({ portal: `${input.origin}/`, settings: `${input.origin}/workspace/email`, unsubscribe: `${input.origin}/unsubscribe#t=${token}` }) as Links,
      header: `${input.origin}/api/notifications/unsubscribe?t=${token}` };
  };
  const today = () => chicagoDay(now()).date;

  async function composeTutorDraft(tx: Tx<Q>, row: data.DeliveryRow): Promise<Composed | null> {
    if (!switchOn(await notificationSettings(tx, row.tenantId), "tutor-draft") || !row.studentId) return null;
    const recipient = await data.liveRecipient(tx, row.tenantId, row.membershipId, "tutor");
    if (!recipient || recipient.grant.id !== row.roleGrantId || recipient.userId !== row.userId) return null;
    const choice = await data.preference(tx, row.tenantId, row.membershipId, "tutor-draft");
    if (choice && !choice.enabled) return null;
    const student = await lockStudent(tx, row.tenantId, row.studentId, "read");
    if (!student || student.disabledAt || !(await lockStudentRelationship(tx, row.tenantId, student.id, recipient.grant.id, "tutor", "read"))) return null;
    const l = links(row.tenantId, row.membershipId, "tutor-draft");
    return { email: recipient.email, unsubscribe: l.header, message: tutorDraftMessage({ product: recipient.productName, tutorName: greetingName(recipient.name),
      studentFirstName: plainName(student.firstName) ?? "Your student", links: l.body }) };
  }

  async function digestStudent(tx: Tx<Q>, tenantId: string, student: { id: string; firstName: string; ceremonyDate: string; rehearsal1: string | null; rehearsal2: string | null },
    day: string, since: Date): Promise<DigestStudent | null> {
    if (student.ceremonyDate < day) return null;
    const slot = await data.serviceSlot(tx, tenantId, student.id), services = (await currentSettings(tx, tenantId))?.services;
    // Days only (ruling 14): the same day rows the practice calendar shows; never raw events.
    const practiced = (await calendar(tx, { tenantId, studentId: student.id } as never, { fromDate: addDays(day, -7), throughDate: addDays(day, -1) } as never)).length;
    const from = chicagoDay(since.getTime()).date, through = addDays(day, -1);
    const lessons = from <= through ? await data.lessonsBetween(tx, tenantId, student.id, from, through, 3) : [];
    return Object.freeze({ firstName: plainName(student.firstName) ?? "Your student", practicedDays: practiced, ceremonyDate: student.ceremonyDate,
      // The congregation's own service name and time, exactly as the portal shows them to families.
      serviceLine: (() => { const line = serviceSlotLine(slot, services); return line ? plainName(line, 80) : null; })(), rehearsals: [student.rehearsal1, student.rehearsal2].filter((r): r is string => !!r && r >= day),
      lessons: lessons.map(l => ({ lessonDate: l.lessonDate, author: plainName(l.name) ?? "Tutor", summary: l.summary })), verseNotes: await data.verseNotesSince(tx, tenantId, student.id, since) });
  }
  async function composeDigest(tx: Tx<Q>, tenantId: string, membershipId: string, excluding: string | null) {
    if (!switchOn(await notificationSettings(tx, tenantId), "weekly-digest")) return null;
    const choice = await data.preference(tx, tenantId, membershipId, "weekly-digest");
    if (choice && !choice.enabled) return null;
    const parent = await data.liveRecipient(tx, tenantId, membershipId, "parent");
    // An adult student's own update is opt-in; a parent's is on unless they turned it off.
    const self = choice?.enabled ? await data.liveRecipient(tx, tenantId, membershipId, "student") : null;
    const recipient = parent ?? self; if (!recipient) return null;
    const day = today(), last = await data.lastDigestAt(tx, tenantId, membershipId, excluding ?? randomUUID());
    const since = new Date(Math.max(now() - 14 * DAY, last ? last.getTime() : now() - 7 * DAY));
    const students: DigestStudent[] = [], seen = new Set<string>();
    let audience: "parent" | "self" | "both" | null = null;
    if (parent) {
      const actor = data.recipientActor(parent, input.origin, "parent");
      for (const candidate of await lockVisibleStudentCandidates(tx, actor, { limit: 20 })) {
        // Parents of child students (adults are their own contact), through the live guardian link only.
        if (candidate.studentKind !== "child" || !(await lockStudentRelationship(tx, tenantId, candidate.id, parent.grant.id, "parent", "read"))) continue;
        const block = await digestStudent(tx, tenantId, candidate, day, since);
        if (block) { students.push(block); seen.add(candidate.id); audience = "parent"; }
      }
    }
    if (self) {
      const own = await data.ownStudent(tx, tenantId, self.grant.id), student = own ? await lockStudent(tx, tenantId, own, "read") : null;
      if (student && !student.disabledAt && student.studentKind === "adult" && !seen.has(student.id)
        && await lockStudentRelationship(tx, tenantId, student.id, self.grant.id, "student", "read")) {
        const block = await digestStudent(tx, tenantId, student, day, since);
        if (block) { students.push(block); audience = audience ? "both" : "self"; }
      }
    }
    if (!students.length || !audience) return null;
    const grant = audience === "self" ? self! : parent!, l = links(tenantId, membershipId, "weekly-digest");
    return { recipient: grant, role: (audience === "self" ? "student" : "parent") as "parent" | "student", composed: { email: grant.email, unsubscribe: l.header,
      message: weeklyDigestMessage({ product: grant.productName, recipientName: greetingName(grant.name), students, audience, links: l.body }) } as Composed };
  }
  async function composeReminder(tx: Tx<Q>, tenantId: string, membershipId: string) {
    if (!switchOn(await notificationSettings(tx, tenantId), "practice-reminder")) return null;
    const choice = await data.preference(tx, tenantId, membershipId, "practice-reminder");
    if (!choice?.enabled || !validWeekday(choice.weekday)) return null;
    // Only a student who signs in with their own account; a child without one has no student grant.
    const recipient = await data.liveRecipient(tx, tenantId, membershipId, "student"); if (!recipient) return null;
    const own = await data.ownStudent(tx, tenantId, recipient.grant.id), student = own ? await lockStudent(tx, tenantId, own, "read") : null;
    if (!student || student.disabledAt || !(await lockStudentRelationship(tx, tenantId, student.id, recipient.grant.id, "student", "read"))) return null;
    const day = today(); if (student.ceremonyDate < day) return null;
    const practiced = (await calendar(tx, { tenantId, studentId: student.id } as never, { fromDate: addDays(day, -7), throughDate: addDays(day, -1) } as never)).length;
    const l = links(tenantId, membershipId, "practice-reminder");
    return { recipient, weekday: choice.weekday, composed: { email: recipient.email, unsubscribe: l.header, message: practiceReminderMessage({ product: recipient.productName,
      studentFirstName: plainName(student.firstName) ?? greetingName(recipient.name) ?? "", practicedDays: practiced, ceremonyDate: student.ceremonyDate, weekday: choice.weekday, links: l.body }) } as Composed };
  }
  async function composeRow(tx: Tx<Q>, row: data.DeliveryRow): Promise<Composed | null> {
    if (row.kind === "tutor-draft") return composeTutorDraft(tx, row);
    const result = row.kind === "weekly-digest" ? await composeDigest(tx, row.tenantId, row.membershipId, row.id) : await composeReminder(tx, row.tenantId, row.membershipId);
    // A retry goes only to the same member under the same grant it was first claimed for.
    return result && result.recipient.grant.id === row.roleGrantId ? result.composed : null;
  }

  /** Hand one composed message to the provider and record what happened; the row is already "sending". */
  async function dispatch(tenantId: string, rowId: string, composed: Composed, counts: RunCounts) {
    let outcome: NotificationOutcome;
    try { outcome = await input.send({ email: composed.email, subject: composed.message.subject, text: composed.message.text, unsubscribeUrl: composed.unsubscribe, idempotencyKey: rowId }); }
    catch { outcome = "unknown"; }
    const status = outcome === "sent" ? "sent" : outcome === "rejected" ? "failed" : "unknown";
    counts[status]++;
    await withTenantTransaction(input.db, { tenantId }, tx => data.finishDelivery(tx as Tx<Q>, tenantId, rowId, "sending", status, new Date(now())));
  }
  /** Claim an existing pending or failed row, re-authorize and recompose it, then send it. */
  async function resend(tenantId: string, id: string, from: "pending" | "failed", counts: RunCounts) {
    const prepared = await withTenantTransaction(input.db, { tenantId }, async tx => {
      const t = tx as Tx<Q>, row = await data.claimDelivery(t, tenantId, id, from, from === "pending" ? 1 : MAX_ATTEMPTS, new Date(now()));
      if (!row) return null;
      const composed = input.enabled ? await composeRow(t, row) : null;
      // A retried update or reminder still goes at most once a week, even if the day changed after it first failed.
      const spent = row.kind !== "tutor-draft" && await data.recentlyDelivered(t, tenantId, row.membershipId, row.kind, addDays(today(), -6), row.id);
      if (!composed || spent) { await data.finishDelivery(t, tenantId, row.id, "sending", "skipped", new Date(now())); counts.skipped++; return null; }
      return { id: row.id, composed };
    });
    if (!prepared) return false;
    await dispatch(tenantId, prepared.id, prepared.composed, counts);
    return true;
  }
  /** Compose a scheduled message, claim its (member, kind, period) row, then send it; false when nothing was sent. */
  async function scheduled(tenantId: string, membershipId: string, kind: "weekly-digest" | "practice-reminder", digestWeekday: number, counts: RunCounts) {
    const prepared = await withTenantTransaction(input.db, { tenantId }, async tx => {
      const t = tx as Tx<Q>, day = today();
      // Never twice in a week, even when the day was changed after this week's message went; checked before any composing.
      if (await data.recentlyDelivered(t, tenantId, membershipId, kind, addDays(day, -6))) return null;
      const result = kind === "weekly-digest" ? await composeDigest(t, tenantId, membershipId, null) : await composeReminder(t, tenantId, membershipId);
      if (!result) return null;
      const period = dueOccurrence(day, kind === "weekly-digest" ? digestWeekday : (result as { weekday: number }).weekday);
      if (!period) return null;
      const role = kind === "weekly-digest" ? (result as { role: "parent" | "student" }).role : "student";
      const row = await data.insertDelivery(t, { tenantId, membershipId, userId: result.recipient.userId, roleGrantId: result.recipient.grant.id, role, kind, periodKey: period, studentId: null, status: "sending" }, new Date(now()));
      return row ? { id: row.id, composed: result.composed } : null;
    });
    if (!prepared) return false;
    await dispatch(tenantId, prepared.id, prepared.composed, counts);
    return true;
  }

  /**
   * One item of a run. A thrown error stops only this item: the run carries on. Its claim and row
   * are rolled back with its transaction when nothing was handed over yet (counted as failed); a
   * row already handed to the provider has been counted and stays where it is ("sending" is never
   * picked again), so a claimed row is never sent twice. Nothing about the error is logged here.
   */
  async function guarded(counts: RunCounts, item: () => Promise<boolean>) {
    const before = counts.sent + counts.failed + counts.unknown;
    try { return await item(); }
    catch { if (counts.sent + counts.failed + counts.unknown === before) counts.failed++; return false; }
  }
  async function deliverPending(tenantId: string, limit: number, counts: RunCounts = { sent: 0, failed: 0, unknown: 0, skipped: 0 }, budget: () => boolean = () => true) {
    const ids = await withTenantTransaction(input.db, { tenantId }, tx => data.deliveryIds(tx as Tx<Q>, tenantId, "pending", new Date(now() - TUTOR_NOTICE_WINDOW), limit));
    for (const id of ids) {
      if (!budget()) break;
      if (await guarded(counts, () => resend(tenantId, id, "pending", counts))) await pause(spacingMs);
    }
    return counts;
  }

  async function run(tenantId: string): Promise<RunResult> {
    const counts: RunCounts = { sent: 0, failed: 0, unknown: 0, skipped: 0 }, at = new Date(now()).toISOString();
    if (!input.enabled) return Object.freeze({ ok: true as const, enabled: false, at, deferred: 0, ...counts });
    const started = now(), handed = () => counts.sent + counts.failed + counts.unknown;
    const budget = () => handed() < perRun && now() - started < deadlineMs;
    await deliverPending(tenantId, perRun, counts, budget);
    const failed = await withTenantTransaction(input.db, { tenantId }, tx => data.deliveryIds(tx as Tx<Q>, tenantId, "failed", new Date(now() - (CATCH_UP_DAYS + 1) * DAY), perRun, MAX_ATTEMPTS));
    for (const id of failed) { if (!budget()) break; if (await guarded(counts, () => resend(tenantId, id, "failed", counts))) await pause(spacingMs); }
    const plan = await withTenantTransaction(input.db, { tenantId }, async tx => {
      const t = tx as Tx<Q>, n = await notificationSettings(t, tenantId);
      const day = today(), recent = addDays(day, -6), weekday = validWeekday(n.digestWeekday) ? n.digestWeekday : DEFAULT_DIGEST_WEEKDAY;
      return { weekday, digests: switchOn(n, "weekly-digest") && dueOccurrence(day, weekday) ? await data.digestCandidates(t, tenantId, day, recent, candidateLimit) : [],
        reminders: switchOn(n, "practice-reminder") ? (await data.reminderCandidates(t, tenantId, recent, candidateLimit)).filter(r => validWeekday(r.weekday) && dueOccurrence(day, r.weekday)) : [] };
    });
    // Updates and reminders the budget did not reach go on the next morning's run (within the catch-up days).
    const due = [...plan.digests.map(membershipId => ({ membershipId, kind: "weekly-digest" as const })), ...plan.reminders.map(r => ({ membershipId: r.membershipId, kind: "practice-reminder" as const }))];
    let reached = 0;
    for (const item of due) {
      if (!budget()) break;
      reached++;
      if (await guarded(counts, () => scheduled(tenantId, item.membershipId, item.kind, plan.weekday, counts))) await pause(spacingMs);
    }
    const deferred = due.length - reached;
    // Counts only: no address, name or token. A run with refusals, unanswered sends or deferrals shows in the logs.
    if (counts.failed || counts.unknown || deferred) console.error(`notifications run: ${counts.sent} sent, ${counts.failed} refused, ${counts.unknown} unanswered, ${deferred} deferred`);
    return Object.freeze({ ok: true as const, enabled: true, at, deferred, ...counts });
  }

  return Object.freeze({
    enabled: input.enabled,
    /**
     * Inside a student's own draft write: queue one notice per live tutor for this student and
     * Central-time day. Runs in a savepoint, so a notice can never cost the student their draft.
     */
    async queueTutorDraft(tx: Tx<Q>, target: { tenantId: string; studentId: string }): Promise<boolean> {
      if (!input.enabled) return false;
      try {
        return await tx.transaction(async savepoint => {
          const t = savepoint as unknown as Tx<Q>;
          if (!switchOn(await notificationSettings(t, target.tenantId), "tutor-draft")) return false;
          let queued = false;
          const period = `${target.studentId}:${today()}`;
          for (const tutor of await data.assignedTutors(t, target.tenantId, target.studentId)) {
            const choice = await data.preference(t, target.tenantId, tutor.membershipId, "tutor-draft");
            if (choice && !choice.enabled) continue;
            if (await data.insertDelivery(t, { tenantId: target.tenantId, membershipId: tutor.membershipId, userId: tutor.userId, roleGrantId: tutor.grantId, role: "tutor",
              kind: "tutor-draft", periodKey: period, studentId: target.studentId, status: "pending" }, new Date(now()))) queued = true;
          }
          return queued;
        });
      } catch { return false; }
    },
    deliverPending: (tenantId: string, limit = 5) => deliverPending(tenantId, limit),
    run,
    /** Vercel Cron: GET with the project's CRON_SECRET bearer, never a cookie. */
    async cron(request: AccessRequest, resolved: { tenantId: string }) {
      if (!input.cronSecret || input.cronSecret.length < 32) throw new AccessUnavailable();
      if (request.headers.has("cookie") || request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
      const expected = Buffer.from(`Bearer ${input.cronSecret}`), candidate = Buffer.from(request.headers.get("authorization") ?? "");
      if (candidate.length !== expected.length || !timingSafeEqual(expected, candidate)) throw new AccessDenied(401);
      return run(resolved.tenantId);
    },
    /** One-click unsubscribe: the signed token is the only authority, for its one member and kind. */
    async unsubscribe(resolved: { tenantId: string }, token: unknown) {
      const opened = openUnsubscribe(input.secret, resolved.tenantId, token);
      if (!opened) throw new AccessDenied(404);
      return withTenantTransaction(input.db, resolved, async tx => {
        const t = tx as Tx<Q>;
        const [member] = await t.select({ id: s.membership.id, userId: s.membership.userId }).from(s.membership)
          .where(and(eq(s.membership.tenantId, resolved.tenantId), eq(s.membership.id, opened.membershipId))).limit(1);
        if (!member) throw new AccessDenied(404);
        const existing = await data.preference(t, resolved.tenantId, member.id, opened.kind);
        if (!existing || existing.enabled) {
          await data.setPreference(t, { tenantId: resolved.tenantId, membershipId: member.id, userId: member.userId, kind: opened.kind, enabled: false,
            weekday: opened.kind === "practice-reminder" ? existing?.weekday ?? null : null, via: "unsubscribe" });
          const roles: ("tutor" | "student" | "parent")[] = opened.kind === "tutor-draft" ? ["tutor"] : opened.kind === "practice-reminder" ? ["student"] : ["parent", "student"];
          const [grant] = await t.select({ id: s.roleGrant.id, role: s.roleGrant.role }).from(s.roleGrant)
            .where(and(eq(s.roleGrant.tenantId, resolved.tenantId), eq(s.roleGrant.membershipId, member.id), inArray(s.roleGrant.role, roles)))
            .orderBy(desc(s.roleGrant.createdAt)).limit(1);
          if (grant) await t.insert(s.auditEvent).values({ tenantId: resolved.tenantId, actorUserId: member.userId, actorMembershipId: member.id, roleGrantId: grant.id,
            mode: grant.role, action: "notification.unsubscribe", targetType: "notification_preference", targetId: opened.kind, requestId: randomUUID() });
        }
        return Object.freeze({ ok: true as const, kind: opened.kind });
      });
    },
    validToken: (token: unknown): token is string => typeof token === "string" && UNSUBSCRIBE_TOKEN.test(token),
  });
}
export type NotificationDelivery = ReturnType<typeof createNotificationDelivery>;

export type PreferenceOption = Readonly<{ kind: NotificationKind; enabled: boolean; offered: boolean; weekday: number | null; audience?: "parent" | "self" | "both" }>;
export type PreferencesView = Readonly<{ options: readonly PreferenceOption[] }>;

/** A signed-in member's own choices, for the kinds their live roles receive. */
export function createNotificationPreferences<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">; enabled: boolean }) {
  async function roles(tx: Tx<Q>, tenantId: string, membershipId: string) {
    // One statement at a time on the transaction's single connection.
    const tutor = await lockRoleGrant(tx, tenantId, membershipId, "tutor", "read"), parent = await lockRoleGrant(tx, tenantId, membershipId, "parent", "read"),
      student = await lockRoleGrant(tx, tenantId, membershipId, "student", "read");
    const own = student && !student.revokedAt ? await data.ownStudent(tx, tenantId, student.id) : null;
    const ownStudent = own ? await lockStudent(tx, tenantId, own, "read") : null;
    return { tutor: tutor && !tutor.revokedAt ? tutor : null, parent: parent && !parent.revokedAt ? parent : null, student: ownStudent && !ownStudent.disabledAt ? student! : null,
      adult: ownStudent?.studentKind === "adult" && !ownStudent.disabledAt };
  }
  async function project(tx: Tx<Q>, tenantId: string, membershipId: string): Promise<PreferencesView> {
    const live = await roles(tx, tenantId, membershipId), n = await notificationSettings(tx, tenantId);
    const rows = new Map((await data.preferences(tx, tenantId, membershipId)).map(row => [row.kind, row]));
    const offered = (kind: NotificationKind) => input.enabled && switchOn(n, kind), options: PreferenceOption[] = [];
    if (live.tutor) options.push({ kind: "tutor-draft", enabled: rows.get("tutor-draft")?.enabled ?? true, offered: offered("tutor-draft"), weekday: null });
    if (live.parent || (live.student && live.adult)) {
      const row = rows.get("weekly-digest"), audience = live.parent && live.student && live.adult ? "both" : live.parent ? "parent" : "self";
      // As composeDigest sends it: a parent's update is on until they turn it off; an adult's own part
      // (alone, or beside their children's) needs a saved choice that is on, so with none it shows off.
      options.push({ kind: "weekly-digest", enabled: row ? row.enabled : audience === "parent", offered: offered("weekly-digest"),
        weekday: validWeekday(n.digestWeekday) ? n.digestWeekday : DEFAULT_DIGEST_WEEKDAY, audience });
    }
    if (live.student) { const row = rows.get("practice-reminder"); options.push({ kind: "practice-reminder", enabled: row?.enabled ?? false, offered: offered("practice-reminder"), weekday: row?.weekday ?? null }); }
    return Object.freeze({ options: Object.freeze(options) });
  }
  return Object.freeze({
    async view(request: AccessRequest): Promise<PreferencesView> {
      return input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
        if (!identity.membership) throw new AccessDenied(403);
        return project(tx, identity.tenantId, identity.membership.id);
      });
    },
    async save(request: AccessRequest & { method?: string }, body: { kind: unknown; enabled: unknown; weekday?: unknown }): Promise<PreferencesView> {
      if (!KINDS.includes(body.kind as NotificationKind) || typeof body.enabled !== "boolean") throw new AccessDenied(403);
      const kind = body.kind as NotificationKind, enabled = body.enabled;
      if (kind === "practice-reminder" ? (enabled || body.weekday !== undefined) && !validWeekday(body.weekday) : body.weekday !== undefined) throw new AccessDenied(403);
      return input.access.withVerifiedIdentity(request, { intent: "data-write", mutation: true }, async (tx, identity) => {
        if (!identity.membership) throw new AccessDenied(403);
        const live = await roles(tx, identity.tenantId, identity.membership.id);
        const grant = kind === "tutor-draft" ? live.tutor : kind === "practice-reminder" ? live.student : live.parent ?? (live.adult ? live.student : null);
        if (!grant) throw new AccessDenied(403);
        const existing = await data.preference(tx, identity.tenantId, identity.membership.id, kind);
        const weekday = kind === "practice-reminder" ? (validWeekday(body.weekday) ? body.weekday : existing?.weekday ?? null) : null;
        await data.setPreference(tx, { tenantId: identity.tenantId, membershipId: identity.membership.id, userId: identity.userId, kind, enabled, weekday, via: "web" });
        await tx.insert(s.auditEvent).values({ tenantId: identity.tenantId, actorUserId: identity.userId, actorMembershipId: identity.membership.id, roleGrantId: grant.id,
          mode: grant.role as ActiveMode, action: "notification-preference.set", targetType: "notification_preference", targetId: kind, requestId: randomUUID() });
        return project(tx, identity.tenantId, identity.membership.id);
      });
    },
  });
}
export type NotificationPreferences = ReturnType<typeof createNotificationPreferences>;
