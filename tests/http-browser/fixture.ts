import { createHonoreeService } from "../../src/server/honoree/service";
import { createNotificationDelivery, createNotificationPreferences } from "../../src/server/notifications/service";
import { createSavedService } from "../../src/server/saved/service";
import { createLearnersService } from "../../src/server/learners/service";
import { createOfflineService } from "../../src/server/offline/service";
import { createAccountsService } from "../../src/server/accounts/service";
import { createCourseProgressService } from "../../src/server/course-progress/service";
import { createServiceCourseProgressService } from "../../src/server/service-course/progress-service";
import { createVerseReviewService } from "../../src/server/verse-review/service";
import { createServiceCoursePath } from "../../src/server/service-course/path";
import { createServicePartFinished } from "../../src/server/service-course/finished";
import { createPracticeVisibilityService } from "../../src/server/practice-visibility/service";
import { createCeremonyDoneService } from "../../src/server/students/ceremony-done";
import { createStaffService } from "../../src/server/staff/service";
import { createCongregationSettingsService } from "../../src/server/settings/service";
import { createClaudeConnectionsService } from "../../src/server/connections/service";
import { createMavenLinkService } from "../../src/server/students/maven-links";
import { createSourceContentService } from "../../src/server/study/source-content-service";
import { createHonorsService } from "../../src/server/honors/service";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { createStudySourceDiscoveryService } from "../../src/server/study/source-discovery-service";
import { parseRelatedMetadata, type RelatedSourceCatalog, type SourceEditionCatalog } from "../../src/server/study/sources/metadata";
import type { ContentSelection } from "../../src/server/study/sources/content";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { createAuthStack } from "../../src/server/auth/factory";
import { createAccessService } from "../../src/server/access/service";
import { createInvitationService } from "../../src/server/invitations/service";
import { createReadingPreviewService } from "../../src/server/students/preview";
import { createStudentService } from "../../src/server/students/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createPortalService } from "../../src/server/portal/service";
import { createReferenceAudioService } from "../../src/server/reference-audio/service";
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";
import type { ShortSourceManifest } from "../../src/server/reference-audio/short-source-manifest";
import { createShortExplorationService } from "../../src/server/reference-audio/short-exploration-service";
import { createPublicReadingService, PUBLIC_TENANT } from "../../src/server/public-reading/service";
import { AccessDenied } from "../../src/server/access/errors";
import type { PublicRuntime } from "../../src/server/http/public-reading";
import { readProductName } from "../../src/server/data/product-name";
import { CommentaryUnavailable, type CommentaryReader } from "../../src/server/study/commentary";
import type { TranslationsReader } from "../../src/server/study/translations";
import { unavailablePinnedSource, unavailableShelf, unavailableSource, unavailableTranslations, unavailableServiceText } from "../helpers/translations";
import { readPublicDiscussions } from "../../src/server/discussions/public";
import { readApprovedPortionSummary } from "../../src/server/portion-summary/public";
import type { ReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { ReferenceUnavailable } from "../../src/server/reference-audio/catalog";
import { createStudyService } from "../../src/server/study/service";
import { createReadingExplorationService } from "../../src/server/study/exploration";
import { createStudyWordAidsService } from "../../src/server/study/word-aids-service";
import { createStudyWordDetailsService } from "../../src/server/study/word-details-service";
import type { StepSourceLoader } from "../../src/server/study/lexical/source-loader";
import { createServiceLearningService } from "../../src/server/service-learning/service";
import { createStudentWorkService } from "../../src/server/student-work/service";
import { createProgressService } from "../../src/server/progress/service";
import { createStudyGuideService, studyGuideWebSurface } from "../../src/server/study-guides/service";
import { createHaftarahSheets } from "../../src/server/study-guides/haftarah-sheets";
import { createLessonLogService } from "../../src/server/lesson-log/service";
import { createPracticeCalendarService } from "../../src/server/practice-calendar/service";
import { createStudentRecordingService } from "../../src/server/recordings/service";
import { StudyUnavailable, type StudyRequest, type StudyPage } from "../../src/server/study/types";
import { createRelationshipService } from "../../src/server/relationships/service";
import { createPendingInvitations } from "../../src/server/http/pending-invitations";
import { createGoogleChallenges } from "../../src/server/http/google-challenge";
import { createSignInCodeBindings } from "../../src/server/http/sign-in-code-binding";
import { createSignInCodeCap } from "../../src/server/auth/sign-in-code-cap";
import { projectMagicLink } from "../../src/server/mail/transport";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { withTenantTransaction } from "../../src/server/db/runtime";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import { createReferenceReviewService } from "../../src/server/reference-review/service";
import { ReviewUnavailable } from "../../src/server/reference-review/batch-contract";
import type { ReferenceCatalogGet } from "../../src/server/reference-audio/storage";
import * as s from "../../src/server/db/index";
import { postgresAccessFixture } from "../postgres/access-fixture";
import { BROWSER_ORIGIN, BROWSER_PORT } from "./server";

const secret = () => randomBytes(48).toString("base64url");
type Mail = { email: string; url: string; code?: string };

export async function browserFixture(options: { google?: boolean; emptyReadingDate?: string; failInvitationDelivery?: () => boolean; studyLoad?: (request: StudyRequest) => Promise<StudyPage>; referenceCatalogLoad?: (signal?: AbortSignal) => Promise<ReferenceCatalog>; referenceStudentRelease?: boolean; shortReferenceStudyLoad?: (request: StudyRequest) => Promise<StudyPage>; referenceShortManifestLoad?: (signal?: AbortSignal) => Promise<ShortSourceManifest>; wordDetailsSource?: StepSourceLoader; relatedReader?: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>; sourceEditionReader?: (work: string, signal: AbortSignal) => Promise<SourceEditionCatalog>; sourceContentReader?: (selection: ContentSelection, signal: AbortSignal) => Promise<unknown>;musicBroker?:MusicBroker;referenceReviewGet?:ReferenceCatalogGet; commentaryLoad?: CommentaryReader; translationsLoad?: TranslationsReader; shelfLoad?: PublicRuntime["shelf"]; sourceLoad?: PublicRuntime["source"] } = {}) {
  const base = await postgresAccessFixture();
  try {
    // The shared disposable fixture creates the DB, migrations and restricted
    // LOGIN. Every request below uses that restricted pool, never its owner.
    const db = base.aDb;
    const deliveries: Mail[] = [];
    await base.ownerDb.insert(s.tenantHost).values({ host: `127.0.0.1:${BROWSER_PORT}`, tenantId: "crc", environment: "local", deployment: "http-browser", origin: BROWSER_ORIGIN });
    // As in composition: one synthetic "email" carries the link and the typed code; nothing is sent anywhere.
    const auth = createAuthStack(db, s, { origin: BROWSER_ORIGIN, secret: secret(), codeSecret: secret(),
      ...(options.google ? { google: { clientId: "synthetic-browser-client", clientSecret: secret() } } : {}),
      sendMagicLink: async ({ email, url, token }) => {
        const code = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
        deliveries.push({ email, url: projectMagicLink(url, token, BROWSER_ORIGIN), code });
      } });
    const deployment = { environment: "local" as const, deployment: "http-browser" };
    const access = createAccessService({ db, auth, deployment });
    const practice = createPracticeService({ access });
    const musicBroker=options.musicBroker??createMusicBroker(undefined),serviceEcosystem=createServiceEcosystemService({access,practice,broker:musicBroker,studentAudioRelease:options.referenceStudentRelease});
    const invitations = createInvitationService({ db, access, transport: async ({ email, url }) => {
      deliveries.push({ email, url });
      if (options.failInvitationDelivery?.()) throw new Error("Synthetic invitation delivery failure");
    }, throttleSecret: secret() });
    const students = createStudentService({ access, signingSecret: secret(), loadReading: async (date, calendar) => ({ fetchedAt: Date.now(),
      snapshot: { date: parseCeremonyDate(date), calendar, classification: date===options.emptyReadingDate ? "missing" : "regular", reading: date === options.emptyReadingDate ? null : { parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:31-2:2" }], triennial: null }, haftarah: date === options.emptyReadingDate ? null : "Isaiah 1:1-2" } }) });
    const explorationSecret = secret();
    const explorationReading: Parameters<typeof createReadingExplorationService>[0]["loadReading"] = async (date, calendar) => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar, classification: "regular", reading: { parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:1-6:8" }], triennial: null }, haftarah: null } });
    const pendingInvitations = createPendingInvitations({ secret: secret(), origin: BROWSER_ORIGIN, environment: "local" });
    const readingPreview=createReadingPreviewService({access,signingSecret:secret(),loadReading:async(date,calendar)=>({fetchedAt:Date.now(),snapshot:{date:parseCeremonyDate(date),calendar,classification:date===options.emptyReadingDate?"missing":"regular",reading:date===options.emptyReadingDate?null:{parashah:"Synthetic",type:"shabbat",summary:"",source:"Hebcal",aliyot:[{n:1,ref:"Genesis 1:1-6:8"},{n:"M",ref:"Numbers 28:9-10"}],triennial:null},haftarah:date===options.emptyReadingDate?null:"Isaiah 1:1-2"}}),loadText:options.studyLoad??(async()=>{throw new StudyUnavailable("upstream");})});
    const saved = createSavedService({ access }), portal = createPortalService({ access, practice, sessionBindingSecret: secret() });
    const serviceLearning = createServiceLearningService({ access: access, practice, signingSecret: secret(),resolveCeremonyUnit:serviceEcosystem.materialMapping });
    const runtime: HttpRuntime = { saved, learners: createLearnersService({ access, saved }), offline: createOfflineService({ access, portal, saved, ownerSecret: secret() }), accounts: createAccountsService({ db, access, throttleSecret: secret(), send: async () => "skipped" as const }), courseProgress: createCourseProgressService({ access }), verseReview: createVerseReviewService({ access }), serviceCourseProgress: createServiceCourseProgressService({ access }), notifications: createNotificationDelivery({ db: db, origin: BROWSER_ORIGIN, secret: secret(), enabled: false, send: async () => "rejected" as const }), notificationPreferences: createNotificationPreferences({ access: access, enabled: false }), rosterSheet: { configured: false, cron: async () => ({ ok: false as const, reason: "not-configured" as const }), now: async () => ({ ok: false as const, reason: "not-configured" as const }) }, mcp: null, honoree: createHonoreeService({ db, access, deployment, origin: BROWSER_ORIGIN, signingSecret: secret() }), honors: createHonorsService({ access }), congregationSettings: createCongregationSettingsService({ access }), claudeConnections: createClaudeConnectionsService({ access }), mavenLinks: createMavenLinkService({ access }), origin: BROWSER_ORIGIN, auth, access, invitations, students, practice, readingPreview, progress: createProgressService({ access, practice }), haftarahSheets: createHaftarahSheets({ fetch: async () => { throw new Error("No haftarah library in tests"); } }), studyGuides: studyGuideWebSurface(createStudyGuideService({ access, practice, check: async ({ body }) => ({ ok: true as const, body }) })), lessonLog: createLessonLogService({ access, practice }), practiceCalendar: createPracticeCalendarService({ access, practice }), recordings: createStudentRecordingService({ access, practice }), portal, relationships: createRelationshipService({ access }), pendingInvitations,
      readingExploration: createReadingExplorationService({ access, practice, signingSecret: explorationSecret, loadReading: explorationReading, loadText: options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }) }),
      shortExplorationAudio: createShortExplorationService({ access, practice, signingSecret: explorationSecret, loadReading: explorationReading, studentRelease: options.referenceStudentRelease === true,
        loadText: options.shortReferenceStudyLoad ?? options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }), loadCatalog: options.referenceCatalogLoad ?? (async () => { throw new ReferenceUnavailable(); }), loadManifest: options.referenceShortManifestLoad ?? (async () => { throw new ReferenceUnavailable(); }) }),
      referenceAudio: createReferenceAudioService({ access, practice, loadText: options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }), loadCatalog: options.referenceCatalogLoad ?? (async () => { throw new ReferenceUnavailable(); }), studentRelease: options.referenceStudentRelease === true }),
      shortReferenceAudio: createShortReferenceAudioService({ access, practice, loadText: options.shortReferenceStudyLoad ?? options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }), loadCatalog: options.referenceCatalogLoad ?? (async () => { throw new ReferenceUnavailable(); }), loadManifest: options.referenceShortManifestLoad ?? (async () => { throw new ReferenceUnavailable(); }), studentRelease: options.referenceStudentRelease === true }),
      studyWordAids: createStudyWordAidsService({ access, practice, loadText: options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }) }),
      sourceContent: createSourceContentService({ access, practice, related: options.relatedReader ?? (async () => { throw new Error("Source content unavailable"); }), editions: options.sourceEditionReader ?? (async () => { throw new Error("Source content unavailable"); }), content: options.sourceContentReader ?? (async () => { throw new Error("Source content unavailable"); }) }),
      sourceAssignments: createSourceAssignmentsService({ access, practice, related: options.relatedReader ?? (async ref => parseRelatedMetadata([], ref)) }),
      studySources: createStudySourceDiscoveryService({ access, practice, loadText: options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }), related: options.relatedReader ?? (async ref => parseRelatedMetadata([], ref)) }),
      studyWordDetails: createStudyWordDetailsService({ access, practice, loadText: options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }), source: options.wordDetailsSource ?? { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) } }),
      study: createStudyService({ access, practice, load: options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }) }), studentWork: createStudentWorkService({ access, practice, authorityBindingSecret: "synthetic-work-authority-binding-secret" }),
    serviceLearning, serviceCoursePath: createServiceCoursePath({ access, serviceLearning }), servicePartFinished: createServicePartFinished({ access }), practiceVisibility: createPracticeVisibilityService({ access }), ceremonyDone: createCeremonyDoneService({ access }), staff: createStaffService({ access }),
    referenceReview: createReferenceReviewService({ access, reviewer: options.referenceReviewGet ? { tenantId: "crc", userId: base.admin.id } : undefined, get: options.referenceReviewGet ?? (async () => { throw new ReviewUnavailable(); }) }),
    serviceEcosystem,
    serviceScheduler: createServiceScheduler({ db, broker:createMusicBroker(undefined) }),
      googleChallenges: createGoogleChallenges({ db, origin: BROWSER_ORIGIN, secret: secret() }),
      signInCodes: createSignInCodeBindings({ origin: BROWSER_ORIGIN, secret: secret() }),
      signInCodeCap: createSignInCodeCap({ db, secret: secret(), capped: () => undefined }),
      resolveHost: async request => {
        const host = await resolveTenantHost(db, request, deployment);
        if (host.origin !== BROWSER_ORIGIN) throw new Error("Host mismatch");
        return host;
      } };
    async function withRuntime<T>(action: (runtime: HttpRuntime) => Promise<T>) {
      // Live restricted-role preflight is retained for the injected runtime.
      await withTenantTransaction(db, { tenantId: "crc" }, async () => undefined);
      return action(runtime);
    }
    // Signed-out reading: no auth, access or people service at all, as in production composition.
    const publicRuntime: PublicRuntime = Object.freeze({
      async resolveTenant(request: Request) {
        const host = await resolveTenantHost(db, { url: request.url, headers: request.headers }, deployment);
        if (host.origin !== BROWSER_ORIGIN || host.tenantId !== PUBLIC_TENANT) throw new AccessDenied(404);
      },
      reading: createPublicReadingService({
        loadReading: async (date, calendar) => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar, classification: "regular", reading: { parashah: "Synthetic portion", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:1-6:8" }], triennial: null }, haftarah: "Isaiah 1:1-2" } }),
        loadText: options.studyLoad ?? (async () => { throw new StudyUnavailable("upstream"); }),
        stepSource: options.wordDetailsSource ?? { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) },
        pocketTorah: options.referenceStudentRelease === true ? { loadCatalog: options.referenceCatalogLoad ?? (async () => { throw new ReferenceUnavailable(); }), loadManifest: options.referenceShortManifestLoad ?? (async () => { throw new ReferenceUnavailable(); }) } : null,
      }),
      // Never Sefaria: a synthetic stub, or a plain upstream failure.
      commentary: options.commentaryLoad ?? (async () => { throw new CommentaryUnavailable("upstream"); }),
      translations: options.translationsLoad ?? unavailableTranslations,
      shelf: options.shelfLoad ?? unavailableShelf,
      source: options.sourceLoad ?? unavailableSource,
      productName: () => withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => readProductName(tx, PUBLIC_TENANT)),
      discussions: (verses: readonly string[]) => withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => readPublicDiscussions(tx, PUBLIC_TENANT, verses)),
      pinnedSource: unavailablePinnedSource,
      serviceText: unavailableServiceText,
      eveningText: unavailableServiceText,
      portionSummary: (reading: string) => withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => readApprovedPortionSummary(tx, PUBLIC_TENANT, reading)),
    });
    async function withPublicRuntime(action: (runtime: PublicRuntime) => Promise<Response>) {
      await withTenantTransaction(db, { tenantId: "crc" }, async () => undefined);
      return action(publicRuntime);
    }
    function takeMail(email: string) {
      const index = deliveries.findIndex(row => row.email === email);
      if (index < 0) throw new Error("Expected synthetic mail was not captured");
      return deliveries.splice(index, 1)[0].url;
    }
    /** A synthetic sign-in email's typed code (1.5); the link in the same email is discarded. */
    function takeCode(email: string) {
      const index = deliveries.findIndex(row => row.email === email && typeof row.code === "string");
      if (index < 0) throw new Error("Expected synthetic sign-in code was not captured");
      return deliveries.splice(index, 1)[0].code!;
    }
    return { ...base, runtime, withRuntime, publicRuntime, withPublicRuntime, takeMail, takeCode, close: base.close };
  } catch {
    await base.close().catch(() => undefined);
    throw new Error("Browser fixture setup failed; details withheld");
  }
}
import { createServiceEcosystemService } from "../../src/server/service-ecosystem/service";
import { createMusicBroker } from "../../src/server/service-ecosystem/broker";
import { createServiceScheduler } from "../../src/server/service-ecosystem/scheduler";
import type { MusicBroker } from "../../src/server/service-ecosystem/contract";
