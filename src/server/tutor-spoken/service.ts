import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, ActiveMode, StudentActor } from "../access/types";
import { AccessDenied } from "../access/errors";
import { confirmedReadings } from "../data/portal";
import { tutorSpoken, tutorSpokenCleanup } from "../db/tutor-spoken-schema";
import { requireCookieMutation } from "../http/mutations";
import { HttpBoundaryError } from "../http/responses";
import { boundedAudio, mediaType, validateMedia, type SpokenMediaType } from "./media";

export type SpokenSelection = Readonly<{ mode: ActiveMode; studentId: string; assignmentId: string; assignmentRevision: number; startVerse: string }>;
export type SpokenTransport = Readonly<{
  put(path: string, bytes: Uint8Array, type: SpokenMediaType): Promise<void>;
  get(path: string): Promise<ReadableStream<Uint8Array>>;
  remove(path: string): Promise<void>;
}>;
type Clip = typeof tutorSpoken.$inferSelect;
const stale = { ok: false as const, code: "stale-revision" as const };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function spokenSelection(value: SpokenSelection): SpokenSelection {
  if (!uuid.test(value.studentId) || !uuid.test(value.assignmentId) || !["student", "parent", "tutor", "admin"].includes(value.mode)
    || !Number.isSafeInteger(value.assignmentRevision) || value.assignmentRevision < 1 || typeof value.startVerse !== "string" || value.startVerse.length > 100 || !/^.+ [1-9]\d*:[1-9]\d*$/.test(value.startVerse)) throw new HttpBoundaryError();
  return Object.freeze({ ...value });
}
const actorBinding = (actor: StudentActor) => JSON.stringify([actor.tenantId, actor.userId, actor.authSessionId, actor.authSessionExpiresAt, actor.membershipId, actor.authorityRevision, actor.roleGrantId, actor.roleGrantRevision, actor.mode, actor.relationshipId, actor.relationshipRevision]);

