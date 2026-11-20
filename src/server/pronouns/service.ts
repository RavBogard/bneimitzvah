import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import { liveStudentOf } from "../learners/data";
import { canView } from "../data/learner-claims";
import { requireCookieMutation } from "../http/mutations";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { privatePronouns } from "../db/pronouns-schema";

type Request = AccessRequest & { method?: string };
export type PronounSubject = { type: "own" } | { type: "learner"; membershipId: string } | { type: "student"; studentId: string; mode: "student" | "parent" | "tutor" | "admin" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function parsePronouns(value: unknown): string {
  if (typeof value !== "string" || !value.isWellFormed() || Array.from(value).length > 80 || /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(value)) throw new HttpBoundaryError();
  return value.trim();
}
export function parsePronounSubject(value: unknown): PronounSubject {
  if (!value || typeof value !== "object") throw new HttpBoundaryError();
  const type = (value as { type?: unknown }).type;
  const row = closedObject(value, type === "own" ? ["type"] : type === "learner" ? ["type", "membershipId"] : ["type", "studentId", "mode"]);
  if (type === "own") return { type };
  if (type === "learner" && typeof row.membershipId === "string" && UUID.test(row.membershipId)) return { type, membershipId: row.membershipId };
  if (type === "student" && typeof row.studentId === "string" && UUID.test(row.studentId) && ["student", "parent", "tutor", "admin"].includes(String(row.mode))) return { type, studentId: row.studentId, mode: row.mode as "student" | "parent" | "tutor" | "admin" };
  throw new HttpBoundaryError();
}

export function createPronounsService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity" | "withStudentCapability"> }) {
  type Scope = { tenantId: string; membershipId?: string; studentId?: string };
  const where = (scope: Scope) => and(eq(privatePronouns.tenantId, scope.tenantId), scope.studentId ? eq(privatePronouns.studentId, scope.studentId) : eq(privatePronouns.membershipId, scope.membershipId!));
  async function authorized<T>(request: Request, subject: PronounSubject, write: boolean, action: (tx: AccessTransaction<Q>, scope: Scope) => Promise<T>): Promise<T> {
    if (request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    if (subject.type === "student") {
      // These existing authority paths prove the selected self/guardian relationship or staff read permission under live locks.
      if (write && subject.mode !== "student" && subject.mode !== "parent") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: subject.mode, studentId: subject.studentId, capability: "read" }, async (tx, actor) => {
        if (write) requireCookieMutation(request, actor.origin);
        return action(tx, { tenantId: actor.tenantId, studentId: subject.studentId });
      });
    }
    return input.access.withVerifiedIdentity(request, { intent: write ? "data-write" : "read", mutation: write }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      if (write) requireCookieMutation(request, identity.origin);
      const membershipId = subject.type === "own" ? identity.membership.id : subject.membershipId;
      if (subject.type === "learner" && (write || !await canView(tx, identity.tenantId, identity.membership.id, membershipId))) throw new AccessDenied(404);
      if (subject.type === "learner") {
        const student = await liveStudentOf(tx, identity.tenantId, membershipId);
        if (student) return action(tx, { tenantId: identity.tenantId, studentId: student.id });
      }
      return action(tx, { tenantId: identity.tenantId, membershipId });
    });
  }
  return Object.freeze({
    read(request: Request, subject: PronounSubject) {
      return authorized(request, subject, false, async (tx, scope) => {
        const [row] = await tx.select().from(privatePronouns).where(where(scope));
        return { ok: true as const, pronouns: row?.pronouns ?? "", revision: row?.revision ?? 0 };
      });
    },
    write(request: Request, supplied: unknown) {
      const body = closedObject(supplied, ["subject", "pronouns", "expectedRevision"]), subject = parsePronounSubject(body.subject), pronouns = parsePronouns(body.pronouns), revision = body.expectedRevision;
      if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new HttpBoundaryError();
      return authorized(request, subject, true, async (tx, scope) => {
        // One atomic compare-and-swap: a concurrent self/guardian edit never overwrites unseen values.
        const rows = revision === 0 ? await tx.insert(privatePronouns).values({ ...scope, pronouns }).onConflictDoNothing().returning()
          : await tx.update(privatePronouns).set({ pronouns, revision: sql`${privatePronouns.revision} + 1` }).where(and(where(scope), eq(privatePronouns.revision, revision as number))).returning();
        const row = rows[0];
        return row ? { ok: true as const, pronouns: row.pronouns, revision: row.revision } : { ok: false as const, code: "changed" as const };
      });
    },
  });
}
