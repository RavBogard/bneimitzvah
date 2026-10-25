import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { deferred } from "../helpers/study";
import { syntheticReferenceReview } from "../helpers/reference-review";
import { admitReviewBatch } from "../../src/server/data/reference-review";
import { buildReviewManifest } from "../../src/server/reference-review/batch-contract";
import { reviewManifestPath } from "../../src/server/reference-review/batch-storage";
import * as s from "../../src/server/db/index";
import { browserFixture } from "./fixture";
import { generateSyntheticShortAudio } from "./synthetic-short-reference";
import { openAuthMail } from "./auth-navigation";
import { installLoopbackFetchGuard } from "./egress";
import { installReadingRouteGuard, readingRouteCleanupError } from "./reading-route-guard";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof browserFixture>>, recording: ReturnType<typeof syntheticReferenceReview>, browser: Browser;
let stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined, directory: string | undefined;
let held: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
const contexts: { context: BrowserContext; guard: Awaited<ReturnType<typeof installReadingRouteGuard>> }[] = [];
let signedIn: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
const path = "/workspace/admin/reference-review";
async function safe<T>(action: () => Promise<T>) { try { return await action(); } catch { throw new Error("Private review browser operation failed; details withheld"); } }
async function tab(mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme: "light", serviceWorkers: "block", acceptDownloads: false });
  const guard = await installReadingRouteGuard(context, BROWSER_ORIGIN); contexts.push({ context, guard }); if (signedIn) await context.addCookies(signedIn);
  const page = await context.newPage(); await safe(() => page.goto("/", { waitUntil: "domcontentloaded" }));
  if (!signedIn) {
    expect(await safe(() => page.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-admin@example.test" }) })).status))).toBe(200);
    await openAuthMail(page, fixture.takeMail("pg-admin@example.test")); signedIn = await context.cookies();
  }
  await safe(() => page.goto(path, { waitUntil: "domcontentloaded" })); await ui(page.getByRole("article", { name: "Selected recording" })).toBeVisible(); return page;
}
const audio = (page: Page) => page.locator("audio[aria-label='Review recording']");
async function clean(page: Page) { return audio(page).evaluate(node => { const media = node as HTMLAudioElement; return media.paused && !media.getAttribute("src"); }); }
beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); directory = await mkdtemp(join(tmpdir(), "finkel-review-ui-"));
  const synthetic = await generateSyntheticShortAudio(directory, "torah"); recording = syntheticReferenceReview(synthetic.bytes);
  const prepared = buildReviewManifest(recording.plan, [{ assetKey: recording.assetKey, text: [{ ref: "Genesis 1:1", readingText: "בָּבָּה נָנָה מָמָה לָלָה בָּבָּה נָנָה מָמָה לָלָה בָּבָּה נָנָה מָמָה לָלָה" }] }]);
  recording.objects.delete(reviewManifestPath(recording.prepared.sha256)); recording.objects.set(reviewManifestPath(prepared.sha256), prepared.bytes); recording = { ...recording, prepared };
  fixture = await browserFixture({ referenceReviewGet: async (objectPath, options) => {
    if (held && objectPath.endsWith(".mp3")) { const owned = held; owned.entered.resolve(undefined); await owned.release.promise; }
    if (options.signal.aborted) throw new Error("Synthetic review load cancelled"); return recording.get(objectPath);
  } });
  stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
}, 120000);
beforeEach(async () => {
  held = undefined;
  await fixture.ownerDb.update(s.referenceReviewBatch).set({ revokedAt: new Date(), generation: sql`${s.referenceReviewBatch.generation} + 1` }).where(isNull(s.referenceReviewBatch.revokedAt));
  recording = { ...recording, batchId: randomUUID() };
  await fixture.ownerDb.transaction(tx => admitReviewBatch(tx, { tenantId: "crc", id: recording.batchId, reviewerUserId: fixture.admin.id, manifestBytes: recording.prepared.bytes, manifestSha256: recording.prepared.sha256, expiresAt: new Date(Date.now() + 600000) }));
});
afterEach(async () => { held?.release.resolve(undefined); held = undefined; const results = await Promise.allSettled(contexts.splice(0).map(scope => scope.guard.close())); const error = readingRouteCleanupError(results); if (error) throw error; });
afterAll(async () => {
  const failures: string[] = [];
  for (const [label, action] of [["browser", () => browser?.close()], ["server", () => stop?.()], ["fixture", () => fixture?.close()], ["home", () => isolation?.cleanup()]] as const) { try { await action(); } catch { failures.push(label); } }
  restore?.(); if (directory) { try { if (!resolve(directory).startsWith(await realpath(tmpdir()) + sep)) throw new Error("Synthetic cleanup refused"); await rm(directory, { recursive: true, force: true }); } catch { failures.push("synthetic media"); } }
  if (failures.length) throw new Error(`Private review cleanup failed (${failures.join(",")}); private details withheld`);
}, 120000);
it("shows Hebrew beside private listening at desktop and phone widths and saves five individual checks without student release", async () => {
  for (const mobile of [false, true]) {
    const page = await tab(mobile); await ui(page.getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await ui(page.getByRole("button", { name: "Save these checks", exact: true })).toBeDisabled();
    const capture = process.env.FINKEL_REVIEW_CAPTURE_DIR;
    if (capture) { const dir = resolve(capture); if (!dir.startsWith(resolve(".local-logs") + sep)) throw new Error("Private review capture directory refused"); await mkdir(dir, { recursive: true }); await safe(() => page.screenshot({ path: join(dir, mobile ? "review-phone.png" : "review-desktop.png"), fullPage: true })); }
    for (const name of ["Privacy", "Listening", "Exact text", "Teaching accuracy", "Permission"]) await page.getByRole("group", { name, exact: true }).getByLabel(name === "Permission" && !mobile ? "Hold" : "Pass", { exact: true }).check();
    await page.getByRole("button", { name: "Save these checks", exact: true }).click();
    await ui(page.getByRole("status")).toContainText(mobile ? "All five review checks saved" : "Review saved with a hold");
    const decisions = await fixture.ownerDb.select().from(s.referenceReviewDecision); expect(decisions.length).toBe(mobile ? 2 : 1);
    expect(decisions.every(row => row.manifestSha256 === recording.prepared.sha256 && row.identitySha256 === recording.prepared.manifest.entries[0].identitySha256)).toBe(true);
  }
});
it("clears real synthetic playback on tab departure and does not resume on quiet return", async () => {
  const page = await tab(); let mediaRequests = 0; page.on("request", request => { if (new URL(request.url()).pathname.includes("/media/")) mediaRequests++; });
  await page.getByRole("button", { name: "Prepare recording", exact: true }).click(); await ui(page.getByRole("button", { name: "Recording ready", exact: true })).toBeVisible();
  await safe(() => audio(page).evaluate(node => (node as HTMLAudioElement).play())); await ui.poll(() => audio(page).evaluate(node => !(node as HTMLAudioElement).paused)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await ui.poll(() => clean(page)).toBe(true);
  const before = mediaRequests; const checked = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/reference-review/batches/${recording.batchId}`) && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await checked; await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(await clean(page)).toBe(true); expect(mediaRequests).toBe(before);
});
it("requires an explicit discard for unsaved checks before reload or workspace navigation", async () => {
  const page = await tab(); await page.getByRole("group", { name: "Privacy", exact: true }).getByLabel("Pass", { exact: true }).check();
  await page.getByRole("button", { name: "Reload review", exact: true }).click(); await ui(page.getByRole("region", { name: "Unsaved review checks" })).toBeVisible();
  await page.getByRole("button", { name: "Keep reviewing", exact: true }).click(); await ui(page.getByRole("group", { name: "Privacy", exact: true }).getByLabel("Pass", { exact: true })).toBeChecked();
  await page.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "Students", exact: true }).click();
  await ui(page.getByRole("region", { name: "Unsaved review checks" })).toBeVisible(); expect(new URL(page.url()).pathname).toBe(path);
  await page.getByRole("button", { name: "Discard checks and continue", exact: true }).click(); await ui(page.getByRole("heading", { name: "Students", exact: true })).toBeVisible();
});
it("discarded held media cannot attach after batch revocation", async () => {
  const page = await tab(); held = { entered: deferred(), release: deferred() }; await page.getByRole("button", { name: "Prepare recording", exact: true }).click(); await held.entered.promise;
  await fixture.ownerDb.update(s.referenceReviewBatch).set({ revokedAt: new Date(), generation: 2 }).where(eq(s.referenceReviewBatch.id, recording.batchId)); held.release.resolve(undefined);
  await ui(page.getByRole("alert").filter({ hasText: "This private review is no longer available." })).toBeVisible(); await ui(page.getByRole("article", { name: "Selected recording" })).toHaveCount(0);
  expect(await page.locator("audio").count()).toBe(0);
});
it("synchronous expiration clears cached playback before queued timers run", async () => {
  const page = await tab();
  await page.getByRole("button", { name: "Prepare recording", exact: true }).click(); await ui(page.getByRole("button", { name: "Recording ready", exact: true })).toBeVisible();
  await safe(() => audio(page).evaluate(node => (node as HTMLAudioElement).play()));
  const [batch] = await fixture.ownerDb.select().from(s.referenceReviewBatch).where(eq(s.referenceReviewBatch.id, recording.batchId));
  await page.clock.install(); await page.clock.setSystemTime(batch.expiresAt.getTime() + 1);
  await audio(page).evaluate(node => node.dispatchEvent(new Event("timeupdate"))); expect(await clean(page)).toBe(true);
});
