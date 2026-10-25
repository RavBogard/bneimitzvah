import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/index";
import { withTenantTransaction } from "../db/runtime";
import { readProductName } from "../data/product-name";
import { countPublicPageView } from "../data/page-views";
import type { AccessDatabase } from "../access/types";
import { AccessDenied } from "../access/errors";
import { createPersistentReadingCache } from "../data/reading-cache";
import { createPersistentStudyCache } from "../data/study-cache";
import { createSefariaStudyReader } from "../study/sefaria";
import { createSefariaCommentaryReader } from "../study/commentary";
import { createSefariaTranslationsReader } from "../study/translations";
import { createSefariaPinnedSourceReader, createSefariaSourceReader } from "../study/source-text";
import { memoPinnedSource, readPublicDiscussions } from "../discussions/public";
import { readCourseText, serviceTextOf } from "../service-course/text";
import { readApprovedPortionSummary } from "../portion-summary/public";
import { createSefariaMetadataReader } from "../study/sources/sefaria-metadata";
import { createHebcalReader } from "../../lib/readings/proposals";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { resolveTenantHost } from "../tenancy/resolve";
import { createRuntimeShortMetadata } from "../reference-audio/runtime-short-metadata";
import { budgetedStepSource, createPublicReadingService, PUBLIC_TENANT } from "../public-reading/service";
import { createStepSource } from "../study/lexical/source";
import type { PublicRuntime, PublicRuntimeScope } from "../http/public-reading";
import type { PageViewRuntime, PageViewScope } from "../http/page-views";
import { createLogger } from "../logging/logger";
import { loadRuntimeConfig, type RuntimeConfig } from "./config";
import { RuntimeUnavailable } from "./errors";
import { sharedStudyTasks } from "./composition";

type Environment = Readonly<Record<string, string | undefined>>;
// One per server instance, apart from the signed-in loader; construction performs no I/O.
const publicStepSource = budgetedStepSource(createStepSource());
// Curated discussions (1.7 M6): pinned Sefaria reads are kept a few hours per instance, so distinct passage URLs (each a
// CDN miss of its own) do not each fan out to Sefaria again for the same sources.
const publicPinnedSource = memoPinnedSource(createSefariaPinnedSourceReader({ fetch: (...args) => globalThis.fetch(...args) }));

/**
 * The signed-out runtime. Deliberately NOT composeRuntime: no auth stack, access
 * service, mail transport or student service exists here, so no public request
 * can open, read or refresh a session or reach a people table by any path. The
 * database handle serves only the exact host lookup, CRC's product name and the two global,
 * non-tenant public text caches (Hebcal calendar and Sefaria chapters) that the
 * signed-in reading already fills, plus the public tenant's own productName for the web app manifest
 * (1.5 A1, E1): one column of the one tenant this runtime ever serves, read only after resolveTenant.
 * Since 1.7 M6 it also reads that tenant's published curated discussions, only through the
 * curated_discussion_public view, each source with its selector's stored display name for "Selected by".
 */
