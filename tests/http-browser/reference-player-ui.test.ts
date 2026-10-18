import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyRequest } from "../../src/server/study/types";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { shortSourceFFmpegMetadataArgs } from "../../src/lib/reference-audio/short-source-tags";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

declare global { interface Window { referenceAudios: HTMLAudioElement[]; referenceRevoked: string[]; referencePageFetches: { ownerOrdinal: number; signal: AbortSignal | null; success: boolean; failed: boolean }[]; referenceBlobKinds: Record<string, "prime" | "word" | "verse"> } }
type TrackedWindow = Window;
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let directory: string | undefined, audioBytes: Buffer, shortBytes: Buffer, shortPath: string, siblingId: string;
const contexts: BrowserContext[] = [], archiveUrl = "https://archive.org/download/PockettorahAudioFiles/Synthetic-player.mp3";
function mainStudyPage(request: StudyRequest) {
  const page = syntheticUiStudyPage(request);
  return { ...page, verses: page.verses.map(verse => ({ ...verse, hebrew: normalizeHebrew('אָ֑ב־<span class="mam-kq"><span class="mam-kq-k">זָ</span><span class="mam-kq-q">[גַּ]</span></span><span class="mam-spi-samekh">{ס}</span>') })) };
}
const sourceAsset = "ra_" + "7".repeat(32);
async function api(tab: Page, path: string, body: unknown) {
  return tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.status; }, { path, body });
}
async function page(mobile = false, who: "admin" | "tutor" = "admin", authenticated?: BrowserContext) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false,
    ...(authenticated ? { storageState: await authenticated.storageState() } : {}) }); contexts.push(context);
  const state = { requests: 0, shortRequests: 0, archiveRequests: 0, pageRequests: 0, corrupt: false, held: null as null | { release(): void; started: Promise<void> }, sawCookie: false, sawReferer: false };
  await context.addInitScript(() => {
    const target = window as TrackedWindow; target.referenceAudios = []; target.referenceRevoked = []; target.referenceBlobKinds = {}; target.referencePageFetches = [];
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!url.pathname.endsWith("/reference-audio/short/page")) return fetchOriginal(input, init);
      const record = { ownerOrdinal: target.referenceAudios.length, signal: init?.signal ?? (input instanceof Request ? input.signal : null), success: false, failed: false }; target.referencePageFetches.push(record);
      return fetchOriginal(input, init).then(response => { record.success = response.ok; return response; }, error => { record.failed = true; throw error; });
    };
    const AudioConstructor = window.Audio;
    window.Audio = new Proxy(AudioConstructor, { construct(original, args) { const audio = Reflect.construct(original, args) as HTMLAudioElement; target.referenceAudios.push(audio); return audio; } });
    const revoke = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = url => { target.referenceRevoked.push(url); revoke(url); };
    const create = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { const url = create(blob); target.referenceBlobKinds[url] = blob instanceof Blob && blob.type === "audio/wav" ? blob.size === 204 ? "prime" : "word" : "verse"; return url; };
  });
  let release!: () => void, began!: () => void;
  const gate = new Promise<void>(yes => { release = yes; }), started = new Promise<void>(yes => { began = yes; });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/reference-audio/short/page")) state.pageRequests++;
    if (url.href === archiveUrl || url.origin === BROWSER_ORIGIN && url.pathname === shortPath) {
      state.requests++; const headers = await request.allHeaders(); state.sawCookie ||= Boolean(headers.cookie); state.sawReferer ||= Boolean(headers.referer);
      const source = url.href === archiveUrl ? audioBytes : shortBytes; if (url.href === archiveUrl) state.archiveRequests++; else state.shortRequests++;
      if (state.held) { began(); await gate; }
      const body = state.corrupt ? Buffer.from(source.map((value, index) => index === 200 ? value ^ 1 : value)) : source;
      try { await route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "access-control-allow-origin": BROWSER_ORIGIN, "content-length": String(body.length), "cache-control": "no-store" }, body }); } catch { /* Scope teardown may abort the routed request. */ }
    } else if (url.origin === BROWSER_ORIGIN) await route.continue(); else await route.abort();
  });
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!authenticated) { const email = `pg-${who}@example.test`; expect(await api(tab, "/api/auth/sign-in/magic-link", { email })).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); }
  await tab.goto(`/workspace/${who === "admin" ? "admin/students" : "tutor"}/${fixture.student.id}${who === "admin" ? "/reading" : ""}`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  const owner = await settledOwner(tab);
  return { tab, state, owner, hold() { state.held = { release, started }; return state.held; } };
}
const player = (tab: Page) => tab.getByRole("region", { name: "Reading playback", exact: true });
const word = (tab: Page, verse: number, index: number) => tab.locator(`.study-verses [data-verse-ref="Genesis 1:${verse}"] [data-word-index="${index}"]`).first();
async function playing(tab: Page) {
  // The synchronous gesture primer can play before any authorized source loads.
  await expect.poll(async () => { const current = await native(tab); return (current.kind === "verse" || current.kind === "word") && current.paused === false && (current.readyState ?? 0) >= 2; }).toBe(true);
  await ui(player(tab).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
}
async function native(tab: Page) { return tab.evaluate(() => { const w = window as TrackedWindow, a = w.referenceAudios.at(-1); return { pageIssued: w.referencePageFetches.length, pageSuccessful: w.referencePageFetches.filter(fetch => fetch.success).length, pageAborted: w.referencePageFetches.filter(fetch => fetch.signal?.aborted).length, pageFailed: w.referencePageFetches.filter(fetch => fetch.failed).length, ordinalPageSuccessful: w.referencePageFetches.filter(fetch => fetch.success && fetch.ownerOrdinal === w.referenceAudios.length).length, count: w.referenceAudios.length, ordinal: a ? w.referenceAudios.indexOf(a) + 1 : 0, retiredClean: w.referenceAudios.slice(0, -1).every(audio => audio.paused && !audio.getAttribute("src")), allClean: w.referenceAudios.every(audio => audio.paused && !audio.getAttribute("src")), paused: a?.paused, readyState: a?.readyState, duration: a?.duration, kind: a?.src ? w.referenceBlobKinds[a.src] : undefined, currentTime: a?.currentTime, rate: a?.playbackRate, preservesPitch: a?.preservesPitch, src: a?.getAttribute("src"),
  revoked: w.referenceRevoked.filter(url => w.referenceBlobKinds[url] !== "prime").length, primeRevoked: w.referenceRevoked.filter(url => w.referenceBlobKinds[url] === "prime").length,
  mediaBlobs: Object.values(w.referenceBlobKinds).filter(kind => kind !== "prime").length }; }); }

// StrictMode may retire an initial effect owner. Pin the settled current owner,
// then forbid constructor growth or identity changes within that owner's lifetime.
async function settledOwner(tab: Page) {
  await tab.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const current = await native(tab);
  expect(current.ordinal).toBe(current.count); expect(current.ordinal).toBeGreaterThan(0); expect(current.retiredClean).toBe(true);
  return { count: current.count, ordinal: current.ordinal };
}
async function sameOwner(tab: Page, owner: { count: number; ordinal: number }) {
  expect(await native(tab)).toMatchObject({ ...owner, retiredClean: true });
}

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  const isolated = await isolatedEnv();
  try {
    directory = await mkdtemp(join(tmpdir(), "reference-player-audio-"));
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Synthetic audio path refused");
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=8", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", join(directory, "synthetic.mp3")], { env: isolated.env, windowsHide: true, timeout: 15000, maxBuffer: 4096 });
    audioBytes = await readFile(join(directory, "synthetic.mp3"));
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", join(directory, "synthetic.mp3"), "-ss", "1", "-t", "4", "-map_metadata", "-1", "-codec:a", "libmp3lame", "-b:a", "64k", "-id3v2_version", "3", "-write_id3v1", "0", "-write_xing", "1", ...shortSourceFFmpegMetadataArgs(), join(directory, "synthetic-short.mp3")], { env: isolated.env, windowsHide: true, timeout: 15000, maxBuffer: 4096 });
    shortBytes = await readFile(join(directory, "synthetic-short.mp3"));
  } catch { throw new Error("Runtime synthetic audio generation failed; details withheld"); } finally { await isolated.cleanup(); }
  const sample = mainStudyPage({ kind: "torah", ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], offset: 0, translation: "jps2023" });
  const digest = createHash("sha256").update(audioBytes).digest("hex");
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: sourceAsset, archiveFile: "Synthetic-player.mp3", sha256: digest, bytes: audioBytes.length,
    verses: sample.verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); if (projection.status !== "ready" || projection.projection.words.length !== 2) throw new Error("Synthetic word projection refused");
      return { schema: "reference-verse/v1", ref: verse.ref, table: "torah", playback: { status: "ready", asset: sourceAsset, clip: { start: 1, end: 5 } }, words: { status: "ready", readingTextSha256: createHash("sha256").update(verse.hebrew.readingText.normalize("NFC")).digest("hex"), starts: [1.1, 3] }, attribution: REFERENCE_ATTRIBUTION }; }) }] });
  if (!catalog) throw new Error("Synthetic reference catalog refused");
  const shortSHA = createHash("sha256").update(shortBytes).digest("hex"); shortPath = `/reference-audio/short-v1/${shortSHA}.mp3`;
  const source = { schema: "reference-short-source/v1", id: `rs_${shortSHA}`, parent: { asset: sourceAsset, sha256: digest, bytes: audioBytes.length }, sha256: shortSHA, bytes: shortBytes.length, path: shortPath,
    codec: "mp3", bitrate: 64000, sampleRate: 24000, channels: 1, presentationFrames: 96000, origin: { firstFrame: 24000, parentRate: 24000 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version };
  const parentBytes = new TextEncoder().encode(JSON.stringify(catalog)), parentSHA = createHash("sha256").update(parentBytes).digest("hex");
  const manifestBytes = new TextEncoder().encode(JSON.stringify({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: parentSHA, recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: [source] }));
  const manifest = await createShortSourceManifestLoader({ sha256: createHash("sha256").update(manifestBytes).digest("hex"), parentCatalogSHA256: parentSHA, parentCatalogBytes: parentBytes,
    get: async () => new ReadableStream({ start(c) { c.enqueue(manifestBytes); c.close(); } }) })();
  fixture = await browserFixture({ studyLoad: async request => mainStudyPage(request), referenceCatalogLoad: async () => catalog, referenceShortManifestLoad: async () => manifest, referenceStudentRelease: true });
  siblingId = (await fixture.practice()).sibling.id;
  const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  for (const studentId of [fixture.student.id, siblingId]) {
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: member.id, proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
  }
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.();
  if (directory && resolve(directory).startsWith(resolve(tmpdir()) + sep)) await rm(directory, { recursive: true, force: true });
}, 120_000);


