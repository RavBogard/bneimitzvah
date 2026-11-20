import "server-only";
import type { SpokenTransport } from "./service";
import { MAX_SPOKEN_BYTES } from "./media";

/** Only native request OIDC, explicit store selection, private objects, and our random namespace. */
export function createTutorSpokenTransport(storeId: string | undefined): SpokenTransport | undefined {
  if (!storeId) return undefined;
  if (!/^store_[A-Za-z0-9]{8,64}$/.test(storeId)) throw new Error("Tutor recording storage unavailable");
  async function credentials(path: string) {
    if (!/^tutor-spoken\/[a-f0-9-]{36}$/.test(path) || process.env.VERCEL_BLOB_API_URL !== undefined || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined) throw new Error("Tutor recording storage unavailable");
    const { getContext } = await import("@vercel/oidc");
    const token = getContext().headers?.["x-vercel-oidc-token"];
    if (typeof token !== "string" || token.length < 1 || token.length > 16384 || /[\s\x00-\x1f\x7f]/.test(token)) throw new Error("Tutor recording storage unavailable");
    return { storeId, oidcToken: token };
  }
  return {
    async put(path, bytes, type) {
      const options = await credentials(path), { put } = await import("@vercel/blob");
      try {
        const result = await put(path, Buffer.from(bytes), { ...options, access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: type, abortSignal: AbortSignal.timeout(20_000) });
        if (result.pathname !== path || result.contentType?.split(";")[0] !== type) throw 0;
      } catch { throw new Error("Tutor recording storage unavailable"); }
    },
    async get(path) {
      const options = await credentials(path), { get } = await import("@vercel/blob");
      try {
        const result = await get(path, { ...options, access: "private", useCache: false, abortSignal: AbortSignal.timeout(20_000) });
        if (!result || result.statusCode !== 200 || result.blob.pathname !== path || result.blob.size > MAX_SPOKEN_BYTES || !(result.stream instanceof ReadableStream)) {
          if (result?.stream) void result.stream.cancel().catch(() => undefined);
          throw 0;
        }
        return result.stream;
      } catch { throw new Error("Tutor recording storage unavailable"); }
    },
    async remove(path) {
      const options = await credentials(path), { del } = await import("@vercel/blob");
      try { await del(path, { ...options, abortSignal: AbortSignal.timeout(20_000) }); }
      catch { throw new Error("Tutor recording storage unavailable"); }
    },
  };
}
