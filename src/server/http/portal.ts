import "server-only";
import type { RelatedSourcePage } from "../study/sources/discovery";
import { parseReferenceResolution, type ReferenceResolution } from "../../lib/reference-audio/source";
import { parseReferenceShortResolution } from "../../lib/reference-audio/short-resolution";
import type { StudyWordAids } from "../../lib/hebrew/word-aids";
import { WORD_DETAILS_LIMITS, type StudyWordDetails } from "../../lib/hebrew/word-details";
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

type Kind = "short-explore-page" | "short-reference-page" | "explore-prepare" | "explore-page" | "preview-prepare" | "preview-page" | "session" | "session-begin" | "session-door" | "students" | "student" | "reading" | "study-text" | "study-word-aids" | "study-word-details" | "study-sources" | "reference-audio" | "practice-read" | "practice-enter" | "practice-switch" | "practice-exit"
  | "admin-students" | "edit" | "disable" | "ceremony-done" | "ceremony-reverse" | "csv-preview" | "csv-confirm" | "prepare" | "confirm" | "invite-issue" | "invite-reissue" | "invite-revoke" | "invite-copy" | "invite-needed" | "pending" | "accept"
  | "eligible-tutors" | "relationships" | "tutor-assign" | "tutor-unassign" | "guardian-revoke" | "identity-revoke" | "guardian-practice" | "grant-revoke" | "cantor";
