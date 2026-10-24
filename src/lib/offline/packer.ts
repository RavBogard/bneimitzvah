import { MELODIES } from "../learn/course";
import { canonicalReadingRef } from "../readings/reading-ref";
import { thisShabbat } from "../readings/public-shabbat";
import { downloadShortReferenceAudio } from "../reference-audio/short-playback";
import type { ShortReferenceSource } from "../reference-audio/short-source";
import { coursePassages } from "../../components/learn/verses-api";
import { parsePublicRefReading, parsePublicShortPage, parsePublicTextPage, parsePublicWeek, refSource, weekSource, type PublicSource } from "../../components/portal/public-reading/api";
import { publicReadingPath, publicShortPath, publicTextPath } from "../../components/portal/public-reading/urls";
import { BUDGET, OFFLINE_CACHE, OFFLINE_PACKS_PATH, OWNER_KEY, RENEW_AFTER_MS, OFFLINE_HEADER, PACK_CONCURRENCY, packAssetAllowed, WINDOW_MS, type Pack, type PackDescriptor } from "./policy";
import { assetKey, inspectPack, packingStarted, purgeGeneration, readIndex, refreshOfflineState, setOfflineState, sweep, trackPacking, writeIndex, type PackState } from "./pack-index";

/**
 * The packer (§3.3–§3.5). It runs in the page, never the worker, and only in the installed app on the torah origin.
 * Two public packs, both owner "public": This week (the week's reading, its text and short-reference pages, both by
 * date for Lein and by ref for Learn's This week, and every clip they name) and the Learn to lein course (F3: every
 * fixed course passage's text and short pages and clips). Everything is fetched with no cookie, three at a time.
 * A clip is stored only after its size and SHA-256 match its parsed PocketTorah short-v1 source; the original
 * network response is stored, so its URL and attribution headers survive. A pack's renewedAt moves only when every
 * step succeeded; a 429 stops packing until the next open.
 *
 * A2 adds owner packs: the signed-in person's own readings, named (descriptors only) by the private
 * /api/offline/packs, and fetched exactly like the public packs, from the public ref routes with no cookie. Each
 * open asks the endpoint first: another owner than the device's means every pack goes (the sign-out purge); 401
 * or 403 means the owner packs go and the public ones stay; anything else changes nothing.
 */
export class PackStopped extends Error { constructor(readonly reason: "rate-limited" | "no-space" | "purged" | "failed") { super(reason); } }
export type PackerIo = Readonly<{
  origin: string; fetch: typeof fetch; caches: CacheStorage; now(): number;
  estimate(): Promise<{ usage?: number; quota?: number }>;
  digest?: Parameters<typeof downloadShortReferenceAudio>[2]["digest"];
  /** Whose own readings this device may keep (A2). Left out, the owner packs are left as they are. */
  owner?: (signal: AbortSignal) => Promise<OwnerAnswer>;
}>;
export type OwnerPack = Readonly<{ kind: "torah" | "haftarah"; ref: string; name: string | null }>;
export type OwnerAnswer = Readonly<{ state: "owner"; owner: string; packs: readonly OwnerPack[] }> | Readonly<{ state: "signed-out" }> | Readonly<{ state: "unknown" }>;
const UNKNOWN: OwnerAnswer = Object.freeze({ state: "unknown" });
const OWNER_PACKS = 8;

