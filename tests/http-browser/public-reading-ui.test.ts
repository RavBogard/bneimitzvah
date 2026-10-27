import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { generateSyntheticShortAudio, syntheticShortReferences } from "./synthetic-short-reference";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { openMore } from "./more-sheet";
import { browserFixture } from "./fixture";
import { createSefariaCommentaryReader } from "../../src/server/study/commentary";
import { syntheticCommentaryFetch } from "../helpers/commentary";
import { installLoopbackFetchGuard } from "./egress";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
vi.mock("server-only", () => ({}));
declare global { interface Window { publicAudios: HTMLAudioElement[] } }

// A signed-out visitor: no cookie is ever set in this browser context. Invented
// syllables, generated tones and synthetic clip bytes only.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, directory: string | undefined;
const shortBodies = new Map<string, Buffer>(), contexts: BrowserContext[] = [];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  directory = await realpath(await mkdtemp(join(tmpdir(), "public-reading-audio-")));
  const tone = await generateSyntheticShortAudio(directory, "torah", 440);
  const ranges = ["Genesis 1:1-6:8"], refs = expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS);
  const text = syntheticUiStudyPage({ kind: "torah", ranges, verses: refs, offset: 0, translation: "jps2023" }).verses[0].hebrew;
  const projection = projectStudyVerse(refs[0], text); if (projection.status !== "ready" || projection.projection.words.length !== 2) throw Error("Synthetic projection refused");
  const asset = "ra_" + "5".repeat(32);
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic-public.mp3", sha256: sha(tone.parent), bytes: tone.parent.length,
    verses: refs.map(ref => ({ schema: "reference-verse/v1", ref, table: "torah", playback: { status: "ready", asset, clip: { start: 1, end: 5 } },
      words: { status: "ready", readingTextSha256: sha(new TextEncoder().encode(text.readingText.normalize("NFC"))), starts: [1.1, 3] }, attribution: REFERENCE_ATTRIBUTION })) }] });
  if (!catalog) throw Error("Synthetic catalog refused");
  const shorts = await syntheticShortReferences(catalog, [{ asset, bytes: tone.bytes, physicalFrames: tone.physicalFrames }]);
  for (const row of shorts.sources) shortBodies.set(row.path, row.bytes);
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request), referenceCatalogLoad: async () => catalog, referenceShortManifestLoad: async () => shorts.manifest,
    referenceStudentRelease: true, commentaryLoad: createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }) });
  stop = await startBrowserServer(fixture.withRuntime, fixture.withPublicRuntime);
  browser = await chromium.launch({ headless: true });
}, 120000);
afterAll(async () => {
  for (const context of contexts.splice(0)) await context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.();
  if (directory) await rm(directory, { recursive: true, force: true });
}, 120000);

async function visitor(mobile: boolean) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  const seen = { api: [] as string[], cookie: false, privateApi: false };
  await context.addInitScript(() => {
    const target = window; target.publicAudios = [];
    window.Audio = new Proxy(window.Audio, { construct(original, args) { const media = Reflect.construct(original, args) as HTMLAudioElement; target.publicAudios.push(media); return media; } });
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if ((await request.allHeaders()).cookie) seen.cookie = true;
    if (url.origin !== BROWSER_ORIGIN) return route.abort();
    if (url.pathname.startsWith("/api/")) { seen.api.push(url.pathname); if (!url.pathname.startsWith("/api/public/")) seen.privateApi = true; }
    const body = shortBodies.get(url.pathname);
    if (url.pathname.startsWith("/reference-audio/short-v1/")) return body ? route.fulfill({ status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(body.length), "cache-control": "no-store" }, body }) : route.abort();
    return route.continue();
  });
  const tab = await context.newPage();
  return { tab, seen };
}
const reading = (tab: Page) => tab.getByTestId("study-verses");
const word = (tab: Page, verse: string, index: number) => tab.locator(`[data-testid="study-verses"] [data-verse-ref="${verse}"] [data-word-index="${index}"]`).first();
// What the player says is selected, by its parts rather than its sentence.
const selection = (player: Locator, ref: string, part: string) => Promise.all([ui(player.getByTestId("player-selection")).toHaveAttribute("data-selected-ref", ref), ui(player.getByTestId("player-selection")).toHaveAttribute("data-selected-part", part)]);
async function playing(tab: Page) {
  await expect.poll(() => tab.evaluate(() => window.publicAudios.some(media => !media.paused && media.src.startsWith("blob:") && media.readyState >= 2)), { timeout: 20000 }).toBe(true);
}

