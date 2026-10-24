import { MELODIES } from "../learn/course";
import { canonicalReadingRef } from "../readings/reading-ref";
import { thisShabbat } from "../readings/public-shabbat";
import { downloadShortReferenceAudio } from "../reference-audio/short-playback";
import type { ShortReferenceSource } from "../reference-audio/short-source";
import { coursePassages } from "../../components/learn/verses-api";
import { parsePublicRefReading, parsePublicShortPage, parsePublicTextPage, parsePublicWeek, refSource, weekSource, type PublicSource } from "../../components/portal/public-reading/api";
import { publicReadingPath, publicShortPath, publicTextPath } from "../../components/portal/public-reading/urls";
import { BUDGET, OFFLINE_CACHE, RENEW_AFTER_MS, OFFLINE_HEADER, PACK_CONCURRENCY, packAssetAllowed, WINDOW_MS, type Pack, type PackDescriptor } from "./policy";
import { assetKey, inspectPack, packingStarted, purgeGeneration, readIndex, refreshOfflineState, setOfflineState, sweep, trackPacking, writeIndex, type PackState } from "./pack-index";

/**
 * The packer (§3.3–§3.5). It runs in the page, never the worker, and only in the installed app on the torah origin.
 * Two public packs, both owner "public": This week (the week's reading, its text and short-reference pages, both by
 * date for Lein and by ref for Learn's This week, and every clip they name) and the Learn to lein course (F3: every
 * fixed course passage's text and short pages and clips). Everything is fetched with no cookie, three at a time.
 * A clip is stored only after its size and SHA-256 match its parsed PocketTorah short-v1 source; the original
 * network response is stored, so its URL and attribution headers survive. A pack's renewedAt moves only when every
 * step succeeded; a 429 stops packing until the next open.
 */
export class PackStopped extends Error { constructor(readonly reason: "rate-limited" | "no-space" | "purged" | "failed") { super(reason); } }
export type PackerIo = Readonly<{
  origin: string; fetch: typeof fetch; caches: CacheStorage; now(): number;
  estimate(): Promise<{ usage?: number; quota?: number }>;
  digest?: Parameters<typeof downloadShortReferenceAudio>[2]["digest"];
}>;
type Plan = { label: string; json: Map<string, Response>; clips: Map<string, ShortReferenceSource>; bytes: number };

