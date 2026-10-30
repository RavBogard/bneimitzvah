import "server-only";
import { isProductionOrigin } from "../../lib/site/identity";
import { ReferenceUnavailable } from "./catalog";
import { createPublicShortHandler, type PublicShortHandler } from "./public-short";
import type { ReferenceCatalogGet } from "./storage";
import { createRuntimeShortMetadata } from "./runtime-short-metadata";
import { reportShortDiagnostic } from "./short-diagnostic";

type Environment = Readonly<Record<string, string | undefined>>;
type Config = Readonly<{ origin: string; parentCatalogSHA256: string; manifestSHA256: string; storeId: string }>;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function select(env: Environment): Config | null {
  if (env.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE !== "true" || env.PORTAL_ENVIRONMENT !== "production" || env.PORTAL_DEPLOYMENT !== "production"
    || env.VERCEL !== "1" || env.VERCEL_ENV !== "production" || env.NODE_ENV !== "production"
    || !isProductionOrigin(env.BETTER_AUTH_URL ?? "", env) || !digest(env.REFERENCE_AUDIO_CATALOG_SHA256) || !digest(env.REFERENCE_AUDIO_SHORT_MANIFEST_SHA256)
    || typeof env.BLOB_STORE_ID !== "string" || !/^store_[A-Za-z0-9]{8,64}$/.test(env.BLOB_STORE_ID)
    || env.VERCEL_BLOB_API_URL !== undefined || env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined) return null;
  return Object.freeze({ origin: env.BETTER_AUTH_URL!, parentCatalogSHA256: env.REFERENCE_AUDIO_CATALOG_SHA256, manifestSHA256: env.REFERENCE_AUDIO_SHORT_MANIFEST_SHA256, storeId: env.BLOB_STORE_ID });
}

/** Independent of auth/DB/mail composition. Only trusted server configuration
 * and native Vercel OIDC context select the existing operator-approved store. */
export function createRuntimePublicShort(env: Environment): PublicShortHandler {
  const config = select(env); if (!config) {
    reportShortDiagnostic("config-rejected", () => ({
      release: env.REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE === "true", portalEnvironment: env.PORTAL_ENVIRONMENT === "production",
      portalDeployment: env.PORTAL_DEPLOYMENT === "production", platform: env.VERCEL === "1", platformEnvironment: env.VERCEL_ENV === "production",
      nodeEnvironment: env.NODE_ENV === "production", origin: isProductionOrigin(env.BETTER_AUTH_URL ?? "", env),
      catalogDigest: digest(env.REFERENCE_AUDIO_CATALOG_SHA256), manifestDigest: digest(env.REFERENCE_AUDIO_SHORT_MANIFEST_SHA256),
      storeShape: typeof env.BLOB_STORE_ID === "string" && /^store_[A-Za-z0-9]{8,64}$/.test(env.BLOB_STORE_ID),
      serverOverrideAbsent: env.VERCEL_BLOB_API_URL === undefined, publicOverrideAbsent: env.NEXT_PUBLIC_VERCEL_BLOB_API_URL === undefined,
    }));
    return createPublicShortHandler();
  }
  const current = () => { const now = select(env); return now !== null && JSON.stringify(now) === JSON.stringify(config); };
  const metadata = createRuntimeShortMetadata({ origin: config.origin, deployment: { environment: "production", deployment: "production" },
    referenceAudio: { storeId: config.storeId, catalogSha256: config.parentCatalogSHA256, studentRelease: false } }, env);
  const get: ReferenceCatalogGet = async (path, { signal }) => {
    let stream: ReadableStream<Uint8Array> | undefined;
    try {
      if (!current() || signal.aborted || !/^reference-audio\/short-v1\/[a-f0-9]{64}\.mp3$/.test(path)) throw 0;
      const { getContext } = await import("@vercel/oidc");
      if (!current() || signal.aborted) throw 0;
      const token = getContext().headers?.["x-vercel-oidc-token"];
      if (typeof token !== "string" || token.length < 1 || token.length > 16384 || token.trim() !== token || /[\s\x00-\x1f\x7f]/.test(token)) throw 0;
      const { get: blobGet } = await import("@vercel/blob");
      if (!current() || signal.aborted || getContext().headers?.["x-vercel-oidc-token"] !== token) throw 0;
      const result = await blobGet(path, { access: "private", storeId: config.storeId, oidcToken: token, abortSignal: signal, useCache: false });
      stream = result?.stream ?? undefined;
      if (!current() || signal.aborted || getContext().headers?.["x-vercel-oidc-token"] !== token || result?.statusCode !== 200 || !(stream instanceof ReadableStream)) throw 0;
      return stream;
    } catch {
      try { if (stream) void stream.cancel().catch(() => {}); } catch {}
      throw new ReferenceUnavailable();
    }
  };
  return createPublicShortHandler({ ...config, get, live: current, loadManifest: metadata.loadManifest });
}

export const publicShortRequest = (request: Request) => {
  return createRuntimePublicShort(process.env)(request);
};
