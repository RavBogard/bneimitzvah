import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import { studentReadingContext, readingAssignmentVersion, customs } from "../data/roster";
import { readingDate } from "../../lib/readings/reading-date";
import { expandReadingRanges, readingSegments } from "../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { proposeReading, ReadingUnavailable, type Calendar, type Snapshot } from "../../lib/readings/proposals";
import { planStudyPage } from "../study/sefaria";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "../study/types";
import { identifier } from "./validation";
import { createBindings, digest } from "./bindings";
import { actorBinding, calendarCustoms } from "./service";
import { validatedSnapshot } from "./preparation";

type Kind = "torah" | "haftarah";
type Mode = "admin" | "tutor";
type Request = CookieMutationRequest & { signal?: AbortSignal };
type Fallback = "unknown-slot" | "non-saturday" | "calendar-date-out-of-range" | "calendar-source-unavailable" | "holiday" | "multiple" | "nonregular" | "missing";
type Source = { mode: "calendar" | "manual"; fetchedAt: number | null; snapshot: Snapshot | null; manualFallback: Fallback | null; maftir: { ref: string; reason?: string } | null };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stale = () => ({ ok: false as const, code: "stale-revision" as const });
const counts = TANAKH_VERSE_COUNTS;

export function previewPages(ranges: readonly string[], kind: Kind) {
  const verses = expandReadingRanges(ranges, kind, counts), pages: { offset: number; first: string; last: string; chapters: string[] }[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const plan = planStudyPage({ kind, ranges, verses, translation: "jps2023", offset }, counts);
    pages.push({ offset, first: plan.refs[0], last: plan.refs.at(-1)!, chapters: plan.chapters.map(chapter => chapter.ref) });
    offset = plan.nextOffset;
  }
  return { verses, pages };
}

