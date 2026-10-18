import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { StudentView } from "../data/students";
import { confirmedReadings } from "../data/portal";
import * as data from "../data/source-assignments";
import * as validate from "./source-assignments-validation";
import type { RelatedSourceCatalog, RelatedSourceMetadata } from "./sources/metadata";
import { projectRelatedCatalog } from "./sources/discovery";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { assignmentNeedsReview } from "../../lib/readings/review";
type Request = AccessRequest & { method?: string; signal?: AbortSignal };
const stale = Object.freeze({ ok: false as const, code: "stale-revision" as const }), conflict = Object.freeze({ ok: false as const, code: "conflict" as const });
const unavailable = (): never => { throw new Error("Source assignments unavailable"); };
export function createSourceAssignmentsService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
}) {
  function snapshot(original: Request) { return Object.freeze({ url: original.url, headers: new Headers(original.headers), method: original.method, signal: original.signal }); }
  async function authorized<T>(request: Request, selection: validate.SourceAssignmentSelection, verse: string, write: boolean,
    action: (tx: AccessTransaction<Q>, actor: data.SourceAssignmentActor, capture: { binding: string; envelope: {
      studentId: string; studentRevision: number; mode: data.SourceAssignmentActor["mode"]; context: import("../practice/types").PracticeContextView | null;
      assignment: { id: string; revision: number; kind: "torah" | "haftarah"; needsReview: boolean }; verseRef: string }; live: () => void }) => Promise<T>) {
    const run = async (tx: AccessTransaction<Q>, actor: data.SourceAssignmentActor, student: StudentView) => {
      const live = () => { if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
        if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= Date.now()) throw new AccessDenied(404);
        if (request.signal?.aborted) unavailable(); };
      const readings = await confirmedReadings(tx, actor.tenantId, student.id); live();
      const reading = readings.find(row => row.kind === selection.kind);
      if (!reading || reading.id !== selection.assignmentId || reading.revision !== selection.assignmentRevision) return stale;
      const verses = expandReadingRanges(reading.ref.split(/;\s*/), selection.kind, TANAKH_VERSE_COUNTS);
      if (verses.length !== reading.verses.length || verses.some((ref, i) => ref !== reading.verses[i])) return unavailable();
      if (!verses.includes(verse)) throw new AccessDenied(404);
      const context = "context" in actor ? actor.context : null;
      const binding = JSON.stringify([actor.tenantId, actor.origin, actor.userId, actor.authSessionId, actor.authSessionExpiresAt, actor.membershipId, actor.authorityRevision,
        actor.roleGrantId, actor.roleGrantRevision, actor.mode, actor.studentId, student.revision, actor.relationshipId, actor.relationshipRevision,
        reading.id, reading.revision, reading.kind, reading.basis, reading.ref, reading.snapshot, verses, verse, context]);
      const result = await action(tx, actor, { binding, live, envelope: { studentId: student.id, studentRevision: student.revision, mode: actor.mode, context,
        assignment: { id: reading.id, revision: reading.revision, kind: selection.kind, needsReview: assignmentNeedsReview(reading.snapshot, student.ceremonyDate) }, verseRef: verse } });
      live(); return result;
    };
    if (write) {
      if (selection.mode === "child-practice") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "source-write" }, run);
    }
    return selection.mode === "child-practice" ? input.practice.withPracticeCapability(request, { mode: "child-practice", studentId: selection.studentId, capability: "read" }, run)
      : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run);
  }
  const compatible = (row: data.SourceAssignmentRow, actor: data.SourceAssignmentActor, selection: validate.SourceAssignmentSelection, write: validate.SourceAssignmentIntent, digest: string) =>
    row.requestDigest === digest && row.assignmentId === selection.assignmentId && row.assignmentRevision === selection.assignmentRevision && row.verseRef === write.verseRef
    && row.actorMembershipId === actor.membershipId && row.roleGrantId === actor.roleGrantId && row.mode === actor.mode;
  return Object.freeze({
    async read(original: Request, supplied: validate.SourceAssignmentSelection, suppliedVerse: string) {
      const request = snapshot(original), selection = validate.selection(supplied), verse = validate.verse(suppliedVerse);
      return authorized(request, selection, verse, false, async (tx, actor, captured) => { const head = await data.latest(tx, actor, selection, verse);
        return Object.freeze({ ok: true as const, ...captured.envelope, currentVersion: head?.version ?? 0, citations: head ? data.citations(head) : Object.freeze([]) }); });
    },
    async receipt(original: Request, supplied: validate.SourceAssignmentSelection, suppliedWrite: validate.SourceAssignmentIntent) {
      const request = snapshot(original), selection = validate.selection(supplied), write = validate.intent(suppliedWrite), digest = validate.digest(selection, write);
      return authorized(request, selection, write.verseRef, true, async (tx, actor, captured) => {
        const row = await data.receipt(tx, actor, write.mutationId);
        if (!row) return Object.freeze({ ok: true as const, ...captured.envelope, outcome: "unconfirmed" as const });
        if (!compatible(row, actor, selection, write, digest)) return conflict;
        const head = await data.latest(tx, actor, selection, write.verseRef); if (!head) return unavailable();
        return Object.freeze({ ok: true as const, ...captured.envelope, outcome: "committed" as const, committedVersion: row.version, currentLatestVersion: head.version, committed: data.view(row) });
      });
    },
    async replace(original: Request, supplied: validate.SourceAssignmentSelection, suppliedWrite: validate.SourceAssignmentIntent) {
      const request = snapshot(original), selection = validate.selection(supplied), write = validate.intent(suppliedWrite), digest = validate.digest(selection, write);
      const replay = async (tx: AccessTransaction<Q>, actor: data.SourceAssignmentActor, envelope: object, row: data.SourceAssignmentRow) => {
        if (!compatible(row, actor, selection, write, digest)) return conflict;
        const head = await data.latest(tx, actor, selection, write.verseRef); if (!head) return unavailable();
        return Object.freeze({ ok: true as const, ...envelope, replayed: true, committedVersion: row.version, currentLatestVersion: head.version, committed: data.view(row) });
      };
      const first = await authorized(request, selection, write.verseRef, true, async (tx, actor, captured) => {
        const row = await data.receipt(tx, actor, write.mutationId); if (row) return { tag: "result" as const, result: await replay(tx, actor, captured.envelope, row) };
        const head = await data.latest(tx, actor, selection, write.verseRef);
        if ((head?.version ?? 0) !== write.expectedVersion) return { tag: "result" as const, result: conflict };
        const retained = head ? data.citations(head) : Object.freeze([]);
        if (retained.length === write.sourceIds.length && retained.every((entry, i) => entry.id === write.sourceIds[i])) return { tag: "result" as const, result: { ok: false as const, code: "no-change" as const } };
        const added = write.sourceIds.filter(id => !retained.some(e => e.id === id));
        if (added.length && !write.catalogHash) return { tag: "result" as const, result: { ok: false as const, code: "invalid-request" as const } };
        return { tag: "prepare" as const, binding: captured.binding, retained, added };
      });
      if ("ok" in first) return first;
      if (first.tag === "result") return first.result;
      type Outcome = { status: "ready"; citations: readonly RelatedSourceMetadata[] } | { status: "unavailable" | "source-catalog-changed" | "invalid-request" };
      let outcome: Outcome;
      try {
        const keep = first.retained.filter(e => write.sourceIds.includes(e.id));
        if (!first.added.length) outcome = { status: "ready", citations: Object.freeze(keep) };
        else {
          const catalog = projectRelatedCatalog(await input.related(write.verseRef, request.signal ?? new AbortController().signal), write.verseRef);
          if (catalog.catalogHash !== write.catalogHash) outcome = { status: "source-catalog-changed" };
          else { const added = catalog.entries.filter(e => first.added.includes(e.id));
            outcome = added.length !== first.added.length ? { status: "invalid-request" } : { status: "ready", citations: Object.freeze([...keep, ...added].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }; }
        }
      } catch { outcome = { status: "unavailable" }; }
      return authorized(request, selection, write.verseRef, true, async (tx, actor, captured) => {
        if (captured.binding !== first.binding) return stale;
        const previous = await data.receipt(tx, actor, write.mutationId); if (previous) return replay(tx, actor, captured.envelope, previous);
        const head = await data.latest(tx, actor, selection, write.verseRef); if ((head?.version ?? 0) !== write.expectedVersion) return conflict;
        if (outcome.status === "unavailable") return unavailable();
        if (outcome.status !== "ready") return Object.freeze({ ok: false as const, code: outcome.status });
        if (Buffer.byteLength(JSON.stringify(outcome.citations)) > 128 * 1024 || outcome.citations.length > 32) return unavailable();
        captured.live(); const inserted = await data.append(tx, actor, selection, write, digest, outcome.citations, captured.live); captured.live();
        if (inserted) return Object.freeze({ ok: true as const, ...captured.envelope, replayed: false, committedVersion: inserted.version, currentLatestVersion: inserted.version, committed: data.view(inserted) });
        const raced = await data.receipt(tx, actor, write.mutationId); captured.live(); if (raced) return replay(tx, actor, captured.envelope, raced);
        const latest = await data.latest(tx, actor, selection, write.verseRef); captured.live(); return (latest?.version ?? 0) !== write.expectedVersion ? conflict : unavailable();
      });
    },
  });
}
