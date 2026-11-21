import "server-only";
import { createHash } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { PERSONAL_STUDY_HEADER } from "../../lib/learn/child-practice";
import { PRACTICE_DATE_BATCH, PRACTICE_REPLAY_DAYS, practiceDateOrdinal } from "../../lib/practice-calendar/day";
import { AccessDenied } from "../access/errors";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { ensureDay } from "../data/practice-calendar";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { childLearningSelection, directLearningStudent, type LearningAccess } from "../practice/learning-owner";
import { offlineOwnerName } from "../offline/owner";
import { retention, serverInstant } from "./policy";

type Request = AccessRequest & { method?: string };
type Owner = Readonly<{ tenantId: string; userId: string; studentId: string; ceremonyDate: string; expiresAt: number }>;
const ownerName = (owner: Owner) => createHash("sha256")
  .update(`practice-date-owner/v1:${owner.tenantId}:${owner.studentId}`).digest("hex").slice(0, 32);

function requestedDates(supplied: unknown) {
  const body = closedObject(supplied, ["owner", "dates"]);
  if (typeof body.owner !== "string" || !/^[a-f0-9]{32}$/.test(body.owner)
    || !Array.isArray(body.dates) || body.dates.length === 0 || body.dates.length > PRACTICE_DATE_BATCH
    || body.dates.some(date => practiceDateOrdinal(date) === null) || new Set(body.dates).size !== body.dates.length) throw new HttpBoundaryError();
  return { owner: body.owner, dates: (body.dates as string[]).slice().sort() };
}

/** A completed activity contributes only a calendar date. The browser's owner and dates are claims, never authority. */
export function createPracticeCompletion<Q extends PgQueryResultHKT>(input: LearningAccess<Q> & { now?: () => number; offlineSecret?: string }) {
  const now = input.now ?? Date.now;
  function authorize<T>(request: Request, write: boolean, operation: (tx: AccessTransaction<Q>, owner: Owner) => Promise<T>) {
    if (request.headers.has(PERSONAL_STUDY_HEADER)) throw new AccessDenied(403);
    const selection = childLearningSelection(request);
    const run = async (tx: AccessTransaction<Q>, owner: Owner) => {
      if (owner.expiresAt <= Date.now()) throw new AccessDenied(401);
      const result = await operation(tx, owner);
      if (owner.expiresAt <= Date.now()) throw new AccessDenied(401);
      return result;
    };
    if (selection) {
      if (!input.practice) throw new AccessDenied(403);
      return input.practice.withPracticeCapability(request, { ...selection, capability: write ? "practice-write" : "read" }, (tx, actor, student) => {
        if (actor.mode !== "child-practice" || !actor.context) throw new AccessDenied(403);
        return run(tx, { tenantId: actor.tenantId, userId: actor.userId, studentId: student.id, ceremonyDate: student.ceremonyDate,
          expiresAt: Math.min(actor.authSessionExpiresAt, Date.parse(actor.context.expiresAt)) });
      });
    }
    const intent = write ? "data-write" as const : "read" as const;
    return input.access.withVerifiedIdentity(request, { intent, mutation: write }, async (tx, identity) => {
      if (!identity.membership) throw new AccessDenied(403);
      const student = await directLearningStudent(tx, identity.tenantId, identity.membership.id, intent);
      if (!student) throw new AccessDenied(403);
      return run(tx, { tenantId: identity.tenantId, userId: identity.userId, studentId: student.id, ceremonyDate: student.ceremonyDate, expiresAt: identity.sessionExpiresAt.getTime() });
    });
  }

  return Object.freeze({
    owner(request: Request) {
      return authorize(request, false, async (_tx, owner) => {
        if (retention(owner.ceremonyDate, serverInstant(now())).expired) throw new AccessDenied(403);
        return { ok: true as const, owner: ownerName(owner), expiresAt: owner.expiresAt,
          ...(input.offlineSecret ? { offlineOwner: offlineOwnerName(input.offlineSecret, owner.tenantId, owner.userId) } : {}) };
      });
    },
    record(request: Request, supplied: unknown) {
      const input = requestedDates(supplied);
      return authorize(request, true, async (tx, owner) => {
        if (input.owner !== ownerName(owner)) throw new AccessDenied(403);
        const status = () => retention(owner.ceremonyDate, serverInstant(now()));
        const accepted: string[] = [], discarded: string[] = [];
        for (const date of input.dates) {
          const state = status();
          const age = practiceDateOrdinal(state.serverDay)! - practiceDateOrdinal(date)!;
          if (state.expired || age < 0 || age > PRACTICE_REPLAY_DAYS) { discarded.push(date); continue; }
          await ensureDay(tx, owner, date);
          accepted.push(date);
        }
        // A wait on an existing day can cross the ceremony cutoff; roll back the entire batch.
        if (accepted.length && status().expired) throw new AccessDenied(403);
        return { ok: true as const, accepted, discarded };
      });
    },
  });
}
