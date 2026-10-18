import "server-only";
import { createHmac } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/index";
import { withTenantTransaction } from "../db/runtime";
import type { AccessDatabase, AccessRequest } from "../access/types";
import { createAuthStack } from "../auth/factory";
import { createAccessService } from "../access/service";
import { createInvitationService } from "../invitations/service";
import { createReadingPreviewService } from "../students/preview";
import { createStudentService } from "../students/service";
import { createPracticeService } from "../practice/service";
import { createPortalService } from "../portal/service";
import { createRelationshipService } from "../relationships/service";
import { createPendingInvitations } from "../http/pending-invitations";
import { createGoogleChallenges } from "../http/google-challenge";
import { createPersistentReadingCache } from "../data/reading-cache";
import { createPersistentStudyCache } from "../data/study-cache";
import { createSefariaStudyReader } from "../study/sefaria";
import { createReferenceAudioService } from "../reference-audio/service";
import { createReferenceCatalogLoader } from "../reference-audio/storage";
import { ReferenceUnavailable, type ReferenceCatalog } from "../reference-audio/catalog";
import { createStudyService } from "../study/service";
import { createStudyWordAidsService } from "../study/word-aids-service";
import { createStudyWordDetailsService } from "../study/word-details-service";
import { createStepSource } from "../study/lexical/source";
import type { StepSourceLoader } from "../study/lexical/source-loader";
import { createServiceLearningService } from "../service-learning/service";
import { createStudentWorkService } from "../student-work/service";
import { createProgressService } from "../progress/service";
import { createLessonLogService } from "../lesson-log/service";
import { createPracticeCalendarService } from "../practice-calendar/service";
import { createStudentRecordingService } from "../recordings/service";
import { createPublicStudyCoalescer, type PublicStudyCoalescer } from "../study/coalescing";
import { resolveTenantHost } from "../tenancy/resolve";
import { createHebcalReader } from "../../lib/readings/proposals";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { createMailTransport, projectMagicLink } from "../mail/transport";
import { createLogger } from "../logging/logger";
import type { HostFrame } from "../logging/logger";
import { loadRuntimeConfig, type RuntimeConfig } from "./config";
import { RuntimeUnavailable } from "./errors";
import { AccessDenied } from "../access/errors";

const purposeSecret = (config: RuntimeConfig, purpose: string) => createHmac("sha256", config.authSecret)
  .update(`crc-portal:v1:${config.deployment.environment}:${config.deployment.deployment}:${config.origin}:${purpose}`).digest("base64url");

// Explicit component boundary permits offline tests without environment flags,
// mock credentials, public endpoints or alternate production database fallback.
const publicStudyTasks = new WeakMap<typeof globalThis.fetch, PublicStudyCoalescer>();
// Public immutable source facts only; construction performs no I/O. Never
// create one cache per authenticated request or store an actor in this instance.
const publicStepSource = createStepSource();
function sharedStudyTasks(fetch: typeof globalThis.fetch) {
  let tasks = publicStudyTasks.get(fetch);
  if (!tasks) { tasks = createPublicStudyCoalescer(); publicStudyTasks.set(fetch, tasks); }
  return tasks;
}
let referenceCatalogCache: Readonly<{ key: string; catalog: ReferenceCatalog }> | undefined;

/** Configured construction stays lazy. The only credential comes from native
 * platform request context, supplied explicitly to the pinned private get. */
