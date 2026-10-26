import { observeSilentAudio, expectSilentAudio, privateRouteFetch, observeInitialShortPage } from "./audio-observation";
import { closeVerseTools, openVerseTools, selectVerse } from "./verse-tools";
import { openAuthMail } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { syntheticUiStudyPage, syntheticUiLongStudyPage } from "../helpers/study-ui";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { StudyUnavailable } from "../../src/server/study/types";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let sibling: { id: string }, adminTab: Page, studentTab: Page, calls = 0, unavailable = false, longVerse = false;
let english: "available" | "partial" | "unavailable" = "partial";
const contexts: BrowserContext[] = [], modes = new Set<string>();
const initialShortPages = new WeakMap<Page, ReturnType<typeof observeInitialShortPage>>();
const metadataLoads: { kind: string; offset: number; refs: string[] }[] = [];
const cookies = new Map<"admin" | "tutor" | "student", Awaited<ReturnType<BrowserContext["cookies"]>>>();
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Study UI browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
const heldMetadata = new WeakMap<Page, { count: number }>();
function observeHeldMetadata(tab: Page) {
  const seen = { count: 0 }; heldMetadata.set(tab, seen);
  tab.on("request", request => { if (/\/(?:reference-audio|reading\/explore\/reference)\//.test(new URL(request.url()).pathname)) seen.count++; });
}
async function heldReading(tab: Page) {
  expect(heldMetadata.get(tab)!.count).toBe(0);
  expect(initialShortPages.get(tab)!.counts()).toEqual({ seen: 0, terminals: 0, pending: 0 });
  await expectSilentAudio(tab);
  expect(await tab.evaluate(() => (window as unknown as { silentAudioProbe: { elements: HTMLAudioElement[] } }).silentAudioProbe.elements.length)).toBe(0);
}
async function page(who: "admin" | "tutor" | "student", mobile = false, fresh = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await observeSilentAudio(context);
  await context.route("**/*", async route => { try {
    const url = new URL(route.request().url()); if (url.origin !== BROWSER_ORIGIN) { await route.abort(); return; }
    if (url.pathname.endsWith("/study-text")) modes.add(url.searchParams.get("mode") ?? ""); await route.continue();
  } catch { await route.abort(); } });
  // Reuse only a known live role session from this disposable fixture. Extra
  // independent cases must not exhaust the real magic-link throttle.
  const signedIn = fresh ? undefined : cookies.get(who); if (signedIn) await context.addCookies(signedIn);
  const tab = await context.newPage(); observeHeldMetadata(tab); initialShortPages.set(tab, observeInitialShortPage(tab)); await navigate(tab, "/"); if (signedIn) return tab;
  const email = who === "student" ? "pg-study-student@example.test" : who === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies.set(who, await context.cookies()); return tab;
}
async function click(tab: Page, name: string) {
  try { await safe(() => tab.getByRole("button", { name, exact: true }).click()); }
  catch { const steps = new Set(["Refresh reading", "Reload assigned text", "Next text page", "Previous text page", "Refresh reading and text", "Haftarah text"]); throw new Error(`Study UI ${steps.has(name) ? name : "controlled action"} failed; private details withheld`); }
}
async function loaded(tab: Page, ref: string) { await ui(tab.locator(".study-verses").getByRole("heading", { name: ref, level: 4, exact: true })).toBeVisible(); }
function verse(tab: Page, ref: string) { return tab.locator(`.study-verses [data-verse-ref="${ref}"]`); }
async function firstHebrewInViewport(tab: Page) {
  await safe(() => tab.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement && document.activeElement.matches(".skip-link")) document.activeElement.blur();
    scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  const geometry = await tab.locator(".study-hebrew > span").first().evaluate(span => {
    const range = document.createRange(); range.selectNodeContents(span); const bounds = range.getBoundingClientRect();
    const marker = span.closest("p")?.parentElement?.querySelector(":scope > .student-aliyah")?.getBoundingClientRect();
    const reference = span.closest("[data-verse-ref]")?.querySelector(":scope > [data-hebrew-ref] > button[title], :scope > [data-hebrew-ref] > sup[title]")?.getBoundingClientRect();
    return { scrollY, top: bounds.top, bottom: bounds.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, markerBottom: marker?.bottom ?? null,
      referenceTop: reference?.top ?? null, referenceBottom: reference?.bottom ?? null,
      bodyFont: getComputedStyle(document.body).fontFamily, hebrewFont: getComputedStyle(span).fontFamily, fontsStatus: document.fonts.status };
  });
  const diagnostic = JSON.stringify(geometry); // Geometry/font metadata only; no student text or contacts.
  expect(geometry.viewportWidth, diagnostic).toBe(390); expect(geometry.viewportHeight, diagnostic).toBe(844);
  expect(geometry.scrollY, diagnostic).toBe(0); expect(geometry.top, diagnostic).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom, diagnostic).toBeLessThanOrEqual(geometry.viewportHeight);
  // Reserve room for platform font differences instead of just clipping below 844px.
  expect(geometry.bottom, diagnostic).toBeLessThanOrEqual(geometry.viewportHeight - 24);
  expect(geometry.referenceTop, diagnostic).not.toBeNull(); expect(geometry.referenceBottom, diagnostic).not.toBeNull();
  expect(geometry.referenceTop!, diagnostic).toBeLessThanOrEqual(geometry.bottom);
  expect(geometry.referenceBottom!, diagnostic).toBeLessThanOrEqual(geometry.bottom);
  if (geometry.markerBottom !== null) expect(geometry.markerBottom, diagnostic).toBeLessThanOrEqual(geometry.referenceTop!);
}
function colorsControl(tab: Page) { return tab.getByRole("navigation", { name: "Reading tools", exact: true }).getByRole("button", { name: "Colors", exact: true }); }
async function setColors(tab: Page, on: boolean) {
  const control = colorsControl(tab);
  if (await control.getAttribute("aria-pressed") !== String(on)) await safe(() => control.click());
  await ui(control).toHaveAttribute("aria-pressed", String(on));
}
async function colorVerse(tab: Page, ref: string) {
  const article = verse(tab, ref);
  if (await colorsControl(tab).count()) await setColors(tab, true);
  await ui(article.locator("[data-family]").first()).toBeVisible();
  return article;
}
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden();
  await ui(tab.locator(".study-hebrew").first()).toBeVisible(); expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.addStyleTag({ content: "nextjs-portal { display: none !important; }" }));
  await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
  if (tab.viewportSize()?.width === 390) await safe(() => tab.screenshot({ path: join(directory, `${name}-viewport.png`) }));
}
async function captureDark(tab: Page, name: string) {
  if (process.env.CI) return;
  await safe(() => tab.emulateMedia({ colorScheme: "dark" })); await capture(tab, name); await safe(() => tab.emulateMedia({ colorScheme: "light" }));
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    const material = (request: Parameters<typeof syntheticUiStudyPage>[0]) => { if (unavailable) throw new StudyUnavailable("upstream"); return longVerse ? syntheticUiLongStudyPage(request) : syntheticUiStudyPage(request, english); };
    fixture = await browserFixture({ referenceStudentRelease: false, studyLoad: async request => { calls++; return material(request); }, shortReferenceStudyLoad: async request => { const page = material(request); metadataLoads.push({ kind: request.kind, offset: page.offset, refs: page.verses.map(verse => verse.ref) }); return page; } });
    sibling = (await fixture.practice()).sibling;
    const learner = await fixture.signIn("pg-study-student");
    const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [adminMember] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const [studentId, kind, ranges] of [[fixture.student.id, "torah", ["Genesis 1:1-3"]], [fixture.student.id, "haftarah", ["Isaiah 1:1-2"]], [sibling.id, "torah", ["Genesis 2:1-2"]]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind, basis: "custom", ref: ranges.join("; "), status: "confirmed", setByMembershipId: adminMember.id, proposalSnapshot: { ranges: [...ranges], confirmationDate: "2027-01-02", needsReview: true } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS).map((verseRef, index) => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: index + 1, verseRef })));
    }
    stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Study UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);


