import { privateRouteFetch } from "./audio-observation";
import { generateSyntheticShortAudio, syntheticFourSecondShort } from "./synthetic-short-reference";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";



import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

declare global { interface Window { referenceAudios: HTMLAudioElement[]; referenceRevoked: string[]; referencePageFetches: { ownerOrdinal: number; signal: AbortSignal | null; success: boolean; failed: boolean }[]; referenceBlobKinds: Record<string, "prime" | "word" | "verse"> } }
type TrackedWindow = Window;
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let directory: string | undefined, audioBytes: Buffer, shortBytes: Buffer, shortPath: string, siblingId: string;
const contexts: BrowserContext[] = [], archiveUrl = "https://archive.org/download/PockettorahAudioFiles/Synthetic-player.mp3";
// Reuse a verified session per actor; never copy later role/child-practice state.
const authenticatedStates = new Map<"admin" | "tutor", Awaited<ReturnType<BrowserContext["storageState"]>>>();
let setListeningRelease: (value: boolean) => void;
function mainStudyPage(request: StudyRequest) {
  const page = syntheticUiStudyPage(request);
  return { ...page, verses: page.verses.map(verse => ({ ...verse, hebrew: normalizeHebrew('אָ֑ב־<span class="mam-kq"><span class="mam-kq-k">זָ</span><span class="mam-kq-q">[גַּ]</span></span><span class="mam-spi-samekh">{ס}</span>') })) };
}
const sourceAsset = "ra_" + "7".repeat(32);
async function api(tab: Page, path: string, body: unknown) {
  return tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.status; }, { path, body });
}
async function page(mobile = false, who: "admin" | "tutor" = "admin", authenticated?: BrowserContext, options: { held?: boolean; colorScheme?: "light" | "dark"; destination?: string } = {}) {
  const storageState = authenticated ? await authenticated.storageState() : authenticatedStates.get(who);
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false,
    ...(storageState ? { storageState } : {}), colorScheme: options.colorScheme }); contexts.push(context);
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
  if (!storageState) { const email = `pg-${who}@example.test`; expect(await api(tab, "/api/auth/sign-in/magic-link", { email })).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); authenticatedStates.set(who, await context.storageState()); }
  await tab.goto(options.destination ?? `/workspace/${who === "admin" ? "admin/students" : "tutor"}/${fixture.student.id}${who === "admin" ? "/reading" : ""}`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  const owner = options.held ? { count: 0, ordinal: 0 } : await settledOwner(tab);
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
  let physicalFrames = 0;
  try {
    directory = await realpath(await mkdtemp(join(tmpdir(), "reference-player-audio-")));
    const generated = await generateSyntheticShortAudio(directory, "torah");
    audioBytes = generated.parent; shortBytes = Buffer.from(generated.bytes); physicalFrames = generated.physicalFrames;
  } catch { throw new Error("Runtime synthetic audio generation failed; details withheld"); }
  const sample = mainStudyPage({ kind: "torah", ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], offset: 0, translation: "jps2023" });
  const digest = createHash("sha256").update(audioBytes).digest("hex");
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: sourceAsset, archiveFile: "Synthetic-player.mp3", sha256: digest, bytes: audioBytes.length,
    verses: sample.verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); if (projection.status !== "ready" || projection.projection.words.length !== 2) throw new Error("Synthetic word projection refused");
      return { schema: "reference-verse/v1", ref: verse.ref, table: "torah", playback: { status: "ready", asset: sourceAsset, clip: { start: 1, end: 5 } }, words: { status: "ready", readingTextSha256: createHash("sha256").update(verse.hebrew.readingText.normalize("NFC")).digest("hex"), starts: [1.1, 3] }, attribution: REFERENCE_ATTRIBUTION }; }) }] });
  if (!catalog) throw new Error("Synthetic reference catalog refused");
  const short = await syntheticFourSecondShort(catalog, shortBytes, physicalFrames); shortPath = short.path; shortBytes = short.bytes;
  const manifest = short.manifest;
  fixture = await browserFixture({ studyLoad: async request => mainStudyPage(request), referenceCatalogLoad: async () => catalog, referenceShortManifestLoad: async () => manifest, referenceStudentRelease: true });
  setListeningRelease = studentRelease => { Object.assign(fixture.runtime, { shortReferenceAudio: createShortReferenceAudioService({ access: fixture.runtime.access, practice: fixture.runtime.practice, loadText: async request => mainStudyPage(request), loadCatalog: async () => catalog, loadManifest: async () => manifest, studentRelease }) }); };
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
  if (directory && resolve(directory).startsWith(await realpath(tmpdir()) + sep)) await rm(directory, { recursive: true, force: true });
}, 120_000);