export function composePublicRuntime<Q extends PgQueryResultHKT>(config: RuntimeConfig, db: AccessDatabase<Q>, fetch: typeof globalThis.fetch, env: Environment): PublicRuntime {
  const loadReading = createHebcalReader({ fetch, cache: createPersistentReadingCache(db), verseCounts: TANAKH_VERSE_COUNTS });
  const loadText = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS, cache: createPersistentStudyCache(db), coalescer: sharedStudyTasks(fetch) });
  // Visitors never hear more than students: PocketTorah needs the student release
  // (and the short metadata loader itself needs REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE).
  const pocketTorah = config.referenceAudio?.studentRelease === true && env.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE === "true" ? createRuntimeShortMetadata(config, env) : null;
  const reading = createPublicReadingService({ loadReading, loadText, stepSource: publicStepSource,
    pocketTorah: pocketTorah ? { loadCatalog: pocketTorah.loadCatalog, loadManifest: pocketTorah.loadManifest } : null });
  const shelfLinks = createSefariaMetadataReader({ fetch });
  return Object.freeze({
    async resolveTenant(request: Request) {
      const resolved = await resolveTenantHost(db, { url: request.url, headers: request.headers }, config.deployment);
      if (resolved.origin !== config.origin || resolved.tenantId !== PUBLIC_TENANT) throw new AccessDenied(404);
    },
    reading,
    // The commentary reader itself keeps nothing (the route still resolves the tenant); the CDN keeps each chapter's answer.
    commentary: createSefariaCommentaryReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS }),
    translations: createSefariaTranslationsReader({ fetch }),
    shelf: (verse: string, signal?: AbortSignal) => shelfLinks.shelfLinks(verse, signal ?? new AbortController().signal),
    source: createSefariaSourceReader({ fetch }),
    productName: () => withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => readProductName(tx, PUBLIC_TENANT)),
    // Curated discussions (1.7 M6): the public tenant's published rows through curated_discussion_public, read only after
    // resolveTenant, plus its product name for the translation credit. No people table is read.
    discussions: (verses: readonly string[]) => withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => readPublicDiscussions(tx, PUBLIC_TENANT, verses)),
    pinnedSource: publicPinnedSource,
    // The service course (2.0 SC2): the public tenant's active pinned PUBLIC build, read in its own tenant transaction after
    // resolveTenant. The licensed service_catalog is not read here.
    serviceText: async (unit: string) => serviceTextOf(await withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => readCourseText(tx, PUBLIC_TENANT)), unit),
    // Portion summaries (1.9 N6): the public tenant's approved revision only, through portion_summary_public.
    portionSummary: (reading: string) => withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => readApprovedPortionSummary(tx, PUBLIC_TENANT, reading)),
  });
}

/**
 * The page-view counter's runtime (1.5, "path and day only"): smaller still than the public one. The exact host lookup,
 * then one upsert of that congregation's count for an allow-listed path and day. Nothing about the visitor reaches it.
 */
export function composePageViewRuntime<Q extends PgQueryResultHKT>(config: RuntimeConfig, db: AccessDatabase<Q>): PageViewRuntime {
  return Object.freeze({
    async resolveTenant(request: Request) {
      const resolved = await resolveTenantHost(db, { url: request.url, headers: request.headers }, config.deployment);
      if (resolved.origin !== config.origin || resolved.tenantId !== PUBLIC_TENANT) throw new AccessDenied(404);
    },
    countPageView: (path: string, day: string) => withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, tx => countPublicPageView(tx, PUBLIC_TENANT, day, path)),
  });
}

export function createPublicRuntimeScope(env: () => Environment = () => process.env): PublicRuntimeScope {
  return publicScope(env, (config, db, values) => composePublicRuntime(config, db, globalThis.fetch, values));
}
export function createPageViewScope(env: () => Environment = () => process.env): PageViewScope {
  return publicScope(env, (config, db) => composePageViewRuntime(config, db));
}

/** One short-lived pool per request for a signed-out runtime, after the restricted-role preflight; failures are one closed 503. */
function publicScope<R>(env: () => Environment, compose: (config: RuntimeConfig, db: NeonDatabase<typeof schema>, values: Environment) => R): (action: (runtime: R) => Promise<Response>) => Promise<Response> {
  return async action => {
    const log = createLogger().request();
    let pool: Pool | undefined;
    try {
      const values = env(), config = loadRuntimeConfig(values);
      if (typeof globalThis.WebSocket !== "function") throw new RuntimeUnavailable();
      pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000, statement_timeout: 10000, query_timeout: 12000 });
      pool.on("error", () => log.emit("runtime.unavailable", 503));
      const db = drizzle(pool, { schema, logger: false });
      // Same restricted, non-owner role check the signed-in runtime runs first.
      await withTenantTransaction(db, { tenantId: PUBLIC_TENANT }, async () => undefined);
      return await action(compose(config, db, values));
    } catch {
      log.emit("runtime.unavailable", 503);
      throw new RuntimeUnavailable();
    } finally { if (pool) await pool.end().catch(() => log.emit("runtime.unavailable", 503)); }
  };
}
