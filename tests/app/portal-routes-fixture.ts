import { createHonoreeService } from "../../src/server/honoree/service";
import { createNotificationDelivery, createNotificationPreferences } from "../../src/server/notifications/service";
import { createSavedService } from "../../src/server/saved/service";
import { createCongregationSettingsService } from "../../src/server/settings/service";
import { createClaudeConnectionsService } from "../../src/server/connections/service";
import { createMavenLinkService } from "../../src/server/students/maven-links";
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";
import { createShortExplorationService } from "../../src/server/reference-audio/short-exploration-service";
import { createSourceContentService } from "../../src/server/study/source-content-service";
import { createHonorsService } from "../../src/server/honors/service";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { createStudySourceDiscoveryService } from "../../src/server/study/source-discovery-service";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { randomBytes } from "node:crypto";
import { accessFixture } from "./access-fixture";
import { createPortalService } from "../../src/server/portal/service";
import { createRelationshipService } from "../../src/server/relationships/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createProgressService } from "../../src/server/progress/service";
import { createStudyGuideService, studyGuideWebSurface } from "../../src/server/study-guides/service";
import { createHaftarahSheets } from "../../src/server/study-guides/haftarah-sheets";
import { createLessonLogService } from "../../src/server/lesson-log/service";
import { createPracticeCalendarService } from "../../src/server/practice-calendar/service";
import { createInvitationService } from "../../src/server/invitations/service";
import { createReadingPreviewService } from "../../src/server/students/preview";
import { createStudentService } from "../../src/server/students/service";
import { createPendingInvitations } from "../../src/server/http/pending-invitations";
import { createGoogleChallenges } from "../../src/server/http/google-challenge";
import { createSignInCodeBindings } from "../../src/server/http/sign-in-code-binding";
import { handlePortalRequest } from "../../src/server/http/portal";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { createReferenceAudioService } from "../../src/server/reference-audio/service";
import { ReferenceUnavailable } from "../../src/server/reference-audio/catalog";
import { createStudyService } from "../../src/server/study/service";
import { createReadingExplorationService } from "../../src/server/study/exploration";
import { createStudyWordAidsService } from "../../src/server/study/word-aids-service";
import { createStudyWordDetailsService } from "../../src/server/study/word-details-service";
import { createServiceLearningService } from "../../src/server/service-learning/service";
import { createStudentWorkService } from "../../src/server/student-work/service";
import { createStudentRecordingService } from "../../src/server/recordings/service";
import { StudyUnavailable } from "../../src/server/study/types";
import { createReferenceReviewService } from "../../src/server/reference-review/service";
import { ReviewUnavailable } from "../../src/server/reference-review/batch-contract";

