import "server-only";
import { eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessDatabase } from "../access/types";
import { hebcalCache } from "../db/tenant-schema";
import { createHebcalReader, hebcalRequest, ReadingUnavailable, type CacheEntry, type HebcalCache } from "../../lib/readings/proposals";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw 0;
}
function binding(key: string) {
  const match = /^hebcal:leyning:v2:(diaspora|israel):(\d{4}-\d{2}-\d{2}):triennial$/.exec(key);
  if (!match) throw 0;
  return hebcalRequest(match[2], match[1] as "diaspora" | "israel");
}
async function validated(key: string, entry: CacheEntry) {
  const request = binding(key);
  if(!Number.isSafeInteger(entry.fetchedAt) || entry.fetchedAt<0 || !Number.isSafeInteger(entry.expiresAt)
    || !Number.isFinite(new Date(entry.fetchedAt).getTime()) || !Number.isFinite(new Date(entry.expiresAt).getTime()))throw 0;
  const serialized = JSON.stringify(entry.payload);
  if (Buffer.byteLength(serialized) > 128 * 1024) throw 0;
  // Only the reader's normalized metadata shape enters this global cache.
  // Unknown properties could conceal contacts/tokens and are rejected outright.
  keys(entry.payload, ["binding", "items", "classification"]);
  keys(entry.payload.binding, ["version", "date", "calendar"]);
  if (!Array.isArray(entry.payload.items) || entry.payload.items.length > 1) throw 0;
  // Multiple calendar results are stored only as a bounded ambiguity marker,
  // never as a selected first reading or an arbitrary source metadata object.
  if(entry.payload.classification!==undefined && (entry.payload.classification!=="multiple" || entry.payload.items.length!==0))throw 0;
  for (const item of entry.payload.items) {
    keys(item, ["date", "name", "type", "parshaNum", "fullkriyah", "triennial", "triYear", "reason", "haft"]);
    if(!["shabbat","holiday","weekday","unknown"].includes(String(item.type)))throw 0;
    keys(item.name, ["en"]);
    if (item.reason !== undefined) keys(item.reason, ["M"]);
    const row = (value: unknown) => { keys(value, ["k", "b", "e", "v", "reason"]); };
    for (const property of ["fullkriyah", "triennial"]) if (item[property] !== undefined) {
      keys(item[property], ["1", "2", "3", "4", "5", "6", "7", "M"]);
      for (const value of Object.values(item[property])) row(value);
    }
    if (item.haft !== undefined) row(item.haft);
  }
  // Reuse calendar/date/range/catalog validation on both reads and writes.
  await createHebcalReader({ cache: { get: async () => entry, set: async () => { throw 0; } },
    fetch: async () => { throw 0; }, verseCounts: TANAKH_VERSE_COUNTS, now: () => entry.fetchedAt })(request.date, request.calendar);
  return request;
}

export function createPersistentReadingCache<Q extends PgQueryResultHKT>(db: AccessDatabase<Q>): HebcalCache {
  return {
    async get(key) {
      try {
        const request = binding(key);
        const [row] = await db.select().from(hebcalCache).where(eq(hebcalCache.requestKey, key));
        if (!row) return null;
        if (row.requestDate !== request.date || JSON.stringify(row.parameters) !== JSON.stringify({ calendar: request.calendar })) throw 0;
        const entry = { payload: row.payload, fetchedAt: row.fetchedAt.getTime(), expiresAt: row.expiresAt.getTime() };
        await validated(key, entry);
        return entry;
      } catch { throw new ReadingUnavailable("cache"); }
    },
    async set(key, entry) {
      try {
        const request = await validated(key, entry);
        const values = { requestKey: key, requestDate: request.date, parameters: { calendar: request.calendar }, payload: entry.payload as Record<string, unknown>,
          fetchedAt: new Date(entry.fetchedAt), expiresAt: new Date(entry.expiresAt) };
        await db.insert(hebcalCache).values(values).onConflictDoUpdate({ target: hebcalCache.requestKey, set: values });
      } catch { throw new ReadingUnavailable("cache"); }
    },
  };
}
