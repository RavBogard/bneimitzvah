import "server-only";
import type { DeploymentScope } from "../access/types";
import { RuntimeUnavailable } from "./errors";

export type RuntimeConfig = Readonly<{
  deployment: DeploymentScope; origin: string; databaseUrl: string; authSecret: string;
  google?: Readonly<{ clientId: string; clientSecret: string }>;
  mail: Readonly<{ apiKey: string; from: string }>;
  referenceAudio?: Readonly<{ catalogSha256: string; storeId: string; studentRelease: boolean }>;
  serviceMusic?: Readonly<{ url: string; token: string }>;
  serviceCronSecret?:string;
}>;
const clean = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.trim() === s && !/[\x00-\x20\x7f]/.test(s);
// Configuration selects exactly one; this is not a request-host alias list.
export const PRODUCTION_ORIGINS: readonly string[] = Object.freeze([
  "https://beitmitzvah.centralreform.org", "https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app",
]);
export const mailbox = (s: unknown): s is string => typeof s === "string" && s.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(s);

// Values enter only from trusted server configuration, never request headers.
export function loadRuntimeConfig(env: Readonly<Record<string, string | undefined>>): RuntimeConfig {
  try {
    const environment = env.PORTAL_ENVIRONMENT;
    if (environment !== "production" && environment !== "preview" && environment !== "local") throw 0;
    if (!clean(env.PORTAL_DEPLOYMENT) || !/^[a-zA-Z0-9_-]{1,100}$/.test(env.PORTAL_DEPLOYMENT)) throw 0;
    if (env.DATABASE_MIGRATION_URL || env.BOOTSTRAP_OWNER_EMAIL) throw 0;
    if (env.VERCEL_ENV && env.VERCEL_ENV !== (environment === "local" ? "development" : environment)) throw 0;
    if (environment === "local" && (env.NODE_ENV === "production" || env.VERCEL)) throw 0;
    if (!clean(env.BETTER_AUTH_URL)) throw 0;
    const origin = new URL(env.BETTER_AUTH_URL);
    if (origin.origin !== env.BETTER_AUTH_URL || origin.username || origin.password || !/^[a-z0-9.-]+$/.test(origin.hostname)) throw 0;
    if (environment === "production" && !PRODUCTION_ORIGINS.includes(origin.origin)) throw 0;
    if (environment === "production" && env.PORTAL_DEPLOYMENT !== "production") throw 0;
    if (environment === "preview" && (origin.protocol !== "https:" || origin.port || /^\d+(?:\.\d+){3}$/.test(origin.hostname) || origin.hostname.endsWith(".localhost") || origin.hostname === "localhost" || PRODUCTION_ORIGINS.includes(origin.origin))) throw 0;
    if (environment === "local" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname) && origin.port)) throw 0;
    if (!clean(env.DATABASE_URL)) throw 0;
    const db = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || !db.password || !/^\/[A-Za-z0-9_-]+$/.test(db.pathname) || db.hash || !/^[a-zA-Z0-9.-]+$/.test(db.hostname)) throw 0;
    if (["postgres", "neondb_owner", "portal_runtime"].includes(decodeURIComponent(db.username))) throw 0;
    // No libpq options, role switches, TLS downgrade, proxy or arbitrary host override.
    if ([...db.searchParams.keys()].some((key) => key !== "sslmode") || db.searchParams.getAll("sslmode").length > 1 || db.searchParams.get("sslmode") !== "require") throw 0;
    if (!db.hostname.endsWith(".neon.tech")) throw 0;
    if (!clean(env.BETTER_AUTH_SECRET) || env.BETTER_AUTH_SECRET.length < 32 || env.BETTER_AUTH_SECRET.length > 512) throw 0;
    if (!clean(env.RESEND_API_KEY) || !/^re_[A-Za-z0-9_-]{8,256}$/.test(env.RESEND_API_KEY) || !mailbox(env.RESEND_FROM)) throw 0;
    let google: RuntimeConfig["google"];
    if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) {
      if (!clean(env.GOOGLE_CLIENT_ID) || !clean(env.GOOGLE_CLIENT_SECRET) || env.GOOGLE_CLIENT_ID.length > 512 || env.GOOGLE_CLIENT_SECRET.length > 512) throw 0;
      google = Object.freeze({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET });
    }
    let referenceAudio: RuntimeConfig["referenceAudio"];
    const catalogSha256 = env.REFERENCE_AUDIO_CATALOG_SHA256, release = env.REFERENCE_AUDIO_STUDENT_RELEASE;
    if (release !== undefined && release !== "true" && release !== "false") throw 0;
    if (catalogSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(catalogSha256) || typeof env.BLOB_STORE_ID !== "string" || !/^store_[A-Za-z0-9]{8,64}$/.test(env.BLOB_STORE_ID)) throw 0;
      referenceAudio = Object.freeze({ catalogSha256, storeId: env.BLOB_STORE_ID, studentRelease: release === "true" });
    } else if (release === "true") throw 0;
    let serviceMusic: RuntimeConfig["serviceMusic"];
    if(env.BEIT_MITZVAH_MUSIC_URL || env.BEIT_MITZVAH_SERVICE_TOKEN){
      if(!clean(env.BEIT_MITZVAH_SERVICE_TOKEN) || env.BEIT_MITZVAH_SERVICE_TOKEN.length<32 || env.BEIT_MITZVAH_SERVICE_TOKEN.length>512 || !clean(env.BEIT_MITZVAH_MUSIC_URL))throw 0;
      const endpoint=new URL(env.BEIT_MITZVAH_MUSIC_URL);
      if(endpoint.protocol!=="https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=="/api/integrations/beit-mitzvah/v1")throw 0;
      serviceMusic=Object.freeze({url:endpoint.href,token:env.BEIT_MITZVAH_SERVICE_TOKEN});
    }
    if(env.CRON_SECRET!==undefined && (!clean(env.CRON_SECRET) || env.CRON_SECRET.length<32 || env.CRON_SECRET.length>512))throw 0;
    return Object.freeze({ deployment: Object.freeze({ environment, deployment: env.PORTAL_DEPLOYMENT }), origin: origin.origin,
      databaseUrl: env.DATABASE_URL, authSecret: env.BETTER_AUTH_SECRET, google, referenceAudio, serviceMusic, serviceCronSecret:env.CRON_SECRET,
      mail: Object.freeze({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM }) });
  } catch { throw new RuntimeUnavailable(); }
}
