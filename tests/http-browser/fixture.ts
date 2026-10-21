import { createHonoreeService } from "../../src/server/honoree/service";
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
import { createLessonLogService } from "../../src/server/lesson-log/service";
import { createPracticeCalendarService } from "../../src/server/practice-calendar/service";
import { createStudentRecordingService } from "../../src/server/recordings/service";
import { StudyUnavailable, type StudyRequest, type StudyPage } from "../../src/server/study/types";
import { createRelationshipService } from "../../src/server/relationships/service";
import { createPendingInvitations } from "../../src/server/http/pending-invitations";
import { createGoogleChallenges } from "../../src/server/http/google-challenge";
import { projectMagicLink } from "../../src/server/mail/transport";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { withTenantTransaction } from "../../src/server/db/runtime";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import * as s from "../../src/server/db/index";
import { postgresAccessFixture } from "../postgres/access-fixture";
import { BROWSER_ORIGIN, BROWSER_PORT } from "./server";

const secret = () => randomBytes(48).toString("base64url");
type Mail = { email: string; url: string };

export async function browserFixture(options: { google?: boolean; emptyReadingDate?: string; failInvitationDelivery?: () => boolean; studyLoad?: (request: StudyRequest) => Promise<StudyPage>; referenceCatalogLoad?: (signal?: AbortSignal) => Promise<ReferenceCatalog>; referenceStudentRelease?: boolean; shortReferenceStudyLoad?: (request: StudyRequest) => Promise<StudyPage>; referenceShortManifestLoad?: (signal?: AbortSignal) => Promise<ShortSourceManifest>; wordDetailsSource?: StepSourceLoader; relatedReader?: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>; sourceEditionReader?: (work: string, signal: AbortSignal) => Promise<SourceEditionCatalog>; sourceContentReader?: (selection: ContentSelection, signal: AbortSignal) => Promise<unknown>;musicBroker?:MusicBroker } = {}) {
  const base = await postgresAccessFixture();
  try {
    // The shared disposable fixture creates the DB, migrations and restricted
    // LOGIN. Every request below uses that restricted pool, never its owner.
    const db = base.aDb;
    const deliveries: Mail[] = [];
    await base.ownerDb.insert(s.tenantHost).values({ host: `127.0.0.1:${BROWSER_PORT}`, tenantId: "crc", environment: "local", deployment: "http-browser", origin: BROWSER_ORIGIN });
    const auth = createAuthStack(db, s, { origin: BROWSER_ORIGIN, secret: secret(),
      ...(options.google ? { google: { clientId: "synthetic-browser-client", clientSecret: secret() } } : {}),
      sendMagicLink: async ({ email, url, token }) => { deliveries.push({ email, url: projectMagicLink(url, token, BROWSER_ORIGIN) }); } });
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
    const runtime: HttpRuntime = { honoree: createHonoreeService({ db, access, deployment, origin: BROWSER_ORIGIN, signingSecret: secret() }), honors: createHonorsService({ access }), origin: BROWSER_ORIGIN, auth, access, invitations, students, practice, readingPreview, progress: createProgressService({ access, practice }), lessonLog: createLessonLogService({ access, practice }), practiceCalendar: createPracticeCalendarService({ access, practice }), recordings: createStudentRecordingService({ access, practice }), portal: createPortalService({ access, practice, sessionBindingSecret: secret() }), relationships: createRelationshipService({ access }), pendingInvitations,
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
    serviceLearning: createServiceLearningService({ access: access, practice, signingSecret: secret(),resolveCeremonyUnit:serviceEcosystem.materialMapping }),
    serviceEcosystem,
    serviceScheduler: createServiceScheduler({ db, broker:createMusicBroker(undefined) }),
      googleChallenges: createGoogleChallenges({ db, origin: BROWSER_ORIGIN, secret: secret() }),
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
    function takeMail(email: string) {
      const index = deliveries.findIndex(row => row.email === email);
      if (index < 0) throw new Error("Expected synthetic mail was not captured");
      return deliveries.splice(index, 1)[0].url;
    }
    return { ...base, runtime, withRuntime, takeMail, close: base.close };
  } catch {
    await base.close().catch(() => undefined);
    throw new Error("Browser fixture setup failed; details withheld");
  }
}
import { createServiceEcosystemService } from "../../src/server/service-ecosystem/service";
import { createMusicBroker } from "../../src/server/service-ecosystem/broker";
import { createServiceScheduler } from "../../src/server/service-ecosystem/scheduler";
import type { MusicBroker } from "../../src/server/service-ecosystem/contract";
