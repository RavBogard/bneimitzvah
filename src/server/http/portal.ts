import "server-only";
import { parseReferenceResolution, type ReferenceResolution } from "../../lib/reference-audio/source";
import type { StudyWordAids } from "../../lib/hebrew/word-aids";
import type { HttpRuntime } from "../runtime/composition";
import type { ActiveMode } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { StudentView } from "../data/students";
import type { PracticeContextView } from "../practice/types";
import type { Snapshot } from "../../lib/readings/proposals";
import type { Aliyah } from "../../lib/readings/leyning.mjs";
import { identifier } from "../students/validation";
import { StudyUnavailable, type StudyPage } from "../study/types";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { requireCookieMutation } from "./mutations";
import { errorResponse, HttpBoundaryError, privateJson, type JsonValue } from "./responses";

type Kind = "preview-prepare" | "preview-page" | "session" | "students" | "student" | "reading" | "study-text" | "study-word-aids" | "reference-audio" | "practice-read" | "practice-enter" | "practice-switch" | "practice-exit"
  | "admin-students" | "edit" | "disable" | "csv-preview" | "csv-confirm" | "prepare" | "confirm" | "invite-issue" | "invite-reissue" | "invite-revoke" | "pending" | "accept"
  | "eligible-tutors" | "relationships" | "tutor-assign" | "tutor-unassign" | "guardian-revoke" | "identity-revoke" | "guardian-practice" | "grant-revoke" | "cantor";
type Route = { kind: Kind; methods: readonly string[]; id?: string; linkId?: string };
const exact: Record<string, Route> = {
  "/api/session": { kind: "session", methods: ["GET"] }, "/api/students": { kind: "students", methods: ["GET"] },
  "/api/practice/read": { kind: "practice-read", methods: ["GET"] },
  "/api/practice/enter": { kind: "practice-enter", methods: ["POST"] }, "/api/practice/switch": { kind: "practice-switch", methods: ["POST"] },
  "/api/practice/exit": { kind: "practice-exit", methods: ["POST"] },
  "/api/admin/students": { kind: "admin-students", methods: ["GET", "POST"] },
  "/api/admin/tutors": { kind: "eligible-tutors", methods: ["GET"] },
  "/api/admin/students/import/preview": { kind: "csv-preview", methods: ["POST"] }, "/api/admin/students/import/confirm": { kind: "csv-confirm", methods: ["POST"] },
  "/api/admin/invitations": { kind: "invite-issue", methods: ["GET", "POST"] },
  "/api/invitations/pending": { kind: "pending", methods: ["GET"] }, "/api/invitations/accept": { kind: "accept", methods: ["POST"] },
};
function route(pathname: string): Route | null {
  if (Object.hasOwn(exact, pathname)) return exact[pathname];
  const preview = /^\/api\/students\/([^/]+)\/reading\/preview\/(prepare|page)$/.exec(pathname);
  if(preview)return {kind:preview[2]==="prepare"?"preview-prepare":"preview-page",methods:["POST"],id:preview[1]};
  const reference = /^\/api\/students\/([^/]+)\/reference-audio$/.exec(pathname);
  if (reference) return { kind: "reference-audio", methods: ["GET"], id: reference[1] };
  const wordAids = /^\/api\/students\/([^/]+)\/study-word-aids$/.exec(pathname);
  if (wordAids) return { kind: "study-word-aids", methods: ["GET"], id: wordAids[1] };
  const study = /^\/api\/students\/([^/]+)\/study-text$/.exec(pathname);
  if (study) return { kind: "study-text", methods: ["GET"], id: study[1] };
  const student = /^\/api\/students\/([^/]+)(?:\/(reading)(?:\/(prepare|confirm))?)?$/.exec(pathname);
  if (student) return { kind: student[3] === "prepare" ? "prepare" : student[3] === "confirm" ? "confirm" : student[2] ? "reading" : "student", methods: student[3] ? ["POST"] : ["GET"], id: student[1] };
  const relationships = /^\/api\/admin\/students\/([^/]+)\/relationships(?:\/(tutors|guardians|identities)(?:\/([^/]+)\/(revoke|practice))?)?$/.exec(pathname);
  if (relationships) {
    const [, id, group, linkId, operation] = relationships;
    if (!group) return { kind: "relationships", methods: ["GET"], id };
    if (!linkId && group === "tutors") return { kind: "tutor-assign", methods: ["POST"], id };
    if (linkId && operation === "revoke") return { kind: group === "tutors" ? "tutor-unassign" : group === "guardians" ? "guardian-revoke" : "identity-revoke", methods: ["POST"], id, linkId };
    if (linkId && group === "guardians" && operation === "practice") return { kind: "guardian-practice", methods: ["POST"], id, linkId };
    return null;
  }
  const grant = /^\/api\/admin\/(grants|tutors)\/([^/]+)\/(revoke|cantor)$/.exec(pathname);
  if (grant) return grant[1] === "grants" && grant[3] === "revoke" ? { kind: "grant-revoke", methods: ["POST"], id: grant[2] }
    : grant[1] === "tutors" && grant[3] === "cantor" ? { kind: "cantor", methods: ["POST"], id: grant[2] } : null;
  const admin = /^\/api\/admin\/students\/([^/]+)\/(edit|disable)$/.exec(pathname);
  if (admin) return { kind: admin[2] as "edit" | "disable", methods: ["POST"], id: admin[1] };
  const invite = /^\/api\/admin\/invitations\/([^/]+)\/(reissue|revoke)$/.exec(pathname);
  if (invite) return { kind: invite[2] === "reissue" ? "invite-reissue" : "invite-revoke", methods: ["POST"], id: invite[1] };
  return null;
}
export const portalRouteMethods = (pathname: string): readonly string[] | null => route(pathname)?.methods ?? null;
const owned = (pathname: string) => /^\/api\/(?:session|students|practice|admin|invitations)(?:\/|$)/.test(pathname);
function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max) throw new HttpBoundaryError();
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new HttpBoundaryError();
  return Number(value);
}
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new HttpBoundaryError(); return value; }
function mode(value: unknown, child = false): ActiveMode | "child-practice" {
  if (typeof value !== "string" || !["student", "parent", "tutor", "admin", ...(child ? ["child-practice"] : [])].includes(value)) throw new HttpBoundaryError();
  return value as ActiveMode | "child-practice";
}
function baseMode(value: unknown): ActiveMode { return mode(value) as ActiveMode; }
function staffMode(value: unknown): "admin" | "tutor" { const result = baseMode(value); if (result !== "admin" && result !== "tutor") throw new HttpBoundaryError(); return result; }
const objectBody = async (request: Request, required: string[], optional: string[] = [], profile: "ordinary" | "binding" | "csv" | "work" = "ordinary") =>
  closedObject(await readJsonBody(request, profile), required, optional);