export function createReadingPreviewService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; signingSecret: string;
  loadReading(date: string, calendar: Calendar): Promise<{ snapshot: Snapshot; fetchedAt: number }>;
  loadText(request: StudyRequest): Promise<StudyPage>; now?: () => number;
}) {
  const now = input.now ?? Date.now, bindings = createBindings(input.signingSecret, now);
  const purpose = "reading-preview";
  const connected = (request: Request) => { if (request.signal?.aborted) throw new StudyUnavailable("upstream"); };
  const fixed = (request: Request): Request => ({ url: request.url, method: request.method, headers: new Headers(request.headers), signal: request.signal });
  function selection(mode: unknown, kind: unknown, id: string) {
    identifier(id);
    if ((mode !== "admin" && mode !== "tutor") || (kind !== "torah" && kind !== "haftarah")) throw new AccessDenied(403);
  }
  async function capture<T>(request: Request, mode: Mode, studentId: string, kind: Kind, action: (context: Awaited<ReturnType<typeof contextShape>>) => T | Promise<T>) {
    return input.access.withStudentCapability(request, { mode, studentId, capability: "set-reading" }, async (tx, actor, student) => {
      connected(request); requireCookieMutation(request, actor.origin);
      const row = await studentReadingContext(tx, actor.tenantId, student.id);
      if (!row) throw new AccessDenied(404);
      const calendar = calendarCustoms(await customs(tx, actor.tenantId)).calendar;
      const assignment = await readingAssignmentVersion(tx, actor.tenantId, student.id, kind);
      const context = contextShape(actorBinding(actor), actor.authSessionExpiresAt, student.id, student.revision,
        student.ceremonyDate, row.serviceSlot, calendar, assignment?.id ?? null, assignment?.revision ?? 0);
      connected(request);
      if (context.sessionExpiresAt <= now()) throw new AccessDenied(401);
      return action(context);
    });
  }
  function contextShape(actor: ReturnType<typeof actorBinding>, sessionExpiresAt: number, studentId: string, studentRevision: number,
    ceremonyDate: string, serviceSlot: "morning" | "havdalah" | "unknown", calendar: Calendar, assignmentId: string | null, assignmentRevision: number) {
    return { actor, sessionExpiresAt, studentId, studentRevision, ceremonyDate, serviceSlot, calendar, assignmentId, assignmentRevision, ...readingDate(ceremonyDate, serviceSlot) };
  }
  type Context = ReturnType<typeof contextShape>;
  const view = (context: Context, kind: Kind, source: Source) => ({ studentId: context.studentId, studentRevision: context.studentRevision,
    mode: context.actor.mode as Mode, kind, ceremonyDate: context.ceremonyDate, serviceSlot: context.serviceSlot, readingDate: context.readingDate,
    calendar: context.calendar, source: source.mode, sourceFetchedAt: source.fetchedAt, manualFallback: source.manualFallback,
    portion: source.snapshot?.reading?.parashah ?? null, calendarAliyot:source.mode==="calendar" && kind==="torah" ? source.snapshot?.reading?.aliyot.filter(row=>row.n!=="M").map(row=>({n:row.n as number,ref:row.ref}))??[] : [], maftir: source.maftir ? { ref: source.maftir.ref, ...(source.maftir.reason===undefined?{}:{reason:source.maftir.reason}) } : null });
  function freshSource(source:Source){
    if(source.fetchedAt!==null && (!Number.isSafeInteger(source.fetchedAt) || source.fetchedAt<0 || source.fetchedAt>now() || now()-source.fetchedAt>=86400000))throw new AccessDenied(403);
  }
  function verify(binding: string) {
    const claim = bindings.verify(binding, purpose);
    if (claim.version !== 1 || !object(claim.context) || !object(claim.context.actor) || !object(claim.source) || (claim.kind !== "torah" && claim.kind !== "haftarah") || !Array.isArray(claim.ranges)) throw new AccessDenied(403);
    if(claim.sourceHash!==digest({kind:claim.kind,ranges:claim.ranges,source:claim.source}))throw new AccessDenied(403);
    freshSource(claim.source as unknown as Source);
    const ranges = claim.ranges as string[];let planned:ReturnType<typeof previewPages>;
    try{planned=previewPages(ranges,claim.kind);}catch{throw new AccessDenied(403);}
    return { claim, kind: claim.kind as Kind, ranges, ...planned };
  }
  async function prepare(original: Request, supplied: { mode: Mode; studentId: string; kind: Kind; source: "calendar" | "manual"; ranges?: string[] }) {
    const request = fixed(original), args = { ...supplied, ...(supplied.ranges ? { ranges: [...supplied.ranges] } : {}) };
    selection(args.mode, args.kind, args.studentId);
    if ((args.source !== "calendar" && args.source !== "manual") || (args.source === "calendar" && args.ranges !== undefined) || (args.source === "manual" && args.ranges === undefined)) throw new AccessDenied(403);
    if(args.source==="manual"){
      try{
        if(!Array.isArray(args.ranges) || args.ranges.some(ref=>typeof ref!=="string" || ref.length>100))throw 0;
        args.ranges=args.ranges.map(ref=>ref.trim());
        expandReadingRanges(args.ranges,args.kind,counts);
      }catch{throw new AccessDenied(403);}
    }
    const before = await capture(request, args.mode, args.studentId, args.kind, context => context);
    let snapshot: Snapshot | null = null, fetchedAt: number | null = null, fallback: Fallback | null = before.manualFallback;
    if (before.readingDate !== null) {
      try {
        const loaded = await input.loadReading(before.readingDate, before.calendar);
        if (!Number.isSafeInteger(loaded.fetchedAt) || loaded.fetchedAt > now() || loaded.fetchedAt < 0 || now() - loaded.fetchedAt >= 86400000) throw new AccessDenied(403);
        snapshot = validatedSnapshot(loaded.snapshot, before.readingDate, before.calendar, counts); fetchedAt = loaded.fetchedAt;
        fallback = snapshot.classification === "regular" ? null : snapshot.classification ?? "nonregular";
      } catch (error) {
        if (error instanceof ReadingUnavailable) fallback = "calendar-source-unavailable";
        else if (error instanceof AccessDenied) throw error;
        else throw new AccessUnavailable();
      }
    }
    connected(request);
    let ranges: string[] = [], maftir: Source["maftir"] = null;
    if (args.source === "manual") ranges = args.ranges!;
    else if (fallback === null && snapshot) {
      if (args.kind === "haftarah") { if (snapshot.haftarah) ranges = readingSegments(snapshot.haftarah); else fallback = "missing"; }
      else try {
        const proposal = proposeReading(snapshot, counts, { pick: "full" });
        if (proposal.selection) { ranges = [proposal.selection.ref]; maftir = proposal.selection.maftir; }
        else fallback = "nonregular";
      } catch { fallback = "nonregular"; }
    }
    const source: Source = { mode: args.source, fetchedAt, snapshot, manualFallback: fallback, maftir };
    const planned = ranges.length ? previewPages(ranges, args.kind) : null;
    return capture(request, args.mode, args.studentId, args.kind, context => {
      if (digest(context) !== digest(before)) return stale();
      freshSource(source);
      if (!planned) return { ok: true as const, status: "manual-required" as const, ...view(context, args.kind, source) };
      const binding = bindings.sign({ purpose, version: 1, context, kind: args.kind, ranges, source, sourceHash:digest({kind:args.kind,ranges,source}) });
      const expiresAt = Number(bindings.verify(binding, purpose).expiresAt);
      return { ok: true as const, status: "prepared" as const, binding, expiresAt, ...view(context, args.kind, source), ranges,
        verseCount: planned.verses.length, pages: planned.pages };
    });
  }
  async function page(original: Request, supplied: { mode: Mode; studentId: string; binding: string; offset: number }) {
    const request = fixed(original), args = { ...supplied }, verified = verify(args.binding);
    selection(args.mode, verified.kind, args.studentId);
    if (!Number.isSafeInteger(args.offset) || !verified.pages.some(page => page.offset === args.offset)) throw new StudyUnavailable("invalid-request");
    const baseline = verified.claim.context as unknown as Context;
    if (baseline.studentId !== args.studentId || baseline.actor.mode !== args.mode) throw new AccessDenied(403);
    const before = await capture(request, args.mode, args.studentId, verified.kind, context => {
      verify(args.binding);
      return digest(context) === digest(baseline);
    });
    if (!before) return stale();
    const text = await input.loadText({ kind: verified.kind, ranges: verified.ranges, verses: verified.verses, offset: args.offset, translation: "jps2023", signal: request.signal });
    connected(request);
    return capture(request, args.mode, args.studentId, verified.kind, context => {
      const fresh = verify(args.binding);
      if (digest(fresh.claim) !== digest(verified.claim) || digest(context) !== digest(baseline)) return stale();
      return { ok: true as const, studentId: context.studentId, studentRevision: context.studentRevision, mode: args.mode, kind: verified.kind,
        expiresAt: Number(fresh.claim.expiresAt), page: text };
    });
  }
  return Object.freeze({ prepare, page });
}
