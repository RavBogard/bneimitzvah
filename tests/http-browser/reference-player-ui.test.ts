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
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

declare global { interface Window { referenceAudios: HTMLAudioElement[]; referenceRevoked: string[] } }
type TrackedWindow = Window;
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let directory: string | undefined, audioBytes: Buffer, siblingId: string;
const contexts: BrowserContext[] = [], archiveUrl = "https://archive.org/download/PockettorahAudioFiles/Synthetic-player.mp3";
const sourceAsset = "ra_" + "7".repeat(32);
async function api(tab: Page, path: string, body: unknown) {
  return tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.status; }, { path, body });
}
async function page(mobile = false, who: "admin" | "tutor" = "admin", authenticated?: BrowserContext) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false,
    ...(authenticated ? { storageState: await authenticated.storageState() } : {}) }); contexts.push(context);
  const state = { requests: 0, corrupt: false, held: null as null | { release(): void; started: Promise<void> }, sawCookie: false, sawReferer: false };
  await context.addInitScript(() => {
    const target = window as TrackedWindow; target.referenceAudios = []; target.referenceRevoked = [];
    const AudioConstructor = window.Audio;
    window.Audio = new Proxy(AudioConstructor, { construct(original, args) { const audio = Reflect.construct(original, args) as HTMLAudioElement; target.referenceAudios.push(audio); return audio; } });
    const revoke = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = url => { target.referenceRevoked.push(url); revoke(url); };
  });
  let release!: () => void, began!: () => void;
  const gate = new Promise<void>(yes => { release = yes; }), started = new Promise<void>(yes => { began = yes; });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === archiveUrl) {
      state.requests++; const headers = await request.allHeaders(); state.sawCookie ||= Boolean(headers.cookie); state.sawReferer ||= Boolean(headers.referer);
      if (state.held) { began(); await gate; }
      const body = state.corrupt ? Buffer.from(audioBytes.map((value, index) => index === 200 ? value ^ 1 : value)) : audioBytes;
      try { await route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "access-control-allow-origin": BROWSER_ORIGIN, "content-length": String(body.length), "cache-control": "no-store" }, body }); } catch { /* Scope teardown may abort the routed request. */ }
    } else if (url.origin === BROWSER_ORIGIN) await route.continue(); else await route.abort();
  });
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!authenticated) { const email = `pg-${who}@example.test`; expect(await api(tab, "/api/auth/sign-in/magic-link", { email })).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); }
  await tab.goto(`/workspace/${who === "admin" ? "admin/students" : "tutor"}/${fixture.student.id}${who === "admin" ? "/reading" : ""}`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  return { tab, state, hold() { state.held = { release, started }; return state.held; } };
}
const player = (tab: Page) => tab.getByRole("region", { name: /^Reference recording for / });
async function open(tab: Page) { await tab.getByRole("button", { name: "Hear", exact: true }).click(); await ui(tab.getByRole("dialog", { name: "Genesis 1:1", exact: true })).toBeVisible(); }
async function load(tab: Page) { await player(tab).getByRole("button", { name: "Load recording", exact: true }).click(); await ui(player(tab).getByRole("button", { name: "Play", exact: true })).toBeEnabled(); }
async function native(tab: Page) { return tab.evaluate(() => { const a = (window as TrackedWindow).referenceAudios.at(-1); return { count: (window as TrackedWindow).referenceAudios.length, paused: a?.paused, currentTime: a?.currentTime, rate: a?.playbackRate, preservesPitch: a?.preservesPitch, src: a?.getAttribute("src"), revoked: (window as TrackedWindow).referenceRevoked.length }; }); }

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  const isolated = await isolatedEnv();
  try {
    directory = await mkdtemp(join(tmpdir(), "reference-player-audio-"));
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Synthetic audio path refused");
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=8", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", join(directory, "synthetic.mp3")], { env: isolated.env, windowsHide: true, timeout: 15000, maxBuffer: 4096 });
    audioBytes = await readFile(join(directory, "synthetic.mp3"));
  } catch { throw new Error("Runtime synthetic audio generation failed; details withheld"); } finally { await isolated.cleanup(); }
  const sample = syntheticUiStudyPage({ kind: "torah", ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], offset: 0, translation: "jps2023" });
  const digest = createHash("sha256").update(audioBytes).digest("hex");
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: sourceAsset, archiveFile: "Synthetic-player.mp3", sha256: digest, bytes: audioBytes.length,
    verses: sample.verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); if (projection.status !== "ready" || projection.projection.words.length !== 2) throw new Error("Synthetic word projection refused");
      return { schema: "reference-verse/v1", ref: verse.ref, table: "torah", playback: { status: "ready", asset: sourceAsset, clip: { start: 1, end: 5 } }, words: { status: "ready", readingTextSha256: createHash("sha256").update(verse.hebrew.readingText.normalize("NFC")).digest("hex"), starts: [1.1, 3] }, attribution: REFERENCE_ATTRIBUTION }; }) }] });
  if (!catalog) throw new Error("Synthetic reference catalog refused");
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request), referenceCatalogLoad: async () => catalog, referenceStudentRelease: true });
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