it("keeps compact equal reading summaries and verse-bound English without changing continuous Hebrew or fetching again", async () => {
  const captures: { file: string; sha256: string; width: number; height: number }[] = [], captureRoot = join(process.cwd(), ".local-logs", "reading-companion-captures-v1");
  if (process.env.READING_COMPANION_CAPTURE === "1") await mkdir(captureRoot);
  for (const mobile of [false, true]) {
    const tab = await page("student", mobile); await navigate(tab, "/workspace/student?tab=reading"); await loaded(tab, "Genesis 1:1");
    // Held students intentionally do not prepare reference metadata; real text/colors are ready.
    await colorVerse(tab, "Genesis 1:1");
    const summaries = tab.getByRole("group", { name: "Assigned readings", exact: true });
    await ui(summaries.getByRole("heading", { name: /^Torah / })).toBeVisible();
    await ui(summaries.getByRole("heading", { name: /^Haftarah / })).toBeVisible();
    await ui(summaries.locator('[aria-current="true"]')).toContainText("Torah");
    const toggle = tab.getByRole("navigation", { name: "Reading tools", exact: true }).getByRole("button", { name: "English", exact: true });
    if (await toggle.getAttribute("aria-pressed") === "true") await toggle.click();
    const flow = tab.locator('.assigned-study .study-verses'), before = await flow.innerHTML(), beforeCalls = calls, beforeMetadata = metadataLoads.length;
    for (const enabled of [false, true]) {
      if (enabled) await toggle.click();
      await ui(toggle).toHaveAttribute("aria-pressed", String(enabled));
      await ui(flow.locator('[data-english-ref]')).toHaveCount(enabled ? 3 : 0);
      if (enabled) {
        for (const ref of ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]) await ui(flow.locator('[data-verse-ref="'+ref+'"] > [data-english-ref="'+ref+'"]')).toHaveAttribute("dir", "ltr");
        await ui(flow.locator('[data-english-ref="Genesis 1:2"]')).toHaveText("English reference unavailable for this verse.");
        expect(await tab.locator('.study-verse-details .study-english').count()).toBe(0);
        expect(await flow.locator('[data-english-ref] [data-word-index], [data-english-ref] button, [data-english-ref] img').count()).toBe(0);
      }
      expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.READING_COMPANION_CAPTURE === "1") {
        await tab.locator('.reading-hero').scrollIntoViewIfNeeded();
        const file = (mobile ? "390" : "1440") + (enabled ? "-english-on.png" : "-english-off.png");
        await tab.screenshot({ path: join(captureRoot, file), fullPage: true });
        const bytes = await readFile(join(captureRoot, file));
        captures.push({ file, sha256: createHash("sha256").update(bytes).digest("hex"), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
      }
    }
    await toggle.click(); await ui(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await flow.innerHTML()).toBe(before); expect(calls).toBe(beforeCalls); expect(metadataLoads.length).toBe(beforeMetadata);
    await click(tab, "Haftarah text"); await loaded(tab, "Isaiah 1:1");
    await ui(summaries.locator('[aria-current="true"]')).toContainText("Haftarah");
    await ui(summaries.getByRole("heading", { name: /^Torah / })).toBeVisible();
  }
  if (process.env.READING_COMPANION_CAPTURE === "1") await writeFile(join(captureRoot, "manifest.json"), JSON.stringify({ synthetic: true, captures }, null, 2)+"\n", { flag: "wx" });
});

