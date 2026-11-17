import "server-only";
import type { DeploymentScope } from "../access/types";
import { RuntimeUnavailable } from "./errors";
import { causedBy, Unavailable } from "../logging/failure";
import { CRC_ORIGINS, isProductionOrigin } from "../../lib/site/identity";

export type RuntimeConfig = Readonly<{
  deployment: DeploymentScope; origin: string; databaseUrl: string; authSecret: string;
  google?: Readonly<{ clientId: string; clientSecret: string }>;
  mail: Readonly<{ apiKey: string; from: string }>;
  referenceAudio?: Readonly<{ catalogSha256: string; storeId: string; studentRelease: boolean }>;
  serviceMusic?: Readonly<{ url: string; token: string }>;
  serviceCronSecret?:string;
  // The music card's ceremony details (contract BET-6) are sent only when PORTAL_MUSIC_DETAILS_ENABLED is exactly "true".
  musicDetailsEnabled: boolean;
  // The portal MCP answers only when explicitly enabled (after its adversarial review).
  mcpEnabled: boolean;
  // Release 1.1 email notifications send only when this is exactly "true" AND the congregation's
  // switch for that kind is on. Unset, "false" or anything else is off, and never takes the portal down.
  notificationsEnabled: boolean;
}>;
const clean = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.trim() === s && !/[\x00-\x20\x7f]/.test(s);
// Configuration selects exactly one; this is not a request-host alias list.
// CRC's own list; a fork adds exactly one more through CANONICAL_ORIGIN (isProductionOrigin, src/lib/site/identity.ts).
export const PRODUCTION_ORIGINS: readonly string[] = CRC_ORIGINS;
export const mailbox = (s: unknown): s is string => typeof s === "string" && s.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(s);