it("toggles adjacent English during main playback without replacing its owner or fetching another source", async () => {
  const { tab, state, owner } = await page();
  await word(tab, 1, 1).click(); await playing(tab); await sameOwner(tab, owner);
  // Natural EOF may occur while assertions run; keep the same whole verse looping.
  await player(tab).getByRole("button", { name: "Repeat", exact: true }).click();
  await ui(player(tab).getByRole("button", { name: "Repeat", exact: true })).toHaveAttribute("aria-pressed", "true");
  const current = await native(tab), counts = { body: state.shortRequests, archive: state.archiveRequests, pages: state.pageRequests };
  const stillSelected = async () => {
    await sameOwner(tab, owner); await playing(tab);
    expect((await native(tab)).src).toBe(current.src);
    await ui(player(tab)).toContainText("Genesis 1:1");
    await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
    // The native clock/index may advance or wrap. Highlighting must remain on this verse's actual words.
    await ui.poll(() => tab.locator('.study-verses [data-reference-active="true"]').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => node.closest('[data-verse-ref]')?.getAttribute('data-verse-ref') === 'Genesis 1:1' && ['0', '1'].includes(node.getAttribute('data-word-index') ?? '')))).toBe(true);
  };
  const toggle = tab.getByRole("navigation", { name: "Reading tools", exact: true }).getByRole("button", { name: "English", exact: true });
  const initial = await toggle.getAttribute("aria-pressed");
  await toggle.click(); await ui(toggle).toHaveAttribute("aria-pressed", initial === "true" ? "false" : "true");
  await stillSelected();
  await toggle.click(); await ui(toggle).toHaveAttribute("aria-pressed", initial!);
  await stillSelected();
  expect({ body: state.shortRequests, archive: state.archiveRequests, pages: state.pageRequests }).toEqual(counts);
  await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
});

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

it("held student and child practice read directly, keep word tools and open optional practice without media", async () => {
  const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.tutor.id));
  const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
  setListeningRelease(false);
  const captures: { name: string; width: number; height: number; sha256: string }[] = []; let authenticated: BrowserContext | undefined;
  try {
    for (const [mobile, scheme] of [[false, "light"], [false, "dark"], [true, "light"], [true, "dark"]] as const) {
      const { tab, state } = await page(mobile, "tutor", authenticated, { held: true, colorScheme: scheme, destination: "/workspace/student" }); authenticated ??= tab.context();
      const reading = tab.locator(".study-verses"); await ui(player(tab)).toHaveCount(0); await ui(tab.getByRole("dialog")).toHaveCount(0);
      await ui(tab.getByRole("button", { name: /^Hear/ })).toHaveCount(0); await ui(word(tab, 1, 1)).toHaveAttribute("aria-label", "Select word 2 of Genesis 1:1 for tools");
      const start = tab.getByRole("button", { name: "Start reading", exact: true }); await start.focus(); await tab.keyboard.press("Enter");
      await ui(reading).toBeFocused(); await ui(tab.getByRole("dialog")).toHaveCount(0); expect(await native(tab)).toMatchObject({ count: 0, allClean: true });
      expect(state.pageRequests).toBe(0); expect(state.requests).toBe(0);
      await word(tab, 1, 1).click(); const tools = tab.getByRole("button", { name: "Word tools", exact: true }); await ui(tools).toHaveAttribute("aria-expanded", "false");
      await tools.click(); await ui(tools).toHaveAttribute("aria-expanded", "true");
      await ui(tab.getByRole("region", { name: "Word tools", exact: true })).toBeVisible(); await ui(tab.getByText("· Word 2 of 2", { exact: false })).toBeVisible(); await ui(tab.getByRole("button", { name: "Hear this word", exact: true })).toHaveCount(0);
      await tab.getByRole("button", { name: "Word tools", exact: true }).click();
      await tab.getByRole("button", { name: "Practice up close", exact: true }).click();
      const dialog = tab.getByRole("dialog", { name: "Genesis 1:1", exact: true }); await ui(dialog).toBeVisible();
      await ui(dialog.getByRole("region", { name: "Reading playback", exact: true })).toHaveCount(0);
      const working = dialog.getByRole("button", { name: "Still working", exact: true }); if (await working.getAttribute("aria-pressed") !== "true") await working.click(); await ui(working).toHaveAttribute("aria-pressed", "true");
      expect(state.pageRequests).toBe(0); expect(state.requests).toBe(0); expect(await native(tab)).toMatchObject({ count: 0, allClean: true });
      await dialog.getByRole("button", { name: "Close practice view", exact: true }).click(); await ui(tab.getByRole("button", { name: "Practice up close", exact: true })).toBeFocused();
      const directory = process.env.HELD_LISTENING_UI_CAPTURE_DIR;
      if (directory) {
        const target = resolve(directory); if (!target.startsWith(resolve(".local-logs") + sep)) throw Error("Held listening capture directory refused");
        await mkdir(target, { recursive: true }); const name = `${mobile ? "phone" : "desktop"}-${scheme}`;
        await tab.evaluate(() => window.scrollTo(0, 0)); const image = join(target, name + ".png"); await tab.screenshot({ path: image });
        captures.push({ name, width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, sha256: createHash("sha256").update(await readFile(image)).digest("hex") });
      }
      await tab.goto("/workspace/parent", { waitUntil: "domcontentloaded" }); await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click();
      await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click(); await ui(reading).toBeVisible();
      await tab.getByRole("button", { name: "Start reading", exact: true }).click(); await ui(reading).toBeFocused();
      await tab.getByRole("button", { name: "Practice up close", exact: true }).click(); await ui(tab.getByRole("dialog", { name: "Genesis 1:1", exact: true })).toBeVisible();
      expect(state.pageRequests).toBe(0); expect(state.requests).toBe(0); expect(await native(tab)).toMatchObject({ count: 0, allClean: true });
      await tab.getByRole("dialog").getByRole("button", { name: "Close practice view", exact: true }).click();
      expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const directory = process.env.HELD_LISTENING_UI_CAPTURE_DIR; if (directory) await writeFile(join(resolve(directory), "manifest.json"), JSON.stringify({ synthetic: true, images: captures }, null, 2) + "\n", { flag: "wx" });
  } finally { setListeningRelease(true); }
});

