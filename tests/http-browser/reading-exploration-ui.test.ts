import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { privateRouteFetch } from "./audio-observation";
import { startFirefoxAudioOutput, type AudioOutput } from "./firefox-audio-output";
import { expect as ui } from "@playwright/test";
import { firefox, type Browser, type BrowserContext, type Page, type Request as BrowserRequest } from "playwright";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generateSyntheticShortAudio, syntheticShortReferences } from "./synthetic-short-reference";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { parseReferenceShortResolution } from "../../src/lib/reference-audio/short-resolution";
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";
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
import { refreshReading, goChild } from "./reading-nav";
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
let audioOutput: AudioOutput | undefined;
const shortBodies = new Map<string, Buffer>();
let signedIn: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
let setListeningRelease: (value: boolean) => void;
const portion = (tab: Page) => tab.getByTestId("proposed-portion");
// Which verses of the proposed portion are on the page, by number rather than by the words that say so.
async function position(tab: Page, first: number, last: number, total: number) {
  const node = portion(tab).getByTestId("page-position");
  await ui(node).toHaveAttribute("data-page-first", String(first)); await ui(node).toHaveAttribute("data-page-last", String(last)); await ui(node).toHaveAttribute("data-page-total", String(total));
}
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Exploration UI browser operation failed; private details withheld"); } }
beforeAll(async () => {
  let setupStage: "synthetic-source" | "catalog" | "fixture" | "server" | "audio-output" | "browser" = "synthetic-source";
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
    setupStage = "catalog";
    const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets }); if (!catalog) throw Error("Synthetic catalog refused");
    const shorts = await syntheticShortReferences(catalog, [torah, haft].map((body, i) => ({ asset: assets[i].id, bytes: body.bytes, physicalFrames: body.physicalFrames })));
    for (const row of shorts.sources) shortBodies.set(row.path, row.bytes);
    setupStage = "fixture";
    fixture = await browserFixture({ referenceCatalogLoad: async () => catalog, referenceShortManifestLoad: async () => shorts.manifest, referenceStudentRelease: true, studyLoad: async request => { if (hold && request.offset === 100) { hold.entered.resolve(undefined); await hold.release.promise; } return syntheticUiStudyPage(request); } });
    setListeningRelease = studentRelease => { Object.assign(fixture.runtime, { shortReferenceAudio: createShortReferenceAudioService({ access: fixture.runtime.access, practice: fixture.runtime.practice, loadText: async request => syntheticUiStudyPage(request), loadCatalog: async () => catalog, loadManifest: async () => shorts.manifest, studentRelease }) }); };
    // Chromium issue 568852319 misreports fully consumed no-store streams as
    // cancelled. Keep every terminal assertion using the pinned Firefox build.
    setupStage = "server";
    stop = await startBrowserServer(fixture.withRuntime); browserEnv = await isolatedEnv();
    setupStage = "audio-output";
    audioOutput = await startFirefoxAudioOutput(process.env.FIREFOX_AUDIO_TEST_TOOLCHAIN);
    setupStage = "browser";
    browser = await firefox.launch({ headless: true, env: { ...browserEnv.env, ...audioOutput.environment } });
    console.info("exploration-contract-browser", { engine: "firefox", version: browser.version() });
  } catch { await browser?.close().catch(() => undefined); let outputCleanupFailed = false; await audioOutput?.close().catch(() => { outputCleanupFailed = true; }); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await browserEnv?.cleanup(); if (audioDirectory) await rm(audioDirectory, { recursive: true, force: true }); throw new Error("Exploration UI setup failed (" + setupStage + "); " + (outputCleanupFailed ? "owned audio cleanup failed; " : "") + "private details withheld"); }
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
  for (const [label, action] of [["browser", () => browser?.close()], ["audio output", () => audioOutput?.close()], ["server", () => stop?.()], ["fixture", () => fixture?.close()], ["home", () => browserEnv?.cleanup()]] as const) {
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
async function tutor(tab: Page) { await safe(() => tab.goto(`/workspace/tutor/${fixture.student.id}`, { waitUntil: "domcontentloaded" })); await position(tab, 1, 100, 146); }
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
    await position(tab, 101, 146, 146);
    const element = await portion(tab).getByTestId("study-verses").elementHandle();
    await safe(() => portion(tab).evaluate(node => node.scrollIntoView({ block: "start" })));
    const scroll = await tab.evaluate(() => scrollY), count = preparations;
    const checked = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading") && response.status() === 200);
    await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await checked;
    await tab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await element!.evaluate(node => node.isConnected)).toBe(true); expect(preparations).toBe(count); expect(Math.abs(await tab.evaluate(() => scrollY) - scroll)).toBeLessThan(3);
    await position(tab, 101, 146, 146);
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
  await goChild(tab, fixture.student.id);
  await ui(tab.getByRole("button", { name: "Practice with Synthetic", exact: true })).toBeVisible();
  expect(await portion(tab).count()).toBe(0); expect(requests).toBe(0);
  await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click();
  await position(tab, 1, 100, 146); expect(requests).toBeGreaterThan(0);
});
// Deliberate wording test for the proposed Torah portion: approved copy, change only with the copy.
it("withholds a held proposed page when confirmed Torah appears, then refreshes to the real assignment", async () => {
  const tab = await page(); await tutor(tab); hold = { entered: deferred(), release: deferred() };
  await portion(tab).getByRole("button", { name: "Next text page", exact: true }).click(); await hold.entered.promise;
  await assign("torah"); hold.release.resolve(undefined);
  await ui(portion(tab).getByTestId("exploration-state")).toHaveAttribute("data-exploration-state", "changed");
  await ui(portion(tab).getByTestId("exploration-state")).toContainText("The reading changed. Refresh it to continue.");
  expect(await portion(tab).getByTestId("study-verses").count()).toBe(0);
  await portion(tab).getByRole("button", { name: "Refresh reading", exact: true }).click();
  await ui(portion(tab)).toHaveCount(0); await ui(tab.getByRole("button", { name: "Hear Genesis 1:1", exact: true })).toBeVisible();
});
it("preserves confirmed Haftarah and honest unknown-slot state without borrowing assigned Torah APIs", async () => {
  await assign("haftarah"); const tab = await page(); let assignedTorah = 0;
  tab.on("request", request => { const url = new URL(request.url()); if (/\/study-|\/reference-audio(?:\/short\/page)?$/.test(url.pathname) && url.searchParams.get("kind") === "torah") assignedTorah++; });
  await tutor(tab); await ui(tab.getByTestId("assigned-haftarah-heading")).toBeVisible();
  await ui(tab.getByRole("button", { name: "Hear Isaiah 1:1", exact: true })).toBeVisible(); expect(assignedTorah).toBe(0);
  await fixture.ownerDb.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, fixture.student.id));
  await refreshReading(tab);
  await ui(portion(tab).getByTestId("exploration-state")).toHaveAttribute("data-exploration-state", "unresolved-unknown-slot");
  await ui(tab.getByRole("button", { name: "Hear Isaiah 1:1", exact: true })).toBeVisible(); expect(assignedTorah).toBe(0);
});

