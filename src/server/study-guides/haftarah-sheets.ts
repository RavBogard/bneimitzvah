import "server-only";

/**
 * The public "Torah from Scratch" haftarah library (RavBogard/haftarah, read-only from here).
 * Its published index is https://haftarah.centralreform.org/data/index.json (schema 2): newest week
 * first, each row { slug: "YYYY-MM-DD-name", civil: "YYYY-MM-DD", ... }, and a week's page is
 * https://haftarah.centralreform.org/<slug>. A student's haftarah card links the week whose civil
 * date is their reading's Shabbat. The index is fetched server-side at most once a day per instance
 * and never by the browser; on any failure there is simply no link.
 */
export const HAFTARAH_ORIGIN = "https://haftarah.centralreform.org";
export const HAFTARAH_INDEX_URL = `${HAFTARAH_ORIGIN}/data/index.json`;
const TTL = 24 * 60 * 60 * 1000, FAILURE_TTL = 15 * 60 * 1000, MAX_BYTES = 512 * 1024, DATE = /^\d{4}-\d{2}-\d{2}$/, SLUG = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseHaftarahIndex(value: unknown): ReadonlyMap<string, string> {
  const weeks = value && typeof value === "object" && (value as { schema?: unknown }).schema === 2 ? (value as { weeks?: unknown }).weeks : null;
  if (!Array.isArray(weeks) || weeks.length > 5000) throw new Error("Invalid haftarah index");
  const byDate = new Map<string, string>();
  for (const row of weeks) {
    const slug = row && typeof row === "object" ? (row as { slug?: unknown }).slug : null, civil = row && typeof row === "object" ? (row as { civil?: unknown }).civil : null;
    // Rows that do not fit the library's own contract are skipped, never guessed at.
    if (typeof slug !== "string" || typeof civil !== "string" || slug.length > 120 || !SLUG.test(slug) || !DATE.test(civil) || !slug.startsWith(civil + "-")) continue;
    if (!byDate.has(civil)) byDate.set(civil, `${HAFTARAH_ORIGIN}/${slug}`);
  }
  return byDate;
}

export function createHaftarahSheets(input: { fetch: typeof globalThis.fetch; now?: () => number; timeoutMs?: number }) {
  const now = input.now ?? Date.now, timeoutMs = input.timeoutMs ?? 5000;
  let cached: { at: number; ttl: number; index: ReadonlyMap<string, string> } | null = null, inflight: Promise<ReadonlyMap<string, string>> | null = null;
  async function load(): Promise<ReadonlyMap<string, string>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await input.fetch(HAFTARAH_INDEX_URL, { redirect: "error", credentials: "omit", headers: { accept: "application/json" }, signal: controller.signal });
      if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) throw new Error("Haftarah index unavailable");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error("Haftarah index too large");
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error("Haftarah index too large");
      return parseHaftarahIndex(JSON.parse(text));
    } finally { clearTimeout(timer); }
  }
  /** The study-sheet page for the Shabbat on this civil date, or null. Never throws. */
  async function sheetFor(civilDate: string | null): Promise<string | null> {
    if (!civilDate || !DATE.test(civilDate)) return null;
    const time = now();
    if (!cached || time - cached.at >= cached.ttl || time < cached.at) {
      inflight ??= load().then(index => { cached = { at: now(), ttl: TTL, index }; return index; },
        () => { cached = { at: now(), ttl: FAILURE_TTL, index: new Map() }; return cached.index; }).finally(() => { inflight = null; });
      await inflight;
    }
    return cached?.index.get(civilDate) ?? null;
  }
  return Object.freeze({ sheetFor });
}