it("shows escaped structured Hebrew, qere/ketiv, paragraph and partial-English credits in all base modes without duplicate initial loads", async () => {
  adminTab = await page("admin"); const before = calls, beforeMetadata = metadataLoads.length; await navigate(adminTab, `/workspace/admin/students/${fixture.student.id}/reading`); await loaded(adminTab, "Genesis 1:1"); await initialShortPages.get(adminTab)!.settled(); expect(calls - before).toBe(1);
  // Visible text and authorized audio metadata are separate actual service purposes.
  // StrictMode may retire one initial owner; each bounded metadata batch is exact.
  const initialMetadata = metadataLoads.slice(beforeMetadata); expect(initialMetadata.length).toBeGreaterThanOrEqual(1); expect(initialMetadata.length).toBeLessThanOrEqual(2);
  for (const batch of initialMetadata) expect(batch).toEqual({ kind: "torah", offset: 0, refs: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"] });
  await ui(adminTab.locator(".reading-review").first()).toContainText("Needs review");
  // The paragraph note is part of the verse's tools (one Sheet for the selected verse, 1.9 N4): the first verse is selected, and its sheet carries the note.
  await ui((await openVerseTools(adminTab, "Genesis 1:1")).getByText("Closed paragraph (setumah) after this verse.", { exact: true })).toBeVisible(); await closeVerseTools(adminTab);
  expect(await adminTab.locator(".study-hebrew").first().getAttribute("lang") === "he" && await adminTab.locator(".study-hebrew").first().getAttribute("dir") === "rtl").toBe(true);
  expect(await adminTab.locator(".study-english img").count()).toBe(0);
  // Staff read with English off by default, as tutors do; the toolbar turns it on.
  await safe(() => adminTab.getByRole("navigation", { name: "Reading tools", exact: true }).getByRole("button", { name: "English", exact: true }).click());
  await ui(adminTab.getByText("English reference unavailable for this verse.", { exact: true })).toBeVisible();
  await safe(() => adminTab.getByText("Text sources, licenses and changes", { exact: true }).click());
  await ui(adminTab.getByRole("link", { name: "CC-BY-SA-4.0", exact: true })).toBeVisible(); await ui(adminTab.getByRole("link", { name: "CC-BY-NC-4.0", exact: true })).toBeVisible();
  expect(await adminTab.locator(".study-credits a").evaluateAll(links => links.every(link => (link as HTMLAnchorElement).protocol === "https:" && /^(www\.sefaria\.org|he\.wikisource\.org|jps\.org|creativecommons\.org)$/.test((link as HTMLAnchorElement).hostname) && link.getAttribute("rel")?.includes("noopener")))).toBe(true);
  await capture(adminTab, "study-admin-partial-desktop");
  const tutor = await page("tutor"); await navigate(tutor, "/workspace/tutor"); await safe(() => tutor.getByLabel("Student", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await loaded(tutor, "Genesis 1:1");
  expect(new URL(tutor.url()).pathname).toBe(`/workspace/tutor/${fixture.student.id}`); // A stable page per student.
  await navigate(tutor, `/workspace/tutor/${crypto.randomUUID()}`); await ui(tutor.getByRole("heading", { name: "Student not found", exact: true })).toBeVisible();
  expect(await tutor.locator(".study-verses").count()).toBe(0); // A route id outside the tutor's list loads nothing.
  await navigate(tutor, `/workspace/tutor/${fixture.student.id}`); await loaded(tutor, "Genesis 1:1");
  await safe(() => tutor.getByRole("link", { name: "Parent", exact: true }).click()); await safe(() => tutor.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await loaded(tutor, "Genesis 1:1");
  expect(await tutor.getByRole("heading", { name: "Set the assigned reading", exact: true }).count()).toBe(0);
  const learner = await page("student", true); await navigate(learner, "/workspace/student?tab=reading"); await loaded(learner, "Genesis 1:1"); expect(await learner.getByLabel("Student", { exact: true }).count()).toBe(0);
  studentTab = learner;
  expect(await learner.getByText("Aliyah boundaries have not been recorded for this assignment.", { exact: true }).count()).toBe(0);
  expect(await learner.locator(".student-aliyah").count()).toBe(0);
  for (const prose of ["Confirmed assignment", "Calendar source", "Selected English edition available.", "Unsent work stays only in this tab"]) expect(await learner.getByText(prose).count(), prose).toBe(0);
  await ui(colorsControl(learner)).toHaveAttribute("aria-pressed", "true");
  await ui(learner.getByRole("button", { name: "Hear verse", exact: true })).toHaveCount(0); await heldReading(learner);
  await firstHebrewInViewport(learner);
  await capture(learner, "study-student-partial-mobile");
  const assigned = await api(adminTab, `/api/students/${fixture.student.id}/reading?mode=admin`);
  const torah = assigned.data.readings.find((row: { kind: string }) => row.kind === "torah");
  const prepared = await api(adminTab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", kind: "torah", preparationMode: "current-assignment", expectedAssignmentRevision: torah.revision, aliyahStarts: [] });
  expect(prepared.status).toBe(200);
  expect((await api(adminTab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status).toBe(200);
  await click(learner, "Refresh reading"); await loaded(learner, "Genesis 1:1");
  await ui(learner.getByText("Aliyah 1 starts here", { exact: true })).toBeVisible();
  await firstHebrewInViewport(learner);
  await capture(learner, "study-student-one-aliyah-mobile"); await captureDark(learner, "study-student-one-aliyah-mobile-dark");
  if (!process.env.CI) { await safe(() => learner.setViewportSize({ width: 1440, height: 1000 })); await capture(learner, "study-student-one-aliyah-desktop"); await safe(() => learner.setViewportSize({ width: 390, height: 844 })); }
  const first = verse(learner, "Genesis 1:1"), hebrew = first.locator(".study-hebrew");
  const original = await safe(() => hebrew.textContent()), beforeColors = calls;
  await ui(learner.getByRole("navigation", { name: "Reading tools", exact: true })).toHaveCount(1);
  expect(await learner.locator(".study-verses details").count()).toBe(0); // One toolbar replaces per-verse aids in the actual flow.
  await colorVerse(learner, "Genesis 1:1");
  const indices = await first.locator("[data-word-index]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-word-index")).join(","));
  const synthetic = syntheticUiStudyPage({ kind: "torah", ranges: ["Genesis 1:1"], verses: ["Genesis 1:1"], offset: 0, translation: "jps2023" }).verses[0];
  const canonical = projectStudyVerse(synthetic.ref, synthetic.hebrew);
  if (canonical.status !== "ready") throw new Error("Synthetic study word projection unavailable");
  expect(indices).toBe(canonical.projection.words.map(word => word.index).join(","));
  await setColors(learner, false);
  expect(await learner.locator(".study-verses [data-family], .study-verses [data-phrase], .study-hebrew [aria-describedby*='-phrase-']").count()).toBe(0); // no phrase colours, so no phrase descriptions (the words still carry their action's description)
  expect(await first.locator("[data-word-index]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-word-index")).join(","))).toBe(indices);
  expect(await first.locator(".study-alternative .study-ketiv [data-word-index]").count()).toBe(0); // Ketiv is never a reading-word target.
  expect(await hebrew.textContent() === original && calls === beforeColors).toBe(true);
  await setColors(learner, true); await colorVerse(learner, "Genesis 1:1");
  expect(await first.locator("[data-word-index]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-word-index")).join(","))).toBe(indices);
  expect(await hebrew.textContent() === original && calls === beforeColors).toBe(true);
  expect(await first.locator(".study-alternative .study-ketiv [data-family]").count()).toBe(0);
  await capture(learner, "study-colors-mobile");
  await safe(() => learner.getByRole("button", { name: "View Genesis 1:1 up close", exact: true }).click());
  const lifted = learner.getByRole("dialog", { name: "Genesis 1:1", exact: true }); await ui(lifted).toBeVisible();
  await ui(lifted.getByRole("list", { name: "Phrase families for Genesis 1:1", exact: true })).toContainText("etnachta");
  await ui(lifted.getByRole("list", { name: "Phrase families for Genesis 1:1", exact: true })).toContainText("Word 1");
  await ui(lifted.getByText(/Verse 1 of 3/)).toBeVisible();
  await capture(learner, "study-lift-mobile"); await captureDark(learner, "study-lift-mobile-dark");
  for (let step = 0; step < 12 && await lifted.getByRole("heading", { name: "Genesis 1:1", exact: true }).count(); step++) await safe(() => lifted.getByRole("button", { name: /^Next (phrase|verse)$/ }).click());
  await ui(learner.getByRole("dialog", { name: "Genesis 1:2", exact: true })).toBeVisible();
  await safe(() => learner.getByRole("button", { name: "Close practice view", exact: true }).click()); await ui(learner.getByRole("dialog")).toHaveCount(0);
  expect(calls).toBe(beforeColors);
  await click(learner, "Haftarah text"); await loaded(learner, "Isaiah 1:1"); expect(await learner.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true }).count()).toBe(0);
  const summaries = learner.getByRole("group", { name: "Assigned readings", exact: true });
  await ui(summaries.locator('[aria-current="true"]')).toContainText("Haftarah Isaiah 1:1\u20132");
  await ui(summaries.locator('[aria-current="true"]')).toContainText("2 verses");
  const middle = await colorVerse(learner, "Isaiah 1:1"), final = await colorVerse(learner, "Isaiah 1:2");
  expect(await middle.locator('[data-family="sof-pasuk"]').count()).toBeGreaterThan(0);
  expect(await final.locator('[data-family="sof-haftarah"]').count()).toBeGreaterThan(0);
  await colorVerse(adminTab, "Genesis 1:1"); await capture(adminTab, "study-colors-desktop");
  await safe(() => adminTab.evaluate(() => { document.documentElement.style.zoom = "2"; })); await capture(adminTab, "study-colors-desktop-200");
  await safe(() => adminTab.evaluate(() => { document.documentElement.style.zoom = ""; }));
});

