
import { generateSyntheticShortAudio, syntheticFourSecondShort } from "./synthetic-short-reference";
import { privateRouteFetch, observeSilentAudio, expectSilentAudio } from "./audio-observation";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdtemp, realpath, rm } from "node:fs/promises";
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
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

declare global { interface Window { toolsAudios: HTMLAudioElement[]; toolsRevoked: string[]; toolsBlobKinds: Record<string, "prime" | "word" | "verse"> } }
type TrackedWindow = Window;
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let directory: string | undefined, audioBytes: Buffer, shortBytes: Buffer, shortPath: string, siblingId: string, duplicateKeyWarnings = 0;
const contexts: BrowserContext[] = [], archiveUrl = "https://archive.org/download/PockettorahAudioFiles/Synthetic-player.mp3";
function mainStudyPage(request: StudyRequest) {
  const page = syntheticUiStudyPage(request);
  return { ...page, verses: page.verses.map(verse => ({ ...verse, hebrew: normalizeHebrew('בָּ֑ג־<span class="mam-kq"><span class="mam-kq-k">זָ</span><span class="mam-kq-q">[דָּ֖ג]</span></span><span class="mam-spi-samekh">{ס}</span>') })) };
}
const sourceAsset = "ra_" + "7".repeat(32);
async function api(tab: Page, path: string, body: unknown) {
  return tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.status; }, { path, body });
}
async function page(mobile = false, who: "admin" | "tutor" | "student" = "admin", authenticated?: BrowserContext) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false,
    ...(authenticated ? { storageState: await authenticated.storageState() } : {}) }); contexts.push(context);
  const state = { requests: 0, shortRequests: 0, archiveRequests: 0, corrupt: false, held: null as null | { release(): void; started: Promise<void> }, sawCookie: false, sawReferer: false };
  await context.addInitScript(() => {
    const target = window as TrackedWindow; target.toolsAudios = []; target.toolsRevoked = []; target.toolsBlobKinds = {};
    const create = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { const url = create(blob); target.toolsBlobKinds[url] = blob instanceof Blob && blob.type === "audio/wav" ? blob.size === 204 ? "prime" : "word" : "verse"; return url; };
    const AudioConstructor = window.Audio;
    window.Audio = new Proxy(AudioConstructor, { construct(original, args) { const audio = Reflect.construct(original, args) as HTMLAudioElement; target.toolsAudios.push(audio); return audio; } });
    const revoke = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = url => { target.toolsRevoked.push(url); revoke(url); };
  });
  await observeSilentAudio(context);
  let release!: () => void, began!: () => void;
  const gate = new Promise<void>(yes => { release = yes; }), started = new Promise<void>(yes => { began = yes; });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === archiveUrl || url.origin === BROWSER_ORIGIN && url.pathname === shortPath) {
      state.requests++; const source = url.href === archiveUrl ? audioBytes : shortBytes; if (url.href === archiveUrl) state.archiveRequests++; else state.shortRequests++; const headers = await request.allHeaders(); state.sawCookie ||= Boolean(headers.cookie); state.sawReferer ||= Boolean(headers.referer);
      if (state.held) { began(); await gate; }
      const body = state.corrupt ? Buffer.from(source.map((value, index) => index === 200 ? value ^ 1 : value)) : source;
      try { await route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "access-control-allow-origin": BROWSER_ORIGIN, "content-length": String(body.length), "cache-control": "no-store" }, body }); } catch { /* Scope teardown may abort the routed request. */ }
    } else if (url.origin === BROWSER_ORIGIN) await route.continue(); else await route.abort();
  });
  const tab = await context.newPage(); tab.on("console", message => { if (message.text().includes("Encountered two children with the same key")) duplicateKeyWarnings++; }); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!authenticated) { const email = `pg-${who}@example.test`; expect(await api(tab, "/api/auth/sign-in/magic-link", { email })).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); }
  await tab.goto((who === "student" ? "/workspace/student?tab=reading" : `/workspace/${who === "admin" ? "admin/students" : "tutor"}/${fixture.student.id}${who === "admin" ? "/reading" : ""}`), { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  return { tab, state, hold() { state.held = { release, started }; return state.held; } };
}
const player = (tab: Page) => tab.getByRole("region", { name: "Reading playback", exact: true });
const word = (tab: Page, verse: number, index: number) => tab.locator(`.study-verses [data-verse-ref="Genesis 1:${verse}"] [data-word-index="${index}"]`).first();
async function playing(tab: Page) { await expect.poll(async () => { const current = await native(tab); return (current.kind === "verse" || current.kind === "word") && current.paused === false && (current.readyState ?? 0) >= 2; }).toBe(true); await ui(player(tab).getByRole("button", { name: "Pause", exact: true })).toBeVisible(); }
async function native(tab: Page) { return tab.evaluate(() => { const a = (window as TrackedWindow).toolsAudios.at(-1); return { count: (window as TrackedWindow).toolsAudios.length, paused: a?.paused, kind: a?.src ? window.toolsBlobKinds[a.src] : undefined, readyState: a?.readyState, duration: a?.duration, currentTime: a?.currentTime, rate: a?.playbackRate, preservesPitch: a?.preservesPitch, src: a?.getAttribute("src"), revoked: (window as TrackedWindow).toolsRevoked.length }; }); }

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
  fixture = await browserFixture({ referenceShortManifestLoad: async () => short.manifest, studyLoad: async request => mainStudyPage(request), referenceCatalogLoad: async () => catalog, referenceStudentRelease: true,
    wordDetailsSource: { book: async () => parseTahot([1,2,3].flatMap(n => [`Gen.1.${n}#1=L\tבָּג\tDISCARDED\tSynthetic occurrence first\t{H0001}\tHNcmsa\t`, `Gen.1.${n}#2=L\tדָּג\tDISCARDED\tSynthetic occurrence second\t{H0001}\tHNcmsa\t`]).join("\n"), "Gen"), lexicon: async () => parseTbesh("H0001#1\tH0001\tH0001\tבָּג\tDISCARDED\tHVqp3ms\tSynthetic dictionary sense\tDISCARDED") } });
  siblingId = (await fixture.practice()).sibling.id;
  const learner = await fixture.signIn("pg-student"), [learnerMembership] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
  const [learnerGrant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: learnerMembership.id, role: "student" }).returning();
  await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: learnerGrant.id });
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
  expect(duplicateKeyWarnings).toBe(0);
}, 120_000);