it("uses real native playback only after explicit load/play, verifies source offsets/highlights/loops and preserves pitch", async () => {
  const { tab, state } = await page(); expect(state.requests).toBe(0); await open(tab); expect(state.requests).toBe(0);
  await load(tab); expect(state.requests).toBe(1); expect(await native(tab)).toMatchObject({ count: 1, paused: true, currentTime: 1 });
  expect(state.sawCookie || state.sawReferer).toBe(false);
  await player(tab).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await native(tab)).paused).toBe(false);
  await ui(tab.getByRole("dialog").locator('[data-reference-active="true"]').first()).toBeVisible();
  await player(tab).getByLabel("Speed", { exact: true }).selectOption("0.5"); expect(await native(tab)).toMatchObject({ rate: 0.5, preservesPitch: true });
  await player(tab).getByLabel("Practice", { exact: true }).selectOption("1");
  await player(tab).getByRole("button", { name: "Repeat", exact: true }).click();
  await tab.evaluate(() => { (window as TrackedWindow).referenceAudios.at(-1)!.currentTime = 4.96; });
  await expect.poll(async () => { const t = (await native(tab)).currentTime ?? 9; return t >= 3 && t < 3.5; }).toBe(true);
  await player(tab).getByRole("button", { name: "Pause", exact: true }).click();
  expect(await native(tab)).toMatchObject({ paused: true });
  const sourceCount = state.requests;
  await tab.getByRole("dialog").getByRole("button", { name: /^Next (phrase|verse)$/ }).click();
  expect((await native(tab)).paused).toBe(true); expect(state.requests).toBe(sourceCount);
});

it("selects a canonical qere word with colors off on a phone, keeps keyboard selection local and unloads on verse close", async () => {
  const { tab, state } = await page(true); await open(tab); await load(tab);
  const dialog = tab.getByRole("dialog"); await dialog.getByRole("button", { name: "Phrase colors", exact: true }).click();
  await ui(dialog.locator("[data-family]")).toHaveCount(0);
  await dialog.locator('.study-read-alternative [data-word-index="1"]').click();
  await ui(player(tab).getByLabel("Practice", { exact: true })).toHaveValue("1"); expect((await native(tab)).currentTime).toBeCloseTo(3, 1);
  const select = player(tab).getByLabel("Practice", { exact: true }); await select.focus(); await select.press("ArrowUp");
  await ui(dialog.getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  await select.selectOption("0"); await player(tab).getByRole("button", { name: "Play", exact: true }).click();
  await ui(dialog.locator('[data-word-index="0"][data-reference-active="true"]').first()).toBeVisible();
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Close practice view", exact: true }).click();
  await expect.poll(async () => (await native(tab)).revoked).toBe(1); expect(await native(tab)).toMatchObject({ paused: true, src: null });
  expect(state.requests).toBe(1);
});

it("drops a held source on verse change and refuses a mismatched byte hash before creating native media", async () => {
  const { tab, state, hold } = await page(); await open(tab); const held = hold();
  await player(tab).getByRole("button", { name: "Load recording", exact: true }).click(); await held.started;
  await tab.getByRole("dialog").getByRole("button", { name: /^Next (phrase|verse)$/ }).click();
  // Advance through the existing phrase rail to a different verse.
  while (await tab.getByRole("dialog", { name: "Genesis 1:1", exact: true }).count()) await tab.getByRole("dialog").getByRole("button", { name: /^Next (phrase|verse)$/ }).click();
  held.release(); await ui(tab.getByRole("dialog", { name: "Genesis 1:2", exact: true })).toBeVisible();
  expect((await native(tab)).count).toBe(0);
  state.held = null; state.corrupt = true; await player(tab).getByRole("button", { name: "Load recording", exact: true }).click();
  await ui(player(tab).getByText("The recording couldn’t be loaded. Try loading it again.", { exact: true })).toBeVisible();
  expect((await native(tab)).count).toBe(0);
});

it("tears down playback during session concealment and child/role navigation without restoring old audio", async () => {
  const { tab } = await page(false, "tutor"); await open(tab); await load(tab); await player(tab).getByRole("button", { name: "Play", exact: true }).click();
  // Real session focus verification temporarily conceals the current workspace.
  let release!: () => void, began!: () => void; const held = new Promise<void>(yes => { release = yes; }), started = new Promise<void>(yes => { began = yes; });
  await tab.route("**/api/session", async route => { const actual = await route.fetch(); began(); await held; await route.fulfill({ response: actual }).catch(() => {}); });
  await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await started;
  await expect.poll(async () => (await native(tab)).paused).toBe(true); await expect.poll(async () => (await native(tab)).revoked).toBe(1);
  release(); await tab.unroute("**/api/session"); await ui(tab.locator(".study-verses").first()).toBeVisible();
  expect(await tab.getByRole("dialog").count()).toBe(0);
  await tab.getByRole("link", { name: "Parent", exact: true }).click();
  expect((await native(tab)).paused).toBe(true);
  // No Audio constructor or source fetch is invoked by restoring the reading.
  await ui(tab.getByLabel("Child", { exact: true })).toBeVisible();
  await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click();
  await tab.getByRole("button", { name: "Enter child practice", exact: true }).click();
  await ui(tab.getByRole("heading", { name: "Child practice", exact: true })).toBeVisible();
  await ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  await open(tab); await load(tab); await player(tab).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await native(tab)).paused).toBe(false);
  // The real sibling chooser is behind the modal. Leave practice view first,
  // as a person must; neither force-click nor bypass the dialog's focus scope.
  await tab.getByRole("dialog").getByRole("button", { name: "Close practice view", exact: true }).click();
  expect(await native(tab)).toMatchObject({ paused: true, src: null });
  await tab.getByRole("button", { name: "Switch practice to Synthetic Sibling", exact: true }).click();
  await ui(tab.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible();
  await expect.poll(async () => (await native(tab)).revoked).toBe(2);
  expect(await native(tab)).toMatchObject({ count: 2, paused: true, src: null });
  expect(await tab.getByRole("dialog").count()).toBe(0);
});