it("wraps a synthetic long verse at Standard and Huge on a phone and keeps Start inline and restores keyboard focus after optional close-up", async () => {
  const tab = studentTab, directory = join(process.cwd(), ".local-logs", "frozen-longverse-review");
  await mkdir(directory, { recursive: true });
  longVerse = true;
  try {
    await click(tab, "Torah text"); await click(tab, "Refresh reading"); await loaded(tab, "Genesis 1:1");
    const first = verse(tab, "Genesis 1:1").locator(".study-hebrew");
    for (const size of ["Standard", "Huge"] as const) {
      const toolbar = tab.getByRole("navigation", { name: "Reading tools", exact: true });
      await safe(() => toolbar.getByRole("button", { name: /^Text size:/ }).click());
      await safe(() => toolbar.getByRole("group", { name: "Hebrew text size", exact: true }).getByRole("button", { name: new RegExp(`${size}$`) }).click());
      await safe(() => tab.evaluate(async () => {
        await document.fonts.ready; scrollTo(0, 0);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }));
      const lines = await first.evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        return new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
      });
      expect(lines).toBeGreaterThan(2);
      expect(await tab.evaluate(() => innerWidth === 390 && innerHeight === 844 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const firstWord = await first.locator('[data-word-index="0"]').first().evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node); const bounds = range.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom };
      });
      expect(firstWord.top).toBeGreaterThanOrEqual(0); expect(firstWord.bottom).toBeLessThanOrEqual(await tab.evaluate(() => innerHeight));
      // The toolbar is the tool dock on a phone (1.9 N4): fixed at the bottom, with matching padding under the passage so it covers no verse at the end.
      const dock = await tab.evaluate(() => { const bar = document.querySelector(".reading-toolbar")!, layout = document.querySelector(".reading-passage-layout")!;
        return { position: getComputedStyle(bar).position, padding: Number.parseFloat(getComputedStyle(layout).paddingBottom), height: bar.getBoundingClientRect().height }; });
      expect(dock.position).toBe("fixed"); expect(dock.padding).toBeGreaterThanOrEqual(dock.height);
      const readingText = await first.textContent();
      await safe(() => tab.screenshot({ path: join(directory, `${size.toLowerCase()}-reading.png`) }));
      await safe(() => tab.getByRole("button", { name: "Refresh reading", exact: true }).focus()); await safe(() => tab.keyboard.press("Tab"));
      const start = tab.getByRole("button", { name: "Start reading", exact: true }); await ui(start).toBeFocused();
      await safe(() => tab.keyboard.press("Enter"));
      await ui(tab.locator(".study-verses")).toBeFocused(); await heldReading(tab);
      await ui(tab.getByRole("region", { name: "Reading playback", exact: true })).toHaveCount(0); await ui(tab.getByRole("dialog")).toHaveCount(0);
      await selectVerse(tab, "Genesis 1:1"); const closeup = tab.getByRole("button", { name: "View Genesis 1:1 up close", exact: true }); await safe(() => closeup.click());
      const dialog = tab.getByRole("dialog", { name: "Genesis 1:1", exact: true }); await ui(dialog).toBeVisible();
      await ui(dialog.getByRole("button", { name: "Close practice view", exact: true })).toBeVisible();
      expect(await dialog.locator(".study-hebrew").textContent()).toBe(readingText);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await safe(() => tab.screenshot({ path: join(directory, `${size.toLowerCase()}-lift.png`) }));
      if (size === "Huge") {
        const stage = dialog.locator(".lift-stage");
        expect(await stage.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
        // Apparatus and the phrase legend follow the Hebrew. Center the actual
        // final read word inside this stage instead of scrolling past it.
        await safe(() => stage.evaluate(node => {
          const words = node.querySelectorAll("[data-word-index]"), word = words[words.length - 1].getBoundingClientRect(), bounds = node.getBoundingClientRect();
          node.scrollTop += (word.top + word.bottom - bounds.top - bounds.bottom) / 2;
        }));
        const finalWord = dialog.locator("[data-word-index]").last(); await ui(finalWord).toBeVisible();
        const usable = await finalWord.evaluate(node => {
          const word = node.getBoundingClientRect(), stage = node.closest(".lift-stage")!.getBoundingClientRect(), dialog = node.closest("dialog")!.getBoundingClientRect();
          return word.top >= Math.max(stage.top, dialog.top) && word.bottom <= Math.min(stage.bottom, dialog.bottom) + 1
            && word.left >= Math.max(stage.left, dialog.left) && word.right <= Math.min(stage.right, dialog.right) + 1;
        });
        expect(usable, "The final Huge word is reachable inside the scrollable practice stage").toBe(true);
        await safe(() => tab.screenshot({ path: join(directory, "huge-lift-end.png") }));
      }
      await safe(() => tab.keyboard.press("Escape")); await ui(dialog).toHaveCount(0); await ui(closeup).toBeFocused(); await heldReading(tab);
    }
  } finally {
    longVerse = false;
    if (await tab.getByRole("dialog").count()) await safe(() => tab.keyboard.press("Escape"));
    const toolbar = tab.getByRole("navigation", { name: "Reading tools", exact: true });
    await safe(() => toolbar.getByRole("button", { name: /^Text size:/ }).click());
    await safe(() => toolbar.getByRole("group", { name: "Hebrew text size", exact: true }).getByRole("button", { name: /Standard$/ }).click());
    await click(tab, "Refresh reading"); await loaded(tab, "Genesis 1:1");
  }
});