const tools = (tab: Page) => tab.getByRole("region", { name: "Word tools", exact: true });
async function openTools(tab: Page) { await tools(tab).getByRole("button", { name: "Word tools", exact: true }).click(); await ui(tools(tab).getByText("Synthetic dictionary sense", { exact: true })).toBeVisible(); }
it("keeps tools closed on primary word playback; explicit open remembers that word and silent navigation ignores audio ticks", async () => {
  const { tab, state } = await page(); let requests = 0;
  tab.on("request", request => { if (/\/study-word-(aids|details)$/.test(new URL(request.url()).pathname)) requests++; });
  await ui(tools(tab).getByRole("button", { name: "Word tools" })).toHaveAttribute("aria-expanded", "false");
  await word(tab, 1, 1).click(); await playing(tab);
  await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse"); expect((await native(tab)).currentTime).toBeGreaterThanOrEqual(0); expect(Math.round((await native(tab)).duration! * 24000)).toBe(96000); expect((await native(tab)).kind).toBe("verse"); expect(state.shortRequests).toBe(1); expect(state.archiveRequests).toBe(0); expect((await native(tab)).currentTime).toBeLessThan(2);
  await player(tab).getByRole("button", { name: "Repeat", exact: true }).click(); expect(requests).toBe(0);
  await openTools(tab); await ui(tools(tab)).toContainText("Word 2 of 2"); await ui(tools(tab)).toContainText("Synthetic occurrence second");
  await tools(tab).getByRole("button", { name: "Next word", exact: true }).click(); await ui(tools(tab)).toContainText("Genesis 1:2"); await ui(tools(tab)).toContainText("Word 1 of 2");
  await ui(player(tab)).toContainText("Genesis 1:1"); await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("verse");
  await ui(tools(tab).getByText("Synthetic occurrence first", { exact: true })).toBeVisible(); const settled = requests;
  // Native repeat/highlight callbacks never select or fetch a study word.
  await tab.evaluate(() => { const audio = window.toolsAudios.at(-1)!; audio.currentTime = 1.5; audio.dispatchEvent(new Event("timeupdate")); });
  await ui(tools(tab)).toContainText("Genesis 1:2"); expect(requests).toBe(settled); expect(state.requests).toBe(1);
  await tools(tab).getByRole("button", { name: "Hear this word", exact: true }).click(); await playing(tab); await ui(player(tab)).toContainText("Genesis 1:2");
  await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("0"); expect((await native(tab)).currentTime).toBeGreaterThanOrEqual(0); expect(Math.round((await native(tab)).duration! * 24000)).toBe(45600); expect((await native(tab)).kind).toBe("word"); expect((await native(tab)).currentTime).toBeLessThan(2); expect(state.requests).toBe(1);
  expect(state.sawCookie || state.sawReferer).toBe(false);
});
it("supports phone keyboard study with no loaded audio; qere/maqaf, independent holds and stress remain in flow", async () => {
  const { tab, state } = await page(true, "student");
  const disclosure = tools(tab).getByRole("button", { name: "Word tools", exact: true }); await disclosure.focus(); await disclosure.press("Enter");
  await ui(tools(tab).getByText("Synthetic dictionary sense", { exact: true })).toBeVisible(); await expectSilentAudio(tab); expect(state.requests).toBe(0);
  await ui(tools(tab).getByRole("heading", { name: "Meaning in this verse", exact: true })).toBeVisible();
  // Meaning first, pronunciation one row below (S23).
  expect(await tools(tab).locator("h5").allTextContents()).toEqual(["Meaning in this verse", "Syllables and stress", "Grammar", "This word elsewhere", "Dictionary senses"]);
  // The exact pure fixture proves first maqaf word has no tonic; do not invent one.
  await ui(tools(tab).getByRole("group", { name: "Hebrew syllables", exact: true })).toBeVisible(); await ui(tools(tab).locator('[data-stress="tonic"]')).toHaveCount(0);
  const next = tools(tab).getByRole("button", { name: "Next word", exact: true }); await next.focus(); await next.press("Enter"); await ui(tools(tab)).toContainText("Word 2 of 2"); await expectSilentAudio(tab); expect(state.requests).toBe(0);
  const tonic = tools(tab).locator('[data-stress="tonic"]'); await ui(tonic).toHaveCount(1);
  const description = await tonic.getAttribute("aria-describedby"); expect(description).toBeTruthy(); await ui(tab.locator(`[id="${description}"]`)).toContainText("primary stress");
  await ui(tools(tab).getByRole("heading", { name: "דָּ֖ג", exact: true })).toBeVisible();
  await tab.getByRole("button", { name: "Colors", exact: true }).click(); await ui(tab.locator(".study-verses [data-family]")).toHaveCount(0);
  await word(tab, 1, 0).click(); await playing(tab); await ui(tools(tab)).toContainText("Word 1 of 2");
  await tab.route("**/study-word-details?**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' }));
  await tools(tab).getByRole("button", { name: "Next word", exact: true }).click(); await ui(tools(tab).getByRole("button", { name: "Try word tools again", exact: true })).toBeVisible();
  await ui(tools(tab).locator('[data-stress="tonic"]')).toHaveCount(1); await tools(tab).getByRole("button", { name: "Hear this word", exact: true }).click(); await playing(tab);
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const geometry = await tools(tab).evaluate(node => { const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return { left: rect.left, right: rect.right, position: style.position }; });
  expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(390); expect(geometry.position).toBe("static");
});
it("fences out-of-order held responses and dismissal; quiet unchanged return retains the same private selection without refetch", async () => {
  const { tab } = await page(false, "admin", contexts[0]); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  await tab.route("**/study-word-details?**", async route => { const response = await privateRouteFetch(route, tab); if (!response) return; if (new URL(route.request().url()).searchParams.get("wordIndex") === "0") { entered(); await gate; } try { await route.fulfill({ response }); } catch {} });
  await tools(tab).getByRole("button", { name: "Word tools", exact: true }).click(); await started;
  await tools(tab).getByRole("button", { name: "Next word", exact: true }).click(); await ui(tools(tab).getByText("Synthetic occurrence second", { exact: true })).toBeVisible(); release();
  await ui(tools(tab)).toContainText("Word 2 of 2"); await ui(tools(tab).getByText("Synthetic occurrence first", { exact: true })).toHaveCount(0);
  let requests = 0; tab.on("request", request => { if (/\/study-word-(aids|details)$/.test(new URL(request.url()).pathname)) requests++; });
  await ui(tools(tab).locator('[data-stress="tonic"]')).toHaveCount(1);
  let sessions = 0; tab.on("response", response => { if (new URL(response.url()).pathname === "/api/session" && response.status() === 200) sessions++; });
  await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect.poll(() => sessions).toBe(4);
  await ui(tools(tab)).toContainText("Word 2 of 2"); expect(requests).toBe(0);
  await tools(tab).getByRole("button", { name: "Word tools", exact: true }).click(); await ui(tools(tab).getByText("Synthetic occurrence second", { exact: true })).toHaveCount(0);
  await tab.context().clearCookies(); await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); await ui(tools(tab)).toHaveCount(0);
});
it("clears selected private tools on actual assignment and child-context changes", async () => {
  const { tab } = await page(false, "tutor"); await openTools(tab);
  await tab.getByRole("link", { name: "Parent", exact: true }).click(); await ui(tools(tab)).toHaveCount(0);
  await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click(); await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click(); await ui(tab.locator(".study-verses")).toBeVisible(); await openTools(tab);
  await tab.getByRole("button", { name: "Switch practice to Synthetic Sibling", exact: true }).click(); await ui(tab.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible();
  await ui(tools(tab).getByRole("button", { name: "Word tools", exact: true })).toHaveAttribute("aria-expanded", "false"); await ui(tools(tab).getByText("Synthetic dictionary sense", { exact: true })).toHaveCount(0);
  await openTools(tab);
  const [assignment] = await fixture.ownerDb.select().from(s.assignment).where(eq(s.assignment.studentId, siblingId));
  await fixture.ownerDb.update(s.assignment).set({ revision: assignment.revision + 1 }).where(eq(s.assignment.id, assignment.id));
  const reload = tab.waitForResponse(response => new URL(response.url()).pathname.endsWith("/study-text") && response.status() === 200); await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await reload;
  await ui(tools(tab).getByRole("button", { name: "Word tools", exact: true })).toHaveAttribute("aria-expanded", "false"); await ui(tools(tab).getByText("Synthetic dictionary sense", { exact: true })).toHaveCount(0);
});