export function createTutorSpokenService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withStudentCapability">; transport?: SpokenTransport }) {
  function authority<T>(request: AccessRequest, selection: SpokenSelection, write: boolean, action: (tx: AccessTransaction<Q>, actor: StudentActor) => Promise<T>) {
    if (selection.mode === "parent") throw new AccessDenied(403);
    return input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: write ? "source-write" : "read" }, async (tx, actor) => {
      if (write) requireCookieMutation(request, actor.origin);
      return action(tx, actor);
    });
  }
  async function capture(tx: AccessTransaction<Q>, actor: StudentActor, selection: SpokenSelection, exactRevision: boolean) {
    const reading = (await confirmedReadings(tx, actor.tenantId, actor.studentId)).find(row => row.id === selection.assignmentId && row.kind === "torah");
    if (!reading || exactRevision && reading.revision !== selection.assignmentRevision || reading.aliyahStarts === null) return null;
    const starts = [reading.verses[0], ...reading.aliyahStarts], index = starts.indexOf(selection.startVerse);
    if (index < 0) return null;
    const first = reading.verses.indexOf(selection.startVerse), next = starts[index + 1], last = next ? reading.verses.indexOf(next) : reading.verses.length;
    const verses = reading.verses.slice(first, last);
    if (!verses.length) return null;
    return { endVerse: verses[verses.length - 1], verseDigest: createHash("sha256").update(JSON.stringify(verses)).digest("hex"), assignmentRevision: reading.revision };
  }
  async function clipRow(tx: AccessTransaction<Q>, actor: StudentActor, selection: SpokenSelection) {
    const [row] = await tx.select().from(tutorSpoken).where(and(eq(tutorSpoken.tenantId, actor.tenantId), eq(tutorSpoken.studentId, actor.studentId), eq(tutorSpoken.assignmentId, selection.assignmentId), eq(tutorSpoken.startVerse, selection.startVerse))).limit(1);
    return row ?? null;
  }
  function canManage(actor: StudentActor, clip: Clip | null) { return actor.mode === "admin" || actor.mode === "tutor" && (!clip?.blobPath || clip.creatorMembershipId === actor.membershipId); }
  const visible = (clip: Clip | null, scope: { verseDigest: string } | null) => !!clip?.blobPath && scope?.verseDigest === clip.verseDigest;
  async function queueCleanup(tx: AccessTransaction<Q>, actor: StudentActor, path: string) {
    await tx.insert(tutorSpokenCleanup).values({ tenantId: actor.tenantId, studentId: actor.studentId, blobPath: path }).onConflictDoNothing();
  }
  async function clean(request: AccessRequest, selection: SpokenSelection) {
    if (!input.transport) return;
    try {
      const pending = await authority(request, selection, false, async (tx, actor) => tx.select().from(tutorSpokenCleanup).where(and(eq(tutorSpokenCleanup.tenantId, actor.tenantId), eq(tutorSpokenCleanup.studentId, actor.studentId))).limit(8));
      for (const item of pending) {
        try {
          await input.transport.remove(item.blobPath);
          await authority(request, selection, false, async (tx, actor) => { await tx.delete(tutorSpokenCleanup).where(and(eq(tutorSpokenCleanup.tenantId, actor.tenantId), eq(tutorSpokenCleanup.studentId, actor.studentId), eq(tutorSpokenCleanup.blobPath, item.blobPath))); });
        } catch { /* The obsolete path remains queued; no provider diagnostics reach logs. */ }
      }
    } catch { /* Cleanup never turns an already committed action into a failure. */ }
  }
  return Object.freeze({
    async read(request: AccessRequest, supplied: SpokenSelection) {
      const selection = spokenSelection(supplied);
      return authority(request, selection, false, async (tx, actor) => {
        const scope = await capture(tx, actor, selection, false), clip = await clipRow(tx, actor, selection);
        return { ok: true as const, available: !!input.transport, clip: input.transport && visible(clip, scope) ? {
          id: clip!.id, revision: clip!.revision, mediaType: clip!.mediaType, canManage: canManage(actor, clip), startVerse: clip!.startVerse, endVerse: clip!.endVerse,
        } : null, canShare: !!input.transport && !!scope && canManage(actor, clip), expectedClipRevision: canManage(actor, clip) ? clip?.revision ?? 0 : 0, expectedClipId: canManage(actor, clip) ? clip?.id ?? null : null };
      });
    },
    async audio(request: AccessRequest, supplied: SpokenSelection, clipId: string) {
      const selection = spokenSelection(supplied); if (!uuid.test(clipId)) throw new HttpBoundaryError();
      const first = await authority(request, selection, false, async (tx, actor) => {
        const scope = await capture(tx, actor, selection, false), clip = await clipRow(tx, actor, selection);
        if (!input.transport || !visible(clip, scope) || clip!.id !== clipId) throw new AccessDenied(404);
        return { actor: actorBinding(actor), clip: clip! };
      });
      let bytes: Uint8Array;
      try { bytes = await boundedAudio(await input.transport!.get(first.clip.blobPath!)); validateMedia(bytes, mediaType(first.clip.mediaType)); }
      catch { throw new Error("Tutor recording unavailable"); }
      return authority(request, selection, false, async (tx, actor) => {
        const scope = await capture(tx, actor, selection, false), clip = await clipRow(tx, actor, selection);
        if (actorBinding(actor) !== first.actor || !visible(clip, scope) || clip!.id !== clipId || clip!.revision !== first.clip.revision || clip!.blobPath !== first.clip.blobPath || bytes.length !== clip!.byteLength) throw new AccessDenied(404);
        return { bytes, mediaType: first.clip.mediaType };
      });
    },
    async replace(request: AccessRequest, supplied: SpokenSelection, expected: { revision: number; id: string | null }, bytes: Uint8Array, type: SpokenMediaType) {
      const selection = spokenSelection(supplied); validateMedia(bytes, type);
      if (!Number.isSafeInteger(expected.revision) || expected.revision < 0 || expected.id !== null && !uuid.test(expected.id)) throw new HttpBoundaryError();
      const first = await authority(request, selection, true, async (tx, actor) => {
        const scope = await capture(tx, actor, selection, true), clip = await clipRow(tx, actor, selection);
        if (!canManage(actor, clip)) throw new AccessDenied(403);
        if (!scope || (clip?.revision ?? 0) !== expected.revision || (clip?.id ?? null) !== expected.id) return null;
        return { actor: actorBinding(actor), tenantId: actor.tenantId, scope };
      });
      if (!first) return stale;
      if (!input.transport) return { ok: false as const, code: "unavailable" as const };
      const path = `tutor-spoken/${randomUUID()}`;
      try { await input.transport.put(path, bytes, type); } catch { throw new Error("Tutor recording unavailable"); }
      let committed = false, knownUncommitted = false;
      try {
        const result = await authority(request, selection, true, async (tx, actor) => {
          const scope = await capture(tx, actor, selection, true);
          if (actorBinding(actor) !== first.actor || !scope || scope.verseDigest !== first.scope.verseDigest) return stale;
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tutor-spoken:${actor.tenantId}:${selection.assignmentId}:${selection.startVerse}`}, 0))`);
          const clip = await clipRow(tx, actor, selection);
          if (!canManage(actor, clip)) throw new AccessDenied(403);
          if ((clip?.revision ?? 0) !== expected.revision || (clip?.id ?? null) !== expected.id) return stale;
          if (clip?.blobPath) await queueCleanup(tx, actor, clip.blobPath);
          const values = { creatorMembershipId: clip?.blobPath ? clip.creatorMembershipId : actor.membershipId, endVerse: scope.endVerse, verseDigest: scope.verseDigest, blobPath: path, mediaType: type, byteLength: bytes.length, revision: (clip?.revision ?? 0) + 1, updatedAt: new Date() };
          if (clip) await tx.update(tutorSpoken).set(values).where(and(eq(tutorSpoken.tenantId, actor.tenantId), eq(tutorSpoken.id, clip.id)));
          else await tx.insert(tutorSpoken).values({ ...values, tenantId: actor.tenantId, studentId: actor.studentId, assignmentId: selection.assignmentId, startVerse: selection.startVerse, creatorMembershipId: actor.membershipId });
          return { ok: true as const };
        });
        committed = result.ok; knownUncommitted = !result.ok;
        return result;
      } finally {
        if (!committed) {
          // A transaction may commit before its response is lost. Never delete a possible live blob.
          if (!knownUncommitted) {
            try { knownUncommitted = await authority(request, selection, false, async (tx, actor) => (await clipRow(tx, actor, selection))?.blobPath !== path); }
            catch { /* Unknown outcome: retain the private blob for an authoritative retry/operator cleanup. */ }
          }
          if (knownUncommitted) {
            try { await input.transport.remove(path); }
            catch { try { await authority(request, selection, true, (tx, actor) => queueCleanup(tx, actor, path)); } catch { /* An inaccessible uncommitted orphan may need operator cleanup. */ } }
          }
        } else await clean(request, selection);
      }
    },
    async withdraw(request: AccessRequest, supplied: SpokenSelection, expected: { revision: number; id: string | null }) {
      const selection = spokenSelection(supplied);
      if (!Number.isSafeInteger(expected.revision) || expected.revision < 1 || !expected.id || !uuid.test(expected.id)) throw new HttpBoundaryError();
      const result = await authority(request, selection, true, async (tx, actor) => {
        if (!await capture(tx, actor, selection, true)) return stale;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tutor-spoken:${actor.tenantId}:${selection.assignmentId}:${selection.startVerse}`}, 0))`);
        const clip = await clipRow(tx, actor, selection);
        if (!clip || clip.id !== expected.id || clip.revision !== expected.revision || !clip.blobPath) return stale;
        if (!canManage(actor, clip)) throw new AccessDenied(403);
        await queueCleanup(tx, actor, clip.blobPath);
        await tx.update(tutorSpoken).set({ blobPath: null, revision: clip.revision + 1, updatedAt: new Date() }).where(and(eq(tutorSpoken.tenantId, actor.tenantId), eq(tutorSpoken.id, clip.id)));
        return { ok: true as const };
      });
      if (result.ok) await clean(request, selection);
      return result;
    },
  });
}