export async function portalRoutesFixture() {
  const f = await accessFixture();
  let recipient!: { id: string; cookie: string; sessionId: string };
  await f.owner(async () => {
    await f.db.update(s.student).set({serviceSlot:"morning"});
    const { cookie } = await f.signIn("routes-recipient@example.test");
    const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
    if (!proof) throw new Error("Synthetic routes recipient failed");
    recipient = { id: proof.user.id, cookie, sessionId: proof.session.id };
  });
  const identities = { ...f.identities, recipient };
  const practice = createPracticeService({ access: f.service });
  const explorationSecret = randomBytes(48).toString("base64url");
  const deliveries: { url: string }[] = []; let sendFails = false;
  const invitations = createInvitationService({ db: f.db, access: f.service, throttleSecret: randomBytes(48).toString("base64url"), transport: async message => {
    deliveries.push({ url: message.url }); if (sendFails) throw new Error("Synthetic delivery failure");
  } });
  const students = createStudentService({ access: f.service, signingSecret: randomBytes(48).toString("base64url"), loadReading: async (date, calendar) => ({ fetchedAt: Date.now(),
    snapshot: { date: parseCeremonyDate(date), calendar, classification:"regular", reading: { parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:31-2:2" }], triennial: null }, haftarah: "Isaiah 1:1-2" } }) });
  const pendingInvitations = createPendingInvitations({ secret: randomBytes(48).toString("base64url"), origin: "http://localhost:3000", environment: "local" });
  const readingPreview=createReadingPreviewService({access:f.service,signingSecret:randomBytes(48).toString("base64url"),loadReading:async(date,calendar)=>({fetchedAt:Date.now(),snapshot:{date:parseCeremonyDate(date),calendar,classification:"regular",reading:{parashah:"Synthetic",type:"shabbat",summary:"",source:"Hebcal",aliyot:[{n:1,ref:"Genesis 1:1-6:8"}],triennial:null},haftarah:"Isaiah 1:1-2"}}),loadText:async()=>{throw new StudyUnavailable("upstream");}});
  // Recordings are parked in production (PORTAL_RECORDINGS_ENABLED); this fixture enables them so their parked tests run.
  const runtime: HttpRuntime & { recordings: NonNullable<HttpRuntime["recordings"]> } = { saved: createSavedService({ access: f.service }), notifications: createNotificationDelivery({ db: f.db, origin: "http://localhost:3000", secret: randomBytes(48).toString("base64url"), enabled: false, send: async () => "rejected" as const }), notificationPreferences: createNotificationPreferences({ access: f.service, enabled: false }), rosterSheet: { configured: false, cron: async () => ({ ok: false as const, reason: "not-configured" as const }), now: async () => ({ ok: false as const, reason: "not-configured" as const }) }, mcp: null, origin: "http://localhost:3000", honoree: createHonoreeService({ db: f.db, access: f.service, origin: "http://localhost:3000", deployment: { environment: "test", deployment: "suite" }, signingSecret: randomBytes(48).toString("base64url") }), honors: createHonorsService({ access: f.service }), congregationSettings: createCongregationSettingsService({ access: f.service }), claudeConnections: createClaudeConnectionsService({ access: f.service }), mavenLinks: createMavenLinkService({ access: f.service }), auth: f.auth, access: f.service, practice, invitations, students, readingPreview, studentWork: createStudentWorkService({ access: f.service, practice, authorityBindingSecret: "synthetic-work-authority-binding-secret" }),
    readingExploration: createReadingExplorationService({ access: f.service, practice, signingSecret: explorationSecret, loadReading: async () => { throw new StudyUnavailable("upstream"); }, loadText: async () => { throw new StudyUnavailable("upstream"); } }),
    shortExplorationAudio: createShortExplorationService({ access: f.service, practice, signingSecret: explorationSecret, loadReading: async () => { throw new StudyUnavailable("upstream"); }, loadText: async () => { throw new StudyUnavailable("upstream"); }, loadCatalog: async () => { throw new ReferenceUnavailable(); }, loadManifest: async () => { throw new ReferenceUnavailable(); } }),
    referenceAudio: createReferenceAudioService({ access: f.service, practice, loadText: async () => { throw new StudyUnavailable("upstream"); }, loadCatalog: async () => { throw new ReferenceUnavailable(); } }),
    shortReferenceAudio: createShortReferenceAudioService({ access: f.service, practice, loadText: async () => { throw new StudyUnavailable("upstream"); }, loadCatalog: async () => { throw new ReferenceUnavailable(); }, loadManifest: async () => { throw new ReferenceUnavailable(); } }),
    studyWordAids: createStudyWordAidsService({ access: f.service, practice, loadText: async () => { throw new StudyUnavailable("upstream"); } }),
    sourceContent: createSourceContentService({ access: f.service, practice, related: async () => { throw new Error("Source content unavailable"); }, editions: async () => { throw new Error("Source content unavailable"); }, content: async () => { throw new Error("Source content unavailable"); } }),
    sourceAssignments: createSourceAssignmentsService({ access: f.service, practice, related: async ref => parseRelatedMetadata([], ref) }),
    studySources: createStudySourceDiscoveryService({ access: f.service, practice, loadText: async () => { throw new StudyUnavailable("upstream"); }, related: async ref => parseRelatedMetadata([], ref) }),
    studyWordDetails: createStudyWordDetailsService({ access: f.service, practice, loadText: async () => { throw new StudyUnavailable("upstream"); }, source: { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) } }),
    study: createStudyService({ access: f.service, practice, load: async () => { throw new StudyUnavailable("upstream"); } }), progress: createProgressService({ access: f.service, practice }), haftarahSheets: createHaftarahSheets({ fetch: async () => { throw new Error("No haftarah library in tests"); } }), studyGuides: studyGuideWebSurface(createStudyGuideService({ access: f.service, practice, check: async ({ body }) => ({ ok: true as const, body }) })), lessonLog: createLessonLogService({ access: f.service, practice }), practiceCalendar: createPracticeCalendarService({ access: f.service, practice }), recordings: createStudentRecordingService({ access: f.service, practice }),
    portal: createPortalService({ access: f.service, practice, sessionBindingSecret: randomBytes(48).toString("base64url") }), relationships: createRelationshipService({ access: f.service }), pendingInvitations,
    serviceLearning: createServiceLearningService({ access: f.service, practice, signingSecret: randomBytes(48).toString("base64url") }),
    referenceReview: createReferenceReviewService({ access: f.service, reviewer: undefined, get: async () => { throw new ReviewUnavailable(); } }),
    serviceEcosystem: createServiceEcosystemService({ access:f.service,practice,broker:createMusicBroker(undefined) }),
    serviceScheduler: createServiceScheduler({ db:f.db, broker:createMusicBroker(undefined) }),
    googleChallenges: createGoogleChallenges({ db: f.db, origin: "http://localhost:3000", secret: randomBytes(48).toString("base64url") }),
    signInCodes: createSignInCodeBindings({ origin: "http://localhost:3000", secret: randomBytes(48).toString("base64url") }),
    resolveHost: request => resolveTenantHost(f.db, request, { environment: "test", deployment: "suite" }) };
  function request(path: string, options: { who?: keyof typeof identities | "anonymous"; method?: string; body?: unknown; handle?: string; pending?: string;
    headers?: Record<string, string>; origin?: string } = {}) {
    const headers = new Headers(options.headers);
    const who = options.who ?? "multi";
    const cookie = [who === "anonymous" ? "" : identities[who].cookie, options.pending ?? ""].filter(Boolean).join("; ");
    if (!headers.has("cookie") && cookie) headers.set("cookie", cookie);
    if (options.handle !== undefined) headers.set("X-Practice-Context", options.handle);
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    if (method === "POST" && !headers.has("origin")) headers.set("origin", "http://localhost:3000");
    if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    return new Request(`${options.origin ?? "http://localhost:3000"}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  }
  async function call(path: string, options: Parameters<typeof request>[1] = {}) {
    const response = await handlePortalRequest(request(path, options), runtime);
    if (!response) throw new Error("Expected owned portal route");
    return response;
  }
  function pending(index = deliveries.length - 1) {
    const token = new URLSearchParams(new URL(deliveries[index].url).hash.slice(1)).get("token");
    if (!token) throw new Error("Synthetic invitation token missing");
    const response = pendingInvitations.exchange(new Request("http://localhost:3000/api/invitations/open", { method: "POST", headers: { origin: "http://localhost:3000" } }), token);
    return { token, cookie: response.headers.getSetCookie()[0].split(";")[0] };
  }
  return { ...f, identities, runtime, request, call, pending, deliveries, failSend: (value: boolean) => { sendFails = value; } };
}
import { createServiceEcosystemService } from "../../src/server/service-ecosystem/service";
import { createMusicBroker } from "../../src/server/service-ecosystem/broker";
import { createServiceScheduler } from "../../src/server/service-ecosystem/scheduler";