it("retains optional close-up during a quiet unchanged access check without requiring it for Start", async () => {
  const tab = await page("student", true); await navigate(tab, "/workspace/student?tab=reading"); await loaded(tab, "Genesis 1:1"); await click(tab, "Start reading");
  await ui(tab.locator(".study-verses")).toBeFocused(); await heldReading(tab);
  await ui(tab.getByRole("region", { name: "Reading playback", exact: true })).toHaveCount(0); await ui(tab.getByRole("dialog")).toHaveCount(0);
  await click(tab, "View Genesis 1:1 up close"); const dialog = tab.getByRole("dialog", { name: "Genesis 1:1", exact: true }); await ui(dialog).toBeVisible();
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/api/session", async route => { const response = await privateRouteFetch(route, tab); if (!response) return; held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
    await ui(tab.getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden(); await ui(dialog).toBeVisible();
  } finally { release(); await tab.unroute("**/api/session"); }
  await loaded(tab, "Genesis 1:1"); await ui(dialog).toBeVisible(); await safe(() => tab.keyboard.press("Escape")); await ui(dialog).toHaveCount(0);
  const start = tab.getByRole("button", { name: "Start reading", exact: true }); await safe(() => start.focus()); await safe(() => tab.keyboard.press("Enter"));
  await ui(tab.locator(".study-verses")).toBeFocused(); await heldReading(tab);
  await ui(tab.getByRole("region", { name: "Reading playback", exact: true })).toHaveCount(0); await ui(tab.getByRole("dialog")).toHaveCount(0);
});