const JSON_LIMIT = 2 * 1024 * 1024;
async function fetchJson(io: PackerIo, path: string, signal: AbortSignal, plan: Plan | null, generation: number): Promise<unknown> {
  if (purgeGeneration() !== generation) throw new PackStopped("purged");
  const url = io.origin + path;
  let response: Response;
  try { response = await io.fetch(url, { headers: { accept: "application/json" }, credentials: "omit", mode: "same-origin", redirect: "error", referrerPolicy: "no-referrer", cache: "no-cache", signal }); }
  catch { throw new PackStopped("failed"); }
  if (response.status === 429) throw new PackStopped("rate-limited");
  // A saved copy handed back by the worker is not a renewal.
  if (response.status !== 200 || response.headers.get(OFFLINE_HEADER) !== null || response.redirected || response.url !== url
    || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new PackStopped("failed");
  const text = await response.clone().text();
  if (text.length > JSON_LIMIT) throw new PackStopped("failed");
  const key = assetKey(url);
  if (!packAssetAllowed(key)) throw new PackStopped("failed");
  if (plan) { plan.json.set(key, response); plan.bytes += text.length; }
  try { return JSON.parse(text); } catch { throw new PackStopped("failed"); }
}
const parsed = <T>(work: () => T): T => { try { return work(); } catch { throw new PackStopped("failed"); } };

/** One passage: every text page and, with recordings on, every short-reference page and the clips they name. */
async function passage(io: PackerIo, source: PublicSource, signal: AbortSignal, plan: Plan, generation: number) {
  const kind = source.passage.kind;
  for (const { offset } of source.passage.pages) {
    const text = await fetchJson(io, publicTextPath(source.selector, kind, offset), signal, plan, generation);
    parsed(() => parsePublicTextPage(text, source, offset));
    if (!source.listening) continue;
    const short = await fetchJson(io, publicShortPath(source.selector, kind, offset), signal, plan, generation);
    for (const reference of parsed(() => parsePublicShortPage(short, source, offset)).references) {
      // Resolution-only clip sources: a parsed PocketTorah short-v1 path, never anything generated (G3).
      if (reference.source && packAssetAllowed(reference.source.path)) plan.clips.set(reference.source.path, reference.source);
    }
  }
}

async function planWeek(io: PackerIo, date: string, signal: AbortSignal, generation: number): Promise<Plan> {
  const plan: Plan = { label: "week", json: new Map(), clips: new Map(), bytes: 0 };
  const value = await fetchJson(io, publicReadingPath({ by: "date", date }), signal, plan, generation);
  const parsedWeek = parsed(() => parsePublicWeek(value, date));
  plan.label = parsedWeek.parashah ?? "week";
  for (const kind of ["torah", "haftarah"] as const) {
    const source = weekSource(parsedWeek, kind); if (!source) continue;
    await passage(io, source, signal, plan, generation);
    // Learn to lein's This week asks for the same passage by ref (verses-api.ts).
    const ref = source.passage.ranges.join("; ");
    if (canonicalReadingRef(ref, kind)) await passage(io, { selector: { by: "ref", ref, kind }, passage: source.passage, listening: source.listening }, signal, plan, generation);
  }
  return plan;
}
async function planCourse(io: PackerIo, signal: AbortSignal, generation: number): Promise<Plan> {
  const plan: Plan = { label: "course", json: new Map(), clips: new Map(), bytes: 0 };
  for (const kind of MELODIES) for (const ref of coursePassages(kind)) {
    if (purgeGeneration() !== generation) throw new PackStopped("purged");
    // The passage's paging, from the cheap, locally computed ref route (not stored: the course never asks for it).
    if (!canonicalReadingRef(ref, kind)) throw new PackStopped("failed");
    const body = await fetchJson(io, publicReadingPath({ by: "ref", ref, kind }), signal, null, generation);
    await passage(io, refSource(parsed(() => parsePublicRefReading(body, ref, kind))), signal, plan, generation);
  }
  return plan;
}

async function pool<T>(items: readonly T[], work: (item: T) => Promise<void>) {
  let next = 0, failure: unknown = null;
  await Promise.all(Array.from({ length: Math.min(PACK_CONCURRENCY, items.length) }, async () => {
    while (next < items.length && failure === null) { const item = items[next++]; try { await work(item); } catch (error) { failure = error; } }
  }));
  if (failure !== null) throw failure;
}

/** Builds or renews one pack. Resolves to the state the pack is in afterwards. */
export async function renewPack(io: PackerIo, descriptor: PackDescriptor, signal: AbortSignal): Promise<PackState> {
  const generation = purgeGeneration(), now = io.now();
  const plan = descriptor.type === "week" ? await planWeek(io, descriptor.date, signal, generation) : await planCourse(io, signal, generation);
  if (purgeGeneration() !== generation || signal.aborted) throw new PackStopped("purged");
  const cache = await io.caches.open(OFFLINE_CACHE);
  const missing: ShortReferenceSource[] = [];
  for (const source of plan.clips.values()) if (!await cache.match(io.origin + source.path)) missing.push(source);
  const needed = plan.bytes + missing.reduce((sum, source) => sum + source.bytes, 0);
  // A browser that cannot estimate its storage packs anyway; one that can is held to the budget.
  const { usage = 0, quota = 0 } = await io.estimate().catch(() => ({ usage: 0, quota: 0 }));
  if (quota > 0 && usage + needed > Math.min(BUDGET.quotaShare * quota, BUDGET.capBytes)) throw new PackStopped("no-space");
  const put = async (key: string, response: Response) => {
    if (purgeGeneration() !== generation || signal.aborted) throw new PackStopped("purged");
    await cache.put(io.origin + key, response);
  };
  await pool(missing, async source => {
    if (purgeGeneration() !== generation || signal.aborted) throw new PackStopped("purged");
    const url = io.origin + source.path;
    let response: Response;
    try { response = await io.fetch(url, { credentials: "omit", mode: "same-origin", redirect: "error", referrerPolicy: "no-referrer", cache: "force-cache", signal }); }
    catch { throw new PackStopped("failed"); }
    if (response.status === 429) throw new PackStopped("rate-limited");
    if (response.headers.get(OFFLINE_HEADER) !== null) throw new PackStopped("failed");
    const original = response.clone();
    // The same checks the player makes: exact URL, audio/mpeg, size and SHA-256 against the parsed source.
    try { await downloadShortReferenceAudio(source, signal, { origin: io.origin, fetch: async () => response, digest: io.digest }); }
    catch { throw new PackStopped("failed"); }
    await put(source.path, original);
  });
  // The JSON goes in only once every clip it names is stored, so a failed renewal never leaves new pages over old clips.
  for (const [key, response] of plan.json) await put(key, response);
  const assets = [...plan.json.keys(), ...plan.clips.keys()];
  if (!assets.every(packAssetAllowed)) throw new PackStopped("failed");
  if (purgeGeneration() !== generation || signal.aborted) throw new PackStopped("purged");
  const key = descriptor.type === "week" ? `week:${descriptor.date}` : "course";
  const pack: Pack = Object.freeze({ key, owner: "public", label: plan.label, descriptor, assets: Object.freeze(assets),
    bytes: plan.bytes + [...plan.clips.values()].reduce((sum, source) => sum + source.bytes, 0), renewedAt: now, expiresAt: now + WINDOW_MS, format: 1 });
  const index = await readIndex(cache);
  await writeIndex(cache, Object.freeze({ format: 1, packs: Object.freeze([...index.packs.filter(row => row.key !== key), pack]) }));
  return "saved";
}

/** Does a stored course pack hold the first text page of every fixed course passage this build asks for? */
export function coursePackCurrent(pack: Pick<Pack, "assets">, origin: string): boolean {
  const assets = new Set(pack.assets);
  return MELODIES.every(kind => coursePassages(kind).every(ref => assets.has(assetKey(origin + publicTextPath({ by: "ref", ref, kind }, kind, 0)))));
}

type Locks = { request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<void>): Promise<void> };
/**
 * Every online open of the installed app: sweep, drop last week's pack on rollover, then renew This week and the
 * course. Packing is idempotent; a pack that fails keeps its old expiry. Another tab packing: this one skips.
 */
