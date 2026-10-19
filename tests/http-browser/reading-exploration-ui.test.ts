import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generateSyntheticShortAudio, syntheticShortReferences } from "./synthetic-short-reference";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { parseReferenceShortResolution } from "../../src/lib/reference-audio/short-resolution";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { deferred } from "../helpers/study";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { browserFixture } from "./fixture";
import { openAuthMail } from "./auth-navigation";
import { installLoopbackFetchGuard } from "./egress";
import { installReadingRouteGuard, readingRouteCleanupError } from "./reading-route-guard";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));
declare global { interface Window { explorationAudios: HTMLAudioElement[]; explorationOverlap: number } }

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let browserEnv: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let hold: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
type SourceRouteScope = { context: BrowserContext; guard: Awaited<ReturnType<typeof installReadingRouteGuard>>; tab?: Page; closing: boolean; pending: Set<Promise<void>>; failures: Set<string>; release: Set<() => void> };
const contexts: SourceRouteScope[] = [];
/** Cancellation is normally handled by the SDK. Only an exact known close
 * WITH actual closing+closed-page evidence is accepted here. Everything else
 * is sanitized, propagated, and retained until the owned routes drain. */
function sourceRoute(scope: SourceRouteScope, action: "fulfill" | "abort", perform: () => Promise<void>) {
  const task = (async () => {
    try { await perform(); }
    catch (error) {
      const closed = "Target page, context or browser has been closed";
      const knownClose = error instanceof Error && (error.message === closed || error.message === "route." + action + ": " + closed);
      if (scope.closing && scope.tab?.isClosed() === true && knownClose) return;
      const label = "Exploration source route " + action + " failed; private details withheld";
      scope.failures.add(label); throw new Error(label);
    }
  })();
  scope.pending.add(task);
  void task.then(() => scope.pending.delete(task), () => scope.pending.delete(task));
  return task;
}
let audioDirectory: string | undefined;
const shortBodies = new Map<string, Buffer>();
let signedIn: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
const portion = (tab: Page) => tab.getByRole("region", { name: "Proposed Torah portion", exact: true });
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Exploration UI browser operation failed; private details withheld"); } }
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    audioDirectory = await realpath(await mkdtemp(join(tmpdir(), "exploration-short-audio-")));
    const torah = await generateSyntheticShortAudio(audioDirectory, "torah", 440), haft = await generateSyntheticShortAudio(audioDirectory, "haftarah", 660);
    const assets = [torah, haft].map((body, i) => {
      const kind = i === 0 ? "torah" as const : "haftarah" as const, ranges = [i === 0 ? "Genesis 1:1-6:8" : "Isaiah 1:1-2"], refs = expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS);
      const text = syntheticUiStudyPage({ kind, ranges, verses: refs, offset: 0, translation: "jps2023" }).verses[0].hebrew;
      const projection = projectStudyVerse(refs[0], text); if (projection.status !== "ready" || projection.projection.words.length !== 2) throw Error("Synthetic projection refused");
      return { id: "ra_" + String(i + 3).repeat(32), archiveFile: i === 0 ? "Synthetic-torah.mp3" : "Synthetic-haftarah.mp3", sha256: createHash("sha256").update(body.parent).digest("hex"), bytes: body.parent.length,
        verses: refs.map(ref => ({ schema: "reference-verse/v1", ref, table: kind, playback: { status: "ready", asset: "ra_" + String(i + 3).repeat(32), clip: { start: 1, end: 5 } },
          words: { status: "ready", readingTextSha256: createHash("sha256").update(text.readingText.normalize("NFC")).digest("hex"), starts: [1.1, 3] }, attribution: REFERENCE_ATTRIBUTION })) };
    });
    const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets }); if (!catalog) throw Error("Synthetic catalog refused");
    const shorts = await syntheticShortReferences(catalog, [torah, haft].map((body, i) => ({ asset: assets[i].id, bytes: body.bytes, physicalFrames: body.physicalFrames })));
    for (const row of shorts.sources) shortBodies.set(row.path, row.bytes);
    fixture = await browserFixture({ referenceCatalogLoad: async () => catalog, referenceShortManifestLoad: async () => shorts.manifest, referenceStudentRelease: true, studyLoad: async request => { if (hold && request.offset === 100) { hold.entered.resolve(undefined); await hold.release.promise; } return syntheticUiStudyPage(request); } });
    stop = await startBrowserServer(fixture.withRuntime); browserEnv = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: browserEnv.env });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await browserEnv?.cleanup(); if (audioDirectory) await rm(audioDirectory, { recursive: true, force: true }); throw new Error("Exploration UI setup failed; private details withheld"); }
}, 120000);
beforeEach(async () => {
  hold = undefined;
  await fixture.ownerDb.delete(s.assignmentVerse).where(eq(s.assignmentVerse.studentId, fixture.student.id));
  await fixture.ownerDb.delete(s.assignment).where(eq(s.assignment.studentId, fixture.student.id));
  await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
});
afterEach(async () => { hold?.release.resolve(undefined); hold = undefined;
  const closing = contexts.splice(0);
  for (const scope of closing) { scope.closing = true; for (const release of scope.release) release(); }
  const results = await Promise.allSettled(closing.map(async scope => {
    try { await scope.guard.close(); }
    finally { while (scope.pending.size) await Promise.allSettled([...scope.pending]); }
  }));
  const error = readingRouteCleanupError(results), failures = [...new Set(closing.flatMap(scope => [...scope.failures]))];
  if (error || failures.length) throw new Error("Exploration UI cleanup failed: " + (error ? "reading route/context failure; " : "") + failures.join("; ") + "; private details withheld");
});
afterAll(async () => {
  const failures: string[] = [];
  for (const [label, action] of [["browser", () => browser?.close()], ["server", () => stop?.()], ["fixture", () => fixture?.close()], ["home", () => browserEnv?.cleanup()]] as const) {
    try { await action(); } catch { failures.push(label); }
  }
  restore?.();
  if (audioDirectory) { try { if (!resolve(audioDirectory).startsWith(await realpath(tmpdir()) + sep)) throw Error("Synthetic cleanup refused"); await rm(audioDirectory, { recursive: true, force: true }); } catch { failures.push("synthetic audio"); } }
  if (failures.length) throw new Error(`Exploration UI cleanup failed (${failures.join(",")}); private details withheld`);
}, 120000);
async function page(mobile = false, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, serviceWorkers: "block", acceptDownloads: false });
  const guard = await installReadingRouteGuard(context, BROWSER_ORIGIN);
  const routes: SourceRouteScope = { context, guard, closing: false, pending: new Set(), failures: new Set(), release: new Set() }; contexts.push(routes);
  if (signedIn) await context.addCookies(signedIn);
  await context.addInitScript(() => {
    const target = window; target.explorationAudios = []; target.explorationOverlap = 0;
    const AudioConstructor = window.Audio; window.Audio = new Proxy(AudioConstructor, { construct(original, args) { const media = Reflect.construct(original, args) as HTMLAudioElement; target.explorationAudios.push(media); media.addEventListener("playing", () => { if (target.explorationAudios.some(other => other !== media && !other.paused && !other.ended)) target.explorationOverlap++; }); return media; } });
  });
  await context.route("**/reference-audio/short-v1/*.mp3", route => {
    const body = shortBodies.get(new URL(route.request().url()).pathname);
    return sourceRoute(routes, body ? "fulfill" : "abort", () => body
      ? route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(body.length), "cache-control": "no-store" }, body })
      : route.abort());
  });
  const tab = await context.newPage(); routes.tab = tab; await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  if (!signedIn) {
    const status = await safe(() => tab.evaluate(async () => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "pg-tutor@example.test" }) })).status));
    expect(status).toBe(200); await openAuthMail(tab, fixture.takeMail("pg-tutor@example.test")); signedIn = await context.cookies();
  }
  return tab;
}
async function tutor(tab: Page) { await safe(() => tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" })); await ui(portion(tab).getByText("Verses 1–100 of 146", { exact: true })).toBeVisible(); }
async function assign(kind: "torah" | "haftarah") {
  const membership = (await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id)))[0];
  const refs = kind === "torah" ? ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"] : ["Isaiah 1:1", "Isaiah 1:2"];
  const [row] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind, basis: "custom", status: "confirmed", ref: kind === "torah" ? "Genesis 1:1-3" : "Isaiah 1:1-2", setByMembershipId: membership.id,
    proposalSnapshot: { confirmationDate: fixture.student.ceremonyDate } }).returning();
  await fixture.ownerDb.insert(s.assignmentVerse).values(refs.map((ref, i) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: row.id, ordinal: i + 1, verseRef: ref })));
}
it("shows all proposed pages, retains unchanged text/scroll on quiet return, and captures one desktop/phone light/dark batch", async () => {
  for (const [mobile, scheme] of [[false, "light"], [false, "dark"], [true, "light"], [true, "dark"]] as const) {
    const tab = await page(mobile, scheme); let preparations = 0;
    tab.on("request", request => { if (new URL(request.url()).pathname.endsWith("/reading/explore/prepare")) preparations++; });
    await tutor(tab); await portion(tab).getByRole("button", { name: "Next text page", exact: true }).click();
    await ui(portion(tab).getByText("Verses 101–146 of 146", { exact: true })).toBeVisible();
    const element = await portion(tab).getByLabel("Hebrew reading", { exact: true }).elementHandle();
    await safe(() => portion(tab).evaluate(node => node.scrollIntoView({ block: "start" })));
    const scroll = await tab.evaluate(() => scrollY), count = preparations;
    const checked = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading") && response.status() === 200);
    await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await checked;
    await tab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await element!.evaluate(node => node.isConnected)).toBe(true); expect(preparations).toBe(count); expect(Math.abs(await tab.evaluate(() => scrollY) - scroll)).toBeLessThan(3);
    await ui(portion(tab).getByText("Verses 101–146 of 146", { exact: true })).toBeVisible();
    await ui(portion(tab).getByRole("button", { name: "Hear Genesis 4:26", exact: true })).toBeVisible();
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const directory = process.env.EXPLORATION_UI_CAPTURE_DIR;
    if (directory) {
      const target = resolve(directory), allowed = resolve(".local-logs") + sep;
      if (!target.startsWith(allowed)) throw new Error("Exploration capture directory refused");
      await mkdir(target, { recursive: true }); await safe(() => tab.screenshot({ path: resolve(target, `proposed-torah-${mobile ? "phone" : "desktop"}-${scheme}.png`) }));
    }
  }
});
it("keeps parent dashboard read-only and enters exploration only after selecting linked child practice", async () => {
  const tab = await page(); let requests = 0;
  tab.on("request", request => { if (new URL(request.url()).pathname.includes("/reading/explore/")) requests++; });
  await safe(() => tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" }));
  await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click();
  await ui(tab.getByRole("button", { name: "Practice with Synthetic", exact: true })).toBeVisible();
  expect(await portion(tab).count()).toBe(0); expect(requests).toBe(0);
  await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click();
  await ui(portion(tab).getByText("Verses 1–100 of 146", { exact: true })).toBeVisible(); expect(requests).toBeGreaterThan(0);
});
it("withholds a held proposed page when confirmed Torah appears, then refreshes to the real assignment", async () => {
  const tab = await page(); await tutor(tab); hold = { entered: deferred(), release: deferred() };
  await portion(tab).getByRole("button", { name: "Next text page", exact: true }).click(); await hold.entered.promise;
  await assign("torah"); hold.release.resolve(undefined);
  await ui(portion(tab).getByText("The reading changed. Refresh it to continue.", { exact: true })).toBeVisible();
  expect(await portion(tab).getByLabel("Hebrew reading", { exact: true }).count()).toBe(0);
  await portion(tab).getByRole("button", { name: "Refresh reading", exact: true }).click();
  await ui(portion(tab)).toHaveCount(0); await ui(tab.getByRole("button", { name: "Hear Genesis 1:1", exact: true })).toBeVisible();
});
it("preserves confirmed Haftarah and honest unknown-slot state without borrowing assigned Torah APIs", async () => {
  await assign("haftarah"); const tab = await page(); let assignedTorah = 0;
  tab.on("request", request => { const url = new URL(request.url()); if (/\/study-|\/reference-audio(?:\/short\/page)?$/.test(url.pathname) && url.searchParams.get("kind") === "torah") assignedTorah++; });
  await tutor(tab); await ui(tab.getByRole("heading", { name: "Assigned Haftarah", exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Hear Isaiah 1:1", exact: true })).toBeVisible(); expect(assignedTorah).toBe(0);
  await fixture.ownerDb.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, fixture.student.id));
  await tab.getByRole("button", { name: "Refresh reading", exact: true }).click();
  await ui(portion(tab).getByText("Your rabbi needs to choose a service time before the Torah portion can be shown.", { exact: true })).toBeVisible();
  await ui(tab.getByRole("button", { name: "Hear Isaiah 1:1", exact: true })).toBeVisible(); expect(assignedTorah).toBe(0);
});


async function audioState(tab: Page) {
  return tab.evaluate(() => {
    const target = window;
    return { overlap: target.explorationOverlap, active: target.explorationAudios.filter(a => !a.paused && !a.ended && a.readyState >= 2 && [96000, 48000].includes(Math.round(a.duration * 24000))).length,
      clean: target.explorationAudios.every(a => a.paused && !a.getAttribute("src")) };
  });
}
async function heard(tab: Page, scope: ReturnType<Page["getByRole"]>) {
  try {
    await ui(scope.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect.poll(async () => (await audioState(tab)).active).toBe(1); expect((await audioState(tab)).overlap).toBe(0);
  } finally {
    // Closed aggregate only: no DOM text, response bodies, signed bindings or errors.
    const statuses = await scope.getByRole("status").allTextContents().catch(() => []);
    const state = statuses.some(text => /unavailable/i.test(text)) ? "unavailable" : statuses.some(text => /failed|try again|could not|changed/i.test(text)) ? "error" : statuses.some(text => /loading|prepar/i.test(text)) ? "loading" : "other";
    console.info("exploration-heard", { ...await audioState(tab), state, pauseVisible: await scope.getByRole("button", { name: "Pause", exact: true }).isVisible().catch(() => false) });
  }
}
/** Observe before navigation; an HTTP 200 alone is not a usable short page. */
function shortMetadata(tab: Page, offset = 0, expected = 100) {
  let sequence = 0, ready = false;
  let facts = { status: 0, responses: 0, references: 0, ready: 0, unavailable: 0, invalid: 0, unreadable: false };
  const scope = contexts.find(scope => scope.context === tab.context()); if (!scope) throw new Error("Exploration metadata ownership missing");
  const observe = (response: Response) => {
    if (!new URL(response.url()).pathname.endsWith("/reading/explore/reference/short/page")) return;
    let selected: unknown; try { selected = response.request().postDataJSON()?.offset; } catch { return; }
    if (selected !== offset) return;
    const current = ++sequence;
    const task = (async () => {
      const next = { status: response.status(), responses: current, references: 0, ready: 0, unavailable: 0, invalid: 0, unreadable: false };
      try {
        const body: unknown = await response.json();
        const page = body && typeof body === "object" && "page" in body ? body.page : undefined;
        const references = page && typeof page === "object" && "references" in page ? page.references : undefined;
        if (!Array.isArray(references)) next.invalid++;
        else {
          next.references = references.length;
          for (const raw of references) { const parsed = parseReferenceShortResolution(raw); if (!parsed) next.invalid++; else if (parsed.source) next.ready++; else next.unavailable++; }
        }
      } catch { next.unreadable = true; }
      if (current !== sequence || scope.closing) return;
      facts = next; ready = next.status === 200 && next.references === expected && next.ready === expected && !next.unavailable && !next.invalid && !next.unreadable;
      console.info("exploration-metadata", { offset, ...facts });
    })();
    scope.pending.add(task); void task.then(() => scope.pending.delete(task), () => scope.pending.delete(task));
  };
  tab.on("response", observe);
  return async () => {
    try { await ui.poll(() => ready, { timeout: 15000 }).toBe(true); }
    finally { tab.off("response", observe); console.info("exploration-metadata-barrier", { offset, ...facts }); }
  };
}
it("keeps proposed Torah, assigned Haftarah and true Lift exclusive in all six directed hearing transitions", async () => {
  await assign("haftarah"); const tab = await page(); let archiveRequests = 0, assignedTorah = 0; const bodies = new Set<string>();
  tab.on("request", request => { const url = new URL(request.url()); if (url.hostname === "archive.org") archiveRequests++;
    if (shortBodies.has(url.pathname)) bodies.add(url.pathname);
    if (/\/(study-text|study-word-aids|study-word-details|reference-audio(?:\/short\/page)?)$/.test(url.pathname) && url.searchParams.get("kind") === "torah") assignedTorah++; });
  const metadataReady = shortMetadata(tab); await tutor(tab); await metadataReady();
  const proposed = portion(tab).getByRole("region", { name: "Reading playback", exact: true });
  const proposedBox = await portion(tab).boundingBox(), headingBox = await tab.getByRole("heading", { name: "Assigned Haftarah", exact: true }).boundingBox(), assignedBox = await tab.getByRole("region", { name: "Assigned text", exact: true }).boundingBox();
  expect(Boolean(proposedBox && headingBox && assignedBox)).toBe(true);
  if (!proposedBox || !headingBox || !assignedBox) throw new Error("Exploration desktop geometry unavailable");
  expect(proposedBox.y + proposedBox.height).toBeLessThanOrEqual(headingBox.y);
  expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(assignedBox.y);
  // Modal must close before an underlying main slot can receive an actual click.
  for (const slot of ["proposed", "assigned", "lifted", "proposed", "lifted", "assigned", "proposed"] as const) {
    if (slot !== "lifted" && await tab.getByRole("dialog").count()) {
      await tab.getByRole("dialog").getByRole("button", { name: "Close practice view", exact: true }).click();
      await ui(tab.getByRole("dialog")).toHaveCount(0); expect(await audioState(tab)).toMatchObject({ active: 0, clean: true });
    }
    if (slot === "proposed") { await portion(tab).getByRole("button", { name: "Hear Genesis 1:1", exact: true }).click(); await heard(tab, proposed); }
    else if (slot === "assigned") { await tab.getByRole("button", { name: "Hear Haftarah", exact: true }).click();
      await heard(tab, tab.getByRole("region", { name: "Assigned text", exact: true }).getByRole("region", { name: "Reading playback", exact: true })); }
    else {
      await tab.getByRole("button", { name: "View Isaiah 1:1 up close", exact: true }).click();
      const dialog = tab.getByRole("dialog", { name: "Isaiah 1:1", exact: true }); await ui(dialog).toBeVisible();
      expect(await audioState(tab)).toMatchObject({ active: 0, clean: true });
      const player = dialog.getByRole("region", { name: "Reading playback", exact: true }); await player.getByRole("button", { name: "Play", exact: true }).click(); await heard(tab, player);
    }
  }
  expect(bodies.size).toBe(2); expect(archiveRequests).toBe(0); expect(assignedTorah).toBe(0);
});

it("cancels held proposed audio on page navigation and quiet return never starts or refetches audio", async () => {
  const tab = await page(); const metadataReady = shortMetadata(tab); await tutor(tab); await metadataReady(); let release!: () => void;
  let finished!: () => void; const terminal = new Promise<void>(yes => { finished = yes; });
  const gate = new Promise<void>(yes => { release = yes; }); let bodyStarted = false, sourceRequests = 0, metadataRequests = 0;
  tab.on("request", request => { const url = new URL(request.url()); if (shortBodies.has(url.pathname)) sourceRequests++; if (url.pathname.endsWith("/reading/explore/reference/short/page")) metadataRequests++; });
  const routes = contexts.find(scope => scope.context === tab.context()); if (!routes) throw new Error("Exploration route ownership missing");
  routes.release.add(release);
  await tab.route("**/reference-audio/short-v1/*.mp3", route => sourceRoute(routes, "fulfill", async () => {
    try {
      bodyStarted = true; console.info("exploration-held-body", { started: true }); await gate; const body = shortBodies.get(new URL(route.request().url()).pathname);
      if (!body) throw new Error("Exploration held source missing");
      await route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(body.length) }, body });
    } finally { finished(); }
  }));
  await portion(tab).getByRole("button", { name: "Hear Genesis 1:1", exact: true }).click();
  try { await ui.poll(() => bodyStarted, { timeout: 15000 }).toBe(true); }
  finally { console.info("exploration-held-body-barrier", { started: bodyStarted, sourceRequests, metadataRequests }); }
  const currentMetadata = tab.waitForEvent("requestfinished", { predicate: request => new URL(request.url()).pathname.endsWith("/reading/explore/reference/short/page") && request.postDataJSON()?.offset === 100, timeout: 15000 });
  await portion(tab).getByRole("button", { name: "Next text page", exact: true }).click(); release(); await terminal; await currentMetadata;
  await ui(portion(tab).getByText("Verses 101–146 of 146", { exact: true })).toBeVisible();
  await expect.poll(async () => (await audioState(tab)).clean).toBe(true); expect((await audioState(tab)).active).toBe(0);
  await tab.unroute("**/reference-audio/short-v1/*.mp3");
  const beforeSources = sourceRequests, beforeMetadata = metadataRequests;
  const response = tab.waitForResponse(r => new URL(r.url()).pathname.endsWith("/reading") && r.status() === 200);
  await tab.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); }); await response;
  await tab.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(sourceRequests).toBe(beforeSources); expect(metadataRequests).toBe(beforeMetadata); expect((await audioState(tab)).active).toBe(0);
});