it("keeps unsent typing and an unknown save intact while phrase controls change", async () => {
  const tab = await page("student"); await navigate(tab, "/workspace/student?tab=reading"); await loaded(tab, "Genesis 1:1");
  // The translation and notes are in the verse tools sheet; closing the sheet (to use the page's controls) leaves the unsent text in the tab, and reopening shows it.
  const panel = (await openVerseTools(tab, "Genesis 1:1")).locator(".verse-work"); await safe(() => panel.locator("summary").click());
  const field = panel.getByRole("textbox"); await ui(field).toBeVisible();
  let release!: () => void, committed = false, writes = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route("**/work/draft", async route => { writes++; const response = await privateRouteFetch(route, tab); if (!response) return; committed = response.status() === 200; await gate; await route.fulfill({ response }).catch(() => undefined); });
  try {
    await safe(() => field.fill("Synthetic save held during phrase colors")); await safe(() => panel.getByRole("button", { name: "Save now", exact: true }).click());
    await ui.poll(() => committed).toBe(true);
    await safe(() => field.fill("Synthetic queued typing kept through phrase colors"));
    await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab.", { timeout: 18_000 });
    await closeVerseTools(tab);
    await colorVerse(tab, "Genesis 1:1");
    await setColors(tab, false); await setColors(tab, true);
    await colorVerse(tab, "Genesis 1:2");
    await openVerseTools(tab, "Genesis 1:1");
    await ui(field).toHaveValue("Synthetic queued typing kept through phrase colors");
    await ui(panel.locator(".work-status")).toHaveText("Save not confirmed. Your text is still in this tab."); expect(writes).toBe(1);
  } finally { release(); await tab.unroute("**/work/draft"); }
  await openVerseTools(tab, "Genesis 1:1");
  await safe(() => panel.getByRole("button", { name: "Check what saved", exact: true }).click());
  await ui(field).toHaveValue("Synthetic queued typing kept through phrase colors"); await ui(panel.locator(".work-status")).toHaveText("Saved", { timeout: 18_000 });
});