// Values enter only from trusted server configuration, never request headers.
export function loadRuntimeConfig(env: Readonly<Record<string, string | undefined>>): RuntimeConfig {
  try {
    const environment = env.PORTAL_ENVIRONMENT;
    if (environment !== "production" && environment !== "preview" && environment !== "local") throw new Unavailable("config/portal-environment");
    if (!clean(env.PORTAL_DEPLOYMENT) || !/^[a-zA-Z0-9_-]{1,100}$/.test(env.PORTAL_DEPLOYMENT)) throw new Unavailable("config/portal-deployment");
    if (env.DATABASE_MIGRATION_URL || env.BOOTSTRAP_OWNER_EMAIL) throw new Unavailable("config/operator-variable-present");
    if (env.VERCEL_ENV && env.VERCEL_ENV !== (environment === "local" ? "development" : environment)) throw new Unavailable("config/vercel-env-mismatch");
    if (environment === "local" && (env.NODE_ENV === "production" || env.VERCEL)) throw new Unavailable("config/local-in-production");
    if (!clean(env.BETTER_AUTH_URL)) throw new Unavailable("config/auth-url-missing");
    const origin = new URL(env.BETTER_AUTH_URL);
    if (origin.origin !== env.BETTER_AUTH_URL || origin.username || origin.password || !/^[a-z0-9.-]+$/.test(origin.hostname)) throw new Unavailable("config/auth-url-shape");
    if (environment === "production" && !isProductionOrigin(origin.origin, env)) throw new Unavailable("config/production-origin");
    if (environment === "production" && env.PORTAL_DEPLOYMENT !== "production") throw new Unavailable("config/production-deployment");
    if (environment === "preview" && (origin.protocol !== "https:" || origin.port || /^\d+(?:\.\d+){3}$/.test(origin.hostname) || origin.hostname.endsWith(".localhost") || origin.hostname === "localhost" || isProductionOrigin(origin.origin, env))) throw new Unavailable("config/preview-origin");
    if (environment === "local" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname) && origin.port)) throw new Unavailable("config/local-origin");
    if (!clean(env.DATABASE_URL)) throw new Unavailable("config/database-url-missing");
    const db = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || !db.password || !/^\/[A-Za-z0-9_-]+$/.test(db.pathname) || db.hash || !/^[a-zA-Z0-9.-]+$/.test(db.hostname)) throw new Unavailable("config/database-url-shape");
    if (["postgres", "neondb_owner", "portal_runtime"].includes(decodeURIComponent(db.username))) throw new Unavailable("config/database-elevated-role");
    // No libpq options, role switches, TLS downgrade, proxy or arbitrary host override.
    if ([...db.searchParams.keys()].some((key) => key !== "sslmode") || db.searchParams.getAll("sslmode").length > 1 || db.searchParams.get("sslmode") !== "require") throw new Unavailable("config/database-url-options");
    if (!db.hostname.endsWith(".neon.tech")) throw new Unavailable("config/database-host");
    if (!clean(env.BETTER_AUTH_SECRET) || env.BETTER_AUTH_SECRET.length < 32 || env.BETTER_AUTH_SECRET.length > 512) throw new Unavailable("config/auth-secret");
    if (!clean(env.RESEND_API_KEY) || !/^re_[A-Za-z0-9_-]{8,256}$/.test(env.RESEND_API_KEY) || !mailbox(env.RESEND_FROM)) throw new Unavailable("config/mail");
    let google: RuntimeConfig["google"];
    if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) {
      if (!clean(env.GOOGLE_CLIENT_ID) || !clean(env.GOOGLE_CLIENT_SECRET) || env.GOOGLE_CLIENT_ID.length > 512 || env.GOOGLE_CLIENT_SECRET.length > 512) throw new Unavailable("config/google");
      google = Object.freeze({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET });
    }
    let referenceAudio: RuntimeConfig["referenceAudio"];
    const catalogSha256 = env.REFERENCE_AUDIO_CATALOG_SHA256, release = env.REFERENCE_AUDIO_STUDENT_RELEASE;
    if (release !== undefined && release !== "true" && release !== "false") throw new Unavailable("config/reference-audio-release");
    if (catalogSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(catalogSha256) || typeof env.BLOB_STORE_ID !== "string" || !/^store_[A-Za-z0-9]{8,64}$/.test(env.BLOB_STORE_ID)) throw new Unavailable("config/reference-audio");
      referenceAudio = Object.freeze({ catalogSha256, storeId: env.BLOB_STORE_ID, studentRelease: release === "true" });
    } else if (release === "true") throw new Unavailable("config/reference-audio-release-without-catalog");
    let serviceMusic: RuntimeConfig["serviceMusic"];
    if(env.BEIT_MITZVAH_MUSIC_URL || env.BEIT_MITZVAH_SERVICE_TOKEN){
      if(!clean(env.BEIT_MITZVAH_SERVICE_TOKEN) || env.BEIT_MITZVAH_SERVICE_TOKEN.length<32 || env.BEIT_MITZVAH_SERVICE_TOKEN.length>512 || !clean(env.BEIT_MITZVAH_MUSIC_URL))throw new Unavailable("config/service-music-token");
      const endpoint=new URL(env.BEIT_MITZVAH_MUSIC_URL);
      if(endpoint.protocol!=="https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=="/api/integrations/beit-mitzvah/v1")throw new Unavailable("config/service-music-url");
      serviceMusic=Object.freeze({url:endpoint.href,token:env.BEIT_MITZVAH_SERVICE_TOKEN});
    }
    if (env.PORTAL_MCP_ENABLED !== undefined && env.PORTAL_MCP_ENABLED !== "true" && env.PORTAL_MCP_ENABLED !== "false") throw new Unavailable("config/mcp-flag");
    if (env.PORTAL_MUSIC_DETAILS_ENABLED !== undefined && env.PORTAL_MUSIC_DETAILS_ENABLED !== "true" && env.PORTAL_MUSIC_DETAILS_ENABLED !== "false") throw new Unavailable("config/music-details-flag");
    if(env.CRON_SECRET!==undefined && (!clean(env.CRON_SECRET) || env.CRON_SECRET.length<32 || env.CRON_SECRET.length>512 || env.CRON_SECRET===serviceMusic?.token || env.CRON_SECRET===env.BETTER_AUTH_SECRET))throw new Unavailable("config/cron-secret");
    return Object.freeze({ deployment: Object.freeze({ environment, deployment: env.PORTAL_DEPLOYMENT }), origin: origin.origin,
      databaseUrl: env.DATABASE_URL, authSecret: env.BETTER_AUTH_SECRET, google, referenceAudio, serviceMusic, serviceCronSecret:env.CRON_SECRET, mcpEnabled: env.PORTAL_MCP_ENABLED === "true",
      musicDetailsEnabled: env.PORTAL_MUSIC_DETAILS_ENABLED === "true",
      notificationsEnabled: env.PORTAL_NOTIFICATIONS_ENABLED === "true",
      mail: Object.freeze({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM }) });
  } catch (error) {
    // The cause names which check failed by a static reason ("config/database-url-shape"), never a value; a
    // TypeError from new URL is logged by class and message only ("Invalid URL"), never its `input`.
    throw causedBy(new RuntimeUnavailable(), error);
  }
}
