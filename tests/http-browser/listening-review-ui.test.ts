import { generateSyntheticShortAudio, syntheticFourSecondShort } from "./synthetic-short-reference";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
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
import { createPocketTorahListeningSource } from "../../src/server/listening-review/sources";
import type { ListeningItem } from "../../src/lib/listening-review/sample";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let directory: string | undefined, shortBytes: Buffer, shortPath: string;
const contexts: BrowserContext[] = [], signedIn = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();
const sample: ListeningItem[] = [
  { id: "pt-genesis-1-1", source: "pocket-torah", kind: "torah", ref: "Genesis 1:1", why: "Synthetic first verse" },
  { id: "pt-genesis-1-2", source: "pocket-torah", kind: "torah", ref: "Genesis 1:2", why: "Synthetic second verse" },
  { id: "fj-genesis-1-3", source: "finkel", kind: "torah", ref: "Genesis 1:3", why: "Second source, not composed" },
];
function studyPage(request: StudyRequest) {
  const page = syntheticUiStudyPage(request, "available");
  return { ...page, verses: page.verses.map(verse => ({ ...verse, hebrew: normalizeHebrew("אָ֑ב־גַּ֖ד") })) };
}
async function api(tab: Page, path: string, body?: unknown) {
  return tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.status; }, { path, body });
}
async function page(who: "admin" | "tutor") {
  const storageState = signedIn.get(who);
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width: 390, height: 844 }, serviceWorkers: "block", acceptDownloads: false, ...(storageState ? { storageState } : {}) }); contexts.push(context);
  const state = { clips: 0 };
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === BROWSER_ORIGIN && url.pathname === shortPath) {
      state.clips++;
      try { await route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(shortBytes.length), "cache-control": "no-store" }, body: shortBytes }); } catch { /* Teardown may abort. */ }
    } else if (url.origin === BROWSER_ORIGIN) await route.continue(); else await route.abort();
  });
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!storageState) { const email = `pg-${who}@example.test`; expect(await api(tab, "/api/auth/sign-in/magic-link", { email })).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); signedIn.set(who, await context.storageState()); }
  return { tab, state };
}
const fits = (tab: Page) => tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  const folder = join(process.cwd(), ".impeccable", "review"); await mkdir(folder, { recursive: true });
  await tab.screenshot({ path: join(folder, `${name}.png`), fullPage: true });
}

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  let physicalFrames = 0, parent: Uint8Array;
  try {
    directory = await realpath(await mkdtemp(join(tmpdir(), "listening-review-audio-")));
    const generated = await generateSyntheticShortAudio(directory, "torah");
    parent = generated.parent; shortBytes = Buffer.from(generated.bytes); physicalFrames = generated.physicalFrames;
  } catch { throw new Error("Runtime synthetic audio generation failed; details withheld"); }
  const text = studyPage({ kind: "torah", ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], offset: 0, translation: "jps2023" });
  const asset = "ra_" + "6".repeat(32);
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-listening.mp3", sha256: createHash("sha256").update(parent).digest("hex"), bytes: parent.length,
    verses: text.verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); if (projection.status !== "ready" || projection.projection.words.length !== 2) throw new Error("Synthetic word projection refused");
      return { schema: "reference-verse/v1", ref: verse.ref, table: "torah", playback: { status: "ready", asset, clip: { start: 1, end: 5 } }, words: { status: "ready", readingTextSha256: createHash("sha256").update(verse.hebrew.readingText.normalize("NFC")).digest("hex"), starts: [1.1, 3] }, attribution: REFERENCE_ATTRIBUTION }; }) }] });
  if (!catalog) throw new Error("Synthetic reference catalog refused");
  const short = await syntheticFourSecondShort(catalog, shortBytes, physicalFrames); shortPath = short.path; shortBytes = short.bytes;
  const pocket = createPocketTorahListeningSource({ loadCatalog: async () => catalog, loadManifest: async () => short.manifest, catalogSha256: "c".repeat(64), manifestSha256: "d".repeat(64) });
  fixture = await browserFixture({ studyLoad: async request => studyPage(request), listening: { sample, sources: [pocket] } });
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.();
  if (directory && resolve(directory).startsWith(await realpath(tmpdir()) + sep)) await rm(directory, { recursive: true, force: true });
}, 120_000);