export function createRuntimeReferenceLoader(config: RuntimeConfig["referenceAudio"]) {
  if (!config) return async () => { throw new ReferenceUnavailable(); };
  const { catalogSha256, storeId } = config;
  const load = createReferenceCatalogLoader({ sha256: catalogSha256, get: async (path, { signal }) => {
    let result: Awaited<ReturnType<typeof import("@vercel/blob")["get"]>>;
    try {
      // These are the pinned SDK's endpoint override names, never request input.
      if (process.env.VERCEL_BLOB_API_URL !== undefined || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined) throw 0;
      const { getContext } = await import("@vercel/oidc");
      if (signal.aborted) throw 0;
      const token = getContext().headers?.["x-vercel-oidc-token"];
      if (typeof token !== "string" || token.length < 1 || token.length > 16384 || token.trim() !== token || /[\s\x00-\x1f\x7f]/.test(token)) throw 0;
      const { get } = await import("@vercel/blob");
      if (signal.aborted || getContext().headers?.["x-vercel-oidc-token"] !== token) throw 0;
      result = await get(path, { access: "private", storeId, oidcToken: token, abortSignal: signal, useCache: false });
      if (signal.aborted || getContext().headers?.["x-vercel-oidc-token"] !== token || !result || result.statusCode !== 200 || !(result.stream instanceof ReadableStream)) throw 0;
      return result.stream;
    } catch {
      try { if (result!?.stream) void result!.stream.cancel().catch(() => {}); } catch {}
      throw new ReferenceUnavailable();
    }
  } });
  const key = `${storeId}:${catalogSha256}`;
  return async (signal?: AbortSignal) => {
    if (signal?.aborted) throw new ReferenceUnavailable();
    if (referenceCatalogCache?.key === key) return referenceCatalogCache.catalog;
    const catalog = await load(signal);
    if (signal?.aborted) throw new ReferenceUnavailable();
    // One immutable success only; never cache promises, failures or request data.
    referenceCatalogCache = Object.freeze({ key, catalog });
    return catalog;
  };
}
export function composeRuntime<Q extends PgQueryResultHKT>(config: RuntimeConfig, db: AccessDatabase<Q>, fetch: typeof globalThis.fetch,
  studyTasks: PublicStudyCoalescer = sharedStudyTasks(fetch), stepSource: StepSourceLoader = publicStepSource) {
  const send = createMailTransport({ ...config.mail, origin: config.origin, fetch });
  const auth = createAuthStack(db, schema, { origin: config.origin, secret: config.authSecret, google: config.google,
    sendMagicLink: ({ email, url, token }) => send("magic-link", { email, url: projectMagicLink(url, token, config.origin) }) });
  const access = createAccessService({ db, auth, deployment: config.deployment });
  const invitations = createInvitationService({ db, access, transport: (message) => send("invitation", message), throttleSecret: purposeSecret(config, "invitation-throttle") });
  const loadReading = createHebcalReader({ fetch, cache: createPersistentReadingCache(db), verseCounts: TANAKH_VERSE_COUNTS });
  const students = createStudentService({ access, loadReading, signingSecret: purposeSecret(config, "student-preparations"), verseCounts: TANAKH_VERSE_COUNTS });
  const practice = createPracticeService({ access });
  const serviceLearning = createServiceLearningService({ access, practice, signingSecret: purposeSecret(config, "service-plan-preparations") });
  const studentWork = createStudentWorkService({ access, practice, authorityBindingSecret: purposeSecret(config, "student-work-authority") });
  const progress = createProgressService({ access, practice });
  const lessonLog = createLessonLogService({ access, practice });
  const practiceCalendar = createPracticeCalendarService({ access, practice });
  const recordings = createStudentRecordingService({ access, practice });
  const loadText = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS, cache: createPersistentStudyCache(db), coalescer: studyTasks });
  const study = createStudyService({ access, practice, load: loadText });
  const studyWordAids = createStudyWordAidsService({ access, practice, loadText });
  const studyWordDetails = createStudyWordDetailsService({ access, practice, loadText, source: stepSource });
  const referenceAudio = createReferenceAudioService({ access, practice, loadText, loadCatalog: createRuntimeReferenceLoader(config.referenceAudio), studentRelease: config.referenceAudio?.studentRelease });
  const readingPreview = createReadingPreviewService({ access, loadReading, loadText, signingSecret:purposeSecret(config,"reading-preview") });
  const portal = createPortalService({ access, practice, sessionBindingSecret: purposeSecret(config, "session-ui-binding") });
  const relationships = createRelationshipService({ access });
  const pendingInvitations = createPendingInvitations({ secret: config.authSecret, origin: config.origin, environment: config.deployment.environment as "local" | "preview" | "production" });
  const googleChallenges = createGoogleChallenges({ db, origin: config.origin, secret: purposeSecret(config, "google-challenges") });
  // An eventual auth handler must resolve the request host BEFORE invoking auth.
  const resolveHost = async (request: AccessRequest, frame: HostFrame = "incoming") => {
    const resolved = await resolveTenantHost(db, request, config.deployment, frame);
    if (resolved.origin !== config.origin) throw new RuntimeUnavailable();
    return resolved;
  };
  return Object.freeze({ origin: config.origin, auth, access, invitations, students, practice, study, studyWordAids, studyWordDetails, referenceAudio, readingPreview, studentWork, progress, lessonLog, practiceCalendar, recordings, serviceLearning, portal, relationships, pendingInvitations, googleChallenges, resolveHost });
}

export type HttpRuntime = ReturnType<typeof composeRuntime>;
export function createRuntimeScope(env: () => Readonly<Record<string, string | undefined>> = () => process.env) {
  // No environment reads, pool construction or I/O until the scoped call.
  return async function withRuntime<T>(action: (runtime: HttpRuntime) => Promise<T>): Promise<T> {
    const log = createLogger().request();
    let pool: Pool | undefined;
    try {
      const config = loadRuntimeConfig(env());
      if (typeof globalThis.WebSocket !== "function") throw new RuntimeUnavailable();
      pool = new Pool({ connectionString: config.databaseUrl, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
        statement_timeout: 10000, query_timeout: 12000 });
      pool.on("error", () => log.emit("runtime.unavailable", 503));
      const db = drizzle(pool, { schema, logger: false });
      // Before ANY auth/global-cache use, reject elevated login/owner/member
      // identities with the same live-role check used by capability services.
      await withTenantTransaction(db, { tenantId: "crc" }, async () => undefined);
      const runtime = composeRuntime(config, db, globalThis.fetch);
      await runtime.resolveHost({ url: config.origin, headers: new Headers() }, "configured");
      return await action(runtime);
    } catch (error) {
      // Callback errors are mutable and may carry private diagnostics even when
      // they began as a service denial. Copy only a closed validated status,
      // never their message/name/stack/properties/cause or object identity.
      let denialStatus: unknown;
      try { if (error instanceof AccessDenied) denialStatus = error.status; } catch { /* Untrusted diagnostic accessor. */ }
      if (denialStatus === 401 || denialStatus === 403 || denialStatus === 404) {
        log.emit("request.complete", denialStatus);
        throw new AccessDenied(denialStatus);
      }
      log.emit("runtime.unavailable", 503);
      throw new RuntimeUnavailable();
    } finally { if (pool) await pool.end().catch(() => log.emit("runtime.unavailable", 503)); }
  };
}
