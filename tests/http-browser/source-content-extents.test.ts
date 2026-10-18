// Real restricted HTTP services with invented flat commentary; loopback only.
import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { parseRelatedMetadata, parseEditionMetadata } from "../../src/server/study/sources/metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
vi.mock("server-only", () => ({}));

const work = "Invented Browser Extents", refs = [`${work} 4:9`, `${work} 4:9:7-9`, `${work} 4:10`, `${work} 4:10:2-4`, `${work} 4:11:3-5`];
const hebrew = ["בְּעִיר דִּמְיוֹן קְטַנָּה פּוֹרֵחַ פֶּרַח כָּחוֹל.", "", "עַל הַשֻּׁלְחָן נָחָה סִירָה יְרֻקָּה מִנְּיָר."];
const english = ["An invented blue flower opens beside a paper boat.", "", "The imaginary window faces a green hill."];
const provenance = "inert:invented-extent-provenance";
const rows = (ref: string) => refs.map((sourceRef, n) => ({ _id: `extent_${n}`, sourceRef, index_title: work, category: "Commentary", anchorRef: ref, collectiveTitle: { en: `Invented extent ${n + 1}`, he: null } }));
const editions = () => parseEditionMetadata(["he", "en"].map(language => ({ title: work, versionTitle: `Invented ${language} edition`, language: language === "he" ? "en" : "he", actualLanguage: language, license: "CC0", versionSource: provenance })), work);
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, readingId = "", relatedCalls = 0, editionCalls = 0, bodyCalls = 0, duplicateKeys = 0;
let barrier: { entered(): void; wait: Promise<void>; release(): void } | undefined;
const contexts: BrowserContext[] = [], cookies: Partial<Record<"admin" | "student", Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};
const panel = (tab: Page) => tab.locator('.study-verse-detail[data-verse-ref="Genesis 1:1"]').getByRole("region", { name: "Sources for Genesis 1:1", exact: true });
const reader = (tab: Page, n: number) => panel(tab).getByRole("region", { name: `Read source: ${refs[n]}`, exact: true });
const list = (tab: Page, lane: "Assigned" | "Related") => panel(tab).getByRole("list", { name: `${lane} sources`, exact: true });
async function api(tab: Page, path: string, body: unknown) { return tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; }, { path, body }); }
async function page(who: "admin" | "student", phone = false, colorScheme: "light" | "dark" = "light", capture = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, ...(capture ? { reducedMotion: "reduce" as const } : {}), serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.addInitScript(() => { const prior = window.Audio; Object.defineProperty(window, "extentAudio", { value: { count: 0 } }); window.Audio = new Proxy(prior, { construct(target, args) { (window as unknown as { extentAudio: { count: number } }).extentAudio.count++; return Reflect.construct(target, args); } }); });
  await context.route("**/*", route => new URL(route.request().url()).origin === BROWSER_ORIGIN ? route.continue() : route.abort());
  if (cookies[who]) await context.addCookies(cookies[who]!); const tab = await context.newPage(); tab.on("console", message => { if (message.text().includes("Encountered two children with the same key")) duplicateKeys++; });
  await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!cookies[who]) { const email = `pg-${who}@example.test`; expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies[who] = await context.cookies(); }
  await tab.goto(who === "student" ? "/workspace/student" : `/workspace/admin/students/${fixture.student.id}/reading`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator('.study-verses [data-verse-ref="Genesis 1:1"]')).toBeVisible(); return tab;
}
async function open(tab: Page) { await panel(tab).getByRole("button", { name: "Sources", exact: true }).click(); await ui(list(tab, "Assigned")).toBeVisible(); }
async function browse(tab: Page) { await panel(tab).getByRole("button", { name: "Browse related sources", exact: true }).click(); await ui(list(tab, "Related")).toBeVisible(); }
async function citation(tab: Page, n: number, lane: "Assigned" | "Related") { await list(tab, lane).getByRole("button", { name: `Read source: ${refs[n]}`, exact: true }).click(); await ui(reader(tab, n).getByRole("list", { name: "Source editions", exact: true })).toBeVisible(); }
async function choose(tab: Page, n: number, language: "he" | "en") { await reader(tab, n).getByRole("button", { name: `Read ${language === "he" ? "Hebrew" : "English"} edition`, exact: true }).click(); }
async function noAudio(tab: Page) { expect(await tab.evaluate(() => (window as unknown as { extentAudio: { count: number } }).extentAudio.count)).toBe(0); }
function mutationCount(tab: Page) { let count = 0; tab.on("request", request => { if (request.method() === "POST" && /source-assignments|practice-calendar/.test(new URL(request.url()).pathname)) count++; }); return () => count; }

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request), relatedReader: async ref => { relatedCalls++; return parseRelatedMetadata(rows(ref), ref); }, sourceEditionReader: async () => { editionCalls++; return editions(); }, sourceContentReader: async selected => {
    bodyCalls++; const gate = barrier; if (gate) { gate.entered(); await gate.wait; }
    const n = refs.indexOf(selected.ref), ranged = selected.ref.includes("-"), address = selected.ref.slice(work.length + 1).split("-"), sections = address[0].split(":"), toSections = ranged ? [...sections.slice(0, -1), address[1]] : sections;
    const text = n === 2 ? [] : n === 3 ? ["", "", ""] : n === 4 ? ["Invented truncated range.", ""] : selected.actualLanguage === "he" ? hebrew : english;
    return { ref: selected.ref, indexTitle: work, textDepth: 3, sections, toSections, isComplex: false, addressTypes: ["Perek", "Pasuk", "Integer"], index_offsets_by_depth: {}, isSpanning: false, warnings: [], versions: [{ versionTitle: selected.editionTitle, language: selected.language, actualLanguage: selected.actualLanguage, languageFamilyName: selected.motherTongue, license: "CC0", versionSource: provenance, text }] };
  } });
  const learner = await fixture.signIn("pg-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning(), [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
  const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", setByMembershipId: admin.id, proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning(); readingId = assignment.id;
  await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2].map(n => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: readingId, ordinal: n, verseRef: `Genesis 1:${n}` })));
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  // Use this runtime's real SDK browser cookie, not the base fixture's auth secret.
  const setup = await page("admin"), catalog = parseRelatedMetadata(rows("Genesis 1:1"), "Genesis 1:1");
  const seeded = await api(setup, `/api/students/${fixture.student.id}/source-assignments`, { mode: "admin", kind: "torah", assignmentId: readingId, assignmentRevision: 1, verseRef: "Genesis 1:1", expectedVersion: 0, mutationId: randomUUID(), sourceIds: ["extent_0"], catalogHash: projectRelatedCatalog(catalog, catalog.verse).catalogHash });
  expect(seeded.status).toBe(200); expect(seeded.value).toMatchObject({ ok: true }); contexts.splice(contexts.indexOf(setup.context()), 1); await setup.context().close();
}, 120000);
afterEach(async () => { barrier?.release(); barrier = undefined; for (const context of contexts.splice(0)) await context.close(); });
afterAll(async () => { try { barrier?.release(); await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); } finally { restore?.(); } expect(duplicateKeys).toBe(0); }, 120000);