it("discards held old-child text after a switch, keeps another tab independent, and clears text after relationship revocation", async () => {
  const tab = await page("tutor", true); await navigate(tab, "/workspace/parent"); await safe(() => tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await click(tab, "Practice with Synthetic"); await loaded(tab, "Genesis 1:1");
  const other = await tab.context().newPage(); await navigate(other, "/workspace/parent"); await safe(() => other.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click()); await click(other, "Practice with Synthetic"); await loaded(other, "Genesis 1:1");
  await colorVerse(tab, "Genesis 1:1"); await setColors(tab, false); // Remembered for this child only.
  const pattern = new RegExp(`/api/students/${fixture.student.id}/study-text\\?`); let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await tab.route(pattern, async route => { const response = await privateRouteFetch(route, tab); if (!response) return; held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  await click(tab, "Refresh reading"); await ui.poll(() => held).toBe(true);
  try { await click(tab, "Switch to Synthetic Sibling"); await loaded(tab, "Genesis 2:1"); } finally { release(); }
  await tab.unroute(pattern); expect(await tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", exact: true }).count()).toBe(0);
  expect(await tab.locator(".study-verses [data-verse-ref]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-verse-ref")).join(","))).toBe("Genesis 2:1,Genesis 2:2");
  await ui(colorsControl(tab)).toHaveAttribute("aria-pressed", "true"); await ui(tab.locator(".study-verses [data-family]").first()).toBeVisible(); // The sibling keeps their own default.
  await colorVerse(tab, "Genesis 2:1");
  await capture(tab, "study-child-sibling-mobile");
  const relationships = await api(adminTab, `/api/admin/students/${sibling.id}/relationships`);
  const guardian = relationships.data.guardians[0]; expect(Boolean(guardian)).toBe(true);
  expect((await api(adminTab, `/api/admin/students/${sibling.id}/relationships/guardians/${guardian.id}/revoke`, { expectedState: "active" })).status === 200).toBe(true);
  await click(tab, "Refresh reading"); await ui(tab.getByLabel("Child", { exact: true })).toBeVisible(); expect(await tab.locator(".study-verses").count()).toBe(0);
  expect(await tab.locator("[data-family], [data-word-index]").count()).toBe(0);
  await safe(() => other.evaluate(() => window.dispatchEvent(new Event("focus")))); await loaded(other, "Genesis 1:1");
  expect(modes.size === 5 && [...modes].every(mode => ["student", "parent", "tutor", "admin", "child-practice"].includes(mode))).toBe(true);
});

it("preserves staff drafts, paging and quiet same-session reading while rejecting stale responses and expired session", async () => {
  // This case intentionally expires the session, so acquire its own real SDK
  // sign-in instead of reusing an earlier case's cached role session.
  const tab = await page("admin", false, true); await navigate(tab, `/workspace/admin/students/${fixture.student.id}/reading`); await loaded(tab, "Genesis 1:1");
  // The verse editor is a sheet over the reading; its draft stays mounted while it is closed.
  await safe(() => tab.getByRole("button", { name: /^(Change|Assign) verses$/ }).click());
  await safe(() => tab.getByLabel("Passage", { exact: true }).selectOption("custom")); await safe(() => tab.getByText("Advanced references and aliyah boundaries", { exact: true }).click()); await safe(() => tab.getByLabel("Custom verse ranges", { exact: true }).fill("Genesis 1:4-5"));
  await safe(() => tab.getByRole("button", { name: "Close verse editor", exact: true }).click());
  unavailable = true; await click(tab, "Refresh reading"); await ui(tab.getByRole("heading", { name: "Text unavailable", level: 4, exact: true })).toBeVisible();
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5"); expect(await tab.locator(".study-hebrew").count()).toBe(0);
  unavailable = false; english = "unavailable"; await click(tab, "Reload assigned text"); await loaded(tab, "Genesis 1:1"); await capture(tab, "study-english-unavailable-desktop"); english = "partial";
  const prepared = await api(tab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 1:1-4:24"] }); expect(prepared.status === 200 && prepared.data.status === "prepared").toBe(true);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: prepared.data.binding })).status === 200).toBe(true);
  await click(tab, "Refresh reading"); await ui(tab.locator(".study-verses [data-verse-ref]")).toHaveCount(100);
  await colorVerse(tab, "Genesis 1:1");
  const beforeNext = calls; await click(tab, "Next text page"); await ui(tab.locator(".study-verses [data-verse-ref]")).toHaveCount(4); expect(calls - beforeNext).toBe(1);
  await ui(tab.getByRole("navigation", { name: "Reading tools", exact: true })).toHaveCount(1);
  expect(await tab.locator(".study-verses details[open]").count()).toBe(0);
  await ui(tab.locator(".study-verses [data-family]").first()).toBeVisible();
  let release!: () => void, held = false, metadataReleased = false, verifiedSessions = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  const existingText = await tab.locator(".study-verses").elementHandle();
  let textReloads = 0; const countText = (request: import("playwright").Request) => { if (new URL(request.url()).pathname.endsWith("/study-text")) textReloads++; }; tab.on("request", countText);
  const scroll = await tab.evaluate(() => { window.scrollTo(0, 240); return window.scrollY; });
  const countVerifiedSession = (response: import("playwright").Response) => { if (metadataReleased && new URL(response.url()).pathname === "/api/session" && response.status() === 200) verifiedSessions++; }; tab.on("response", countVerifiedSession);
  await tab.route("**/reading?**", async route => { const response = await privateRouteFetch(route, tab); if (!response) return; held = true; await gate; metadataReleased = true; await route.fulfill({ response }).catch(() => undefined); });
  try {
    await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui.poll(() => held).toBe(true);
    await ui(tab.locator("#workspace-main").getByRole("heading", { name: "Checking your access", level: 1, exact: true })).toBeHidden(); await ui(tab.locator(".study-verses")).toBeVisible();
    expect(await existingText!.evaluate(node => node === document.querySelector(".study-verses"))).toBe(true); expect(await tab.evaluate(() => window.scrollY)).toBe(scroll); expect(textReloads).toBe(0);
    await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5");
  } finally { release(); }
  // Observe readVerified's trailing session and the provider's final session;
  // unrelated long-lived browser requests are not a quiet-authority barrier.
  await ui.poll(() => verifiedSessions).toBeGreaterThanOrEqual(2); tab.off("response", countVerifiedSession);
  await ui(tab.locator(".study-verses")).toBeVisible(); await ui(tab.locator(".study-verses [data-verse-ref]")).toHaveCount(4); await tab.unroute("**/reading?**");
  expect(await existingText!.evaluate(node => node === document.querySelector(".study-verses"))).toBe(true); expect(textReloads).toBe(0); tab.off("request", countText); await existingText?.dispose();
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5");
  const replacement = await api(tab, `/api/students/${fixture.student.id}/reading/prepare`, { mode: "admin", ranges: ["Genesis 2:1-2"] });
  expect(replacement.status === 200 && replacement.data.status === "prepared").toBe(true);
  expect((await api(tab, `/api/students/${fixture.student.id}/reading/confirm`, { mode: "admin", binding: replacement.data.binding })).status === 200).toBe(true);
  await click(tab, "Previous text page"); await ui(tab.getByRole("heading", { name: "Assignment changed", level: 4, exact: true })).toBeVisible();
  expect(await tab.locator(".study-hebrew").count()).toBe(0);
  // The verse marks and the study guide are read after the reloaded text is shown. If the server answers
  // either one after the expiry below, it denies the reading in place and unregisters the reading's focus
  // check while that check's own session 401 is in flight, so the provider discards it as stale and never
  // asks to sign in. Expire only once both reads of this reload have answered under the live session.
  const followOn = ["progress", "study-guide"].map(name => tab.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `/api/students/${fixture.student.id}/${name}`, { timeout: 30_000 }));
  for (const read of followOn) read.catch(() => undefined); // Awaited below; a failure before then must not surface as an unhandled rejection.
  await click(tab, "Refresh reading and text"); await loaded(tab, "Genesis 2:1"); await ui(tab.locator(".study-verses [data-verse-ref]")).toHaveCount(2); await safe(() => Promise.all(followOn));
  expect(await tab.getByRole("navigation", { name: "Text pages", exact: true }).count()).toBe(0); // A single page shows no paging controls.
  await ui(tab.getByLabel("Custom verse ranges", { exact: true })).toHaveValue("Genesis 1:4-5");
  await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.userId, fixture.admin.id));
  await safe(() => tab.evaluate(() => window.dispatchEvent(new Event("focus")))); await ui(tab.getByRole("heading", { name: "Sign in to continue", level: 1, exact: true })).toBeVisible(); expect(await tab.locator(".study-hebrew").count()).toBe(0);
});