it("held tutor Start returns from another tab to focused continuous text and practice stays optional", async () => {
  setListeningRelease(false);
  try {
    const { tab, state } = await page(false, "tutor", undefined, { held: true });
    await tab.getByRole("tab", { name: "Service parts", exact: true }).click(); await tab.getByRole("button", { name: "Start reading", exact: true }).click();
    await ui(tab.getByRole("tab", { name: "Reading", exact: true })).toHaveAttribute("aria-selected", "true"); await ui(tab.locator(".study-verses")).toBeFocused();
    await ui(tab.getByRole("dialog")).toHaveCount(0); expect(state.pageRequests).toBe(0); expect(state.requests).toBe(0); expect(await native(tab)).toMatchObject({ count: 0, allClean: true });
    await tab.getByRole("button", { name: "Practice up close", exact: true }).click(); await ui(tab.getByRole("dialog", { name: "Genesis 1:1", exact: true })).toBeVisible();
    expect(state.pageRequests).toBe(0); expect(state.requests).toBe(0); expect(await native(tab)).toMatchObject({ count: 0, allClean: true });
  } finally { setListeningRelease(true); }
});
// Synthetic text/cues with real normalized native media. This is not real-corpus,
// acoustic, Safari/phone or click-to-sound evidence.
it("advances synthetic main-text highlights on the native verse clock and repeats whole verses after native EOF", async () => {
  const { tab, state, owner } = await page();
  await word(tab, 1, 1).click(); await playing(tab); await sameOwner(tab, owner);
  await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
  await ui(player(tab).getByRole("button", { name: "Repeat", exact: true })).toHaveAttribute("aria-pressed", "false");
  const prepared = await native(tab), preparedRequests = state.pageRequests;
  expect(prepared.kind).toBe("verse"); expect(Math.round(prepared.duration! * 24000)).toBe(96000);
  expect(state.shortRequests).toBe(1); expect(state.archiveRequests).toBe(0);
  const first = await tab.evaluate(async () => {
    const media = window.referenceAudios.at(-1)!;
    const proof = { ended: 0, playing: 0, source: media.src, initial: media.currentTime };
    Reflect.set(window, "referenceMainClockProof", proof);
    media.addEventListener("ended", () => { proof.ended++; });
    media.addEventListener("playing", () => { proof.playing++; });
    const active = () => [...new Set(Array.from(document.querySelectorAll('.study-verses [data-verse-ref="Genesis 1:1"] [data-reference-active="true"]')).map(el => Number(el.getAttribute("data-word-index"))))];
    // Independent fixture oracle: source onsets [1.1, 3], source clip [1, 5].
    // Interior quarters avoid racing the exact onset boundary; clock is never assigned.
    const starts = [1.1, 3], clipStart = 1, clipEnd = 5, seen = new Set<number>();
    let samples = 0, mismatches = 0;
    const highlighted = await new Promise<boolean>(done => {
      let settled = false; const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); done(ok); } };
      const timer = setTimeout(() => finish(false), 10000);
      const sample = () => {
        if (settled) return; samples++;
        const sourceTime = clipStart + media.currentTime;
        for (let i = 0; i < starts.length; i++) {
          const left = starts[i], right = starts[i + 1] ?? clipEnd;
          if (!media.paused && !media.ended && media.src === proof.source && sourceTime > left + (right - left) / 4 && sourceTime < right - (right - left) / 4) {
            const indices = active(); if (indices.length === 1 && indices[0] === i) seen.add(i); else mismatches++;
          }
        }
        if (seen.size === 2) finish(true); else if (media.ended || media.src !== proof.source) finish(false); else requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    const afterHighlights = media.currentTime;
    const nearEnd = highlighted && await new Promise<boolean>(done => {
      let settled = false; const finish = (ok: boolean) => { if (!settled) { settled = true; clearTimeout(timer); done(ok); } };
      const timer = setTimeout(() => finish(false), 6000);
      const sample = () => { if (settled) return; if (media.ended || media.paused || media.src !== proof.source) finish(false);
        else if (media.currentTime >= media.duration - 0.35) finish(true); else requestAnimationFrame(sample); }; requestAnimationFrame(sample);
    });
    if (nearEnd) { const start = performance.now(); while (performance.now() - start < 950) { /* Deliberately stall UI across native EOF. */ } }
    // Observe only after the event loop resumes; native ended event must actually fire.
    await new Promise<void>(done => setTimeout(done, 0));
    return { highlighted, distinct: seen.size, samples, mismatches, initial: proof.initial, afterHighlights, nearEnd,
      endedEvents: proof.ended, ended: media.ended, paused: media.paused, finalClock: media.currentTime, activeIndices: active(), sameSource: media.src === proof.source };
  });
  console.log("Synthetic main native-clock EOF: " + JSON.stringify(first));
  expect(first.highlighted).toBe(true); expect(first.distinct).toBe(2); expect(first.mismatches).toBe(0);
  expect(first.afterHighlights).toBeGreaterThan(first.initial); expect(first.nearEnd).toBe(true);
  await expect.poll(async () => tab.evaluate(() => Reflect.get(window, "referenceMainClockProof").ended)).toBe(1);
  expect(first.ended).toBe(true); expect(first.paused).toBe(true); expect(first.sameSource).toBe(true);
  await ui(word(tab, 1, 0)).not.toHaveAttribute("data-reference-active", "true");
  await ui(word(tab, 1, 1)).not.toHaveAttribute("data-reference-active", "true");
  await player(tab).getByRole("button", { name: "Play", exact: true }).click(); await playing(tab);
  await player(tab).getByRole("button", { name: "Repeat", exact: true }).click();
  await ui(player(tab).getByRole("button", { name: "Repeat", exact: true })).toHaveAttribute("aria-pressed", "true");
  const repeated = await tab.evaluate(async () => {
    const media = window.referenceAudios.at(-1)!, proof = Reflect.get(window, "referenceMainClockProof") as { ended: number; playing: number; source: string };
    let previous = media.currentTime, reset = false, samples = 0;
    const baseline = proof.ended;
    return new Promise<{ ok: boolean; reset: boolean; samples: number; endedEvents: number; playingEvents: number; currentTime: number; sameSource: boolean; activeIndex: number | null }>(done => {
      let settled = false; const finish = (ok: boolean, activeIndex: number | null = null) => { if (!settled) { settled = true; clearTimeout(timer); done({ ok, reset, samples, endedEvents: proof.ended, playingEvents: proof.playing, currentTime: media.currentTime, sameSource: media.src === proof.source, activeIndex }); } };
      const timer = setTimeout(() => finish(false), 10000);
      const sample = () => {
        if (settled) return; samples++; const clock = media.currentTime;
        if (proof.ended > baseline && clock < previous) reset = true; previous = clock;
        const indices = [...new Set(Array.from(document.querySelectorAll('.study-verses [data-verse-ref="Genesis 1:1"] [data-reference-active="true"]')).map(el => Number(el.getAttribute("data-word-index"))))];
        if (reset && proof.ended === baseline + 1 && proof.playing >= 2 && !media.paused && !media.ended && media.src === proof.source && clock > 0.575 && clock < 1.525 && indices.length === 1 && indices[0] === 0) finish(true, 0);
        else if (media.src !== proof.source) finish(false); else requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
  });
  console.log("Synthetic main native Verse repeat: " + JSON.stringify(repeated));
  expect(repeated.ok).toBe(true); expect(repeated.reset).toBe(true); expect(repeated.endedEvents).toBe(2); expect(repeated.activeIndex).toBe(0); expect(repeated.sameSource).toBe(true);
  await sameOwner(tab, owner); expect((await native(tab)).src).toBe(prepared.src);
  expect(state.shortRequests).toBe(1); expect(state.archiveRequests).toBe(0); expect(state.pageRequests).toBe(preparedRequests);
  expect(await native(tab)).toMatchObject({ pageIssued: prepared.pageIssued, pageSuccessful: prepared.pageSuccessful, kind: "verse" });
  await player(tab).getByRole("button", { name: "Pause", exact: true }).click(); expect((await native(tab)).paused).toBe(true);
  await ui(word(tab, 1, 0)).not.toHaveAttribute("data-reference-active", "true");
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
  await service.click(); await ui(service).toHaveAttribute("aria-selected", "true"); await tab.getByRole("button", { name: "Start reading", exact: true }).click();
  await ui(reading).toHaveAttribute("aria-selected", "true"); await playing(tab); await ui(tab.getByRole("dialog")).toHaveCount(0); expect(state.requests).toBe(1); expect(state.shortRequests).toBe(1); expect(state.archiveRequests).toBe(0);
  await service.click(); await expect.poll(async () => (await native(tab)).revoked).toBe(1); expect((await native(tab)).paused).toBe(true);
  await reading.click(); expect(await native(tab)).toMatchObject({ ...owner, paused: true, src: null, retiredClean: true });
  await tab.getByRole("button", { name: "Hear verse", exact: true }).click(); await playing(tab); expect(state.shortRequests).toBe(2); expect(state.archiveRequests).toBe(0); expect(state.requests).toBe(2); await sameOwner(tab, owner); await ui(tab.getByRole("dialog")).toHaveCount(0);
});
it("plays main verses without word timing but refuses explicit untimed word drills", async () => {
  const { tab } = await page(false, "admin", contexts[0]);
  await tab.route("**/reference-audio/short/page?**", async route => { const actual = await privateRouteFetch(route, tab); if (!actual) return; const body = await actual.json(); for (const reference of body.page.references) reference.verse.words = { status: "unavailable", reason: "no-words" }; await route.fulfill({ response: actual, json: body }); });
  await tab.reload(); await ui(tab.locator(".study-verses")).toBeVisible(); const untimedOwner = await settledOwner(tab); // Install the control before the new owner's optional metadata preparation.
  await word(tab, 1, 1).click(); await playing(tab); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
  await ui(tab.locator('.study-verses [data-reference-active="true"]')).toHaveCount(0);
  await player(tab).getByLabel("Practice", { exact: true }).selectOption("1"); await ui(player(tab).getByText(/Choose Whole verse to listen/)).toBeVisible(); expect((await native(tab)).paused).toBe(true);
  await ui(player(tab).getByRole("button", { name: "Play", exact: true })).toBeDisabled(); await ui(player(tab).getByRole("button", { name: "Repeat", exact: true })).toBeDisabled();
  await player(tab).getByLabel("Practice", { exact: true }).selectOption("verse"); await playing(tab);
  await tab.getByRole("button", { name: "Word tools", exact: true }).click(); await tab.getByRole("button", { name: "Hear this word", exact: true }).click();
  await expect.poll(async () => (await native(tab)).paused).toBe(true); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("1"); await ui(player(tab).getByRole("button", { name: "Play", exact: true })).toBeDisabled(); await sameOwner(tab, untimedOwner);
});


it("true per-verse Lift is inert on navigation, uses current whole Verse and explicit Word without Archive", async () => {
  const { tab, state, owner: mainOwner } = await page();
  await tab.getByRole("button", { name: "Practice up close", exact: true }).click();
  const optional = tab.getByRole("dialog", { name: "Genesis 1:1", exact: true }); await ui(optional).toBeVisible();
  const optionalOwner = await settledOwner(tab);
  expect(state.requests).toBe(0); expect(await native(tab)).toMatchObject({ paused: true, src: null, mediaBlobs: 0 });
  await optional.getByRole("button", { name: "Close practice view", exact: true }).click();
  expect(await native(tab)).toMatchObject({ count: optionalOwner.count, allClean: true }); expect(state.requests).toBe(0);
  await word(tab, 1, 0).click();
  // Closing Lift disposes its later Audio; the retained main controller owns the
  // original ordinal. Probe it explicitly without relaxing the latest-owner oracle.
  await expect.poll(() => tab.evaluate(ordinal => {
    const w = window as TrackedWindow, audio = w.referenceAudios[ordinal - 1];
    return { count: w.referenceAudios.length, ordinal: audio ? w.referenceAudios.indexOf(audio) + 1 : 0,
      kind: audio?.src ? w.referenceBlobKinds[audio.src] : undefined, ready: (audio?.readyState ?? 0) >= 2, paused: audio?.paused,
      active: w.referenceAudios.filter(media => !media.paused && Boolean(media.getAttribute("src"))).length,
      othersClean: w.referenceAudios.every(media => media === audio || media.paused && !media.getAttribute("src")) };
  }, mainOwner.ordinal)).toEqual({ count: optionalOwner.count, ordinal: mainOwner.ordinal, kind: "verse", ready: true, paused: false, active: 1, othersClean: true });
  await ui(player(tab).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await tab.getByRole("button", { name: "View Genesis 1:1 up close", exact: true }).click();
  const dialog = tab.getByRole("dialog", { name: "Genesis 1:1", exact: true }), modalPlayer = dialog.getByRole("region", { name: "Reading playback", exact: true });
  await ui(dialog).toBeVisible(); await ui(modalPlayer).toContainText("Genesis 1:1");
  const modalOwner = await settledOwner(tab), before = state.shortRequests;
  expect(await native(tab)).toMatchObject({ paused: true, src: null, retiredClean: true });
  await modalPlayer.getByRole("button", { name: "Play", exact: true }).click(); await playing(tab); expect(state.shortRequests).toBe(before + 1);
  await modalPlayer.getByRole("button", { name: "Pause", exact: true }).click();
  const halfway = 0.5; await tab.evaluate(value => { window.referenceAudios.at(-1)!.currentTime = value; }, halfway);
  await modalPlayer.getByRole("button", { name: "Play", exact: true }).click(); await playing(tab); expect((await native(tab)).currentTime).toBeGreaterThanOrEqual(halfway);
  await modalPlayer.getByLabel("Practice", { exact: true }).selectOption("1"); await playing(tab); expect(Math.round((await native(tab)).duration! * 24000)).toBe(48000);
  // Visual teaching chunks are not audio phrases; each step only stops sound.
  for (let step = 0; step < 2 && await dialog.getByRole("button", { name: "Next phrase", exact: true }).count(); step++) await dialog.getByRole("button", { name: "Next phrase", exact: true }).click();
  await dialog.getByRole("button", { name: "Next verse", exact: true }).click();
  const nextDialog = tab.getByRole("dialog", { name: "Genesis 1:2", exact: true }); await ui(nextDialog).toBeVisible();
  const nextPlayer = nextDialog.getByRole("region", { name: "Reading playback", exact: true }); await ui(nextPlayer).toContainText("Genesis 1:2"); await ui(nextPlayer.getByLabel("Practice", { exact: true })).toHaveValue("verse");
  await sameOwner(tab, modalOwner); expect(await native(tab)).toMatchObject({ paused: true, src: null });
  await nextPlayer.getByRole("button", { name: "Play", exact: true }).click(); await playing(tab); await sameOwner(tab, modalOwner);
  await nextDialog.getByRole("button", { name: "Close practice view", exact: true }).click();
  await ui(tab.getByRole("dialog")).toHaveCount(0); expect(await native(tab)).toMatchObject({ allClean: true }); expect(state.archiveRequests).toBe(0);
});
