import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generateSyntheticShortAudio, syntheticShortReferences } from "./synthetic-short-reference";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { browserFixture } from "./fixture";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { syntheticCourseRoutes } from "../../e2e/learn-synthetic";
import { finishLesson } from "../../e2e/learn-drill";
import { rateLimit } from "../../src/server/db/auth-schema";
vi.mock("server-only", () => ({}));
declare global { interface Window { offlineAudios: HTMLAudioElement[] } }

// The installable app on the isolated server (1.5 plan §6.2). Chromium with service workers allowed; the loopback-only
// seam crc.offline.force-installed stands in for display-mode standalone, which Playwright cannot emulate. Invented
// syllables, generated tones and synthetic clip bytes only; synthetic people only.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, directory: string | undefined;
const shortBodies = new Map<string, Buffer>(), contexts: BrowserContext[] = [];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const SEAM = "crc.offline.force-installed", OFFLINE_CACHE = "crc-offline-v1", INDEX = "/__crc_offline__/index";
beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  directory = await realpath(await mkdtemp(join(tmpdir(), "offline-ui-audio-")));
  const tone = await generateSyntheticShortAudio(directory, "torah", 440);
  const ranges = ["Genesis 1:1-6:8"], refs = expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS);
  const text = syntheticUiStudyPage({ kind: "torah", ranges, verses: refs, offset: 0, translation: "jps2023" }).verses[0].hebrew;
  const projection = projectStudyVerse(refs[0], text); if (projection.status !== "ready") throw Error("Synthetic projection refused");
  const asset = "ra_" + "6".repeat(32);
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-offline.mp3", sha256: sha(tone.parent), bytes: tone.parent.length,
    verses: refs.map(ref => ({ schema: "reference-verse/v1", ref, table: "torah", playback: { status: "ready", asset, clip: { start: 1, end: 5 } },
      words: { status: "ready", readingTextSha256: sha(new TextEncoder().encode(text.readingText.normalize("NFC"))), starts: [1.1, 3] }, attribution: REFERENCE_ATTRIBUTION })) }] });
  if (!catalog) throw Error("Synthetic catalog refused");
  const shorts = await syntheticShortReferences(catalog, [{ asset, bytes: tone.bytes, physicalFrames: tone.physicalFrames }]);
  for (const row of shorts.sources) shortBodies.set(row.path, row.bytes);
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request), referenceCatalogLoad: async () => catalog, referenceShortManifestLoad: async () => shorts.manifest, referenceStudentRelease: true });
  stop = await startBrowserServer(fixture.withRuntime, fixture.withPublicRuntime);
  browser = await chromium.launch({ headless: true });
}, 180_000);
beforeEach(async () => { await fixture.ownerDb.delete(rateLimit); });
afterAll(async () => {
  for (const context of contexts.splice(0)) await context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 120_000);

type Seen = { offline: boolean; ranges: string[]; fromWorker: string[] };
/** An installed-app context. `course`: the Learn to lein synthetic routes answer every public request instead of the server. */
async function installed(options: { course?: boolean } = {}) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width: 390, height: 844 }, serviceWorkers: "allow", acceptDownloads: false }); contexts.push(context);
  const seen: Seen = { offline: false, ranges: [], fromWorker: [] };
  await context.addInitScript(key => {
    try { localStorage.setItem(key, "1"); } catch { /* No storage. */ }
    const target = window; target.offlineAudios = [];
    window.Audio = new Proxy(window.Audio, { construct(original, args) { const media = Reflect.construct(original, args) as HTMLAudioElement; target.offlineAudios.push(media); return media; } });
  }, SEAM);
  // Registered first, so it runs last: loopback only, synthetic clips, and nothing at all while "offline".
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== BROWSER_ORIGIN || seen.offline) return route.abort("internetdisconnected");
    if (url.pathname.startsWith("/reference-audio/") && (await request.allHeaders()).range) seen.ranges.push(url.pathname);
    const body = shortBodies.get(url.pathname);
    if (url.pathname.startsWith("/reference-audio/short-v1/")) return body ? route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(body.length) }, body }) : route.fallback();
    return route.continue();
  });
  // The course's synthetic answers stop too while "offline": a fulfilled route would otherwise bypass the offline network.
  if (options.course) await syntheticCourseRoutes().install({ addInitScript: context.addInitScript.bind(context),
    route: ((url: string, handler: (route: Route) => unknown) => context.route(url, route => seen.offline ? route.abort("internetdisconnected") : handler(route))) as unknown as BrowserContext["route"] });
  context.on("response", response => { if (response.fromServiceWorker()) seen.fromWorker.push(new URL(response.url()).pathname); });
  const tab = await context.newPage();
  async function offline(value: boolean) { seen.offline = value; await context.setOffline(value); }
  return { context, tab, seen, offline };
}
const pack = (tab: Page) => tab.evaluate(async ([name, key]) => {
  if (!await caches.has(name)) return null;
  const response = await (await caches.open(name)).match(key);
  return response ? await response.json() as { packs: { key: string; renewedAt: number; expiresAt: number; assets: string[] }[] } : null;
}, [OFFLINE_CACHE, INDEX] as const);
async function signIn(tab: Page, email: string) {
  await tab.goto("/", { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await tab.getByLabel("Email address", { exact: true }).fill(email);
  await tab.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await ui(tab.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  await openAuthMail(tab, fixture.takeMail(email));
  await ui(tab.getByRole("heading", { name: "You’re signed in", exact: true })).toBeVisible();
}

// Offline navigation (the shell, the pill, playback and expiry) is proven on the built server in e2e/installable.spec.ts:
// this isolated server runs Next in development mode, whose pages do not hydrate from a service worker's shell.

it("signing out removes the saved readings from the device", async () => {
  const { tab } = await installed();
  await signIn(tab, "pg-admin@example.test");
  await ui(tab.getByText("Saved on this device", { exact: true })).toBeVisible({ timeout: 150_000 });
  expect(await tab.evaluate(name => caches.has(name), OFFLINE_CACHE)).toBe(true);
  await tab.getByRole("button", { name: "Sign out", exact: true }).click();
  await ui(tab.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(await tab.evaluate(async () => (await caches.keys()).filter(key => key === "crc-offline-v1"))).toEqual([]);
  await ui(tab.getByText("Saved on this device", { exact: true })).toHaveCount(0);
}, 300_000);

it("a lesson finished while the installed app is offline reaches the account when it is back online", async () => {
  const { tab, offline } = await installed({ course: true });
  await signIn(tab, "pg-admin@example.test");
  await ui(tab.getByText("Saved on this device", { exact: true })).toBeVisible({ timeout: 150_000 });
  await expect.poll(async () => (await pack(tab))?.packs.some(row => row.key === "course") ?? false, { timeout: 150_000 }).toBe(true);
  await expect.poll(() => tab.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);
  await tab.goto("/learn/torah-sof-pasuk", { waitUntil: "load" });
  await ui(tab.locator("main[data-step=hear]")).toBeVisible({ timeout: 60_000 });
  // Offline from here: every clip the drills play comes from the course pack.
  await offline(true);
  await finishLesson(tab);
  const local = await tab.evaluate(() => JSON.parse(localStorage.getItem("crc-torah:learn-progress/v1") ?? "{}") as { lessons?: Record<string, unknown> });
  expect(Object.keys(local.lessons ?? {})).toContain("torah-sof-pasuk");
  await offline(false);
  await expect.poll(async () => tab.evaluate(async () => {
    const response = await fetch("/api/learn/progress", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json() as { progress?: { lessons?: Record<string, unknown> } | null };
    return Object.keys(body.progress?.lessons ?? {});
  }), { timeout: 30_000 }).toContain("torah-sof-pasuk");
}, 300_000);