it("clears real playback when its authenticated browser session disappears", async () => {
  const { tab } = await page(); await open(tab); await load(tab); await player(tab).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await native(tab)).paused).toBe(false);
  await tab.context().clearCookies(); await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await native(tab)).revoked).toBe(1);
  expect(await native(tab)).toMatchObject({ paused: true, src: null });
  await ui(player(tab)).toHaveCount(0);
});

it("opens fresh idle practice from Service parts Start without reviving disposed media", async () => {
  // A new media/browser context can reuse this fixture's valid synthetic admin
  // session without spending a sixth magic link in the same IP rate window.
  // When selected alone, page() signs in normally.
  const { tab, state } = await page(false, "admin", contexts[0]);
  const tabs = tab.getByRole("tablist", { name: "Student page" });
  const service = tabs.getByRole("tab", { name: "Service parts", exact: true });
  const reading = tabs.getByRole("tab", { name: "Reading", exact: true });
  await service.click(); await ui(service).toHaveAttribute("aria-selected", "true");
  await ui(tab.locator(".reading-toolbar")).toHaveCount(0);
  await tab.getByRole("button", { name: "Start", exact: true }).click();
  await ui(reading).toHaveAttribute("aria-selected", "true");
  await ui(tab.getByRole("dialog", { name: "Genesis 1:1", exact: true })).toBeVisible();
  expect(await native(tab)).toMatchObject({ count: 0 }); expect(state.requests).toBe(0);
  await load(tab); await player(tab).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await native(tab)).paused).toBe(false);
  await tab.getByRole("dialog").getByRole("button", { name: "Close practice view", exact: true }).click();
  await expect.poll(async () => (await native(tab)).revoked).toBe(1);
  expect(await native(tab)).toMatchObject({ paused: true, src: null });
  await service.click(); await ui(service).toHaveAttribute("aria-selected", "true");
  await ui(player(tab)).toHaveCount(0);
  await tab.getByRole("button", { name: "Start", exact: true }).click();
  await ui(reading).toHaveAttribute("aria-selected", "true"); await ui(player(tab)).toBeVisible();
  await ui(player(tab).getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await ui(player(tab).getByRole("button", { name: "Load recording", exact: true })).toBeEnabled();
  expect(state.requests).toBe(1); expect(await native(tab)).toMatchObject({ count: 1, paused: true, src: null, revoked: 1 });
});
