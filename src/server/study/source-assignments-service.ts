import { AccessDenied } from "../access/errors";
import { createCurrentVerseContext, currentVerseCapture, snapshotCurrentVerseRequest, type CurrentVerseCapture } from "./current-verse-context";
import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction, StudentAuthority } from "../access/types";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import * as data from "../data/source-assignments";
import * as validate from "./source-assignments-validation";
import type { RelatedSourceCatalog, RelatedSourceMetadata } from "./sources/metadata";
import { projectRelatedCatalog } from "./sources/discovery";
type Request = AccessRequest & { method?: string; signal?: AbortSignal };
const stale = Object.freeze({ ok: false as const, code: "stale-revision" as const }), conflict = Object.freeze({ ok: false as const, code: "conflict" as const });
const unavailable = (): never => { throw new Error("Source assignments unavailable"); };
type Gate<Q extends PgQueryResultHKT> = <T>(verse: string, action: (tx: AccessTransaction<Q>, actor: data.SourceAssignmentActor, capture: CurrentVerseCapture) => Promise<T>) => Promise<T | typeof stale>;
const compatible = (row: data.SourceAssignmentRow, actor: data.SourceAssignmentActor, selection: validate.SourceAssignmentSelection, write: validate.SourceAssignmentIntent, digest: string) =>
  row.requestDigest === digest && row.assignmentId === selection.assignmentId && row.assignmentRevision === selection.assignmentRevision && row.verseRef === write.verseRef
  && row.actorMembershipId === actor.membershipId && row.roleGrantId === actor.roleGrantId && row.mode === actor.mode;
/** The one verse-source replace: the portal's route and the portal MCP both run exactly this, under their own authority gate. */
async function replaceWith<Q extends PgQueryResultHKT>(related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>, gate: Gate<Q>, signal: AbortSignal | undefined, selection: validate.SourceAssignmentSelection, write: validate.SourceAssignmentIntent) {
      const digest = validate.digest(selection, write);
      const replay = async (tx: AccessTransaction<Q>, actor: data.SourceAssignmentActor, envelope: object, row: data.SourceAssignmentRow) => {
        if (!compatible(row, actor, selection, write, digest)) return conflict;
        const head = await data.latest(tx, actor, selection, write.verseRef); if (!head) return unavailable();
        return Object.freeze({ ok: true as const, ...envelope, replayed: true, committedVersion: row.version, currentLatestVersion: head.version, committed: data.view(row) });
      };
      const first = await gate(write.verseRef, async (tx, actor, captured) => {
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
          const catalog = projectRelatedCatalog(await related(write.verseRef, signal ?? new AbortController().signal), write.verseRef);
          if (catalog.catalogHash !== write.catalogHash) outcome = { status: "source-catalog-changed" };
          else { const added = catalog.entries.filter(e => first.added.includes(e.id));
            outcome = added.length !== first.added.length ? { status: "invalid-request" } : { status: "ready", citations: Object.freeze([...keep, ...added].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }; }
        }
      } catch { outcome = { status: "unavailable" }; }
      return gate(write.verseRef, async (tx, actor, captured) => {
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
}
export function createSourceAssignmentsService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
}) {
  const snapshot = snapshotCurrentVerseRequest;
  const readContext = createCurrentVerseContext(input);
  async function authorized<T>(request: Request, selection: validate.SourceAssignmentSelection, verse: string, write: boolean,
    action: (tx: AccessTransaction<Q>, actor: data.SourceAssignmentActor, capture: CurrentVerseCapture) => Promise<T>) {
    if (write) {
      if (selection.mode === "child-practice") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "source-write" }, currentVerseCapture(request,selection,verse,action));
    }
    return readContext(request,selection,verse,action);
  }
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
      const request = snapshot(original), selection = validate.selection(supplied), write = validate.intent(suppliedWrite);
      return replaceWith<Q>(input.related, (verse, action) => authorized(request, selection, verse, true, action), request.signal, selection, write);
    },
  });
}

/**
 * The same replace for a delegated staff authority (the portal MCP's live admin connection): the caller
 * establishes the actor and the student; the verse context, versions, replay, catalog re-check, append
 * and audit are the portal's own (replaceWith), exactly as for the portal's route.
 */
export function createDelegatedSourceAssignments<Q extends PgQueryResultHKT>(input: { related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog> }) {
  return Object.freeze({
    async replaceAs(authority: StudentAuthority<Q>, signal: AbortSignal, supplied: validate.SourceAssignmentSelection, suppliedWrite: validate.SourceAssignmentIntent) {
      const selection = validate.selection(supplied), write = validate.intent(suppliedWrite);
      if (selection.mode !== "admin") throw new AccessDenied(403);
      return replaceWith<Q>(input.related, (verse, action) => authority(selection.studentId, currentVerseCapture({ signal }, selection, verse, action)), signal, selection, write);
    },
  });
}