it("actual assigned Hebrew parent and related English range preserve missing positions and a staff draft without mutations", async () => {
  const tab = await page("admin"), posts = mutationCount(tab); await open(tab); const before = bodyCalls; await citation(tab, 0, "Assigned"); expect(bodyCalls).toBe(before); await choose(tab, 0, "he");
  const parentRows = reader(tab, 0).getByRole("list", { name: "Source segments", exact: true }).getByRole("listitem"); await ui(parentRows).toHaveCount(3);
  await ui(parentRows.nth(0)).toContainText(`${work} 4:9:1`); await ui(parentRows.nth(0).locator('[lang="he"]')).toHaveText(hebrew[0]); await ui(parentRows.nth(1)).toContainText("No text was returned for this segment"); await ui(parentRows.nth(2).locator('[lang="he"]')).toHaveText(hebrew[2]);
  expect(await parentRows.nth(0).locator('[lang="he"]').getAttribute("dir")).toBe("rtl"); await ui(reader(tab, 0)).toContainText("Other segments may exist in other editions");
  await browse(tab); await list(tab, "Related").getByRole("checkbox").nth(1).check(); await citation(tab, 1, "Related"); await choose(tab, 1, "en");
  const rangeRows = reader(tab, 1).getByRole("list", { name: "Source segments", exact: true }).getByRole("listitem"); await ui(rangeRows).toHaveCount(3);
  await ui(rangeRows.nth(0)).toContainText(`${work} 4:9:7`); await ui(rangeRows.nth(0).locator('[lang="en"]')).toHaveText(english[0]); await ui(rangeRows.nth(1)).toContainText(`${work} 4:9:8`); await ui(rangeRows.nth(2)).toContainText(`${work} 4:9:9`);
  await ui(panel(tab).getByRole("button", { name: "Save sources", exact: true })).toBeEnabled(); await ui(list(tab, "Related").getByRole("checkbox").nth(1)).toBeChecked(); expect(posts()).toBe(0); await noAudio(tab);
});