it("held proposed reading remains readable without reference metadata and optional practice names the assigned Haftarah", async () => {
  setListeningRelease(false);
  try {
    const tab = await page(); let metadata = 0, bodies = 0;
    tab.on("request", request => { const path = new URL(request.url()).pathname; if (path.endsWith("/reading/explore/reference/short/page") || path.endsWith("/reference-audio/short/page")) metadata++; if (shortBodies.has(path)) bodies++; });
    await tutor(tab); await position(tab, 1, 100, 146);
    await ui(tab.getByRole("button", { name: /^Hear/ })).toHaveCount(0); await ui(tab.getByRole("button", { name: "Practice up close", exact: true })).toHaveCount(0);
    // E2: no Start reading button; the portion's text takes focus where a reader puts it.
    await ui(tab.getByRole("button", { name: "Start reading", exact: true })).toHaveCount(0); await portion(tab).getByTestId("study-verses").focus(); await ui(portion(tab).getByTestId("study-verses")).toBeFocused();
    await ui(tab.getByRole("dialog")).toHaveCount(0); expect(metadata).toBe(0); expect(bodies).toBe(0); expect(await tab.evaluate(() => window.explorationAudios.length)).toBe(0);
    await assign("haftarah"); await refreshReading(tab);
    const practice = tab.getByRole("button", { name: "Practice assigned Haftarah up close", exact: true }); await ui(practice).toBeEnabled(); await practice.click();
    await ui(tab.getByRole("dialog", { name: "Isaiah 1:1", exact: true })).toBeVisible(); await ui(tab.getByRole("region", { name: "Reading playback", exact: true })).toHaveCount(0);
    expect(metadata).toBe(0); expect(bodies).toBe(0); expect(await tab.evaluate(() => window.explorationAudios.length)).toBe(0);
    await tab.getByRole("dialog").getByRole("button", { name: "Close practice view", exact: true }).click();
  } finally { setListeningRelease(true); }
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
/** Observe original stream/signal events only. Promise reactions can perturb scheduling;
 * a pass with this observer cannot prove the cause of the preserved CI failure. */
async function observeMetadataConsumption(tab: Page, path: string) {
  await tab.addInitScript(({ path }) => {
    type Stage = "fetch" | "response" | "reader" | "first-chunk" | "eof" | "abort" | "cancel" | "release" | "fetch-rejected" | "read-rejected";
    type Rejection = "none" | "AbortError" | "TypeError" | "other";
    type Record = { ordinal: number; status: number; chunks: number; bytes: number; eof: boolean; signalAborted: boolean; cancelCalled: boolean; released: boolean; fetchRejected: Rejection; readRejected: Rejection; observerFailed: boolean; overflow: boolean; events: { stage: Stage; ms: number }[] };
    const observation = { records: [] as Record[], dropped: 0 }, original = window.fetch.bind(window);
    Object.defineProperty(window, "__explorationMetadataObservation", { value: observation });
    const rejection = (error: unknown): Rejection => { try { const name = error instanceof Error || error instanceof DOMException ? error.name : ""; return name === "AbortError" || name === "TypeError" ? name : "other"; } catch { return "other"; } };
    window.fetch = (input, init) => {
      let matches = false;
      try { const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.href, location.origin); matches = url.origin === location.origin && url.pathname === path && !url.search && (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() === "POST"; } catch { /* Original fetch remains authoritative. */ }
      if (!matches) return original(input, init);
      if (observation.records.length >= 4) { observation.dropped = Math.min(999, observation.dropped + 1); return original(input, init); }
      const record: Record = { ordinal: observation.records.length + 1, status: 0, chunks: 0, bytes: 0, eof: false, signalAborted: false, cancelCalled: false, released: false, fetchRejected: "none", readRejected: "none", observerFailed: false, overflow: false, events: [] };
      observation.records.push(record); const start = performance.now();
      const event = (stage: Stage) => { if (record.events.length < 12) record.events.push({ stage, ms: Math.min(120000, Math.max(0, Math.round(performance.now() - start))) }); else record.overflow = true; };
      event("fetch"); const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
      const aborted = () => { record.signalAborted = true; event("abort"); };
      if (signal?.aborted) aborted(); else signal?.addEventListener("abort", aborted, { once: true });
      return original(input, init).then(response => {
        record.status = response.status; event("response"); const body = response.body;
        if (body) try {
          const getReader = body.getReader;
          Object.defineProperty(body, "getReader", { configurable: true, value: (options?: ReadableStreamGetReaderOptions) => {
            const reader = Reflect.apply(getReader, body, options === undefined ? [] : [options]) as ReadableStreamDefaultReader<Uint8Array>;
            event("reader"); const read = reader.read.bind(reader), cancel = reader.cancel.bind(reader), release = reader.releaseLock.bind(reader);
            try {
              reader.read = () => read().then(part => {
                try {
                  if (part.done) { record.eof = true; event("eof"); }
                  else { if (!record.chunks) event("first-chunk"); record.chunks = Math.min(65535, record.chunks + 1); record.bytes = Math.min(1024 * 1024 + 1, record.bytes + part.value.byteLength); }
                } catch { record.observerFailed = true; }
                return part;
              }, error => { record.readRejected = rejection(error); event("read-rejected"); throw error; });
              reader.cancel = reason => { record.cancelCalled = true; event("cancel"); return cancel(reason); };
              reader.releaseLock = () => { record.released = true; event("release"); return release(); };
            } catch { record.observerFailed = true; }
            return reader;
          } });
        } catch { record.observerFailed = true; }
        return response; // Same Response, body, reader, chunks and errors; no clone or second read.
      }, error => { record.fetchRejected = rejection(error); event("fetch-rejected"); throw error; });
    };
  }, { path });
}

/** Capture the actual authenticated upstream bytes before navigation. Chromium's
 * duplicate response-body lookup is not the application consumption barrier. */
async function shortMetadata(tab: Page, offset = 0, expected = 100) {
  let sequence = 0, ready = false;
  type Failure = "none" | "request-shape" | "upstream-fetch" | "body-bound" | "body-read" | "json" | "reference-shape" | "fulfill" | "browser-failed" | "dispose";
  type Terminal = "pending" | "finished" | "failed" | "closing";
  type BrowserFailure = "none" | "unobserved" | "aborted" | "timed-out" | "connection-reset" | "connection-closed" | "invalid-response" | "length-mismatch" | "decoding-failed" | "failed" | "other";
  type Stage = "route" | "browser-request" | "browser-response" | "upstream" | "body" | "fulfill-start" | "fulfill-resolved" | "disposed" | "browser-finished" | "browser-failed" | "closing";
  type Facts = { status: number; responses: number; references: number; ready: number; unavailable: number; invalid: number; failure: Failure; terminal: Terminal; fulfilled: boolean; ordinal: number; currentSequence: boolean; scopeClosing: boolean; pageClosed: boolean; elapsed: number; stages: { stage: Stage; ms: number }[]; stageOverflow: boolean; browserFailure: BrowserFailure; contentEncoding: "unobserved" | "identity" | "gzip" | "br" | "deflate" | "other"; lengthMatchesBytes: boolean | null; transferEncoding: "unobserved" | "absent" | "chunked" | "other"; forwardedTransferEncoding: "unobserved" | "absent" | "chunked" | "other"; forwardedLengthMatchesBytes: boolean | null; forwardedBodyDigestMatches: boolean | null };
  const initial = (responses: number): Facts => ({ status: 0, responses, references: 0, ready: 0, unavailable: 0, invalid: 0, failure: "none", terminal: "pending", fulfilled: false, ordinal: 0, currentSequence: false, scopeClosing: false, pageClosed: false, elapsed: 0, stages: [], stageOverflow: false, browserFailure: "none", contentEncoding: "unobserved", lengthMatchesBytes: null, transferEncoding: "unobserved", forwardedTransferEncoding: "unobserved", forwardedLengthMatchesBytes: null, forwardedBodyDigestMatches: null });
  let facts = initial(0);
  const scope = contexts.find(scope => scope.context === tab.context()); if (!scope) throw new Error("Exploration metadata ownership missing");
  const requests = new Map<BrowserRequest, Facts>(), path = `/api/students/${fixture.student.id}/reading/explore/reference/short/page`;
  await observeMetadataConsumption(tab, path);
  const ownership = new WeakMap<BrowserRequest, { ordinal: number; start: number }>(); let ordinal = 0;
  const identify = (request: BrowserRequest) => { let owned = ownership.get(request); if (!owned) { owned = { ordinal: ++ordinal, start: performance.now() }; ownership.set(request, owned); } return owned; };
  const stamp = (request: BrowserRequest, next: Facts, stage: Stage) => { const owned = identify(request); next.ordinal = owned.ordinal; next.elapsed = Math.min(120000, Math.max(0, Math.round(performance.now() - owned.start))); next.currentSequence = next.responses === sequence; next.scopeClosing = scope.closing; next.pageClosed = tab.isClosed(); if (next.stages.length < 12) next.stages.push({ stage, ms: next.elapsed }); else next.stageOverflow = true; };
  const publish = (next: Facts) => {
    if (scope.closing || next.responses !== sequence) return;
    facts = next; ready = next.status === 200 && next.references === expected && next.ready === expected && !next.unavailable && !next.invalid
      && next.failure === "none" && next.fulfilled && next.terminal === "finished";
  };
  const fail = (next: Facts, failure: Failure) => {
    next.failure = failure; ready = false;
    if (!scope.closing) scope.failures.add(`Exploration metadata ${failure} failed; private details withheld`);
    publish(next);
  };
  const started = (request: BrowserRequest) => { const url = new URL(request.url()); if (url.origin === BROWSER_ORIGIN && url.pathname === path) { identify(request); const next = requests.get(request); if (next) stamp(request, next, "browser-request"); } };
  const responded = (response: import("playwright").Response) => { const request = response.request(), next = requests.get(request); if (next) stamp(request, next, "browser-response"); };
  const finish = (request: BrowserRequest) => { const next = requests.get(request); if (next) { next.terminal = "finished"; stamp(request, next, "browser-finished"); publish(next); } };
  const failed = (request: BrowserRequest) => { const next = requests.get(request); if (next) { const code = request.failure()?.errorText; const known: { [key: string]: BrowserFailure } = { "net::ERR_ABORTED": "aborted", "net::ERR_TIMED_OUT": "timed-out", "net::ERR_CONNECTION_RESET": "connection-reset", "net::ERR_CONNECTION_CLOSED": "connection-closed", "net::ERR_INVALID_RESPONSE": "invalid-response", "net::ERR_CONTENT_LENGTH_MISMATCH": "length-mismatch", "net::ERR_CONTENT_DECODING_FAILED": "decoding-failed", "net::ERR_FAILED": "failed" }; next.browserFailure = code === undefined ? "unobserved" : Object.hasOwn(known, code) ? known[code] : "other"; next.terminal = scope.closing ? "closing" : "failed"; stamp(request, next, "browser-failed"); if (!scope.closing) fail(next, "browser-failed"); } };
  tab.on("request", started); tab.on("response", responded); tab.on("requestfinished", finish); tab.on("requestfailed", failed);
  scope.release.add(() => { tab.off("request", started); tab.off("response", responded); tab.off("requestfinished", finish); tab.off("requestfailed", failed); for (const [request, next] of requests) if (next.terminal === "pending") { next.terminal = "closing"; stamp(request, next, "closing"); } });
  await tab.route(url => url.origin === BROWSER_ORIGIN && url.pathname === path, route => sourceRoute(scope, "fulfill", async () => {
    const request = route.request(), url = new URL(request.url());
    let selected: unknown; try { selected = request.postDataJSON()?.offset; } catch { /* Refused below without copying request data. */ }
    if (request.method() !== "POST" || url.origin !== BROWSER_ORIGIN || url.pathname !== path || url.search || !Number.isSafeInteger(selected) || Number(selected) < 0 || Number(selected) > 999) {
      const next = initial(++sequence); requests.set(request, next); stamp(request, next, "route"); fail(next, "request-shape"); await route.abort("failed"); return;
    }
    if (selected !== offset) { await route.fallback(); return; }
    const next = initial(++sequence); requests.set(request, next); stamp(request, next, "route"); ready = false; publish(next);
    let response: Awaited<ReturnType<typeof privateRouteFetch>>;
    let stage: Failure = "upstream-fetch", settled = false;
    try {
      response = await privateRouteFetch(route, tab, { maxRedirects: 0, maxRetries: 0, timeout: 15000 }); if (!response) return; stamp(request, next, "upstream");
      try {
        next.status = response.status(); stage = "body-bound";
        const declared = response.headers()["content-length"];
        const encoding = response.headers()["content-encoding"]?.toLowerCase(), transfer = response.headers()["transfer-encoding"]?.toLowerCase();
        next.contentEncoding = encoding === undefined || encoding === "identity" ? "identity" : encoding === "gzip" || encoding === "br" || encoding === "deflate" ? encoding : "other";
        next.transferEncoding = transfer === undefined ? "absent" : transfer === "chunked" ? "chunked" : "other";
        if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(declared) || Number(declared) > 1024 * 1024)) throw Error("Bounded metadata body refused");
        stage = "body-read"; const bytes = await response.body(); stamp(request, next, "body"); next.lengthMatchesBytes = declared === undefined ? null : Number(declared) === bytes.length;
        stage = "body-bound"; if (bytes.length > 1024 * 1024) throw Error("Bounded metadata body refused");
        stage = "json"; let body: unknown;
        try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(next, "json"); }
        const page = body && typeof body === "object" && "page" in body ? body.page : undefined;
        const references = page && typeof page === "object" && "references" in page ? page.references : undefined;
        if (!page || typeof page !== "object" || !("offset" in page) || page.offset !== offset || !Array.isArray(references)) next.invalid++;
        else {
          next.references = references.length;
          for (const raw of references) { const parsed = parseReferenceShortResolution(raw); if (!parsed) next.invalid++; else if (parsed.source) next.ready++; else next.unavailable++; }
        }
        if (next.failure === "none" && (next.status !== 200 || next.references !== expected || next.ready !== expected || next.unavailable || next.invalid)) fail(next, "reference-shape");
        // Preserve status, semantic headers and the exact buffered body, even on invalid data.
        // The buffer is already dechunked: do not forward upstream chunk framing alongside Playwright's length.
        stage = "fulfill";
        const forwardedHeaders: Record<string, string> = { ...response.headers(), "content-length": String(bytes.length) }, digest = createHash("sha256").update(bytes).digest("hex");
        delete forwardedHeaders["transfer-encoding"];
        const forwardedTransfer = forwardedHeaders["transfer-encoding"];
        next.forwardedTransferEncoding = forwardedTransfer === undefined ? "absent" : forwardedTransfer === "chunked" ? "chunked" : "other";
        next.forwardedLengthMatchesBytes = forwardedHeaders["content-length"] === String(bytes.length);
        if (next.forwardedTransferEncoding !== "absent" || !next.forwardedLengthMatchesBytes) throw Error("Buffered metadata framing refused");
        stamp(request, next, "fulfill-start"); await route.fulfill({ status: next.status, headers: forwardedHeaders, body: bytes }); settled = true; next.fulfilled = true;
        next.forwardedBodyDigestMatches = createHash("sha256").update(bytes).digest("hex") === digest;
        if (!next.forwardedBodyDigestMatches) throw Error("Buffered metadata body changed");
        stamp(request, next, "fulfill-resolved"); publish(next);
      } finally { try { await response.dispose(); stamp(request, next, "disposed"); } catch (error) { stage = "dispose"; throw error; } }
    } catch (error) {
      fail(next, stage);
      if (!settled && !tab.isClosed()) await route.abort("failed");
      throw error; // sourceRoute retains failures, allowing only its exact close case.
    } finally { console.info("exploration-metadata", { offset, ...next }); }
  }));
  return async () => {
    try { await ui.poll(() => ready, { timeout: 15000 }).toBe(true); }
    // Keep observing through context teardown: later invalid responses cannot
    // hide behind an earlier successful100-reference readiness barrier.
    finally {
      console.info("exploration-metadata-barrier", { offset, ...facts });
      let browserFacts: unknown = { unavailable: true };
      let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
      try { browserFacts = await Promise.race([tab.evaluate(() => Reflect.get(window, "__explorationMetadataObservation") ?? { unavailable: true }), new Promise(resolve => { snapshotTimer = setTimeout(() => resolve({ unavailable: true, budgetEnded: true }), 250); })]); } catch { /* Closed page retains unknown browser consumption. */ }
      finally { clearTimeout(snapshotTimer); }
      console.info("exploration-metadata-consumption", JSON.stringify({ schedulingSensitiveObservation: true, observation: browserFacts }));
    }
  };
}
it("keeps proposed Torah, assigned Haftarah and true Lift exclusive in all six directed hearing transitions", async () => {
  await assign("haftarah"); const tab = await page(); let archiveRequests = 0, assignedTorah = 0; const bodies = new Set<string>();
  tab.on("request", request => { const url = new URL(request.url()); if (url.hostname === "archive.org") archiveRequests++;
    if (shortBodies.has(url.pathname)) bodies.add(url.pathname);
    if (/\/(study-text|study-word-aids|study-word-details|reference-audio(?:\/short\/page)?)$/.test(url.pathname) && url.searchParams.get("kind") === "torah") assignedTorah++; });
  const metadataReady = await shortMetadata(tab); await tutor(tab); await metadataReady();
  const proposed = portion(tab).getByRole("region", { name: "Reading playback", exact: true });
  // Both readings are on the page together; how they are stacked is layout, and each hearing below proves its own player works.
  await ui(portion(tab)).toBeVisible(); await ui(tab.getByTestId("assigned-haftarah-heading")).toBeVisible(); await ui(tab.getByTestId("assigned-text")).toBeVisible();
  // Modal must close before an underlying main slot can receive an actual click.
  for (const slot of ["proposed", "assigned", "lifted", "proposed", "lifted", "assigned", "proposed"] as const) {
    if (slot !== "lifted" && await tab.getByRole("dialog").count()) {
      await tab.getByRole("dialog").getByRole("button", { name: "Close practice view", exact: true }).click();
      await ui(tab.getByRole("dialog")).toHaveCount(0); expect(await audioState(tab)).toMatchObject({ active: 0, clean: true });
    }
    if (slot === "proposed") { await portion(tab).getByRole("button", { name: "Hear Genesis 1:1", exact: true }).click(); await heard(tab, proposed); }
    else if (slot === "assigned") { await tab.getByRole("button", { name: "Hear Haftarah", exact: true }).click();
      await heard(tab, tab.getByTestId("assigned-text").getByRole("region", { name: "Reading playback", exact: true })); }
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
  const tab = await page(); const metadataReady = await shortMetadata(tab); await tutor(tab); await metadataReady(); let release!: () => void;
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
  await position(tab, 101, 146, 146);
  await expect.poll(async () => (await audioState(tab)).clean).toBe(true); expect((await audioState(tab)).active).toBe(0);
  await tab.unroute("**/reference-audio/short-v1/*.mp3");
  const beforeSources = sourceRequests, beforeMetadata = metadataRequests;
  const response = tab.waitForResponse(r => new URL(r.url()).pathname.endsWith("/reading") && r.status() === 200);
  await tab.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); }); await response;
  await tab.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(sourceRequests).toBe(beforeSources); expect(metadataRequests).toBe(beforeMetadata); expect((await audioState(tab)).active).toBe(0);
});


