import "server-only";
export type MediaSlot = Readonly<{ storeGeneration: string; assetId: string; slotIndex: number; expectedBytes: number; bodySha256: string }>;
export type MediaFacts = Readonly<{ byteLength: number; etag: string }>;
export type MediaResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; outcome: "unavailable" | "precondition-failed" | "not-found" | "unknown-write" }>;
export type MediaOperation = Readonly<{ signal?: AbortSignal; deadline?: number }>;