it("on a phone an admin hears a sampled verse from a word tap, sees tap-to-sound timing, records Pass and Needs work, and the per-source tally follows", async () => {
  const { tab, state } = await page("admin");
  await tab.goto("/workspace/admin/students", { waitUntil: "domcontentloaded" });
  await tab.getByRole("navigation", { name: "Admin", exact: true }).getByRole("link", { name: "Listening review", exact: true }).click();
  await ui(tab.getByRole("heading", { name: "Listening review", level: 1, exact: true })).toBeVisible();
  const tally = tab.getByRole("region", { name: "Tally", exact: true });
  await ui(tally.getByRole("heading", { name: "PocketTorah", exact: true })).toBeVisible();
  await ui(tally.getByText("of 2 heard", { exact: false })).toBeVisible();
  await ui(tally.getByRole("heading", { name: "Cantor Finkel", exact: true })).toBeVisible();
  await ui(tab.getByRole("heading", { name: "Genesis 1:1", level: 2, exact: true })).toBeVisible();
  await ui(tab.getByText("Synthetic first verse", { exact: true })).toBeVisible();
  expect(await fits(tab)).toBe(true);

  // Verse-first: a word tap plays the whole verse through the student's own player.
  await tab.locator(".study-verses [data-word-index=\"1\"]").first().click();
  const player = tab.getByRole("region", { name: "Reading playback", exact: true });
  await ui(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 20_000 });
  await ui(player.getByText("Genesis 1:1 · Whole verse", { exact: true })).toBeVisible();
  await ui(tab.getByText(/^Tap to sound: \d+ ms/)).toBeVisible();
  expect(state.clips).toBeGreaterThan(0);
  await ui(player.getByLabel("Speed", { exact: true })).toBeEnabled();
  await ui(player.getByRole("button", { name: "Repeat", exact: true })).toBeEnabled();
  expect(await fits(tab)).toBe(true); await capture(tab, "listening-review-phone-playing");

  await tab.getByRole("button", { name: "Pass", exact: true }).click();
  await tab.getByRole("button", { name: "Save and go to next", exact: true }).click();
  await ui(tab.getByRole("heading", { name: "Genesis 1:2", level: 2, exact: true })).toBeVisible();
  await ui(tally.getByText("Pass rate", { exact: false })).toContainText("100%");

  await tab.locator(".study-verses [data-word-index=\"0\"]").first().click();
  await ui(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 20_000 });
  await tab.getByRole("button", { name: "Needs work", exact: true }).click();
  await tab.getByLabel("Would teach wrong", { exact: true }).check();
  await tab.getByLabel("Note (optional)", { exact: true }).fill("Second word starts early.");
  expect(await fits(tab)).toBe(true); await capture(tab, "listening-review-phone-needs-work");
  await tab.getByRole("button", { name: "Save and go to next", exact: true }).click();
  await ui(tab.getByText("Saved: Needs work.", { exact: true })).toBeVisible();
  await ui(tally.getByText("Pass rate", { exact: false })).toContainText("50%");
  await ui(tally.getByText("would teach wrong", { exact: false }).first()).toContainText("1");
  await ui(tab.getByText("All 2 verses heard, below the comparison bar.", { exact: true })).toBeVisible();

  const rows = await fixture.ownerDb.select().from(s.listeningReviewVerdict);
  expect(rows.map(row => [row.itemId, row.verdict, row.reasons, row.note, row.source]).sort()).toEqual([
    ["pt-genesis-1-1", "pass", [], null, "pocket-torah"], ["pt-genesis-1-2", "needs-work", ["would-teach-wrong"], "Second word starts early.", "pocket-torah"]]);
  expect(rows.every(row => row.latencyMs !== null && row.latencyMs >= 0 && row.asset === short().id)).toBe(true);

  // The second source's verse is listed but cannot be played or marked.
  await tab.getByText("All 3 verses", { exact: true }).click();
  await tab.getByRole("button", { name: /Genesis 1:3/ }).click();
  await ui(tab.getByText("This source isn’t available yet.", { exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Save and go to next", exact: true })).toHaveCount(0);
  expect(await fits(tab)).toBe(true);
});

it("a tutor sees no listening review and its API refuses them", async () => {
  const { tab, state } = await page("tutor");
  await tab.goto("/workspace/admin/listening-review", { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { name: "Role unavailable", exact: true })).toBeVisible();
  expect(await api(tab, "/api/admin/listening-review")).toBe(403);
  expect(await api(tab, "/api/admin/listening-review/items/pt-genesis-1-1")).toBe(403);
  expect(await api(tab, "/api/admin/listening-review/verdicts", { itemId: "pt-genesis-1-1", verdict: "pass", asset: "x", mutationId: crypto.randomUUID() })).toBe(403);
  expect(state.clips).toBe(0);
});
function short() { return { id: "rs_" + shortPath.slice("/reference-audio/short-v1/".length, -4) }; }
