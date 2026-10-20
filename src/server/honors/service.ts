import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction, StudentActor } from "../access/types";
import type { createAccessService } from "../access/service";
import { AccessDenied } from "../access/errors";
import * as data from "../data/honors";
import * as validate from "./validation";
import { capture, validMappings } from "./context";
import type { HonorsCommit, HonorsContextView, HonorsIntent, HonorsRead, HonorsSelection } from "../../lib/honors/types";
type Request = AccessRequest & { method?: string; signal?: AbortSignal };
const conflict = Object.freeze({ ok: false as const, code: "conflict" as const });
export function createHonorsService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>> }) {
  async function authorized<T>(original: Request, selected: HonorsSelection, write: boolean, action: (tx: AccessTransaction<Q>, actor: StudentActor, context: () => Promise<HonorsContextView>, live: () => void) => Promise<T>) {
    const request = { url: original.url, headers: new Headers(original.headers), method: original.method, signal: original.signal };
    return input.access.withStudentCapability(request, { ...selected, capability: write ? "honors-write" : "honors-read" }, async (tx, actor, student) => {
      const live = () => { if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401); if (request.signal?.aborted) throw new Error("Honors unavailable"); };
      live(); const result = await action(tx, actor, () => capture(tx, actor, student), live); live(); return result;
    });
  }
  function compatible(row: data.HonorsRow, actor: StudentActor, digest: string) {
    return row.requestDigest === digest && row.actorUserId === actor.userId && row.actorMembershipId === actor.membershipId && row.roleGrantId === actor.roleGrantId
      && row.mode === actor.mode && row.guardianId === (actor.mode === "parent" ? actor.relationshipId : null)
      && row.studentIdentityId === (actor.mode === "student" ? actor.relationshipId : null);
  }
  async function committed<Q2 extends PgQueryResultHKT>(tx: AccessTransaction<Q2>, actor: StudentActor, row: data.HonorsRow, current: HonorsContextView, replayed: boolean, live: () => void): Promise<HonorsCommit> {
    const head = await data.latest(tx, actor); live(); if (!head) throw new Error("Honors unavailable");
    return Object.freeze({ ok: true, outcome: "committed", replayed, committedVersion: row.version, currentLatestVersion: head.version,
      committed: data.view(row), currentContext: current, needsReview: row.contextHash !== current.hash });
  }
  async function mutate(original: Request, supplied: HonorsSelection, suppliedWrite: HonorsIntent, receipt: boolean) {
    const selected = validate.selection(supplied), write = validate.intent(suppliedWrite), digest = validate.digest(selected, write);
    return authorized(original, selected, true, async (tx, actor, context, live) => {
      const prior = await data.receipt(tx, actor, write.mutationId); live();
      if (prior) { if (!compatible(prior, actor, digest)) return conflict; return committed(tx, actor, prior, await context(), true, live); }
      if (receipt) return Object.freeze({ ok: true as const, outcome: "unconfirmed" as const });
      const current = await context(); live(); if (current.hash !== write.contextHash) return Object.freeze({ ok: false as const, code: "stale-context" as const });
      if (!validMappings(write.form, current)) return Object.freeze({ ok: false as const, code: "invalid-request" as const });
      const head = await data.latest(tx, actor); live();
      if ((head?.version ?? 0) !== write.expectedVersion) {
        const previous = await data.receipt(tx, actor, write.mutationId); live();
        return previous && compatible(previous, actor, digest) ? committed(tx, actor, previous, current, true, live) : conflict;
      }
      const inserted = await data.append(tx, actor, write, digest, current, live); live();
      if (inserted) return committed(tx, actor, inserted, current, false, live);
      const raced = await data.receipt(tx, actor, write.mutationId); live();
      return raced && compatible(raced, actor, digest) ? committed(tx, actor, raced, current, true, live) : conflict;
    });
  }
  return Object.freeze({
    async read(original: Request, supplied: HonorsSelection): Promise<HonorsRead> {
      const selected = validate.selection(supplied);
      return authorized(original, selected, false, async (tx, actor, context, live) => { const current = await context(), head = await data.latest(tx, actor); live();
        return Object.freeze({ ok: true, studentId: actor.studentId, currentVersion: head?.version ?? 0, currentContext: current, saved: head ? data.view(head) : null, needsReview: !!head && head.contextHash !== current.hash }); });
    },
    replace: (request: Request, selected: HonorsSelection, write: HonorsIntent) => mutate(request, selected, write, false),
    receipt: (request: Request, selected: HonorsSelection, write: HonorsIntent) => mutate(request, selected, write, true),
  });
}
