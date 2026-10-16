import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import { confirmedReadings } from "../data/portal";
import * as data from "../data/student-work";
import * as validate from "./validation";
import type { Stream, WorkSelection } from "./validation";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { expandReadingRanges } from "../../lib/readings/ranges";

const stale = { ok: false as const, code: "stale-revision" as const };
const conflict = { ok: false as const, code: "conflict" as const };
type Request = AccessRequest & { method?: string };
export function createStudentWorkService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  authorityBindingSecret: string;
}) {
  if (input.authorityBindingSecret.length < 32) throw new Error("Work authority unavailable");
  const authorityBinding = async (tx: AccessTransaction<Q>, actor: data.WorkActor) => createHmac("sha256", input.authorityBindingSecret).update(JSON.stringify([
    "student-work-authority:v1", actor.origin, actor.tenantId, actor.userId, actor.authSessionId, actor.membershipId, actor.authorityRevision,
    actor.roleGrantId, actor.roleGrantRevision, actor.studentId, actor.relationshipId, actor.relationshipRevision, actor.mode,
    "context" in actor ? actor.context?.id ?? null : null, "context" in actor ? actor.context?.authorityRevision ?? null : null,
    await data.studentRevision(tx, actor),
  ])).digest("base64url");
  async function authorized<T>(request: Request, selection: WorkSelection, operation: "read" | Stream,
    action: (tx: AccessTransaction<Q>, actor: data.WorkActor, verses: readonly string[]) => Promise<T>) {
    const run = async (tx: AccessTransaction<Q>, actor: data.WorkActor) => {
      const readings = await confirmedReadings(tx, actor.tenantId, actor.studentId);
      const assertLive = () => {
        const now = Date.now();
        if (actor.authSessionExpiresAt <= now) throw new AccessDenied(401);
        if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= now) throw new AccessDenied(404);
      };
      // Even a stale binding is subordinate to current authority expiry after
      // acquiring assignment locks. No early result bypasses this check.
      assertLive();
      const reading = readings.find(row => row.kind === selection.kind);
      if (!reading || reading.id !== selection.assignmentId || reading.revision !== selection.assignmentRevision) return stale;
      const verses = expandReadingRanges(reading.ref.split(/;\s*/), selection.kind, TANAKH_VERSE_COUNTS);
      if (verses.length !== reading.verses.length || verses.some((ref, i) => ref !== reading.verses[i])) throw new Error("Work assignment unavailable");
      const result = await action(tx, actor, verses);
      // INSERT uniqueness can itself wait. Recheck real time after every wait;
      // an expiry rolls back a new version and its audit together.
      assertLive();
      return result;
    };
    if (operation === "draft") {
      if (selection.mode !== "student" && selection.mode !== "child-practice") {
        return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "practice-write" }, run);
      }
      return input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "practice-write" }, run);
    }
    if (operation === "note") {
      if (selection.mode === "child-practice") throw new AccessDenied(403);
      return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "note-write" }, run);
    }
    return selection.mode === "child-practice"
      ? input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run)
      : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run);
  }
  const requireVerse = (verses: readonly string[], verse: string) => { if (!verses.includes(verse)) throw new AccessDenied(404); };
  const latest = async (tx: AccessTransaction<Q>, actor: data.WorkActor, stream: Stream, verse: string) =>
    (await data.history(tx, actor, stream, verse, undefined, 1))[0] ?? null;
  return Object.freeze({
    async recovery(request: Request, supplied: WorkSelection, stream: Stream, originalRevision: number, suppliedWrite: validate.WorkWrite, originalAuthority: string) {
      const selection = validate.selection(supplied); validate.stream(stream); validate.integer(originalRevision, 1, 2147483647);
      const write = validate.write(suppliedWrite, stream);
      if (originalRevision >= selection.assignmentRevision) return { ok: false as const, code: "invalid-request" as const };
      const digest = createHash("sha256").update(JSON.stringify([stream, selection.kind, selection.assignmentId, originalRevision,
        selection.mode, write.verseRef, write.expectedVersion, write.text])).digest("hex");
      return authorized(request, selection, stream, async (tx, actor, verses) => {
        if (typeof originalAuthority !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(originalAuthority) || originalAuthority !== await authorityBinding(tx, actor)) throw new AccessDenied(404);
        requireVerse(verses, write.verseRef);
        // A newer assignment under this SHARE lock proves every old writer
        // either committed before its UPDATE or will reject the old revision.
        const row = await data.receipt(tx, actor, stream, write.mutationId);
        const child = actor.mode === "child-practice";
        if (row && (row.requestDigest !== digest || row.assignmentId !== selection.assignmentId || row.assignmentRevision !== originalRevision
          || row.verseRef !== write.verseRef || row.text !== write.text || row.version !== write.expectedVersion + 1
          || row.actorMembershipId !== actor.membershipId || row.mode !== actor.mode || row.roleGrantId !== actor.roleGrantId
          || row.guardianId !== (child ? actor.relationshipId : null) || row.contextId !== ("context" in actor ? actor.context?.id ?? null : null)
          || row.studentIdentityId !== (actor.mode === "student" ? actor.relationshipId : null))) return conflict;
        return { ok: true as const, assignmentId: selection.assignmentId, assignmentRevision: selection.assignmentRevision, originalRevision,
          mutationId: write.mutationId, verseRef: write.verseRef, stream, authorityBinding: originalAuthority, outcome: row ? "committed" as const : "absent" as const,
          receipt: row ? { ok: true as const, committedVersion: row.version, currentLatestVersion: (await latest(tx, actor, stream, write.verseRef))!.version, committed: data.view(row) } : null };
      });
    },
    async page(request: Request, supplied: WorkSelection, offset = 0) {
      const selection = validate.selection(supplied); validate.integer(offset, 0, 999);
      return authorized(request, selection, "read", async (tx, actor, verses) => {
        if (offset >= verses.length) return { ok: false as const, code: "invalid-request" as const };
        const rows = [];
        for (const ref of verses.slice(offset, offset + 10)) {
          const row = { ref, draft: await latest(tx, actor, "draft", ref).then(row => row ? data.view(row) : null),
            notes: (await data.history(tx, actor, "note", ref, undefined, 3)).map(data.view) };
          // Quoted/backslash-heavy valid text expands in JSON. Keep a page
          // useful within the transport bound by stopping at a verse boundary.
          if (rows.length && Buffer.byteLength(JSON.stringify([...rows, row])) > 240 * 1024) break;
          rows.push(row);
        }
        return { ok: true as const, studentId: actor.studentId, assignmentId: selection.assignmentId, assignmentRevision: selection.assignmentRevision, authorityBinding: await authorityBinding(tx, actor),
          offset, totalVerses: verses.length, nextOffset: offset + rows.length < verses.length ? offset + rows.length : null, verses: rows };
      });
    },
    async history(request: Request, supplied: WorkSelection, stream: Stream, verseRef: string, beforeVersion?: number) {
      const selection = validate.selection(supplied); validate.stream(stream); validate.verse(verseRef); if (beforeVersion !== undefined) validate.integer(beforeVersion, 1, 2147483647);
      return authorized(request, selection, "read", async (tx, actor, verses) => {
        requireVerse(verses, verseRef);
        const rows = await data.history(tx, actor, stream, verseRef, beforeVersion, 21);
        return { ok: true as const, versions: rows.slice(0, 20).map(data.view), nextBeforeVersion: rows.length > 20 ? rows[19].version : null };
      });
    },
    async receipt(request: Request, supplied: WorkSelection, stream: Stream, verseRef: string, mutationId: string) {
      const selection = validate.selection(supplied); validate.stream(stream); validate.verse(verseRef); mutationId = validate.uuid(mutationId);
      return authorized(request, selection, "read", async (tx, actor, verses) => {
        requireVerse(verses, verseRef);
        const row = await data.receipt(tx, actor, stream, mutationId);
        if (!row || row.verseRef !== verseRef) throw new AccessDenied(404);
        return { ok: true as const, committedVersion: row.version, currentLatestVersion: (await latest(tx, actor, stream, verseRef))!.version,
          committed: data.view(row) };
      });
    },
    async append(request: Request, supplied: WorkSelection, stream: Stream, suppliedWrite: validate.WorkWrite) {
      const selection = validate.selection(supplied); validate.stream(stream);
      const write = validate.write(suppliedWrite, stream);
      const digest = createHash("sha256").update(JSON.stringify([stream, selection.kind, selection.assignmentId, selection.assignmentRevision,
        selection.mode, write.verseRef, write.expectedVersion, write.text])).digest("hex");
      return authorized(request, selection, stream, async (tx, actor, verses) => {
        requireVerse(verses, write.verseRef);
        const replay = async (row: data.WorkRow) => row.requestDigest === digest && row.verseRef === write.verseRef && row.mode === actor.mode
          && row.roleGrantId === actor.roleGrantId && row.guardianId === (actor.mode === "child-practice" ? actor.relationshipId : null)
          ? { ok: true as const, replayed: true, committedVersion: row.version, currentLatestVersion: (await latest(tx, actor, stream, write.verseRef))!.version, committed: data.view(row) }
          : conflict;
        const previous = await data.receipt(tx, actor, stream, write.mutationId);
        if (previous) return replay(previous);
        const head = await latest(tx, actor, stream, write.verseRef);
        if ((head?.version ?? 0) !== write.expectedVersion) return conflict;
        const inserted = await data.append(tx, actor, stream, selection, write, digest);
        if (inserted) return { ok: true as const, replayed: false, committedVersion: inserted.version, currentLatestVersion: inserted.version, committed: data.view(inserted) };
        const raced = await data.receipt(tx, actor, stream, write.mutationId);
        return raced ? replay(raced) : conflict;
      });
    },
  });
}
