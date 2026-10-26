import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, ActiveMode } from "../access/types";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import { identifier, revision } from "../students/validation";
import * as roster from "../data/roster";
import { isCeremonyDone, liveRows as ceremonyDoneRows } from "../data/ceremony-done";
import * as relationships from "../relationships/data";
import { displayName, writeTutorAssignment } from "../relationships/service";
import { assignmentNeedsReview } from "../../lib/readings/review";
import { readingDate } from "../../lib/readings/reading-date";
import * as data from "./data";

/**
 * Release 1.9 N14 and N15: what the staff screens need beyond the roster and the reading.
 *
 * - status (admin): per active student, the setup facts behind "Needs you" and the roster's status chips. Ids, counts and states
 *   only: no names, no addresses (the admin's own roster already carries those).
 * - teaching (admin): each tutor's current students, by name, for "Teaches n students" (G11).
 * - handOver (admin, fresh session): moves a departing tutor's students to another tutor and removes the departing tutor, in one
 *   transaction (G11). It can only move the students the departing tutor teaches now, in this congregation, to a live, verified
 *   tutor of this congregation; it refuses a ceremony-done student (N21) before anything is written.
 * - family (tutor or admin on a student they already reach): "Family: invitation sent / joined" (G7, TP-12). Joined parents' display
 *   names only, sanitized as the People page sanitizes them; never an address.
 * - reconfirm (admin or tutor): "Confirm reading is still right" (AD-05). Keeps the verses, basis and divisions; records the reading
 *   as reviewed for the current ceremony date and service.
 */
type Access<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createAccessService<Q>>, "withAdminCapability" | "withStudentCapability">;
export type FamilyState = "joined" | "invited" | "expiring" | "expired" | "none";
export type StudentStatus = Readonly<{ id: string; tutors: number; family: FamilyState | null; reading: "none" | "confirmed" | "review"; honors: boolean }>;
const DAY_MS = 86_400_000;
const conflict = () => Object.freeze({ ok: false as const, code: "stale-state" as const });
const tooMany = (rows: readonly unknown[]) => { if (rows.length > 20_000) throw new AccessDenied(403); };