it("an actual signed proposal deadline stops cached playback even before queued timer processing", async () => {
  const tab = await page(); await tab.clock.install();
  const metadataReady = shortMetadata(tab);
  const preparation = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading/explore/prepare") && response.status() === 200);
  await tutor(tab); await metadataReady(); const selected: unknown = await (await preparation).json();
  const deadline = selected && typeof selected === "object" && "expiresAt" in selected ? selected.expiresAt : undefined;
  expect(typeof deadline === "number" && Number.isSafeInteger(deadline) && deadline > Date.now()).toBe(true);
  await portion(tab).getByRole("button", { name: "Hear Genesis 1:1", exact: true }).click();
  await heard(tab, portion(tab).getByRole("region", { name: "Reading playback", exact: true }));
  // Uses the genuine returned claim deadline, not a rewritten response or signature.
  // Server-clock expiration remains separately covered by actual service tests.
  await tab.clock.setSystemTime(Number(deadline) + 1);
  await tab.evaluate(() => { const target = window; for (const media of target.explorationAudios) media.dispatchEvent(new Event("timeupdate")); });
  expect(await audioState(tab)).toMatchObject({ active: 0, clean: true });
  await ui(portion(tab).getByRole("region", { name: "Reading playback", exact: true }).getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  expect(await audioState(tab)).toMatchObject({ active: 0, clean: true });
});