it("a signed-out visitor reads this week's portion, plays a verse and uses word tools", async () => {
  for (const mobile of [true, false]) {
    const { tab, seen } = await visitor(mobile);
    const response = await tab.goto("/read", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
    await ui(tab.locator("[data-reading-ranges]")).toBeVisible();
    await ui(tab.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();
    await ui(reading(tab).getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
    // Tapping a word plays its whole verse from the human recording.
    await word(tab, "Genesis 1:1", 1).click(); await playing(tab);
    await ui(word(tab, "Genesis 1:1", 0)).toHaveAttribute("data-reference-active", "true");
    await ui(tab.getByRole("region", { name: "Reading playback", exact: true }).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await tab.getByRole("region", { name: "Reading playback", exact: true }).getByRole("button", { name: "Pause", exact: true }).click();
    // Word tools answer for the selected word.
    await tab.getByRole("button", { name: "Word tools", exact: true }).click();
    await ui(tab.getByTestId("word-tools-place")).toHaveAttribute("data-word-ref", "Genesis 1:1"); await ui(tab.getByTestId("word-tools-place")).toHaveAttribute("data-word-position", "2");
    await tab.getByRole("button", { name: "Word tools", exact: true }).click();
    // The second text page and the haftarah are one tap away.
    await tab.getByRole("button", { name: "Next text page", exact: true }).click();
    await ui(tab.getByTestId("page-position")).toHaveAttribute("data-page-first", "101"); await ui(tab.getByTestId("page-position")).toHaveAttribute("data-page-last", "146"); await ui(tab.getByTestId("page-position")).toHaveAttribute("data-page-total", "146");
    await tab.getByRole("tablist", { name: "Reading text selection" }).getByRole("tab", { name: /^Haftarah/ }).click();
    await ui(reading(tab).getByRole("heading", { name: "Isaiah 1:1", exact: true })).toBeVisible();
    // Nothing on this page reached a signed-in route or carried a cookie.
    expect(seen.privateApi).toBe(false); expect(seen.cookie).toBe(false);
    expect(seen.api).toContain("/api/public/reference/short"); expect(seen.api).toContain("/api/public/word-details");
    await ui(tab.getByRole("region", { name: "Cantor Finkel’s recordings", exact: true })).toHaveCount(0);
    expect((await tab.context().cookies()).length).toBe(0);
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const capture = process.env.PUBLIC_READING_CAPTURE_DIR;
    if (capture) {
      const target = resolve(capture), allowed = resolve(".local-logs") + sep;
      if (!target.startsWith(allowed)) throw Error("Capture directory refused");
      await mkdir(target, { recursive: true });
      await tab.getByRole("tablist", { name: "Reading text selection" }).getByRole("tab", { name: /^Torah/ }).click();
      await ui(reading(tab).getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
      await tab.evaluate(() => scrollTo(0, 0));
      await tab.screenshot({ path: join(target, `public-reading-${mobile ? "phone" : "desktop"}.png`), fullPage: !mobile });
    }
  }
});

it("the public API answers the visitor directly, with noindex and no cookie, and has no recording route but PocketTorah's", async () => {
  const { tab } = await visitor(false);
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(tab.getByRole("heading", { level: 1, name: "Synthetic portion", exact: true })).toBeVisible();
  const result = await tab.evaluate(async () => {
    const date = document.querySelector("main header time")!.getAttribute("datetime");
    const week = await fetch(`/api/public/reading?date=${date}`, { credentials: "omit" });
    const finkel = await fetch(`/api/public/reference/finkel/media/${"0".repeat(64)}.mp3`, { credentials: "omit" });
    const session = await fetch("/api/public/session", { credentials: "omit" });
    const rashi = await fetch("/api/public/commentary?work=rashi&chapter=Genesis+1", { credentials: "omit" });
    const rashiBody = await rashi.json() as { work: string; verses: Record<string, { comments: { hebrew: { text: string }[] }[] }> };
    const unregistered = await fetch("/api/public/commentary?work=malbim&chapter=Genesis+1", { credentials: "omit" });
    return { status: week.status, robots: week.headers.get("x-robots-tag"), cookie: week.headers.get("set-cookie"), finkel: finkel.status, session: session.status,
      rashi: { status: rashi.status, cdn: rashi.headers.get("vercel-cdn-cache-control"), cookie: rashi.headers.get("set-cookie"), work: rashiBody.work,
        verses: Object.keys(rashiBody.verses), first: rashiBody.verses["1"]?.comments[0].hebrew[0].text }, unregistered: unregistered.status };
  });
  expect(result).toEqual({ status: 200, robots: "noindex, nofollow", cookie: null, finkel: 404, session: 404,
    rashi: { status: 200, cdn: "public, s-maxage=2592000, stale-while-revalidate=86400", cookie: null, work: "rashi", verses: ["1", "3"], first: "אָב גַּד." }, unregistered: 400 });
});

it("any reading: a named reading, a deep-linked verse that plays from the player, and the chooser, all on the signed-out routes", async () => {
  for (const mobile of [true, false]) {
    const { tab, seen } = await visitor(mobile);
    // A deep link into "Any reading": the verse is selected in the player, ready, and plays on Play.
    await tab.goto("/read?ref=Genesis+1%3A1-6%3A8&kind=torah&verse=1", { waitUntil: "domcontentloaded" });
    await ui(tab.getByRole("heading", { level: 1, name: "Genesis 1:1–6:8", exact: true })).toBeVisible();
    const player = tab.getByRole("region", { name: "Reading playback", exact: true });
    await selection(player, "Genesis 1:1", "verse");
    await player.getByRole("button", { name: "Play", exact: true }).click(); await playing(tab);
    await player.getByRole("button", { name: "Pause", exact: true }).click();
    expect(seen.api).toContain("/api/public/reference/short");
    // A named reading from the catalog, by its address.
    await tab.goto("/read?reading=bereshit", { waitUntil: "domcontentloaded" });
    await ui(tab.getByRole("heading", { level: 1, name: "Bereshit", exact: true })).toBeVisible();
    await ui(reading(tab).getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
    await tab.getByRole("tablist", { name: "Reading text selection" }).getByRole("tab", { name: /^Haftarah/ }).click();
    await ui(reading(tab).getByRole("heading", { name: "Isaiah 42:5", exact: true })).toBeVisible();
    await ui(tab).toHaveURL(/\/read\?reading=bereshit&passage=2$/);
    // The Readings index opens another reading in place of this one.
    await tab.goto("/readings", { waitUntil: "domcontentloaded" });
    await tab.getByRole("link", { name: "Shabbat Shekalim", exact: true }).click();
    await ui(tab.getByRole("heading", { level: 1, name: "Shabbat Shekalim", exact: true })).toBeVisible();
    await ui(reading(tab).getByRole("heading", { name: "Exodus 30:11", exact: true })).toBeVisible();
    expect(seen.api.some(path => path === "/api/public/reading")).toBe(true);
    expect(seen.privateApi).toBe(false); expect(seen.cookie).toBe(false);
    expect((await tab.context().cookies()).length).toBe(0);
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

const noScroll = (tab: Page) => tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function controls44(tab: Page, scope: string) {
  for (const height of await tab.locator(`${scope} button`).evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent).map(node => node.getBoundingClientRect().height)))
    expect(height).toBeGreaterThanOrEqual(44);
}

// Deliberate wording test for the public translate drill: approved copy, change only with the copy.
it("the translate drill, signed out, in Lein only: hides every verse's English and Rashi, reveals, moves on and ends with the view as it was, storing nothing", async () => {
  for (const mobile of [true, false]) {
    const { tab, seen } = await visitor(mobile);
    await tab.goto("/read", { waitUntil: "domcontentloaded" });
    await ui(reading(tab).getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
    // The visitor's own English choice, made before the drill; the drill must leave it exactly as it is.
    await tab.getByRole("navigation", { name: "Reading tools", exact: true }).getByRole("button", { name: "English", exact: true }).click();
    const english = reading(tab).locator("[data-english-ref]"), hidden = reading(tab).locator("[data-english-hidden]");
    await ui(english.first()).toBeVisible();
    const shown = await english.count();
    expect(shown).toBeGreaterThan(1);
    await word(tab, "Genesis 1:1", 1).click(); await playing(tab);
    await tab.getByRole("region", { name: "Reading playback", exact: true }).getByRole("button", { name: "Pause", exact: true }).click();
    await tab.getByRole("button", { name: "Rashi (1)", exact: true }).click();
    const rashi = tab.getByRole("region", { name: "Rashi on Genesis 1:1", exact: true });
    await ui(rashi.getByText("SYNTHETIC LEMMA", { exact: false }).first()).toBeVisible();
    const stored = await tab.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
    const api = seen.api.length;

    const toggle = tab.getByRole("button", { name: "Translate drill", exact: true });
    await ui(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await ui(toggle).toHaveAttribute("aria-pressed", "true");
    const drill = tab.getByRole("region", { name: "Translate drill on Genesis 1:1", exact: true });
    await ui(drill).toHaveAttribute("data-drill-revealed", "false");
    await ui(drill.getByText("English hidden", { exact: true })).toBeVisible();
    await ui(drill.getByTestId("drill-hint")).toHaveText("Tap a word for its meaning. Hear plays the verse.");
    // Every verse's English is hidden, not only this one's, and Rashi is closed away.
    await ui(english).toHaveCount(0); await ui(hidden).toHaveCount(shown);
    await ui(tab.locator("[data-verse-rashi]")).toBeHidden();
    await ui(tab.getByRole("button", { name: /up close$/ })).toHaveCount(0);
    await drill.getByRole("button", { name: "Reveal", exact: true }).click();
    await ui(drill).toHaveAttribute("data-drill-revealed", "true");
    await ui(drill.getByRole("heading", { name: "JPS", exact: true })).toBeFocused();
    await ui(drill.getByText("Synthetic reference 1:", { exact: false })).toBeVisible();
    await ui(drill.getByText("Compare it with what you said.", { exact: true })).toBeVisible();
    // Signed out: no own translation, no Yours, no sign-in prompt.
    await ui(drill.getByText(/My translation|Yours|Sign in/)).toHaveCount(0);
    expect(await tab.evaluate(() => window.publicAudios.every(media => media.paused))).toBe(true);
    expect(await noScroll(tab)).toBe(true);
    await controls44(tab, "[data-translate-drill]");
    await drill.getByRole("button", { name: "Hide again", exact: true }).click();
    await ui(drill.getByRole("button", { name: "Reveal", exact: true })).toBeFocused();
    await drill.getByRole("button", { name: "Reveal", exact: true }).click();
    await drill.getByRole("button", { name: "Next verse", exact: true }).click();
    const second = tab.getByRole("region", { name: "Translate drill on Genesis 1:2", exact: true });
    await ui(second.getByRole("button", { name: "Reveal", exact: true })).toBeFocused();
    await ui(second.getByTestId("drill-hint")).toHaveCount(0);
    await second.getByRole("button", { name: "Reveal", exact: true }).click();
    await ui(second.getByTestId("drill-english")).toHaveAttribute("data-english-available", "false");
    expect(await tab.evaluate(() => window.publicAudios.every(media => media.paused))).toBe(true);
    await second.getByRole("button", { name: "Hide again", exact: true }).click();
    // Escape inside the drill ends it: the view is exactly as it was, with the English back on every verse.
    await tab.keyboard.press("Escape");
    await ui(toggle).toHaveAttribute("aria-pressed", "false"); await ui(toggle).toBeFocused();
    await ui(english).toHaveCount(shown); await ui(hidden).toHaveCount(0);
    // On the verse it started on, End drill brings Rashi back as it was left: open.
    await toggle.click();
    await tab.getByRole("region", { name: "Translate drill on Genesis 1:2", exact: true }).getByRole("button", { name: "End drill", exact: true }).click();
    await ui(english).toHaveCount(shown);
    // Nothing was written: no request beyond the public reading's own, no storage, the English choice untouched.
    expect(seen.api.slice(api).every(path => path.startsWith("/api/public/"))).toBe(true);
    expect(await tab.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(stored);
    expect(await tab.evaluate(() => sessionStorage.length)).toBe(0);
    // Study has no drill, and a visitor has no Yours row or stars.
    await tab.getByRole("group", { name: "Reading lens", exact: true }).getByRole("button", { name: "Study", exact: true }).click();
    await ui(tab.locator("[data-study-rows]")).toBeVisible();
    await ui(tab.getByRole("button", { name: "Translate drill", exact: true })).toHaveCount(0);
    await ui(tab.locator("[data-yours-ref], [data-star]")).toHaveCount(0);
    expect(seen.privateApi).toBe(false); expect(seen.cookie).toBe(false);
  }
});

it("on a phone, Next verse brings Reveal into view, Play plays the verse the drill is on, and the English button reads what is on screen", async () => {
  const { tab } = await visitor(true);
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(reading(tab).getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  const english = tab.getByRole("navigation", { name: "Reading tools", exact: true }).getByRole("button", { name: /^English/ });
  await english.click(); await ui(english).toHaveAttribute("aria-pressed", "true");
  const player = tab.getByRole("region", { name: "Reading playback", exact: true });
  await word(tab, "Genesis 1:1", 1).click(); await playing(tab);
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await tab.getByRole("button", { name: "Translate drill", exact: true }).click();
  // While the drill hides the English, the button says so: not pressed, and not working, with its reason.
  await ui(english).toHaveAttribute("aria-pressed", "false"); await ui(english).toHaveAttribute("aria-disabled", "true");
  await ui(english).not.toHaveAccessibleDescription("");
  await english.click({ force: true }); await ui(english).toHaveAttribute("aria-pressed", "false"); // a click does nothing (Playwright treats aria-disabled as not enabled)
  const first = tab.getByRole("region", { name: "Translate drill on Genesis 1:1", exact: true });
  await first.getByRole("button", { name: "Reveal", exact: true }).click();
  await first.getByRole("button", { name: "Next verse", exact: true }).click();
  const reveal = tab.getByRole("region", { name: "Translate drill on Genesis 1:2", exact: true }).getByRole("button", { name: "Reveal", exact: true });
  await ui(reveal).toBeFocused();
  // Reveal is on the screen (the scroll may still be settling), not below it.
  await expect.poll(() => reveal.evaluate(node => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })).toBe(true);
  // Play is set to the new verse and plays it; nothing played on its own.
  expect(await tab.evaluate(() => window.publicAudios.every(media => media.paused))).toBe(true);
  await selection(player, "Genesis 1:2", "verse");
  await player.getByRole("button", { name: "Play", exact: true }).click(); await playing(tab);
  await selection(player, "Genesis 1:2", "verse");
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  // Ending the drill gives the English button its own state back.
  await tab.getByRole("button", { name: "End drill", exact: true }).click();
  await ui(english).toHaveAttribute("aria-pressed", "true"); await ui(english).not.toHaveAttribute("aria-disabled", "true");
});

it("ending the drill on the verse it began shows Rashi as it was left", async () => {
  const { tab } = await visitor(false);
  await tab.goto("/read", { waitUntil: "domcontentloaded" });
  await ui(reading(tab).getByRole("heading", { name: "Genesis 1:1", exact: true })).toBeVisible();
  await word(tab, "Genesis 1:1", 1).click(); await playing(tab);
  await tab.getByRole("region", { name: "Reading playback", exact: true }).getByRole("button", { name: "Pause", exact: true }).click();
  await tab.getByRole("button", { name: "Rashi (1)", exact: true }).click();
  const comment = tab.getByRole("region", { name: "Rashi on Genesis 1:1", exact: true }).getByText("SYNTHETIC LEMMA", { exact: false }).first();
  await ui(comment).toBeVisible();
  await tab.getByRole("button", { name: "Translate drill", exact: true }).click();
  await ui(comment).toBeHidden();
  await tab.getByRole("button", { name: "End drill", exact: true }).click();
  await ui(comment).toBeVisible();
  await ui(tab.getByRole("button", { name: "Rashi (1)", exact: true })).toHaveAttribute("aria-expanded", "true");
});