export async function openOffline(io: PackerIo & { locks?: Locks | null }) {
  const controller = packingStarted(), date = thisShabbat(io.now()), weekKey = `week:${date}`;
  const run = async () => {
    const cache = await io.caches.open(OFFLINE_CACHE);
    await sweep(cache, io.now(), pack => pack.descriptor.type !== "week" || pack.key === weekKey);
    await refreshOfflineState(io.now(), weekKey);
    const fresh = await readIndex(cache);
    for (const [name, descriptor] of [["week", { type: "week", date }], ["course", { type: "course" }]] as const) {
      // A complete pack renewed in the last 12 hours is left alone, so moving between pages never re-asks the public routes
      // (their firewall allows 120 requests a minute per address). Decided here: renewal is at most twice a day.
      const current = fresh.packs.find(pack => pack.key === (name === "week" ? weekKey : "course"));
      // A course pack built from an older set of fixed passages (a release that moved them, 1.6) is renewed at once.
      if (current && io.now() - current.renewedAt < RENEW_AFTER_MS && (name !== "course" || coursePackCurrent(current, io.origin)) && await inspectPack(cache, current, io.now(), io.origin) === "saved") continue;
      setOfflineState({ [name]: "saving" });
      try { await renewPack(io, descriptor, controller.signal); }
      catch (error) {
        if (error instanceof PackStopped && error.reason === "no-space") setOfflineState({ [name]: "no-space" });
        if (error instanceof PackStopped && (error.reason === "rate-limited" || error.reason === "purged")) break;
      }
      finally { await refreshOfflineState(io.now(), weekKey); }
    }
  };
  const generation = purgeGeneration();
  const guarded = async () => { if (purgeGeneration() === generation) await run(); };
  await trackPacking(io.locks ? io.locks.request("crc-offline", { ifAvailable: true }, async lock => { if (lock) await guarded(); else await refreshOfflineState(io.now(), weekKey); }) : guarded());
}
