import "server-only";
import type { ReferenceCatalogGet } from "../reference-audio/storage";
import { ReviewUnavailable } from "./batch-contract";

/** Existing store authority is injected by trusted runtime composition. No static
 * credential or provider endpoint fallback and no unsigned/signed client URL. */
export function createPrivateReviewGet(input: { storeId: string }): ReferenceCatalogGet {
  if (!/^store_[A-Za-z0-9]{8,64}$/.test(input.storeId)) throw new ReviewUnavailable();
  const storeId = input.storeId;
  return async (path, { signal }) => {
    let stream: ReadableStream<Uint8Array> | undefined;
    try {
      if (!/^reference-review\/finkel\/v1\/(?:manifests\/[a-f0-9]{64}\.json|audio\/[a-f0-9]{64}\.mp3)$/.test(path) || signal.aborted || process.env.VERCEL_BLOB_API_URL !== undefined || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined) throw 0;
      const { getContext } = await import("@vercel/oidc");
      const token = getContext().headers?.["x-vercel-oidc-token"];
      if (typeof token !== "string" || token.length < 1 || token.length > 16384 || token.trim() !== token || /[\s\x00-\x1f\x7f]/.test(token)) throw 0;
      const live = () => { if (signal.aborted || process.env.VERCEL_BLOB_API_URL !== undefined || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined || getContext().headers?.["x-vercel-oidc-token"] !== token) throw 0; };
      const { get } = await import("@vercel/blob"); live();
      const result = await get(path, { access: "private", storeId, oidcToken: token, abortSignal: signal, useCache: false }); stream = result?.stream ?? undefined;
      live(); if (!result || result.statusCode !== 200 || !(stream instanceof ReadableStream)) throw 0;
      return stream;
    } catch { try { if (stream) void stream.cancel().catch(() => {}); } catch {} throw new ReviewUnavailable(); }
  };
}