it("an actual signed proposal deadline stops cached playback even before queued timer processing", async () => {
  const tab = await page();
  // Successful Hear below proves actual browser consumption and caching.
  // Capture the genuine preparation bytes at its exact endpoint: a duplicate
  // CDP body lookup can lose Chromium's resource even when the app read it.
  const metadata = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/reading/explore/reference/short/page") && response.status() === 200);
  const scope = contexts.find(scope => scope.context === tab.context()); if (!scope) throw Error("Exploration preparation ownership missing");
  const path = `/api/students/${fixture.student.id}/reading/explore/prepare`;
  let selected: unknown, captured = false;
  await tab.route(url => url.origin === BROWSER_ORIGIN && url.pathname === path, route => sourceRoute(scope, "fulfill", async () => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "POST" || url.search || request.postDataJSON()?.mode !== "tutor") throw Error("Exploration preparation request refused");
    const response = await privateRouteFetch(route, tab, { maxRedirects: 0, maxRetries: 0, timeout: 15000 });
    if (!response) throw Error("Exploration preparation response missing");
    try {
      const headers = response.headers(), declared = headers["content-length"];
      if (response.status() !== 200 || headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
        || declared !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(declared) || Number(declared) > 256 * 1024)) throw Error("Exploration preparation response refused");
      const bytes = await response.body(); if (!bytes.length || bytes.length > 256 * 1024) throw Error("Exploration preparation body refused");
      const digest = createHash("sha256").update(bytes).digest("hex");
      selected = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      // Buffered bytes are dechunked; preserve status, semantic headers and body.
      const forwarded: Record<string, string> = { ...headers, "content-length": String(bytes.length) }; delete forwarded["transfer-encoding"];
      await route.fulfill({ status: response.status(), headers: forwarded, body: bytes });
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
    } finally { await response.dispose(); }
    captured = true;
  }));
  await Promise.all([tutor(tab), metadata, ui.poll(() => captured, { timeout: 15000 }).toBe(true)]);
  const deadline = selected && typeof selected === "object" && "expiresAt" in selected ? selected.expiresAt : undefined;
  expect(typeof deadline === "number" && Number.isSafeInteger(deadline) && deadline > Date.now()).toBe(true);
  await portion(tab).getByRole("button", { name: "Hear Genesis 1:1", exact: true }).click();
  await heard(tab, portion(tab).getByRole("region", { name: "Reading playback", exact: true }));
  await tab.clock.install();
  // Uses the genuine returned claim deadline, not a rewritten response or signature.
  // Server-clock expiration remains separately covered by actual service tests.
  await tab.clock.setSystemTime(Number(deadline) + 1);
  await tab.evaluate(() => { const target = window; for (const media of target.explorationAudios) media.dispatchEvent(new Event("timeupdate")); });
  expect(await audioState(tab)).toMatchObject({ active: 0, clean: true });
  await ui(portion(tab).getByRole("region", { name: "Reading playback", exact: true }).getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  expect(await audioState(tab)).toMatchObject({ active: 0, clean: true });
});