export function createStaffService<Q extends PgQueryResultHKT>(input: { access: Access<Q>; now?: () => number }) {
  const now = input.now ?? Date.now;

  async function status(request: AccessRequest, selection: { mode: ActiveMode }): Promise<readonly StudentStatus[]> {
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "read-relationships" }, async (tx, actor) => {
      const tenantId = actor.tenantId, rows = await roster.roster(tx, tenantId);
      if (rows.length > 5000) throw new AccessDenied(403);
      const done = await ceremonyDoneRows(tx, tenantId);
      if (done.length > 5000) throw new AccessDenied(403);
      const finished = new Set(done.map(row => row.studentId)), active = rows.filter(row => !row.disabledAt && !finished.has(row.id));
      const [tutors, families, invites, readings, honors] = [await data.liveTutorCounts(tx, tenantId), await data.joinedFamilies(tx, tenantId),
        await data.openParentInvites(tx, tenantId), await data.confirmedAssignments(tx, tenantId), await data.honorsStarted(tx, tenantId)];
      [tutors, families, invites, readings, honors].forEach(tooMany);
      const tutorCount = new Map(tutors.map(row => [row.studentId, Number(row.count)])), joined = new Set(families.map(row => row.studentId)), started = new Set(honors.map(row => row.studentId));
      const group = <T extends { studentId: string | null }>(rows: readonly T[]) => { const map = new Map<string, T[]>(); for (const row of rows) if (row.studentId) map.set(row.studentId, [...map.get(row.studentId) ?? [], row]); return map; };
      const invitesOf = group(invites), readingsOf = group(readings), at = now();
      return Object.freeze(active.map(student => {
        let family: FamilyState | null = null;
        if (student.studentKind === "child") {
          // "Expires tomorrow" as N22 counts it: a pending link with a day or less left.
          const open = invitesOf.get(student.id) ?? [], live = open.filter(row => row.expiresAt.getTime() > at);
          family = joined.has(student.id) ? "joined" : live.length ? (live.every(row => row.expiresAt.getTime() - at <= DAY_MS) ? "expiring" : "invited") : open.length ? "expired" : "none";
        }
        const own = readingsOf.get(student.id) ?? [];
        const reading = !own.length ? "none" : own.some(row => assignmentNeedsReview(row.snapshot, student.ceremonyDate)) ? "review" : "confirmed";
        return Object.freeze({ id: student.id, tutors: tutorCount.get(student.id) ?? 0, family, reading, honors: started.has(student.id) });
      }));
    });
  }

  async function teaching(request: AccessRequest, selection: { mode: ActiveMode }) {
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "read-relationships" }, async (tx, actor) => {
      const rows = await data.teaching(tx, actor.tenantId); tooMany(rows);
      const byTutor = new Map<string, { id: string; firstName: string; lastName: string }[]>();
      for (const row of rows) byTutor.set(row.tutorGrantId, [...byTutor.get(row.tutorGrantId) ?? [], Object.freeze({ id: row.studentId, firstName: row.firstName, lastName: row.lastName })]);
      return Object.freeze([...byTutor.entries()].map(([tutorGrantId, students]) => Object.freeze({ tutorGrantId, students: Object.freeze(students) })));
    });
  }

  async function handOver(request: CookieMutationRequest, selection: { mode: ActiveMode; tutorGrantId: string; expectedRevision: number; toTutorGrantId: string; studentIds: unknown }) {
    const fromId = identifier(selection.tutorGrantId), toId = identifier(selection.toTutorGrantId), expected = revision(selection.expectedRevision);
    if (fromId.toLowerCase() === toId.toLowerCase()) throw new AccessDenied(403);
    if (!Array.isArray(selection.studentIds) || selection.studentIds.length < 1 || selection.studentIds.length > 500) throw new AccessDenied(403);
    const reviewed = [...new Set(selection.studentIds.map(identifier).map(id => id.toLowerCase()))].sort();
    if (reviewed.length !== selection.studentIds.length) throw new AccessDenied(403);
    return input.access.withAdminCapability(request, { mode: selection.mode, capability: "manage-relationships" }, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      // Both grants are this congregation's (subjectGrant reads by tenant and id; anything else is a 404), locked in id order.
      const [first, second] = [fromId, toId].sort();
      const locked = new Map([[first, await relationships.subjectGrant(tx, actor.tenantId, first, "authority-write")], [second, await relationships.subjectGrant(tx, actor.tenantId, second, "authority-write")]]);
      const from = locked.get(fromId)!, to = locked.get(toId)!;
      if (from.grant.role !== "tutor" || to.grant.role !== "tutor") throw new AccessDenied(404);
      if (to.grant.revokedAt || to.membership.disabledAt || !to.verified) throw new AccessDenied(404);
      if (from.grant.revokedAt || from.grant.revision !== expected) return conflict();
      // Exactly the students the admin reviewed: the departing tutor's live rows of enabled students now, nothing more or less.
      // Lock order is grant, student, link: probe the rows, lock their students, then lock the rows and check they are the same.
      const same = (rows: readonly { studentId: string }[]) => { const ids = rows.map(row => row.studentId.toLowerCase()).sort(); return ids.length === reviewed.length && ids.every((id, i) => id === reviewed[i]); };
      const probe = await data.handOverLinks(tx, actor.tenantId, fromId, false);
      if (probe.length > 500) throw new AccessDenied(403);
      if (!same(probe)) return conflict();
      // Every check before any write: a refusal leaves everything as it was.
      for (const studentId of reviewed) {
        const student = await relationships.student(tx, actor.tenantId, studentId, "authority-write");
        if (student.disabledAt) return conflict();
        // N21: no tutor row is added while a ceremony is done; such a student is refused, never moved.
        if (await isCeremonyDone(tx, actor.tenantId, studentId)) return conflict();
      }
      const links = await data.handOverLinks(tx, actor.tenantId, fromId, true);
      if (!same(links)) return conflict();
      const plan: { linkId: string; studentId: string; assign: boolean }[] = [];
      for (const link of links) plan.push({ linkId: link.id, studentId: link.studentId, assign: !await relationships.activeTutorLink(tx, actor.tenantId, link.studentId, toId) });
      const at = new Date(now());
      for (const step of plan) {
        if (!await relationships.revokeTutor(tx, actor.tenantId, step.linkId, at)) throw new Error("Hand-over unavailable");
        await relationships.audit(tx, actor, "tutor.revoke", step.linkId, step.studentId);
        if (step.assign) { const assigned = await writeTutorAssignment(tx, actor, step.studentId, toId); if (!assigned.ok) throw new Error("Hand-over unavailable"); }
      }
      // The departing tutor's role ends in the same transaction, exactly as "Remove as a tutor" ends it.
      const updated = await relationships.revokeGrant(tx, actor.tenantId, fromId, expected, at);
      if (!updated) throw new Error("Hand-over unavailable");
      await relationships.revokeContexts(tx, actor.tenantId, { kind: "grant", id: fromId }, at);
      await relationships.audit(tx, actor, "grant.revoke", fromId);
      return Object.freeze({ ok: true as const, id: fromId, revision: updated.revision, moved: plan.length });
    });
  }

  async function family(request: AccessRequest, selection: { mode: ActiveMode; studentId: string }) {
    if (selection.mode !== "tutor" && selection.mode !== "admin") throw new AccessDenied(403);
    return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, async (tx, actor, student) => {
      if (actor.mode !== "tutor" && actor.mode !== "admin") throw new AccessDenied(403);
      const kind = await data.studentKind(tx, actor.tenantId, student.id);
      if (kind !== "child" && kind !== "adult") throw new AccessDenied(404);
      const parents = await data.joinedParents(tx, actor.tenantId, student.id);
      const joined = parents.slice(0, 8).map(row => displayName(row.name, "Parent"));
      const invited = !joined.length && await data.parentInvitePending(tx, actor.tenantId, student.id, new Date(now()));
      return Object.freeze({ kind, joined: Object.freeze(joined), invited });
    });
  }

  async function reconfirm(request: CookieMutationRequest, selection: { mode: ActiveMode; studentId: string; kind: unknown; expectedRevision: unknown }) {
    if (selection.mode !== "tutor" && selection.mode !== "admin") throw new AccessDenied(403);
    if (selection.kind !== "torah" && selection.kind !== "haftarah") throw new AccessDenied(403);
    const kind = selection.kind, expected = revision(selection.expectedRevision);
    return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "set-reading" }, async (tx, actor, student) => {
      requireCookieMutation(request, actor.origin);
      const current = await data.lockedAssignment(tx, actor.tenantId, student.id, kind);
      if (!current || current.status !== "confirmed") throw new AccessDenied(404);
      if (current.revision !== expected) return conflict();
      const context = await roster.studentReadingContext(tx, actor.tenantId, student.id);
      if (!context) throw new AccessDenied(404);
      const updated = await data.reconfirm(tx, actor.tenantId, student.id, kind, expected, { confirmationDate: student.ceremonyDate, serviceSlot: context.serviceSlot, readingDate: readingDate(student.ceremonyDate, context.serviceSlot).readingDate });
      if (!updated) return conflict();
      await roster.audit(tx, actor, "reading.set", student.id, updated.id);
      return Object.freeze({ ok: true as const, assignmentId: updated.id, revision: updated.revision });
    });
  }

  return Object.freeze({ status, teaching, handOver, family, reconfirm });
}
export type StaffService = ReturnType<typeof createStaffService>;