it("phone reader observes zero-parent and all-missing range, retaining snapshot and scroll on quiet return with no source GET", async () => {
  const tab = await page("student", true), posts = mutationCount(tab); await open(tab); await browse(tab); await ui(list(tab, "Related").getByRole("checkbox")).toHaveCount(0);
  await citation(tab, 2, "Related"); await choose(tab, 2, "he"); await ui(reader(tab, 2)).toContainText("No segments were returned for this source in this edition."); await ui(reader(tab, 2).getByRole("list", { name: "Source segments", exact: true }).getByRole("listitem")).toHaveCount(0);
  await citation(tab, 3, "Related"); await choose(tab, 3, "en"); await ui(reader(tab, 3)).toContainText("No text was returned for these segments in this edition.");
  const items = reader(tab, 3).getByRole("list", { name: "Source segments", exact: true }).getByRole("listitem"); await ui(items).toHaveCount(3); for (let n = 0; n < 3; n++) await ui(items.nth(n)).toContainText(`${work} 4:10:${n + 2}`);
  await reader(tab, 3).evaluate(node => { (window as unknown as { extentNode: Element }).extentNode = node; window.scrollTo(0, 250); });
  const before = [relatedCalls, editionCalls, bodyCalls], scroll = await tab.evaluate(() => scrollY); let sessions = 0; tab.on("response", response => { if (new URL(response.url()).pathname === "/api/session" && response.status() === 200) sessions++; });
  await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await ui.poll(() => sessions).toBeGreaterThanOrEqual(4);
  expect([relatedCalls, editionCalls, bodyCalls]).toEqual(before); expect(await reader(tab, 3).evaluate(node => node === (window as unknown as { extentNode: Element }).extentNode)).toBe(true); expect(await tab.evaluate(() => scrollY)).toBe(scroll); expect(posts()).toBe(0); await noAudio(tab);
});

it("a short range holds the whole source and real session expiry clears a held later range without publishing late text", async () => {
  const tab = await page("admin"), posts = mutationCount(tab); await open(tab); await browse(tab); await citation(tab, 4, "Related");
  const response = tab.waitForResponse(value => new URL(value.url()).pathname.endsWith("/source-text")); await choose(tab, 4, "en"); expect((await response).status()).toBe(503);
  await ui(reader(tab, 4)).toContainText("This source couldn’t be loaded."); await ui(reader(tab, 4).getByRole("list", { name: "Source segments", exact: true })).toHaveCount(0);
  await citation(tab, 1, "Related"); let entered!: () => void, release!: () => void; const entry = new Promise<void>(r => entered = r), wait = new Promise<void>(r => release = r); barrier = { entered, wait, release };
  await choose(tab, 1, "en"); await entry;
  try { await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, fixture.admin.id)); } finally { release(); barrier = undefined; }
  await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); await ui(tab.locator(".study-verses")).toHaveCount(0); await ui(reader(tab, 1)).toHaveCount(0); expect(posts()).toBe(0); await noAudio(tab);
});