type Route = { kind: Kind; methods: readonly string[]; id?: string; linkId?: string };
const exact: Record<string, Route> = {
  "/api/session": { kind: "session", methods: ["GET"] }, "/api/session/begin": { kind: "session-begin", methods: ["POST"] }, "/api/session/door": { kind: "session-door", methods: ["GET"] }, "/api/students": { kind: "students", methods: ["GET"] },
  "/api/practice/read": { kind: "practice-read", methods: ["GET"] },
  "/api/practice/enter": { kind: "practice-enter", methods: ["POST"] }, "/api/practice/switch": { kind: "practice-switch", methods: ["POST"] },
  "/api/practice/exit": { kind: "practice-exit", methods: ["POST"] },
  "/api/admin/students": { kind: "admin-students", methods: ["GET", "POST"] },
  "/api/admin/tutors": { kind: "eligible-tutors", methods: ["GET"] },
  "/api/admin/students/import/preview": { kind: "csv-preview", methods: ["POST"] }, "/api/admin/students/import/confirm": { kind: "csv-confirm", methods: ["POST"] },
  "/api/admin/invitations": { kind: "invite-issue", methods: ["GET", "POST"] },
  "/api/admin/invitations/needed": { kind: "invite-needed", methods: ["GET"] },
  "/api/invitations/pending": { kind: "pending", methods: ["GET"] }, "/api/invitations/accept": { kind: "accept", methods: ["POST"] },
};
function route(pathname: string): Route | null {
  if (Object.hasOwn(exact, pathname)) return exact[pathname];
  const shortExploration = /^\/api\/students\/([^/]+)\/reading\/explore\/reference\/short\/page$/.exec(pathname);
  if (shortExploration) return { kind: "short-explore-page", methods: ["POST"], id: shortExploration[1] };
  const exploration = /^\/api\/students\/([^/]+)\/reading\/explore\/(prepare|page)$/.exec(pathname);
  if (exploration) return { kind: exploration[2] === "prepare" ? "explore-prepare" : "explore-page", methods: ["POST"], id: exploration[1] };
  const preview = /^\/api\/students\/([^/]+)\/reading\/preview\/(prepare|page)$/.exec(pathname);
  if(preview)return {kind:preview[2]==="prepare"?"preview-prepare":"preview-page",methods:["POST"],id:preview[1]};
  const reference = /^\/api\/students\/([^/]+)\/reference-audio$/.exec(pathname);
  const shortReference = /^\/api\/students\/([^/]+)\/reference-audio\/short\/page$/.exec(pathname);
  if (shortReference) return { kind: "short-reference-page", methods: ["GET"], id: shortReference[1] };
  if (reference) return { kind: "reference-audio", methods: ["GET"], id: reference[1] };
  const wordAids = /^\/api\/students\/([^/]+)\/study-word-aids$/.exec(pathname);
  if (wordAids) return { kind: "study-word-aids", methods: ["GET"], id: wordAids[1] };
  const sources = /^\/api\/students\/([^/]+)\/study-sources$/.exec(pathname);
  if (sources) return { kind: "study-sources", methods: ["GET"], id: sources[1] };
  const wordDetails = /^\/api\/students\/([^/]+)\/study-word-details$/.exec(pathname);
  if (wordDetails) return { kind: "study-word-details", methods: ["GET"], id: wordDetails[1] };
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
  const admin = /^\/api\/admin\/students\/([^/]+)\/(edit|disable|ceremony-done|ceremony-reverse)$/.exec(pathname);
  if (admin) return { kind: admin[2] as "edit" | "disable" | "ceremony-done" | "ceremony-reverse", methods: ["POST"], id: admin[1] };
  const invite = /^\/api\/admin\/invitations\/([^/]+)\/(reissue|revoke|copy)$/.exec(pathname);
  if (invite) return { kind: invite[2] === "reissue" ? "invite-reissue" : invite[2] === "copy" ? "invite-copy" : "invite-revoke", methods: ["POST"], id: invite[1] };
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
  const row = closedObject(value, ["firstName", "lastName", "ceremonyDate"], ["studentKind", "serviceSlot", "parentEmail", "ownEmail", "hebrewName", "secondParentEmail", "rehearsal1", "rehearsal2"]);
  return { firstName: text(row.firstName, 100), lastName: text(row.lastName, 100), ceremonyDate: text(row.ceremonyDate, 10), studentKind: row.studentKind, serviceSlot: row.serviceSlot,
    parentEmail: row.parentEmail === undefined || row.parentEmail === null ? null : text(row.parentEmail, 254, 0),
    ownEmail: row.ownEmail === undefined || row.ownEmail === null ? null : text(row.ownEmail, 254, 0),
    ...(row.hebrewName === undefined ? {} : { hebrewName: row.hebrewName === null ? null : text(row.hebrewName, 400, 0) }),
    ...(row.secondParentEmail === undefined ? {} : { secondParentEmail: row.secondParentEmail === null ? null : text(row.secondParentEmail, 254, 0) }),
    ...(row.rehearsal1 === undefined ? {} : { rehearsal1: row.rehearsal1 === null ? null : text(row.rehearsal1, 10) }),
    ...(row.rehearsal2 === undefined ? {} : { rehearsal2: row.rehearsal2 === null ? null : text(row.rehearsal2, 10) }) };
}
const studentCore = (s: Omit<StudentView, "rehearsal1" | "rehearsal2" | "serviceSlot">) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, ceremonyDate: s.ceremonyDate, revision: s.revision });
// Rehearsal dates and the service slot travel with the ceremony date to every role that already sees it.
const studentView = (s: StudentView) => ({ ...studentCore(s), rehearsal1: s.rehearsal1, rehearsal2: s.rehearsal2, serviceSlot: s.serviceSlot });
const contextView = (c: PracticeContextView | null) => c ? { id: c.id, authorityRevision: c.authorityRevision, studentId: c.studentId, studentRevision: c.studentRevision, expiresAt: c.expiresAt } : null;
export function wordAidsView(value: StudyWordAids): JsonValue {
  if (value.status === "unavailable") return { schema: value.schema, ref: value.ref, status: value.status, reason: value.reason };
  return { schema: value.schema, ref: value.ref, status: value.status, readingTextSha256: value.readingTextSha256, wordCount: value.wordCount,
    words: value.words.map((word): JsonValue => word.status === "unavailable" ? { index: word.index, status: word.status, reason: word.reason }
      : { index: word.index, status: word.status, syllables: word.syllables.map(part => ({ start: part.start, end: part.end, stress: part.stress })) }) };
}
export function wordDetailsView(value: StudyWordDetails): JsonValue {
  if (value.status === "unavailable" && value.reason === "reconstruction") return { schema: value.schema, ref: value.ref, wordIndex: value.wordIndex, status: value.status, reason: value.reason };
  const identity = { schema: value.schema, ref: value.ref, wordIndex: value.wordIndex, readingTextSha256: value.readingTextSha256, wordCount: value.wordCount,
    attribution: { name: value.attribution.name, source: value.attribution.source, commit: value.attribution.commit, license: value.attribution.license, licenseUrl: value.attribution.licenseUrl, changes: value.attribution.changes } };
  if (value.status === "unavailable") return { ...identity, status: value.status, reason: value.reason };
  const grammar = value.occurrence.grammar;
  return { ...identity, status: value.status, occurrence: { gloss: value.occurrence.gloss,
    grammar: grammar.status === "unavailable" ? { status: grammar.status, reason: grammar.reason } : { status: grammar.status, language: grammar.language, morphemes: grammar.morphemes.map(part => ({ partOfSpeech: part.partOfSpeech,
      ...(part.stem === undefined ? {} : { stem: part.stem }), ...(part.form === undefined ? {} : { form: part.form }), ...(part.person === undefined ? {} : { person: part.person }),
      ...(part.gender === undefined ? {} : { gender: part.gender }), ...(part.number === undefined ? {} : { number: part.number }), ...(part.state === undefined ? {} : { state: part.state }), ...(part.definite === undefined ? {} : { definite: part.definite }) })) } },
    dictionary: value.dictionary.map((entry): JsonValue => entry.status === "unavailable" ? { lemma: entry.lemma, status: entry.status, reason: entry.reason }
      : { lemma: entry.lemma, status: entry.status, headword: entry.headword, dictionaryGloss: entry.dictionaryGloss }),
    ...(value.elsewhere === undefined ? {} : { elsewhere: value.elsewhere.status === "unavailable" ? { status: value.elsewhere.status, reason: value.elsewhere.reason }
      : { status: value.elsewhere.status, lemma: value.elsewhere.lemma, total: value.elsewhere.total,
        places: value.elsewhere.places.map(place => ({ ref: place.ref, wordIndex: place.wordIndex, words: [...place.words], mark: place.mark })),
        ...(value.elsewhere.partial ? { partial: true } : {}) } }) };
}
export function studyPageView(page: StudyPage): { [key: string]: JsonValue } {
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
      words: v.words.status === "ready" ? { status: "ready", readingTextSha256: v.words.readingTextSha256, starts: [...v.words.starts], ...(v.words.ends ? { ends: [...v.words.ends] } : {}) } : { status: "unavailable", reason: v.words.reason },
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
    if (!practiceRoute && selected.kind !== "explore-prepare" && selected.kind !== "explore-page" && selected.kind !== "short-explore-page" && selected.kind !== "reading" && selected.kind !== "study-text" && selected.kind !== "study-word-aids" && selected.kind !== "study-word-details" && selected.kind !== "study-sources" && selected.kind !== "reference-audio" && selected.kind !== "short-reference-page" && request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
    // Dispatcher resolves the actual host before this adapter. Services still
    // independently reauthorize; no body/Origin/forwarded claim chooses tenant.
    if (request.method === "POST") requireCookieMutation(request, runtime.origin);
    const id = selected.id === undefined ? undefined : identifier(selected.id);
    const linkId = selected.linkId === undefined ? undefined : identifier(selected.linkId);
    switch (selected.kind) {
      case "explore-prepare": {
        uniqueQuery(request.url, []);
        const body = await objectBody(request, ["mode"]);
        const selectedMode = mode(body.mode, true);
        if (selectedMode === "parent") throw new HttpBoundaryError();
        const value = await runtime.readingExploration.prepare(request, { mode: selectedMode, studentId: id! });
        if (!value.ok) return stale();
        const context = { status: value.status, studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, kind: value.kind,
          ceremonyDate: value.ceremonyDate, serviceSlot: value.serviceSlot, readingDate: value.readingDate, calendar: value.calendar };
        if (value.status === "assigned") return privateJson({ ...context, assignment: value.assignment });
        if (value.status === "unresolved") return privateJson({ ...context, reason: value.reason });
        return privateJson({ ...context, binding: value.binding, expiresAt: value.expiresAt, sourceFetchedAt: value.sourceFetchedAt, portion: value.portion,
          ranges: [...value.ranges], verseCount: value.verseCount, pages: value.pages.map(row => ({ offset: row.offset, first: row.first, last: row.last, chapters: [...row.chapters] })) });
      }
      case "short-explore-page": {
        uniqueQuery(request.url, []);
        const body = await objectBody(request, ["mode", "binding", "offset"], [], "binding"), selectedMode = mode(body.mode, true);
        if (selectedMode === "parent" || !Number.isSafeInteger(body.offset) || Number(body.offset) < 0 || Number(body.offset) > 999) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.shortExplorationAudio.page(request, { mode: selectedMode, studentId: id!, binding: text(body.binding, 48000), offset: Number(body.offset) }); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return stale();
        const page = value.page;
        if (value.kind !== "torah" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1
          || !Array.isArray(page.references) || !page.references.length || page.references.length > 100 || page.offset !== body.offset
          || !Number.isSafeInteger(page.totalVerses) || page.totalVerses < 1 || page.totalVerses > 1000
          || page.offset + page.references.length > page.totalVerses
          || page.nextOffset !== (page.offset + page.references.length < page.totalVerses ? page.offset + page.references.length : null)) throw new Error("Reference page unavailable");
        const references = page.references.map(raw => { const parsed = parseReferenceShortResolution(raw); if (!parsed) throw new Error("Reference page unavailable"); return parsed as unknown as JsonValue; });
        const projected = { studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, kind: value.kind, expiresAt: value.expiresAt,
          page: { offset: page.offset, nextOffset: page.nextOffset, totalVerses: page.totalVerses, references } };
        if (Buffer.byteLength(JSON.stringify(projected)) > 1024 * 1024) throw new Error("Reference page unavailable"); return privateJson(projected);
      }
      case "explore-page": {
        uniqueQuery(request.url, []);
        const body = await objectBody(request, ["mode", "binding", "offset"], [], "binding"), selectedMode = mode(body.mode, true);
        if (selectedMode === "parent" || !Number.isSafeInteger(body.offset) || Number(body.offset) < 0 || Number(body.offset) > 999) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.readingExploration.page(request, { mode: selectedMode, studentId: id!, binding: text(body.binding, 48000), offset: Number(body.offset) }); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return stale();
        return privateJson({ studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, kind: value.kind, expiresAt: value.expiresAt, ...studyPageView(value.page) });
      }
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
        return privateJson({ student: { ...studentCore(value.student), disabled: value.student.disabled },
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
        return privateJson({ membershipAvailable: value.membershipAvailable, roles: value.roles.map(role => role), saved: value.saved, approver: value.approver, sessionBinding: value.sessionBinding });
      }
      case "session-door": {
        // The facts the home's door names, for a signed-in person; the same checks as the summary.
        uniqueQuery(request.url, []); const value = await runtime.portal.sessionDoor(request);
        return privateJson({ pinned: value.pinned, child: value.child, nearest: value.nearest, count: value.count });
      }
      case "session-begin": {
        // The first sign-in's membership (plan D1): an empty body, the cookie-mutation rule already applied above, the same summary as GET.
        uniqueQuery(request.url, []); await objectBody(request, []); const value = await runtime.portal.beginSession(request);
        return privateJson({ membershipAvailable: value.membershipAvailable, roles: value.roles.map(role => role), saved: value.saved, approver: value.approver, sessionBinding: value.sessionBinding });
      }
      case "students": {
        const query = uniqueQuery(request.url, ["mode", "afterId", "limit"]), limit = query.get("limit");
        if (limit !== null && (!/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100)) throw new HttpBoundaryError();
        const rows = await runtime.access.listStudents(request, { mode: baseMode(query.get("mode")), afterId: query.has("afterId") ? identifier(query.get("afterId")) : undefined, limit: limit === null ? undefined : Number(limit) });
        return privateJson({ students: rows.map(row => ({ ...studentView(row), ownAdultHonors: row.ownAdultHonors })) });
      }
      case "student": {
        const query = uniqueQuery(request.url, ["mode"]);
        return privateJson({ student: studentView(await runtime.access.readStudent(request, { mode: baseMode(query.get("mode")), studentId: id! })) });
      }
      case "short-reference-page": {
        if (request.body !== null || request.headers.has("transfer-encoding") || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) throw new HttpBoundaryError();
        const query = uniqueQuery(request.url, ["mode", "kind", "assignmentId", "assignmentRevision", "translation", "offset"]);
        const kind = query.get("kind"), translation = query.get("translation"), revision = query.get("assignmentRevision"), offset = query.get("offset");
        if ((kind !== "torah" && kind !== "haftarah") || translation !== "jps2023" || !revision || !/^[1-9][0-9]{0,9}$/.test(revision)
          || offset === null || !/^(?:0|[1-9][0-9]{0,2})$/.test(offset)) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.shortReferenceAudio.readPage(request, { mode: mode(query.get("mode"), true), studentId: id!, kind,
          assignmentId: identifier(query.get("assignmentId")), assignmentRevision: integer(Number(revision)), translation, offset: Number(offset) }); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return stale();
        const page = value.page;
        if (!Array.isArray(page.references) || !page.references.length || page.references.length > 100 || page.offset !== Number(offset)
          || !Number.isSafeInteger(page.totalVerses) || page.totalVerses < 1 || page.totalVerses > 1000
          || page.offset + page.references.length > page.totalVerses
          || page.nextOffset !== (page.offset + page.references.length < page.totalVerses ? page.offset + page.references.length : null)) throw new Error("Reference page unavailable");
        const references = page.references.map(raw => { const parsed = parseReferenceShortResolution(raw); if (!parsed) throw new Error("Reference page unavailable"); return parsed as unknown as JsonValue; });
        const projected = { studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, context: contextView(value.context),
          assignment: { id: value.assignment.id, revision: value.assignment.revision, kind: value.assignment.kind, needsReview: value.assignment.needsReview },
          page: { offset: page.offset, nextOffset: page.nextOffset, totalVerses: page.totalVerses, references } };
        if (Buffer.byteLength(JSON.stringify(projected)) > 1024 * 1024) throw new Error("Reference page unavailable");
        return privateJson(projected);
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
      case "study-sources": {
        if (request.body !== null || request.headers.has("transfer-encoding") || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) throw new HttpBoundaryError();
        const query = uniqueQuery(request.url, ["mode", "kind", "assignmentId", "assignmentRevision", "translation", "offset", "sourceOffset", "catalogHash"]);
        const kind = query.get("kind"), translation = query.get("translation"), revisionValue = query.get("assignmentRevision"), offset = query.get("offset"), sourceOffset = query.get("sourceOffset"), catalogHash = query.get("catalogHash");
        if ((kind !== "torah" && kind !== "haftarah") || translation !== "jps2023" || !revisionValue || !/^[1-9][0-9]{0,9}$/.test(revisionValue)
          || offset === null || !/^(?:0|[1-9][0-9]{0,2})$/.test(offset) || sourceOffset === null || !/^(?:0|[1-9][0-9]{0,3})$/.test(sourceOffset)
          || Number(sourceOffset) > 4090 || Number(sourceOffset) % 10 !== 0 || catalogHash !== null && !/^[a-f0-9]{64}$/.test(catalogHash) || Number(sourceOffset) > 0 && catalogHash === null) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.studySources.read(request, { mode: mode(query.get("mode"), true), studentId: id!, kind,
          assignmentId: identifier(query.get("assignmentId")), assignmentRevision: integer(Number(revisionValue)), translation, offset: Number(offset) },
          { sourceOffset: Number(sourceOffset), ...(catalogHash === null ? {} : { catalogHash }) }); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return value.code === "source-catalog-changed" ? privateJson({ ok: false, code: "source-catalog-changed" }, 409) : stale();
        const page: RelatedSourcePage = value.sources;
        const body = { studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, context: contextView(value.context),
          assignment: { id: value.assignment.id, revision: value.assignment.revision, kind: value.assignment.kind, needsReview: value.assignment.needsReview },
          sources: { schema: page.schema, ref: page.ref, catalogHash: page.catalogHash, sourceOffset: page.sourceOffset, pageSize: page.pageSize,
            totalEntries: page.totalEntries, receivedRows: page.receivedRows, heldCount: page.heldCount, duplicateCount: page.duplicateCount, nextSourceOffset: page.nextSourceOffset,
            entries: page.entries.map(entry => ({ id: entry.id, ref: entry.ref, indexTitle: entry.indexTitle, category: entry.category, labels: { en: entry.labels.en, he: entry.labels.he } })) } };
        if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024) throw new StudyUnavailable("upstream");
        return privateJson(body);
      }
      case "study-word-details": {
        if (request.body !== null || request.headers.has("transfer-encoding") || (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) throw new HttpBoundaryError();
        const query = uniqueQuery(request.url, ["mode", "kind", "assignmentId", "assignmentRevision", "translation", "offset", "wordIndex"]);
        const kind = query.get("kind"), translation = query.get("translation"), revisionValue = query.get("assignmentRevision"), offset = query.get("offset"), wordIndex = query.get("wordIndex");
        if ((kind !== "torah" && kind !== "haftarah") || translation !== "jps2023" || !revisionValue || !/^[1-9][0-9]{0,9}$/.test(revisionValue)
          || offset === null || !/^(?:0|[1-9][0-9]{0,2})$/.test(offset) || wordIndex === null || !/^(?:0|[1-9][0-9]{0,2})$/.test(wordIndex) || Number(wordIndex) >= WORD_DETAILS_LIMITS.words) throw new HttpBoundaryError();
        let value;
        try { value = await runtime.studyWordDetails.read(request, { mode: mode(query.get("mode"), true), studentId: id!, kind,
          assignmentId: identifier(query.get("assignmentId")), assignmentRevision: integer(Number(revisionValue)), translation, offset: Number(offset) }, Number(wordIndex)); }
        catch (error) { if (error instanceof StudyUnavailable && error.code === "invalid-request") throw new HttpBoundaryError(); throw error; }
        if (!value.ok) return stale();
        const body = { studentId: value.studentId, studentRevision: value.studentRevision, mode: value.mode, context: contextView(value.context),
          assignment: { id: value.assignment.id, revision: value.assignment.revision, kind: value.assignment.kind, needsReview: value.assignment.needsReview }, wordDetails: wordDetailsView(value.wordDetails) };
        if (Buffer.byteLength(JSON.stringify(body)) > WORD_DETAILS_LIMITS.bytes) throw new StudyUnavailable("upstream");
        return privateJson(body);
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
        return privateJson({ student: studentView(value.student), mode: value.mode, context: contextView(value.context),
          referenceListeningEnabled: runtime.shortReferenceAudio.listeningEnabled(value.mode), readings: value.readings.map(row => ({ id: row.id, status: row.status,
          kind: row.kind, basis: row.basis, revision: row.revision, ranges: [...row.ranges], verses: [...row.verses], confirmationDate: row.confirmationDate, needsReview: row.needsReview, aliyahStarts:row.aliyahStarts, readingKey: row.readingKey,
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
            rehearsal1: row.rehearsal1, rehearsal2: row.rehearsal2, studentKind: row.studentKind, serviceSlot: row.serviceSlot, parentEmail: row.parentEmail, ownEmail: row.ownEmail,
            hebrewName: row.hebrewName, secondParentEmail: row.secondParentEmail, importMetadata: row.importMetadata,
            disabledAt: row.disabledAt?.toISOString() ?? null, ceremonyDoneAt: row.ceremonyDoneAt?.toISOString() ?? null, revision: row.revision })) });
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
      // N21 "Ceremony done": admin mode only (src/server/students/ceremony-done.ts refuses every other mode and checks the live grant).
      case "ceremony-done": case "ceremony-reverse": {
        uniqueQuery(request.url, []); const body = await objectBody(request, ["expectedRevision"]);
        const selection = { mode: "admin" as const, studentId: id!, expectedRevision: integer(body.expectedRevision) };
        const value = selected.kind === "ceremony-done" ? await runtime.ceremonyDone.set(request, selection) : await runtime.ceremonyDone.reverse(request, selection);
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
            createdAt: row.createdAt, expiresAt: row.expiresAt, expiresTomorrow: row.expiresTomorrow, acceptedAt: row.acceptedAt, revokedAt: row.revokedAt,
            delivery: { status: row.delivery.status, attemptedAt: row.delivery.attemptedAt } })) });
        }
        uniqueQuery(request.url, []); const body = await objectBody(request, ["role", "email"], ["studentId"]);
        if (body.role !== "parent" && body.role !== "student" && body.role !== "tutor") throw new HttpBoundaryError();
        const value = await runtime.invitations.issue(request, { mode: "admin", role: body.role, email: text(body.email, 254), studentId: body.studentId === undefined ? undefined : identifier(body.studentId) });
        return privateJson({ inviteId: value.inviteId, delivery: value.delivery }, 201);
      }
      case "invite-needed": {
        uniqueQuery(request.url, []);
        const rows = await runtime.invitations.parentInvitationsNeeded(request, { mode: "admin" });
        return privateJson({ needed: rows.map(row => ({ memberId: row.memberId, name: row.name, email: row.email,
          student: { id: row.student.id, firstName: row.student.firstName, lastName: row.student.lastName } })) });
      }
      case "invite-copy": {
        // The new link goes only to this admin, in this no-store response; it is never logged, stored or emailed.
        uniqueQuery(request.url, []); await objectBody(request, []);
        const value = await runtime.invitations.copyLink(request, { mode: "admin", inviteId: id! });
        return privateJson({ inviteId: value.inviteId, url: value.url, expiresAt: value.expiresAt });
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
