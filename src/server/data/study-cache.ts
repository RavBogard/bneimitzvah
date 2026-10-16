import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase } from "../access/types";
import { sefariaTextCache } from "../db/study-cache-schema";
import { StudyCacheUnavailable, validateStudyCacheBinding, validateStudyCacheEntry,
  type StudyCacheBinding, type StudyChapterCache } from "../study/cache";

const identityColumns = [sefariaTextCache.provider, sefariaTextCache.apiVersion, sefariaTextCache.parserVersion,
  sefariaTextCache.policyVersion, sefariaTextCache.book, sefariaTextCache.chapter, sefariaTextCache.hebrewEdition,
  sefariaTextCache.hebrewLanguage, sefariaTextCache.translationEdition, sefariaTextCache.translationLanguage];
const where = (binding: StudyCacheBinding) => and(...Object.entries(binding)
  .map(([key, value]) => eq(sefariaTextCache[key as keyof StudyCacheBinding], value)));

/** Public normalized content only. Invoke outside authority transactions; callers
 * still perform final live authorization before projecting any assigned page. */
export function createPersistentStudyCache<Q extends PgQueryResultHKT>(db: AccessDatabase<Q>,
  options: { now?: () => number } = {}): StudyChapterCache {
  const now = options.now ?? Date.now;
  return {
    async get(key) {
      try {
        const binding = validateStudyCacheBinding(key);
        const [row] = await db.select().from(sefariaTextCache).where(where(binding));
        const time = now();
        if (!Number.isSafeInteger(time) || time < 0) throw 0;
        if (!row) return null;
        const { payload, contentHash, fetchedAt, expiresAt, ...storedBinding } = row;
        const entry = validateStudyCacheEntry(binding, { binding: storedBinding, payload, hash: contentHash,
          fetchedAt: fetchedAt.getTime(), expiresAt: expiresAt.getTime() }, time);
        // Validate even expired envelopes, then treat expiry as a miss. No stale
        // fallback and no runtime DELETE privilege or privileged cleanup helper.
        return entry.expiresAt <= time ? null : entry;
      } catch { throw new StudyCacheUnavailable(); }
    },
    async set(key, candidate) {
      try {
        const binding = validateStudyCacheBinding(key), time = now();
        if (!Number.isSafeInteger(time) || time < 0) throw 0;
        const entry = validateStudyCacheEntry(binding, candidate, time);
        if (entry.expiresAt <= time) throw 0;
        const content = { payload: entry.payload, contentHash: entry.hash,
          fetchedAt: new Date(entry.fetchedAt), expiresAt: new Date(entry.expiresAt) };
        await db.insert(sefariaTextCache).values({ ...binding, ...content })
          .onConflictDoUpdate({ target: identityColumns, set: content });
      } catch { throw new StudyCacheUnavailable(); }
    },
  };
}