it.runIf(process.env.SOURCE_EXTENTS_CAPTURE === "1")("captures four approved ordered-source extent regions only", async () => {
  const directory = join(process.cwd(), ".impeccable", "review", "source-extents");
  await mkdir(directory, { recursive: true });
  const freezePath = join(process.cwd(), ".local-logs", "source-content-extents-contract-freeze.json"), freezeBytes = await readFile(freezePath);
  const freezeSha256 = createHash("sha256").update(freezeBytes).digest("hex");
  expect(freezeSha256).toBe("61400c2609331da4446a951bc60e5eff6edf7c36691d9bc12db88bb2552a828c");
  const freeze = JSON.parse(freezeBytes.toString("utf8")) as { files: { path: string; sha256: string }[] };
  async function verifyFreeze() { for (const file of freeze.files) expect(createHash("sha256").update(await readFile(join(process.cwd(), file.path))).digest("hex")).toBe(file.sha256); }
  await verifyFreeze();
  for (const text of hebrew.filter(Boolean)) { expect(text).toMatch(/[\u0590-\u05ff]/); expect(text).not.toMatch(/[A-Za-z]/); }
  const images: unknown[] = [], style = "nextjs-portal { display: none !important; }";
  async function image(tab: Page, n: number, name: string, theme: "light" | "dark", state: string) {
    const target = reader(tab, n), heading = target.getByRole("heading", { level: 5 });
    await tab.evaluate(async () => { await document.fonts.ready; });
    await heading.evaluate(node => { const h = node as HTMLElement; h.tabIndex = -1; h.focus({ preventScroll: true }); });
    await target.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + scrollY));
    const facts = await tab.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollY, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    expect(facts.horizontalOverflow).toBe(false); expect(facts.reducedMotion).toBe(true); expect(await heading.evaluate(node => document.activeElement === node)).toBe(true);
    const rect = await target.boundingBox(); expect(rect).not.toBeNull();
    const clip = { x: Math.max(0, rect!.x), y: rect!.y + facts.scrollY, width: rect!.width, height: rect!.height };
    expect(Math.abs(rect!.y)).toBeLessThanOrEqual(1);
    async function skipFacts() { return tab.evaluate(capture => {
      const skip = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Skip to workspace"), box = skip?.getBoundingClientRect();
      if (!box) return { present: false, offscreen: true, outsideDocumentClip: true };
      const left = box.left + scrollX, top = box.top + scrollY;
      return { present: true, offscreen: box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth, outsideDocumentClip: left + box.width <= capture.x || left >= capture.x + capture.width || top + box.height <= capture.y || top >= capture.y + capture.height };
    }, clip); }
    const beforeSkip = await skipFacts(); expect(beforeSkip.present).toBe(true); expect(beforeSkip.offscreen).toBe(true); expect(beforeSkip.outsideDocumentClip).toBe(true);
    const controls = [];
    for (const label of ["Close source", "Back to editions"]) { const control = target.getByRole("button", { name: label, exact: true }); await ui(control).toBeVisible(); const bounds = await control.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.height).toBeGreaterThanOrEqual(44); controls.push({ name: label, rect: bounds }); }
    const png = await tab.screenshot({ fullPage: true, clip, animations: "disabled", style });
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true); expect(png.length).toBeGreaterThan(1000); expect(png.length).toBeLessThan(16 * 1024 * 1024);
    const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }; expect(pixels.width).toBeGreaterThan(100); expect(pixels.height).toBeGreaterThan(100);
    const afterSkip = await skipFacts(); expect(afterSkip).toEqual(beforeSkip); expect(await tab.evaluate(() => scrollY)).toBe(facts.scrollY);
    await writeFile(join(directory, `${name}.png`), png, { flag: "wx" });
    images.push({ file: `${name}.png`, theme, state, viewport: { width: facts.width, height: facts.height }, pixels, rect, clip, screenshotFullPageDocumentClip: true, controls, fontsSettled: true, sourceHeadingFocus: true, stableTop: true, beforeSkip, afterSkip, horizontalOverflow: false, reducedMotion: true, sha256: createHash("sha256").update(png).digest("hex") });
    await noAudio(tab);
  }
  const dl = await page("admin", false, "light", true); await open(dl); await citation(dl, 0, "Assigned"); await choose(dl, 0, "he"); await ui(reader(dl, 0)).toContainText(hebrew[2]); await image(dl, 0, "desktop-light-hebrew-parent", "light", "invented-hebrew-parent-with-missing-middle");
  const dd = await page("admin", false, "dark", true); await open(dd); await browse(dd); await citation(dd, 1, "Related"); await choose(dd, 1, "en"); await ui(reader(dd, 1)).toContainText(english[2]); await image(dd, 1, "desktop-dark-english-range", "dark", "invented-english-range-with-missing-middle");
  const pl = await page("student", true, "light", true); await open(pl); await browse(pl); await citation(pl, 2, "Related"); await choose(pl, 2, "he"); await ui(reader(pl, 2)).toContainText("No segments were returned for this source in this edition."); await image(pl, 2, "phone-light-empty-parent", "light", "zero-parent-explicit-empty");
  const pd = await page("student", true, "dark", true); await open(pd); await browse(pd); await citation(pd, 3, "Related"); await choose(pd, 3, "en"); await ui(reader(pd, 3)).toContainText("No text was returned for these segments in this edition."); await image(pd, 3, "phone-dark-all-missing-range", "dark", "all-missing-range-exact-positions");
  expect(images).toHaveLength(4); await verifyFreeze();
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ schema: "source-extents-review-packet/v1", sourceFreezeSha256: freezeSha256, syntheticOnly: true, inheritedContextPacket: "../source-content/manifest.json", screenshotOnlySuppression: "nextjs-portal development indicator; no product UI suppressed", limits: ["local ordered-source addition in inherited Song session only", "not full language/device/theme Cartesian coverage", "no linguistic, hosted or source API acceptance claim", "root detector reused at .local-logs/source-extents-detector.json; not rerun"], images }, null, 2) + "\n", { flag: "wx" });
});