function studentInput(value: unknown) {
  const row = closedObject(value, ["firstName", "lastName", "ceremonyDate"], ["studentKind", "serviceSlot", "parentEmail", "ownEmail", "hebrewName", "secondParentEmail"]);
  return { firstName: text(row.firstName, 100), lastName: text(row.lastName, 100), ceremonyDate: text(row.ceremonyDate, 10), studentKind: row.studentKind, serviceSlot: row.serviceSlot,
    parentEmail: row.parentEmail === undefined || row.parentEmail === null ? null : text(row.parentEmail, 254, 0),
    ownEmail: row.ownEmail === undefined || row.ownEmail === null ? null : text(row.ownEmail, 254, 0),
    ...(row.hebrewName === undefined ? {} : { hebrewName: row.hebrewName === null ? null : text(row.hebrewName, 400, 0) }),
    ...(row.secondParentEmail === undefined ? {} : { secondParentEmail: row.secondParentEmail === null ? null : text(row.secondParentEmail, 254, 0) }) };
}
const studentView = (s: StudentView) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, ceremonyDate: s.ceremonyDate, revision: s.revision });
const contextView = (c: PracticeContextView | null) => c ? { id: c.id, authorityRevision: c.authorityRevision, studentId: c.studentId, studentRevision: c.studentRevision, expiresAt: c.expiresAt } : null;
function wordAidsView(value: StudyWordAids): JsonValue {
  if (value.status === "unavailable") return { schema: value.schema, ref: value.ref, status: value.status, reason: value.reason };
  return { schema: value.schema, ref: value.ref, status: value.status, readingTextSha256: value.readingTextSha256, wordCount: value.wordCount,
    words: value.words.map((word): JsonValue => word.status === "unavailable" ? { index: word.index, status: word.status, reason: word.reason }
      : { index: word.index, status: word.status, syllables: word.syllables.map(part => ({ start: part.start, end: part.end, stress: part.stress })) }) };
}
function studyPageView(page: StudyPage): { [key: string]: JsonValue } {
  return { offset: page.offset, nextOffset: page.nextOffset, totalVerses: page.totalVerses,
    translation: { key: page.translation.key, status: page.translation.status },
    verses: page.verses.map(verse => ({ ref: verse.ref, english: verse.english, hebrew: { text: verse.hebrew.text, readingText: verse.hebrew.readingText,
      paragraphAfter: verse.hebrew.paragraphAfter, segments: verse.hebrew.segments.map((segment): JsonValue => segment.kind === "text" ? { kind: segment.kind, text: segment.text }
        : segment.kind === "alternative" ? { kind: segment.kind, written: segment.written, read: segment.read }
          : segment.kind === "gap" ? { kind: segment.kind, break: segment.break } : { kind: segment.kind }) } })),
    chapters: page.chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.sefariaUrl, fetchedAt: chapter.fetchedAt, hash: chapter.hash,
      editions: chapter.editions.map(edition => ({ key: edition.key, versionTitle: edition.versionTitle, language: edition.language, creator: edition.creator,
        sourceUrl: edition.sourceUrl, license: edition.license, licenseUrl: edition.licenseUrl, changes: edition.changes })) })) };
}
function referenceView(value: ReferenceResolution): JsonValue {
  const parsed = parseReferenceResolution(value); if (!parsed) throw new Error("Reference projection unavailable");
  const v = parsed.verse, source = parsed.source;
  if (v.playback.status !== "unavailable" && (!("table" in v) || !("attribution" in v))) throw new Error("Reference projection unavailable");
  const verse: JsonValue = v.playback.status === "unavailable" ? { schema: v.schema, ref: v.ref, playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } }
    : { schema: v.schema, ref: v.ref, table: "table" in v ? v.table : null,
      playback: { status: v.playback.status, asset: v.playback.asset, clip: { start: v.playback.clip.start, end: v.playback.clip.end }, ...(v.playback.status === "needs-review" ? { review: v.playback.review } : {}) },
      words: v.words.status === "ready" ? { status: "ready", readingTextSha256: v.words.readingTextSha256, starts: [...v.words.starts] } : { status: "unavailable", reason: v.words.reason },
      attribution: { ...("attribution" in v ? v.attribution : {}) } };
  return { verse, source: source ? { schema: source.schema, asset: source.asset, url: source.url, sha256: source.sha256, bytes: source.bytes } : null };
}
const aliyot = (rows: Aliyah[]) => rows.map(row => ({ n: row.n, ref: row.ref, verses: row.verses ?? null, reason: row.reason ?? null }));
function snapshotView(snapshot: Snapshot) {
  const r = snapshot.reading;
  return { date: snapshot.date, calendar: snapshot.calendar, haftarah: snapshot.haftarah, reading: r ? { parashah: r.parashah, type: r.type, source: r.source,
    aliyot: aliyot(r.aliyot), triennial: r.triennial ? { year: r.triennial.year, aliyot: aliyot(r.triennial.aliyot) } : null } : null };
}
function maftirView(value: unknown): JsonValue {
  if (value === null) return null;
  if (!value || typeof value !== "object" || typeof (value as { ref?: unknown }).ref !== "string") throw new Error("Reading projection unavailable");
  const row = value as { ref: string; reason?: unknown };
  if (row.reason !== undefined && typeof row.reason !== "string") throw new Error("Reading projection unavailable");
  return { ref: row.ref, reason: row.reason ?? null };
}
const stale = () => privateJson({ ok: false, code: "stale-revision" }, 409);
const staleRelationship = () => privateJson({ ok: false, code: "stale-state" }, 409);
function expectedActive(value: unknown): "active" { if (value !== "active") throw new HttpBoundaryError(); return value; }