/** The endpoint's answer, strictly: 401 or 403 is signed out; a 200 that is not exactly the closed shape changes nothing. */
export function parseOwnerAnswer(status: number, body: unknown): OwnerAnswer {
  if (status === 401 || status === 403) return Object.freeze({ state: "signed-out" });
  if (status !== 200 || !body || typeof body !== "object" || Array.isArray(body)) return UNKNOWN;
  const row = body as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== "owner,packs" || typeof row.owner !== "string" || !OWNER_KEY.test(row.owner) || !Array.isArray(row.packs) || row.packs.length > OWNER_PACKS) return UNKNOWN;
  const packs: OwnerPack[] = [];
  for (const raw of row.packs) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return UNKNOWN;
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).sort().join() !== "kind,name,ref" || (p.kind !== "torah" && p.kind !== "haftarah") || typeof p.ref !== "string") return UNKNOWN;
    const canonical = canonicalReadingRef(p.ref, p.kind);
    if (!canonical || canonical.ref !== p.ref) return UNKNOWN;
    if (p.name !== null && (typeof p.name !== "string" || p.name.length < 1 || p.name.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(p.name))) return UNKNOWN;
    packs.push(Object.freeze({ kind: p.kind, ref: p.ref, name: p.name as string | null }));
  }
  return Object.freeze({ state: "owner", owner: row.owner, packs: Object.freeze(packs) });
}
/** Asks the private endpoint with the session cookie, never stored (no-store, and the worker does not handle it). */
export async function askOwner(io: Pick<PackerIo, "origin" | "fetch">, signal: AbortSignal): Promise<OwnerAnswer> {
  const url = io.origin + OFFLINE_PACKS_PATH;
  try {
    const response = await io.fetch(url, { headers: { accept: "application/json" }, credentials: "same-origin", mode: "same-origin", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal });
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return parseOwnerAnswer(response.status, null); }
    if (response.redirected || response.url !== url || response.headers.get(OFFLINE_HEADER) !== null || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return UNKNOWN;
    const text = await response.text();
    if (text.length > 64 * 1024) return UNKNOWN;
    return parseOwnerAnswer(200, JSON.parse(text));
  } catch { return UNKNOWN; }
}
/** A short, stable key for an owner pack (the index caps keys at 64 characters): FNV-1a over kind and ref, twice. */
export function ownerPackKey(kind: "torah" | "haftarah", ref: string): string {
  const text = `${kind}:${ref}`;
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x0100019d) >>> 0; }
  return `ref:${kind}:${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
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

/** One of this person's own readings, by ref: the reading route (the reader asks it), and every page and clip. */
async function planRef(io: PackerIo, kind: "torah" | "haftarah", ref: string, signal: AbortSignal, generation: number): Promise<Plan> {
  const canonical = canonicalReadingRef(ref, kind);
  if (!canonical || canonical.ref !== ref) throw new PackStopped("failed");
  const plan: Plan = { label: "", json: new Map(), clips: new Map(), bytes: 0 };
  const body = await fetchJson(io, publicReadingPath({ by: "ref", ref, kind }), signal, plan, generation);
  await passage(io, refSource(parsed(() => parsePublicRefReading(body, ref, kind))), signal, plan, generation);
  return plan;
}

async function pool<T>(items: readonly T[], work: (item: T) => Promise<void>) {
  let next = 0, failure: unknown = null;
  await Promise.all(Array.from({ length: Math.min(PACK_CONCURRENCY, items.length) }, async () => {
    while (next < items.length && failure === null) { const item = items[next++]; try { await work(item); } catch (error) { failure = error; } }
  }));
  if (failure !== null) throw failure;
}

/** Builds or renews one pack. Resolves to the state the pack is in afterwards. An owner pack names its owner and label. */
export async function renewPack(io: PackerIo, descriptor: PackDescriptor, signal: AbortSignal, own?: Readonly<{ owner: string; label: string }>): Promise<PackState> {
  const generation = purgeGeneration(), now = io.now();
  if ((descriptor.type === "ref") !== (own !== undefined) || (own && !OWNER_KEY.test(own.owner))) throw new PackStopped("failed");
  const plan = descriptor.type === "week" ? await planWeek(io, descriptor.date, signal, generation)
    : descriptor.type === "ref" ? await planRef(io, descriptor.kind, descriptor.ref, signal, generation) : await planCourse(io, signal, generation);
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
  const key = descriptor.type === "week" ? `week:${descriptor.date}` : descriptor.type === "ref" ? ownerPackKey(descriptor.kind, descriptor.ref) : "course";
  const pack: Pack = Object.freeze({ key, owner: own ? own.owner : "public", label: own ? own.label : plan.label, descriptor, assets: Object.freeze(assets),
    bytes: plan.bytes + [...plan.clips.values()].reduce((sum, source) => sum + source.bytes, 0), renewedAt: now, expiresAt: now + WINDOW_MS, format: 1 });
  const index = await readIndex(cache);
  // An owner pack joins only its own owner's index: an account switch since this pack began means it is not kept.
  if (own && index.owner !== own.owner) throw new PackStopped("purged");
  await writeIndex(cache, Object.freeze({ format: 1, owner: index.owner, packs: Object.freeze([...index.packs.filter(row => row.key !== key), pack]) }));
  return "saved";
}

type Locks = { request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<void>): Promise<void> };
/**
 * Every online open of the installed app: sweep, drop last week's pack on rollover, then renew This week and the
 * course. Packing is idempotent; a pack that fails keeps its old expiry. Another tab packing: this one skips.
 */
export async function openOffline(io: PackerIo & { locks?: Locks | null }) {
  const controller = packingStarted(), date = thisShabbat(io.now()), weekKey = `week:${date}`;
  const run = async () => {
    let cache = await io.caches.open(OFFLINE_CACHE);
    // A2: whose own readings this device keeps, asked before anything is packed.
    const answer = io.owner ? await io.owner(controller.signal).catch(() => UNKNOWN) : UNKNOWN;
    if (purgeGeneration() !== generation || controller.signal.aborted) return;
    const before = await readIndex(cache);
    if (answer.state === "owner" && before.owner !== null && before.owner !== answer.owner) {
      // Another account's packs: everything goes, the public packs too, exactly as at a sign-out; then this owner's are packed.
      await io.caches.delete(OFFLINE_CACHE);
      setOfflineState({ week: null, course: null, savedUntil: null });
      cache = await io.caches.open(OFFLINE_CACHE);
    }
    const listed = new Set(answer.state === "owner" ? answer.packs.map(pack => ownerPackKey(pack.kind, pack.ref)) : []);
    await sweep(cache, io.now(), pack => (pack.descriptor.type !== "week" || pack.key === weekKey) && (pack.owner === "public" || answer.state === "unknown" || listed.has(pack.key)),
      answer.state === "owner" ? answer.owner : answer.state === "signed-out" ? null : undefined);
    if (answer.state !== "unknown") setOfflineState({ ownerChecked: true });
    await refreshOfflineState(io.now(), weekKey);
    const fresh = await readIndex(cache);
    type Job = Readonly<{ key: string; descriptor: PackDescriptor; state?: "week" | "course"; own?: Readonly<{ owner: string; label: string }> }>;
    const own: Job[] = answer.state === "owner" ? answer.packs.map(pack => ({ key: ownerPackKey(pack.kind, pack.ref), descriptor: Object.freeze({ type: "ref" as const, kind: pack.kind, ref: pack.ref }),
      own: Object.freeze({ owner: answer.owner, label: pack.name ?? "" }) })) : [];
    // This week first, then the person's own readings, then the course.
    const jobs: Job[] = [{ key: weekKey, descriptor: { type: "week", date }, state: "week" }, ...own, { key: "course", descriptor: { type: "course" }, state: "course" }];
    for (const job of jobs) {
      // A complete pack renewed in the last 12 hours is left alone, so moving between pages never re-asks the public routes
      // (their firewall allows 120 requests a minute per address). Decided here: renewal is at most twice a day.
      const current = fresh.packs.find(pack => pack.key === job.key);
      if (current && (!job.own || current.label === job.own.label) && io.now() - current.renewedAt < RENEW_AFTER_MS && await inspectPack(cache, current, io.now(), io.origin) === "saved") continue;
      if (job.state) setOfflineState({ [job.state]: "saving" });
      try { await renewPack(io, job.descriptor, controller.signal, job.own); }
      catch (error) {
        if (error instanceof PackStopped && error.reason === "no-space" && job.state) setOfflineState({ [job.state]: "no-space" });
        if (error instanceof PackStopped && (error.reason === "rate-limited" || error.reason === "purged")) break;
      }
      finally { await refreshOfflineState(io.now(), weekKey); }
    }
  };
  const generation = purgeGeneration();
  const guarded = async () => { if (purgeGeneration() === generation) await run(); };
  await trackPacking(io.locks ? io.locks.request("crc-offline", { ifAvailable: true }, async lock => { if (lock) await guarded(); else await refreshOfflineState(io.now(), weekKey); }) : guarded());
}