it("plays whole verses from main-text words, verifies explicit word offsets/loops/pitch and reuses one adjacent-verse asset", async () => {
  const { tab, state, owner } = await page();
  await sameOwner(tab, owner); expect(state.requests).toBe(0); expect(await native(tab)).toMatchObject({ paused: true, src: null, mediaBlobs: 0, retiredClean: true }); await ui(tab.locator(".study-verses .verse-card")).toHaveCount(0);
  await word(tab, 1, 1).click(); await playing(tab); expect(state.requests).toBe(1); expect(state.archiveRequests).toBe(0);
  const prepared = await native(tab), issuedPages = state.pageRequests;
  const pageCounts = { pageIssued: prepared.pageIssued, pageSuccessful: prepared.pageSuccessful, pageAborted: prepared.pageAborted, pageFailed: prepared.pageFailed };
  console.log("Reference page counters: " + JSON.stringify({ stage: "verified-ready", ...pageCounts, networkIssued: issuedPages, audioOrdinal: prepared.ordinal }));
  const firstNativeSrc = (await native(tab)).src;
  expect(typeof firstNativeSrc === "string" && firstNativeSrc.startsWith("blob:")).toBe(true);
  expect(Math.round((await native(tab)).duration! * 24000)).toBe(96000); expect((await native(tab)).kind).toBe("verse");
  expect((await native(tab)).currentTime).toBeGreaterThanOrEqual(0); expect((await native(tab)).currentTime).toBeLessThan(1);
  await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse"); await ui(word(tab, 1, 0)).toHaveAttribute("data-reference-active", "true");
  await tab.getByRole("button", { name: "Word tools", exact: true }).click(); await ui(tab.getByText("Genesis 1:1 · Word 2 of 2", { exact: true })).toBeVisible(); await tab.getByRole("button", { name: "Word tools", exact: true }).click();
  expect(state.sawCookie || state.sawReferer).toBe(false); await ui(tab.getByRole("dialog")).toHaveCount(0);
  await player(tab).getByLabel("Speed", { exact: true }).selectOption("0.5"); expect(await native(tab)).toMatchObject({ rate: 0.5, preservesPitch: true });
  await player(tab).getByLabel("Practice", { exact: true }).selectOption("1"); await playing(tab); expect((await native(tab)).currentTime).toBeGreaterThanOrEqual(0); expect((await native(tab)).currentTime).toBeLessThan(1);
  expect(Math.round((await native(tab)).duration! * 24000)).toBe(48000); expect((await native(tab)).kind).toBe("word"); await sameOwner(tab, owner); await player(tab).getByRole("button", { name: "Repeat", exact: true }).click();
  await tab.evaluate(() => { (window as TrackedWindow).referenceAudios.at(-1)!.currentTime = 1.96; });
  await expect.poll(async () => { const time = (await native(tab)).currentTime ?? 9; return time >= 0 && time < 0.6; }).toBe(true);
  await sameOwner(tab, owner); await word(tab, 2, 0).click(); await playing(tab); await ui(player(tab)).toContainText("Genesis 1:2");
  expect(state.requests).toBe(1); expect(state.pageRequests).toBe(issuedPages); const finalPageCounts = await native(tab); console.log("Reference page counters: " + JSON.stringify({ stage: "after-selection-reuse", pageIssued: finalPageCounts.pageIssued, pageSuccessful: finalPageCounts.pageSuccessful, pageAborted: finalPageCounts.pageAborted, pageFailed: finalPageCounts.pageFailed, networkIssued: state.pageRequests, audioOrdinal: finalPageCounts.ordinal })); expect(finalPageCounts).toMatchObject({ pageIssued: prepared.pageIssued, pageSuccessful: prepared.pageSuccessful }); expect(state.archiveRequests).toBe(0); expect(await native(tab)).toMatchObject({ ...owner, retiredClean: true, revoked: 2, rate: 0.5 }); await ui(player(tab).getByRole("button", { name: "Repeat", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await native(tab)).src !== firstNativeSrc).toBe(true); // Physical Word WAV replaced the first MP3 lease; the same Audio/body remain.
  await ui(word(tab, 2, 0)).toHaveAttribute("data-reference-active", "true");
  await player(tab).getByRole("button", { name: "Pause", exact: true }).click(); expect((await native(tab)).paused).toBe(true);
});
it("supports colors-off qere/maqaf and keyboard whole-verse playback in the phone main text", async () => {
  const { tab, state, owner } = await page(true, "admin", contexts[0]);
  const clearance = await tab.evaluate(() => {
    const toolbar = document.querySelector(".reading-toolbar")!, flow = document.querySelector(".study-verses")!;
    return { position: getComputedStyle(toolbar).position, bottom: toolbar.getBoundingClientRect().bottom, top: flow.getBoundingClientRect().top, bars: document.querySelectorAll(".reading-toolbar").length };
  });
  expect(clearance.position).toBe("static"); expect(clearance.bars).toBe(1); expect(clearance.bottom).toBeLessThanOrEqual(clearance.top);
  await tab.getByRole("button", { name: "Colors", exact: true }).click(); await ui(tab.locator(".study-verses [data-family]")).toHaveCount(0);
  const qere = tab.locator('.study-verses [data-verse-ref="Genesis 1:1"] .study-read-alternative [data-word-index="1"]');
  await ui(qere).toHaveAttribute("aria-label", "Hear whole verse Genesis 1:1; select word 2 for tools");
  await qere.focus(); await qere.press("Enter"); await playing(tab); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
  expect((await native(tab)).currentTime).toBeGreaterThanOrEqual(0); expect((await native(tab)).currentTime).toBeLessThan(1);
  await tab.evaluate(() => { const audio = (window as TrackedWindow).referenceAudios.at(-1)!; audio.currentTime = 2.2; audio.dispatchEvent(new Event("timeupdate")); }); await ui(qere).toHaveAttribute("data-reference-active", "true");
  await qere.press("Space"); await playing(tab); expect((await native(tab)).currentTime).toBeLessThan(1);
  await ui(tab.locator('.study-verses .study-alternative > span:first-child [data-word-index]')).toHaveCount(0);
  expect(await tab.locator('.study-verses [data-verse-ref="Genesis 1:1"]').innerText()).toContain("־");
  await tab.getByRole("button", { name: "Hear Genesis 1:2", exact: true }).click(); await playing(tab); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
  await sameOwner(tab, owner); expect(state.requests).toBe(1); expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const grouped = await player(tab).getByLabel("Speed", { exact: true }).evaluate(node => {
    const label = document.querySelector(`label[for="${node.id}"]`)!;
    return label.parentElement === node.parentElement && Math.abs(label.getBoundingClientRect().left - node.getBoundingClientRect().left) < 1 && label.getBoundingClientRect().bottom <= node.getBoundingClientRect().top;
  }); expect(grouped).toBe(true);
});
it("latest held selection wins; changed page and corrupt bytes never create or revive obsolete media", async () => {
  const { tab, state, hold, owner } = await page(false, "admin", contexts[0]), held = hold();
  await word(tab, 1, 0).click(); await held.started; await word(tab, 2, 1).click(); held.release(); await playing(tab);
  await ui(player(tab)).toContainText("Genesis 1:2"); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse"); await sameOwner(tab, owner); expect((await native(tab)).currentTime).toBeLessThan(2);
  await tab.reload(); await ui(tab.locator(".study-verses")).toBeVisible(); state.held = null; state.corrupt = true; const corruptOwner = await settledOwner(tab);
  await word(tab, 1, 0).click(); await ui(player(tab).getByText("The recording couldn’t be loaded. Try again.", { exact: true })).toBeVisible(); expect(await native(tab)).toMatchObject({ ...corruptOwner, paused: true, src: null, mediaBlobs: 0, retiredClean: true });
});
it("backgrounding pauses/cancels without erasing text or resuming on return; role and child switches dispose media", async () => {
  const { tab, state, owner } = await page(false, "tutor"); await word(tab, 1, 0).click(); await playing(tab);
  const reading = tab.locator(".study-verses");
  await tab.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(async () => (await native(tab)).revoked).toBe(1); expect(await native(tab)).toMatchObject({ paused: true, src: null, allClean: true }); await ui(reading).toBeVisible();
  await tab.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await ui(reading).toBeVisible(); await sameOwner(tab, owner); expect(state.requests).toBe(1);
  await word(tab, 1, 1).click(); await playing(tab); expect(state.requests).toBe(2); await sameOwner(tab, owner); // Scope suspension cleared private metadata and compressed ownership.
  await tab.getByRole("link", { name: "Parent", exact: true }).click(); await expect.poll(async () => (await native(tab)).revoked).toBe(2); expect(await native(tab)).toMatchObject({ paused: true, allClean: true });
  await ui(tab.getByLabel("Child", { exact: true })).toBeVisible(); await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click(); await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click();
  await ui(tab.locator(".study-verses")).toBeVisible(); const childOwner = await settledOwner(tab); await word(tab, 1, 0).click(); await playing(tab); await sameOwner(tab, childOwner);
  await tab.getByRole("button", { name: "Switch practice to Synthetic Sibling", exact: true }).click(); await ui(tab.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible();
  expect(await native(tab)).toMatchObject({ paused: true, src: null, revoked: 3, allClean: true, retiredClean: true });
});
it("clears playback on real session denial while quiet unchanged checks retain the passage", async () => {
  const { tab } = await page(false, "admin", contexts[0]); await word(tab, 1, 0).click(); await playing(tab);
  await tab.context().clearCookies(); await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await native(tab)).revoked).toBe(1); expect(await native(tab)).toMatchObject({ paused: true, src: null, allClean: true }); await ui(player(tab)).toHaveCount(0);
});
it("Start and Hear play the main verse and never require or reopen the optional close-up", async () => {
  const { tab, state, owner } = await page(false, "admin", contexts[0]), tabs = tab.getByRole("tablist", { name: "Student page" }), service = tabs.getByRole("tab", { name: "Service parts", exact: true }), reading = tabs.getByRole("tab", { name: "Reading", exact: true });
  await service.click(); await ui(service).toHaveAttribute("aria-selected", "true"); await tab.getByRole("button", { name: "Practice up close", exact: true }).click();
  await ui(reading).toHaveAttribute("aria-selected", "true"); await playing(tab); await ui(tab.getByRole("dialog")).toHaveCount(0); expect(state.requests).toBe(1); expect(state.shortRequests).toBe(1); expect(state.archiveRequests).toBe(0);
  await service.click(); await expect.poll(async () => (await native(tab)).revoked).toBe(1); expect((await native(tab)).paused).toBe(true);
  await reading.click(); expect(await native(tab)).toMatchObject({ ...owner, paused: true, src: null, retiredClean: true });
  await tab.getByRole("button", { name: "Close-up", exact: true }).click(); await playing(tab); expect(state.shortRequests).toBe(2); expect(state.archiveRequests).toBe(0); expect(state.requests).toBe(2); await sameOwner(tab, owner); await ui(tab.getByRole("dialog")).toHaveCount(0);
});
it("plays main verses without word timing but refuses explicit untimed word drills", async () => {
  const { tab } = await page(false, "admin", contexts[0]);
  await tab.route("**/reference-audio/short/page?**", async route => { const actual = await route.fetch(), body = await actual.json(); for (const reference of body.page.references) reference.verse.words = { status: "unavailable", reason: "no-words" }; await route.fulfill({ response: actual, json: body }); });
  await tab.reload(); await ui(tab.locator(".study-verses")).toBeVisible(); const untimedOwner = await settledOwner(tab); // Install the control before the new owner's optional metadata preparation.
  await word(tab, 1, 1).click(); await playing(tab); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
  await ui(tab.locator('.study-verses [data-reference-active="true"]')).toHaveCount(0);
  await player(tab).getByLabel("Practice", { exact: true }).selectOption("1"); await ui(player(tab).getByText(/Choose Whole verse to listen/)).toBeVisible(); expect((await native(tab)).paused).toBe(true);
  await ui(player(tab).getByRole("button", { name: "Play", exact: true })).toBeDisabled(); await ui(player(tab).getByRole("button", { name: "Repeat", exact: true })).toBeDisabled();
  await player(tab).getByLabel("Practice", { exact: true }).selectOption("verse"); await playing(tab);
  await tab.getByRole("button", { name: "Word tools", exact: true }).click(); await tab.getByRole("button", { name: "Hear this word", exact: true }).click();
  await expect.poll(async () => (await native(tab)).paused).toBe(true); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("1"); await ui(player(tab).getByRole("button", { name: "Play", exact: true })).toBeDisabled(); await sameOwner(tab, untimedOwner);
});