export async function handlePortalRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  let clearPreviewInvalid = false;
  try {
    const pathname = new URL(request.url).pathname;
    if (!owned(pathname)) return null;
    const selected = route(pathname);
    if (!selected) throw new HttpBoundaryError(404);
    if (!selected.methods.includes(request.method)) {
      const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", selected.methods.join(", ")); return response;
    }
    const practiceRoute = selected.kind.startsWith("practice-");
    if (!practiceRoute && selected.kind !== "reading" && selected.kind !== "study-text" && selected.kind !== "study-word-aids" && selected.kind !== "reference-audio" && request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    // Dispatcher resolves the actual host before this adapter. Services still
    // independently reauthorize; no body/Origin/forwarded claim chooses tenant.
    if (request.method === "POST") requireCookieMutation(request, runtime.origin);
    const id = selected.id === undefined ? undefined : identifier(selected.id);
    const linkId = selected.linkId === undefined ? undefined : identifier(selected.linkId);
    switch (selected.kind) {
      case "preview-prepare": {
        uniqueQuery(request.url,[]);
        const body=await objectBody(request,["mode","kind","source"],["ranges"]);
        if((body.kind!=="torah" && body.kind!=="haftarah") || (body.source!=="calendar" && body.source!=="manual")
          || body.ranges!==undefined && (!Array.isArray(body.ranges) || body.ranges.length<1 || body.ranges.length>32))throw new HttpBoundaryError();
        const value=await runtime.readingPreview.prepare(request,{mode:staffMode(body.mode),studentId:id!,kind:body.kind,source:body.source,
          ...(body.ranges===undefined?{}:{ranges:(body.ranges as unknown[]).map(ref=>text(ref,100))})});
        if(!value.ok)return stale();
        const context={status:value.status,studentId:value.studentId,studentRevision:value.studentRevision,mode:value.mode,kind:value.kind,
          ceremonyDate:value.ceremonyDate,serviceSlot:value.serviceSlot,readingDate:value.readingDate,calendar:value.calendar,source:value.source,
          sourceFetchedAt:value.sourceFetchedAt,manualFallback:value.manualFallback,portion:value.portion,calendarAliyot:value.calendarAliyot.map(row=>({n:row.n,ref:row.ref})),maftir:maftirView(value.maftir)};
        return privateJson(value.status==="manual-required"?context:{...context,binding:value.binding,expiresAt:value.expiresAt,ranges:[...value.ranges],verseCount:value.verseCount,
          pages:value.pages.map(page=>({offset:page.offset,first:page.first,last:page.last,chapters:[...page.chapters]}))});
      }
      case "preview-page": {
        uniqueQuery(request.url,[]);const body=await objectBody(request,["mode","binding","offset"],[],"binding");
        if(!Number.isSafeInteger(body.offset) || Number(body.offset)<0 || Number(body.offset)>999)throw new HttpBoundaryError();
        let value;try{value=await runtime.readingPreview.page(request,{mode:staffMode(body.mode),studentId:id!,binding:text(body.binding,48000),offset:Number(body.offset)});}
        catch(error){if(error instanceof StudyUnavailable && error.code==="invalid-request")throw new HttpBoundaryError();throw error;}
        if(!value.ok)return stale();
        return privateJson({studentId:value.studentId,studentRevision:value.studentRevision,mode:value.mode,kind:value.kind,expiresAt:value.expiresAt,...studyPageView(value.page)});
      }
      case "eligible-tutors": {
        const query = uniqueQuery(request.url, ["afterId", "limit"]), limit = query.get("limit");
        if (limit !== null && (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100)) throw new HttpBoundaryError();
        const rows = await runtime.relationships.listEligibleTutors(request, { mode: "admin", afterId: query.has("afterId") ? identifier(query.get("afterId")) : undefined, limit: limit === null ? undefined : Number(limit) });
        return privateJson({ tutors: rows.map(row => ({ id: row.id, displayName: row.displayName, revision: row.revision, isCantor: row.isCantor })) });
      }
      case "relationships": {
        uniqueQuery(request.url, []);
        const value = await runtime.relationships.inspectStudent(request, { mode: "admin", studentId: id! });
        return privateJson({ student: { ...studentView(value.student), disabled: value.student.disabled },
          guardians: value.guardians.map(row => ({ id: row.id, revision: row.revision, parentGrantId: row.parentGrantId, parentGrantRevision: row.parentGrantRevision,
            displayName: row.displayName, practiceEnabled: row.practiceEnabled, effectiveRead: row.effectiveRead, effectivePractice: row.effectivePractice })),
          identities: value.identities.map(row => ({ id: row.id, studentGrantId: row.studentGrantId, studentGrantRevision: row.studentGrantRevision, displayName: row.displayName, effectivePractice: row.effectivePractice })),
          tutors: value.tutors.map(row => ({ id: row.id, tutorGrantId: row.tutorGrantId, tutorGrantRevision: row.tutorGrantRevision, displayName: row.displayName, isCantor: row.isCantor, effectiveRead: row.effectiveRead })) });
      }
      case "tutor-assign": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["tutorGrantId", "expectedState"]);
        if (body.expectedState !== "unassigned") throw new HttpBoundaryError();
        const value = await runtime.relationships.assignTutor(request, { mode: "admin", studentId: id!, tutorGrantId: identifier(body.tutorGrantId), expectedState: "unassigned" });
        return value.ok ? privateJson({ ok: true, id: value.id, studentId: value.studentId, tutorGrantId: value.tutorGrantId }, 201) : staleRelationship();
      }
      case "tutor-unassign": case "guardian-revoke": case "identity-revoke": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["expectedState"]);
        const selection = { mode: "admin" as const, studentId: id!, linkId: linkId!, expectedState: expectedActive(body.expectedState) };
        const value = selected.kind === "tutor-unassign" ? await runtime.relationships.revokeTutor(request, selection)
          : selected.kind === "guardian-revoke" ? await runtime.relationships.revokeGuardian(request, selection) : await runtime.relationships.revokeStudentIdentity(request, selection);
        return value.ok ? privateJson({ ok: true, id: value.id }) : staleRelationship();
      }
      case "guardian-practice": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["expectedRevision", "practiceEnabled"]);
        const value = await runtime.relationships.setGuardianPractice(request, { mode: "admin", studentId: id!, guardianId: linkId!, expectedRevision: integer(body.expectedRevision), practiceEnabled: boolean(body.practiceEnabled) });
        return value.ok ? privateJson({ ok: true, id: value.id, revision: value.revision, practiceEnabled: value.practiceEnabled }) : staleRelationship();
      }
      case "grant-revoke": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["expectedRevision", "expectedState"]);
        const value = await runtime.relationships.revokeRoleGrant(request, { mode: "admin", roleGrantId: id!, expectedRevision: integer(body.expectedRevision), expectedState: expectedActive(body.expectedState) });
        return value.ok ? privateJson({ ok: true, id: value.id, revision: value.revision }) : staleRelationship();
      }
      case "cantor": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["expectedRevision", "isCantor"]);
        const value = await runtime.relationships.setCantor(request, { mode: "admin", roleGrantId: id!, expectedRevision: integer(body.expectedRevision), isCantor: boolean(body.isCantor) });
        return value.ok ? privateJson({ ok: true, id: value.id, revision: value.revision, isCantor: value.isCantor }) : staleRelationship();
      }
      case "session": {
        uniqueQuery(request.url, []); const value = await runtime.portal.sessionSummary(request);
        return privateJson({ membershipAvailable: value.membershipAvailable, roles: value.roles.map(role => role), sessionBinding: value.sessionBinding });
      }
      case "students": {
        const query = uniqueQuery(request.url, ["mode", "afterId", "limit"]), limit = query.get("limit");
        if (limit !== null && (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100)) throw new HttpBoundaryError();
        const rows = await runtime.access.listStudents(request, { mode: baseMode(query.get("mode")), afterId: query.has("afterId") ? identifier(query.get("afterId")) : undefined, limit: limit === null ? undefined : Number(limit) });
        return privateJson({ students: rows.map(studentView) });
      }
      case "student": {
        const query = uniqueQuery(request.url, ["mode"]);
        return privateJson({ student: studentView(await runtime.access.readStudent(request, { mode: baseMode(query.get("mode")), studentId: id! })) });
      }
      case "reference-audio": {
        const query = uniqueQuery(request.url, ["mode", "kind", "assignmentId", "assignmentRevision", "translation", "offset", "asset"]);
        const kind = query.get("kind"), translation = query.get("translation"), revisionValue = query.get("assignmentRevision"), offset = query.get("offset"), asset = query.get("asset");
        if ((kind !== "torah" && kind !== "haftarah") || translation !== "jps2023" || !revisionValue || !/^[1-9][0-9]{0,9}$/.test(revisionValue)
          || offset === null || !/^(?:0|[1-9][0-9]{0,2})$/.test(offset) || asset !== null && !/^ra_[a-f0-9]{32}$/.test(asset)) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.referenceAudio.read(request, { mode: mode(query.get("mode"), true), studentId: id!, kind,
          assignmentId: identifier(query.get("assignmentId")), assignmentRevision: integer(Number(revisionValue)), translation, offset: Number(offset), ...(asset === null ? {} : { asset }) }); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return stale();
        return privateJson({ studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, context: contextView(value.context),
          assignment: { id: value.assignment.id, revision: value.assignment.revision, kind: value.assignment.kind, needsReview: value.assignment.needsReview }, reference: referenceView(value.reference) });
      }
      case "study-word-aids": {
        const query = uniqueQuery(request.url, ["mode", "kind", "assignmentId", "assignmentRevision", "translation", "offset"]);
        const kind = query.get("kind"), translation = query.get("translation"), revisionValue = query.get("assignmentRevision"), offset = query.get("offset");
        if ((kind !== "torah" && kind !== "haftarah") || translation !== "jps2023" || !revisionValue || !/^[1-9][0-9]{0,9}$/.test(revisionValue)
          || offset === null || !/^(?:0|[1-9][0-9]{0,2})$/.test(offset)) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.studyWordAids.read(request, { mode: mode(query.get("mode"), true), studentId: id!, kind,
          assignmentId: identifier(query.get("assignmentId")), assignmentRevision: integer(Number(revisionValue)), translation, offset: Number(offset) }); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return stale();
        return privateJson({ studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, context: contextView(value.context),
          assignment: { id: value.assignment.id, revision: value.assignment.revision, kind: value.assignment.kind, needsReview: value.assignment.needsReview }, wordAids: wordAidsView(value.wordAids) });
      }
      case "study-text": {
        const query = uniqueQuery(request.url, ["mode", "kind", "assignmentId", "assignmentRevision", "translation", "offset"]);
        const kind = query.get("kind"), translation = query.get("translation"), revisionValue = query.get("assignmentRevision"), offset = query.get("offset");
        if ((kind !== "torah" && kind !== "haftarah") || translation !== "jps2023" || !revisionValue || !/^[1-9][0-9]{0,9}$/.test(revisionValue)
          || offset === null || !/^(?:0|[1-9][0-9]{0,2})$/.test(offset)) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.study.read(request, { mode: mode(query.get("mode"), true), studentId: id!, kind,
          assignmentId: identifier(query.get("assignmentId")), assignmentRevision: integer(Number(revisionValue)), translation, offset: Number(offset) }); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return stale();
        return privateJson({ studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, context: contextView(value.context),
          assignment: { id: value.assignment.id, revision: value.assignment.revision, kind: value.assignment.kind, needsReview: value.assignment.needsReview },
          ...studyPageView(value.page) });
      }
      case "reading": {
        const query = uniqueQuery(request.url, ["mode"]), value = await runtime.portal.assignedReading(request, { mode: mode(query.get("mode"), true), studentId: id! });
        return privateJson({ student: studentView(value.student), mode: value.mode, context: contextView(value.context), readings: value.readings.map(row => ({ id: row.id, status: row.status,
          kind: row.kind, basis: row.basis, revision: row.revision, ranges: [...row.ranges], verses: [...row.verses], confirmationDate: row.confirmationDate, needsReview: row.needsReview, aliyahStarts:row.aliyahStarts,
          source: { status: row.source.status, fetchedAt: row.source.fetchedAt, date: row.source.date, calendar: row.source.calendar,
            attribution: row.source.attribution ? { name: row.source.attribution.name, url: row.source.attribution.url } : null } })) });
      }
      case "practice-read": {
        const query = uniqueQuery(request.url, ["mode", "studentId"]), selectedMode = mode(query.get("mode"), true);
        if (selectedMode !== "student" && selectedMode !== "child-practice") throw new HttpBoundaryError();
        const value = await runtime.practice.read(request, { mode: selectedMode, studentId: identifier(query.get("studentId")) });
        return privateJson({ student: studentView(value.student), mode: value.mode, context: contextView(value.context) });
      }
      case "practice-enter": case "practice-switch": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["studentId"]), studentId = identifier(body.studentId);
        const value = selected.kind === "practice-enter" ? await runtime.practice.enter(request, { studentId }) : await runtime.practice.switch(request, { studentId });
        return privateJson({ handle: value.handle, context: contextView(value.context) }, 201);
      }
      case "practice-exit": {
        uniqueQuery(request.url, []); await objectBody(request, []); const value = await runtime.practice.exit(request);
        return privateJson({ status: value.status, contextId: value.contextId });
      }
      case "admin-students": {
        uniqueQuery(request.url, []);
        if (request.method === "GET") {
          const rows = await runtime.students.listRoster(request, { mode: "admin" });
          return privateJson({ students: rows.map(row => ({ id: row.id, firstName: row.firstName, lastName: row.lastName, ceremonyDate: row.ceremonyDate,
            studentKind: row.studentKind, serviceSlot: row.serviceSlot, parentEmail: row.parentEmail, ownEmail: row.ownEmail,
            hebrewName: row.hebrewName, secondParentEmail: row.secondParentEmail, importMetadata: row.importMetadata,
            disabledAt: row.disabledAt?.toISOString() ?? null, revision: row.revision })) });
        }
        const body = await objectBody(request, ["student"]), value = await runtime.students.create(request, { mode: "admin", student: studentInput(body.student) });
        return privateJson({ id: value.id, revision: value.revision }, 201);
      }
      case "edit": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["expectedRevision", "student"]);
        const value = await runtime.students.edit(request, { mode: "admin", studentId: id!, expectedRevision: integer(body.expectedRevision), student: studentInput(body.student) });
        return value.ok ? privateJson({ ok: true, id: value.id, revision: value.revision, readingNeedsReview: value.readingNeedsReview }) : stale();
      }
      case "disable": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["expectedRevision"]);
        const value = await runtime.students.disable(request, { mode: "admin", studentId: id!, expectedRevision: integer(body.expectedRevision) });
        return value.ok ? privateJson({ ok: true, id: value.id, revision: value.revision }) : stale();
      }
      case "csv-preview": case "csv-confirm": {
        uniqueQuery(request.url, []); const body = await objectBody(request, selected.kind === "csv-preview" ? ["csv", "allowDuplicates"] : ["csv", "allowDuplicates", "binding"], [], "csv");
        const csv = text(body.csv, 1024 * 1024), allowDuplicates = boolean(body.allowDuplicates);
        if (Buffer.byteLength(csv) > 1024 * 1024) throw new HttpBoundaryError(413);
        if (selected.kind === "csv-preview") {
          const value = await runtime.students.previewImport(request, { mode: "admin", csv, allowDuplicates });
          return privateJson({ validRows: value.validRows, issues: value.issues.map(issue => ({ row: issue.row, code: issue.code })), duplicateRows: value.duplicateRows,
            requiresDuplicateConfirmation: value.requiresDuplicateConfirmation, canConfirm: value.canConfirm, binding: value.binding,
            tutorMatches: value.tutorMatches, missingSecondParentRows: value.missingSecondParentRows, tutorAssignmentsPending: value.tutorAssignmentsPending });
        }
        const value = await runtime.students.confirmImport(request, { mode: "admin", csv, allowDuplicates, binding: text(body.binding, 48000) });
        return value.ok ? privateJson({ ok: true, ids: value.ids }, 201) : stale();
      }
      case "prepare": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["mode"], ["kind", "pick", "ranges", "aliyahStarts", "preparationMode", "expectedAssignmentRevision"], "work");
        if (body.kind !== undefined && body.kind !== "torah" && body.kind !== "haftarah") throw new HttpBoundaryError();
        if (body.ranges !== undefined && (!Array.isArray(body.ranges) || body.ranges.length < 1 || body.ranges.length > 32)) throw new HttpBoundaryError();
        if (body.aliyahStarts !== undefined && (body.kind === "haftarah" || !Array.isArray(body.aliyahStarts) || body.aliyahStarts.length > 999)) throw new HttpBoundaryError();
        if (body.preparationMode !== undefined && body.preparationMode !== "current-assignment" || body.preparationMode === "current-assignment" && (body.kind === "haftarah" || body.ranges !== undefined || body.pick !== undefined || body.expectedAssignmentRevision === undefined)
          || body.preparationMode === undefined && body.expectedAssignmentRevision !== undefined) throw new HttpBoundaryError();
        const value = await runtime.students.prepareReading(request, { mode: staffMode(body.mode), studentId: id!, kind: body.kind as "torah" | "haftarah" | undefined,
          pick: body.pick === undefined ? undefined : text(body.pick, 100), ranges: body.ranges === undefined ? undefined : (body.ranges as unknown[]).map(ref => text(ref, 100)),
          ...(body.aliyahStarts===undefined?{}:{aliyahStarts:(body.aliyahStarts as unknown[]).map(ref=>text(ref,100))}),
          ...(body.preparationMode===undefined?{}:{preparationMode:"current-assignment" as const,expectedAssignmentRevision:integer(body.expectedAssignmentRevision)}) });
        if(value.status==="stale")return stale();
        if (value.status === "needs-selection") return privateJson({ status: value.status, requiresConfirmation: value.requiresConfirmation, snapshot: snapshotView(value.snapshot),
          ceremonyDate: value.ceremonyDate, serviceSlot: value.serviceSlot, readingDate: value.readingDate, manualFallback: value.manualFallback, sourceFetchedAt: value.sourceFetchedAt, sourceStatus: value.sourceStatus, warning: value.warning, toConfirm: value.toConfirm });
        return privateJson({ status: value.status, requiresConfirmation: value.requiresConfirmation, binding: value.binding, kind: value.kind, basis: value.basis, ranges: value.ranges,
          verseCount: value.verseCount, ceremonyDate: value.ceremonyDate, serviceSlot: value.serviceSlot, readingDate: value.readingDate, manualFallback: value.manualFallback, sourceFetchedAt: value.sourceFetchedAt, sourceStatus: value.sourceStatus, warning: value.warning, maftir: maftirView(value.maftir), toConfirm: value.toConfirm,
          aliyahStarts:value.aliyahStarts,preparationMode:value.preparationMode,preserved:value.preserved });
      }
      case "confirm": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["mode", "binding"], [], "binding");
        const value = await runtime.students.confirmReading(request, { mode: staffMode(body.mode), studentId: id!, binding: text(body.binding, 48000) });
        return value.ok ? privateJson({ ok: true, assignmentId: value.assignmentId, revision: value.revision }) : stale();
      }
      case "invite-issue": {
        if (request.method === "GET") {
          const query = uniqueQuery(request.url, ["afterId", "limit"]), limit = query.get("limit");
          if (limit !== null && (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100)) throw new HttpBoundaryError();
          const rows = await runtime.invitations.list(request, { mode: "admin", afterId: query.has("afterId") ? identifier(query.get("afterId")) : undefined, limit: limit === null ? undefined : Number(limit) });
          return privateJson({ invitations: rows.map(row => ({ id: row.id, role: row.role, recipientEmail: row.recipientEmail,
            student: row.student ? { id: row.student.id, firstName: row.student.firstName, lastName: row.student.lastName } : null, status: row.status,
            createdAt: row.createdAt, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt,
            delivery: { status: row.delivery.status, attemptedAt: row.delivery.attemptedAt } })) });
        }
        uniqueQuery(request.url, []); const body = await objectBody(request, ["role", "email"], ["studentId"]);
        if (body.role !== "parent" && body.role !== "student" && body.role !== "tutor") throw new HttpBoundaryError();
        const value = await runtime.invitations.issue(request, { mode: "admin", role: body.role, email: text(body.email, 254), studentId: body.studentId === undefined ? undefined : identifier(body.studentId) });
        return privateJson({ inviteId: value.inviteId, delivery: value.delivery }, 201);
      }
      case "invite-reissue": case "invite-revoke": {
        uniqueQuery(request.url, []); await objectBody(request, []);
        if (selected.kind === "invite-revoke") { const value = await runtime.invitations.revoke(request, { mode: "admin", inviteId: id! }); return privateJson({ inviteId: value.inviteId }); }
        const value = await runtime.invitations.reissue(request, { mode: "admin", inviteId: id! }); return privateJson({ inviteId: value.inviteId, delivery: value.delivery });
      }
      case "pending": {
        clearPreviewInvalid = true; uniqueQuery(request.url, []);
        const token = runtime.pendingInvitations.read(request), value = await runtime.invitations.preview(request, { token });
        return privateJson({ role: value.role, student: value.student ? { firstName: value.student.firstName, lastName: value.student.lastName } : null,
          expiresAt: value.expiresAt, requiresConfirmation: value.requiresConfirmation, reviewBinding: value.reviewBinding });
      }
      case "accept": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["reviewBinding"]);
        let token: string;
        try { token = runtime.pendingInvitations.read(request); }
        catch (error) { const response = errorResponse(error); if (response.status === 404) response.headers.append("set-cookie", runtime.pendingInvitations.clear()); return response; }
        const value = await runtime.invitations.acceptReviewed(request, { token, reviewBinding: text(body.reviewBinding, 80) });
        const response = privateJson({ inviteId: value.inviteId, role: value.role, studentId: value.studentId }); response.headers.append("set-cookie", runtime.pendingInvitations.clear()); return response;
      }
    }
  } catch (error) {
    const response = errorResponse(error);
    if (clearPreviewInvalid && response.status === 404) response.headers.append("set-cookie", runtime.pendingInvitations.clear());
    return response;
  }
}
