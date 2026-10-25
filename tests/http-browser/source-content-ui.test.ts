import { observeSilentAudio, expectSilentAudio } from "./audio-observation";
// Actual restricted SDK/HTTP services, synthetic metadata/scalars, loopback only.
import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { parseRelatedMetadata, parseEditionMetadata } from "../../src/server/study/sources/metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { closeVerseTools, openVerseTools, toolsSheet } from "./verse-tools";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let readingId = "", siblingId = "", revision = 0, duplicateKeys = 0, editionsCalls = 0, bodyCalls = 0, relatedCalls = 0;
let bodyBarrier: { entered(): void; wait: Promise<void> } | undefined;
let captureNamedNode = false;
const contexts: BrowserContext[] = [], cookies: Partial<Record<"admin" | "tutor" | "student", Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};
const work = "Invented Browser Commentary", sourceRef = (n = 0) => `${work} 1:1:${n + 1}`;
const rows = (ref: string) => Array.from({ length: 13 }, (_, n) => ({ _id: `reader_${String(n).padStart(3, "0")}`, sourceRef: captureNamedNode && n === 12 ? `${work}, Introduction` : sourceRef(n), index_title: work, category: revision ? "Commentary updated" : "Commentary", anchorRef: ref, collectiveTitle: { en: `Invented source ${n + 1}`, he: null } }));
const versions = () => parseEditionMetadata(Array.from({ length: 12 }, (_, n) => ({ title: work, versionTitle: `Invented edition ${String(n).padStart(3, "0")}`, language: n === 0 ? "he" : "en", actualLanguage: n === 0 ? "en" : "he", license: n === 2 ? "Unknown rights" : "CC0", versionSource: "https://example.test/" + "inert-provenance-".repeat(18) })), work);
const bodyText = (ref: string, language: string) => captureNamedNode && language === "he"
  ? ("בְּעִיר דִּמְיוֹן קְטַנָּה נִפְתַּח חַלּוֹן כָּחוֹל. הַיְּלָדִים מְצַיְּרִים עָנָן סָגֹל וּמַנִּיחִים לְיַדוֹ כּוֹכָב מִנְּיָר.\n\n" + "לְיַד הַשֻּׁלְחָן עוֹמֵד כִּסֵּא יָרֹק. עַל הַמַּדָּף נָחָה סִירָה קְטַנָּה, וּבַחַלּוֹן נִרְאֶה פֶּרַח דִּמְיוֹנִי.\n\n").repeat(4)
  : `Synthetic commentary (${ref}; ${language}). דָּג e\u0301.\n` + "Invented explanation. ".repeat(60);
// The first verse's Sources are in its verse tools (one Sheet for the selected verse, 1.9 N4); page() leaves that sheet open.
const panel = (tab: Page) => toolsSheet(tab, "Genesis 1:1").locator('.study-verse-detail[data-verse-ref="Genesis 1:1"]').getByRole("region", { name: "Sources for Genesis 1:1", exact: true });
const reader = (tab: Page, n = 0) => panel(tab).getByRole("region", { name: `Read source: ${sourceRef(n)}`, exact: true });
const sourceList = (tab: Page, kind: "Assigned" | "Related" = "Assigned") => panel(tab).getByRole("list", { name: `${kind} sources`, exact: true });
async function api(tab: Page, path: string, body?: unknown) { return tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, value: await response.json() }; }, { path, body }); }
async function page(who: "admin" | "tutor" | "student" = "admin", phone = false, colorScheme: "light" | "dark" = "light", capture = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, ...(capture ? { reducedMotion: "reduce" as const } : {}), serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await observeSilentAudio(context);
  await context.route("**/*", async route => { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); });
  if (cookies[who]) await context.addCookies(cookies[who]!); const tab = await context.newPage(); tab.on("console", message => { if (message.text().includes("Encountered two children with the same key")) duplicateKeys++; });
  await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!cookies[who]) { const email = `pg-${who}@example.test`; expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies[who] = await context.cookies(); }
  await tab.goto(who === "student" ? "/workspace/student?tab=reading" : `/workspace/${who === "admin" ? "admin/students" : "tutor"}/${fixture.student.id}${who === "admin" ? "/reading" : ""}`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator('.study-verses [data-verse-ref="Genesis 1:1"]')).toBeVisible(); await openVerseTools(tab, "Genesis 1:1"); return tab;
}
async function open(tab: Page) { await openVerseTools(tab, "Genesis 1:1"); await panel(tab).getByRole("button", { name: /^Sources( \(\d+\))?$/ }).click(); await ui(sourceList(tab)).toBeVisible(); }
async function browse(tab: Page) { await panel(tab).getByRole("button", { name: "Browse related sources", exact: true }).click(); await ui(sourceList(tab, "Related")).toBeVisible(); }
async function readCitation(tab: Page, n = 0, lane: "Assigned" | "Related" = "Assigned") { await sourceList(tab, lane).getByRole("button", { name: `Read source: ${sourceRef(n)}`, exact: true }).click(); await ui(reader(tab, n).getByRole("list", { name: "Source editions", exact: true })).toBeVisible(); }
async function readEdition(tab: Page, n = 0, language: "en" | "he" = "he") { const row = reader(tab, n).getByRole("listitem").filter({ hasText: `Invented edition ${language === "en" ? "000" : "001"}` }); await row.getByRole("button", { name: `Read ${language === "he" ? "Hebrew" : "English"} edition`, exact: true }).click(); const scalar = reader(tab, n).locator(`[lang="${language}"]`); await ui(scalar).toHaveText(bodyText(sourceRef(n), language)); expect(await scalar.textContent()).toBe(bodyText(sourceRef(n), language)); }
async function quiet(tab: Page) { let sessions = 0; const response = (value: import("playwright").Response) => { if (new URL(value.url()).pathname === "/api/session" && value.status() === 200) sessions++; }; tab.on("response", response); try { await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await ui.poll(() => sessions).toBeGreaterThanOrEqual(4); } finally { tab.off("response", response); } }
async function noAudio(tab: Page) { await expectSilentAudio(tab); }

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request), relatedReader: async ref => { relatedCalls++; return parseRelatedMetadata(rows(ref), ref); }, sourceEditionReader: async () => { editionsCalls++; return versions(); }, sourceContentReader: async selected => { bodyCalls++; const gate = bodyBarrier; if (gate) { gate.entered(); await gate.wait; } return { ref: selected.ref, indexTitle: work, textDepth: 3, sections: selected.ref.slice(work.length + 1).split(":"), toSections: selected.ref.slice(work.length + 1).split(":"), isSpanning: false, warnings: [], versions: [{ versionTitle: selected.editionTitle, language: selected.language, actualLanguage: selected.actualLanguage, languageFamilyName: selected.motherTongue, license: "CC0", versionSource: "https://example.test/" + "inert-provenance-".repeat(18), text: bodyText(selected.ref, selected.actualLanguage) }] }; } });
  siblingId = (await fixture.practice()).sibling.id;
  const learner = await fixture.signIn("pg-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning(); const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning(); await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
  const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  for (const studentId of [fixture.student.id, siblingId]) { const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", setByMembershipId: admin.id, proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning(); if (studentId === fixture.student.id) readingId = assignment.id; await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2].map(n => ({ tenantId: "crc", studentId, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); }
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  // Runtime auth owns a different secret from the base PG fixture. Seed through
  // its real SDK browser cookie and HTTP boundary, never the base fixture cookie.
  const setup = await page("admin"), catalog = parseRelatedMetadata(rows("Genesis 1:1"), "Genesis 1:1");
  const seeded = await api(setup, `/api/students/${fixture.student.id}/source-assignments`, { mode: "admin", kind: "torah", assignmentId: readingId, assignmentRevision: 1, verseRef: "Genesis 1:1", expectedVersion: 0, mutationId: randomUUID(), sourceIds: ["reader_000"], catalogHash: projectRelatedCatalog(catalog, catalog.verse).catalogHash });
  expect(seeded.status).toBe(200); expect(seeded.value).toMatchObject({ ok: true });
  contexts.splice(contexts.indexOf(setup.context()), 1); await setup.context().close();
}, 120000);
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); revision = 0; bodyBarrier = undefined; captureNamedNode = false; });
afterAll(async () => { try { await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); } finally { restore?.(); } expect(duplicateKeys).toBe(0); }, 120000);

it("all actual modes explicitly list/read editions without assignment writes, automatic body, audio or provenance navigation", async () => {
  for (const who of ["admin", "tutor", "student"] as const) {
    const tab = await page(who, who === "student"); let posts = 0; tab.on("request", request => { if (request.method() === "POST" && /source-assignments|practice-calendar/.test(request.url())) posts++; });
    const before = [editionsCalls, bodyCalls]; await open(tab); expect([editionsCalls, bodyCalls]).toEqual(before); await readCitation(tab); expect(editionsCalls).toBe(before[0] + 1); expect(bodyCalls).toBe(before[1]);
    await readEdition(tab); await ui(reader(tab).getByRole("link")).toHaveCount(0); await reader(tab).getByRole("button", { name: "Back to editions", exact: true }).click(); await readEdition(tab, 0, "en"); expect(posts).toBe(0); await noAudio(tab);
    await reader(tab).getByRole("button", { name: "Back to the verse", exact: true }).click(); await ui(reader(tab)).toHaveCount(0);
  }
  const child = await page("tutor"); await closeVerseTools(child); await child.getByRole("link", { name: "Parent", exact: true }).click(); await child.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click(); await ui(child.locator(".study-verses")).toBeVisible(); await open(child); await readCitation(child); await readEdition(child); await closeVerseTools(child); await child.getByRole("button", { name: "Practice with Synthetic", exact: true }).click(); await ui(child.locator(".study-verses")).toBeVisible(); await open(child); await readCitation(child); await readEdition(child); await noAudio(child);
});

it("related readers page explicitly, hold unknown rights, and quiet return retains the exact text DOM without any source-provider GET", async () => {
  const tab = await page("student", true); await open(tab); await browse(tab); await readCitation(tab, 1, "Related");
  await ui(reader(tab, 1).getByRole("listitem").filter({ hasText: "Invented edition 002" }).getByRole("button")).toHaveCount(0);
  await reader(tab, 1).getByRole("button", { name: "Next editions", exact: true }).click(); await ui(reader(tab, 1)).toContainText("Invented edition 011"); await reader(tab, 1).getByRole("button", { name: "Previous editions", exact: true }).click(); await readEdition(tab, 1);
  const element = reader(tab, 1).locator('[lang="he"]'); await element.evaluate(node => { (node as HTMLElement).dataset.retainedReader = "yes"; }); await element.scrollIntoViewIfNeeded(); const scroll = await tab.evaluate(() => window.scrollY), counts = [relatedCalls, editionsCalls, bodyCalls];
  await quiet(tab); expect([relatedCalls, editionsCalls, bodyCalls]).toEqual(counts); await ui(element).toHaveAttribute("data-retained-reader", "yes"); expect(await tab.evaluate(() => window.scrollY)).toBe(scroll); await noAudio(tab);
  revision = 1; await panel(tab).getByRole("button", { name: "Next sources", exact: true }).click(); await ui(panel(tab)).toContainText("related sources changed"); await ui(reader(tab, 1)).toHaveCount(0);
});

it("reading preserves an unsaved staff draft; local source absence keeps it while genuine source head changes invalidate only its reader", async () => {
  const tab = await page(); await open(tab); await browse(tab); const candidate = sourceList(tab, "Related").getByRole("checkbox").nth(3); await candidate.check(); let posts = 0; tab.on("request", request => { if (request.method() === "POST" && request.url().includes("source-assignments")) posts++; });
  await readCitation(tab); await readEdition(tab); await ui(candidate).toBeChecked(); expect(posts).toBe(0);
  await reader(tab).getByRole("button", { name: "Back to editions", exact: true }).click(); await tab.route("**/source-text?**", route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "source-not-found" }) }));
  await reader(tab).getByRole("listitem").filter({ hasText: "Invented edition 001" }).getByRole("button").click(); await ui(reader(tab)).toContainText("no longer in this list"); await ui(candidate).toBeChecked(); await ui(tab.locator(".study-verses")).toBeVisible(); expect(posts).toBe(0); await tab.unroute("**/source-text?**");
  await reader(tab).getByRole("button", { name: "Back to the verse", exact: true }).click(); await readCitation(tab); await readEdition(tab);
  const saved = tab.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname.endsWith("/source-assignments") && value.status() === 200); await panel(tab).getByRole("button", { name: "Save sources", exact: true }).click(); await saved; await ui(reader(tab)).toHaveCount(0); expect(posts).toBe(1);
});

it("read-only content actions cannot alter an uncertain save or its exact retry identity", async () => {
  const tab = await page(); await open(tab); await browse(tab); await sourceList(tab, "Related").getByRole("checkbox").nth(4).check(); const bodies: string[] = [];
  await tab.route("**/source-assignments", async route => { if (route.request().method() !== "POST") return route.continue(); bodies.push(route.request().postData()!); if (bodies.length === 1) await route.abort("failed"); else await route.continue(); });
  await panel(tab).getByRole("button", { name: "Save sources", exact: true }).click(); await ui(panel(tab).getByRole("button", { name: "Check what saved", exact: true })).toBeVisible(); await readCitation(tab); await readEdition(tab); expect(bodies).toHaveLength(1);
  await panel(tab).getByRole("button", { name: "Check what saved", exact: true }).click(); await ui(panel(tab).getByRole("button", { name: "Send the same save again", exact: true })).toBeVisible(); expect(bodies).toHaveLength(1);
  await panel(tab).getByRole("button", { name: "Send the same save again", exact: true }).click(); await ui(panel(tab).getByText("Sources saved.", { exact: true })).toBeVisible(); expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); await ui(reader(tab)).toHaveCount(0);
});

it("actual guardian revocation during a held body clears old child text and cannot publish its late result", async () => {
  const tab = await page("tutor"); await closeVerseTools(tab); await tab.getByRole("link", { name: "Parent", exact: true }).click(); await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click(); await tab.getByRole("button", { name: "Practice with Synthetic", exact: true }).click(); await ui(tab.locator(".study-verses")).toBeVisible(); await open(tab); await readCitation(tab);
  let entered!: () => void, release!: () => void; const entry = new Promise<void>(done => { entered = done; }), wait = new Promise<void>(done => { release = done; }); bodyBarrier = { entered, wait };
  await reader(tab).getByRole("listitem").filter({ hasText: "Invented edition 001" }).getByRole("button").click();
  try { await entry; await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.studentId, fixture.student.id)); } finally { release(); }
  await ui(tab.getByText("Practice access changed. Choose an available child again.", { exact: true })).toBeVisible(); await ui(reader(tab)).toHaveCount(0); await ui(tab.locator(".study-verses")).toHaveCount(0);
});

it("a staged endpoint503 cannot outrank a real original-session expiry detected by the final probe", async () => {
  const tab = await page("student"); await open(tab); await readCitation(tab);
  await tab.route("**/source-text?**", async route => { const proof = await api(tab, "/api/session"); expect(proof.status).toBe(200); const identity = fixture.student.id; const [link] = await fixture.ownerDb.select().from(s.studentIdentity).where(eq(s.studentIdentity.studentId, identity)); const [grant] = await fixture.ownerDb.select().from(s.roleGrant).where(eq(s.roleGrant.id, link.roleGrantId)); const [membership] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.id, grant.membershipId)); await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, membership.userId)); await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unavailable" }) }); });
  await reader(tab).getByRole("listitem").filter({ hasText: "Invented edition 001" }).getByRole("button").click(); await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); await ui(tab.locator(".study-verses")).toHaveCount(0); await ui(reader(tab)).toHaveCount(0);
});

it.runIf(process.env.INLINE_SOURCE_CAPTURE === "1" || process.env.INLINE_SOURCE_RECAPTURE === "1")("captures the approved twelve source-reader states without rerunning the functional pack", async () => {
  const recapture = process.env.INLINE_SOURCE_RECAPTURE === "1";
  const directory = join(process.cwd(), ".impeccable", "review", "source-content"); await mkdir(directory, { recursive: true });
  const freezeBytes = await readFile(join(process.cwd(), ".local-logs", "inline-source-author-freeze.json"));
  const images: unknown[] = [], style = "nextjs-portal { display: none !important; }";
  async function image(tab: Page, name: string, theme: "light" | "dark", state: string, target?: ReturnType<typeof reader>) {
    await tab.evaluate(async () => { await document.fonts.ready; });
    const activeReader = panel(tab).getByRole("region", { name: /^Read source:/ });
    const heading = activeReader.getByRole("heading", { level: 5 }); await heading.evaluate(node => { const h = node as HTMLElement; h.tabIndex = -1; h.focus({ preventScroll: true }); });
    // Element screenshots can extend above the viewport and include the fixed,
    // offscreen Skip link. Top-align and clip in document coordinates instead.
    if (target) await target.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + scrollY)); else await tab.evaluate(() => window.scrollTo(0, 0));
    const facts = await tab.evaluate(() => { const skip = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Skip to workspace"), box = skip?.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, scrollY, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, skipOffscreen: !box || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth }; });
    expect(facts.horizontalOverflow).toBe(false); expect(facts.reducedMotion).toBe(true); expect(facts.skipOffscreen).toBe(true); expect(await heading.evaluate(node => document.activeElement === node)).toBe(true);
    const controls: unknown[] = [];
    for (const label of ["Back to the verse", "Back to editions", "Read Hebrew edition", "Read English edition", "Next editions", "Save sources"]) { const control = panel(tab).getByRole("button", { name: label, exact: true }).first(); if (await control.count() && await control.isVisible()) controls.push({ name: label, rect: await control.boundingBox() }); }
    const rect = target ? await target.boundingBox() : null;
    const clip = rect ? { x: Math.max(0, rect.x), y: rect.y + facts.scrollY, width: rect.width, height: rect.height } : null;
    async function skipOutsideClip() { return tab.evaluate(capture => { const skip = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Skip to workspace"), box = skip?.getBoundingClientRect(); if (!box) return true; const area = capture ?? { x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }; const left = box.left + scrollX, top = box.top + scrollY; return left + box.width <= area.x || left >= area.x + area.width || top + box.height <= area.y || top >= area.y + area.height; }, clip); }
    expect(await skipOutsideClip()).toBe(true);
    const png = clip ? await tab.screenshot({ fullPage: true, clip, animations: "disabled", style }) : await tab.screenshot({ fullPage: true, animations: "disabled", style });
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true); expect(png.length).toBeGreaterThan(1000); expect(png.length).toBeLessThan(16 * 1024 * 1024);
    expect(png.readUInt32BE(16)).toBeGreaterThan(100); expect(png.readUInt32BE(20)).toBeGreaterThan(100); if (!target) { expect(facts.scrollY).toBe(0); expect(png.readUInt32BE(16)).toBe(facts.width); }
    expect(await tab.evaluate(() => { const skip = [...document.querySelectorAll("a")].find(node => node.textContent?.trim() === "Skip to workspace"), box = skip?.getBoundingClientRect(); return !box || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth; })).toBe(true);
    expect(await skipOutsideClip()).toBe(true);
    await writeFile(join(directory, `${name}.png`), png, { flag: recapture ? "w" : "wx" }); images.push({ file: `${name}.png`, theme, state, fullPage: !target, viewport: { width: facts.width, height: facts.height }, pixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, rect, clip, controls, fontsSettled: true, sourceHeadingFocus: true, skipOffscreen: true, skipOutsideCaptureClip: true, horizontalOverflow: false, reducedMotion: true, sha256: createHash("sha256").update(png).digest("hex") }); await noAudio(tab);
  }
  // Capture-only named-node metadata is supplied consistently by the real
  // discovery/content services. No source proof or422 is manufactured.
  captureNamedNode = true;
  expect(bodyText(sourceRef(0), "he")).toMatch(/[\u0590-\u05ff]/); expect(bodyText(sourceRef(0), "he")).not.toMatch(/[A-Za-z]/);
  if (recapture) {
    const originalBytes = await readFile(join(directory, "invalid-first-packet", "manifest.json"));
    const original = JSON.parse(originalBytes.toString("utf8"));
    const names = ["desktop-light-hebrew-detail.png", "desktop-light-dirty-reader-detail.png", "desktop-dark-hebrew-full.png", "phone-dark-hebrew-full.png", "phone-dark-hebrew-detail.png", "phone-light-english-detail.png"];
    for (const entry of original.images) { const bytes = await readFile(join(directory, names.includes(entry.file) ? "invalid-first-packet" : "", entry.file)); expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256); }
    const dl = await page("admin", false, "light", true); await open(dl); await readCitation(dl); await readEdition(dl);
    await image(dl, "desktop-light-hebrew-detail", "light", "assigned-hebrew-long-inert-provenance", reader(dl));
    await browse(dl); await sourceList(dl, "Related").getByRole("checkbox").nth(3).check();
    await image(dl, "desktop-light-dirty-reader-detail", "light", "unsaved-staff-source-draft-and-hebrew-reader", panel(dl));
    const dd = await page("admin", false, "dark", true); await open(dd); await readCitation(dd); await readEdition(dd);
    await image(dd, "desktop-dark-hebrew-full", "dark", "assigned-hebrew");
    const pl = await page("student", true, "light", true); await open(pl); await readCitation(pl); await readEdition(pl, 0, "en");
    await image(pl, "phone-light-english-detail", "light", "assigned-english-long-inert-provenance", reader(pl));
    const pd = await page("student", true, "dark", true); await open(pd); await readCitation(pd); await readEdition(pd);
    await image(pd, "phone-dark-hebrew-full", "dark", "assigned-hebrew");
    await image(pd, "phone-dark-hebrew-detail", "dark", "assigned-hebrew-long-inert-provenance", reader(pd));
    expect(images).toHaveLength(6);
    const replacements = images as { file: string }[]; expect(replacements.map(entry => entry.file).sort()).toEqual([...names].sort());
    const merged = original.images.map((entry: { file: string }) => replacements.find(next => next.file === entry.file) ?? entry);
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ ...original, images: merged, recapture: { reason: "first packet invalid: English-heavy Hebrew fixture and offscreen fixed Skip link included in element clips", originalManifestSha256: createHash("sha256").update(originalBytes).digest("hex"), originals: "invalid-first-packet/", replacedFiles: names, unchangedImages: 6, syntheticHebrewOnly: true, documentClipping: true } }, null, 2) + "\n");
    return;
  }
  const dl = await page("admin", false, "light", true); await open(dl); await readCitation(dl);
  await image(dl, "desktop-light-editions-full", "light", "assigned-editions"); await readEdition(dl);
  await image(dl, "desktop-light-hebrew-detail", "light", "assigned-hebrew-long-inert-provenance", reader(dl));
  await browse(dl); await sourceList(dl, "Related").getByRole("checkbox").nth(3).check();
  await image(dl, "desktop-light-dirty-reader-detail", "light", "unsaved-staff-source-draft-and-hebrew-reader", panel(dl));
  const dd = await page("admin", false, "dark", true); await open(dd); await readCitation(dd); await readEdition(dd);
  await image(dd, "desktop-dark-hebrew-full", "dark", "assigned-hebrew"); await reader(dd).getByRole("button", { name: "Back to editions", exact: true }).click(); await readEdition(dd, 0, "en");
  await image(dd, "desktop-dark-english-detail", "dark", "assigned-english-long-inert-provenance", reader(dd));
  await reader(dd).getByRole("button", { name: "Back to editions", exact: true }).click(); await dd.route("**/source-text?**", route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "source-not-found" }) })); await reader(dd).getByRole("listitem").filter({ hasText: "Invented edition 001" }).getByRole("button").click(); await ui(reader(dd)).toContainText("no longer in this list");
  await image(dd, "desktop-dark-local-missing-detail", "dark", "synthetic-exact-local-source-not-found404", reader(dd)); await dd.unroute("**/source-text?**");
  const pl = await page("student", true, "light", true); await open(pl); await readCitation(pl); await readEdition(pl, 0, "en");
  await image(pl, "phone-light-english-full", "light", "assigned-english"); await image(pl, "phone-light-english-detail", "light", "assigned-english-long-inert-provenance", reader(pl));
  await reader(pl).getByRole("button", { name: "Back to the verse", exact: true }).click(); await browse(pl); await panel(pl).getByRole("button", { name: "Next sources", exact: true }).click(); const unsupported = `${work}, Introduction`;
  await sourceList(pl, "Related").getByRole("button", { name: `Read source: ${unsupported}`, exact: true }).click(); const held = panel(pl).getByRole("region", { name: `Read source: ${unsupported}`, exact: true }); await ui(held.getByRole("list", { name: "Source editions", exact: true })).toBeVisible(); await held.getByRole("listitem").filter({ hasText: "Invented edition 001" }).getByRole("button").click(); await ui(held).toContainText("format isn’t available");
  await image(pl, "phone-light-unsupported-source-detail", "light", "actual-server422-named-node-profile-hold", held);
  const pd = await page("student", true, "dark", true); await open(pd); await readCitation(pd); await readEdition(pd);
  await image(pd, "phone-dark-hebrew-full", "dark", "assigned-hebrew"); await image(pd, "phone-dark-hebrew-detail", "dark", "assigned-hebrew-long-inert-provenance", reader(pd)); await reader(pd).getByRole("button", { name: "Back to editions", exact: true }).click();
  await image(pd, "phone-dark-held-editions-detail", "dark", "editions-with-unknown-rights-row", reader(pd));
  expect(images).toHaveLength(12);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ schema: "source-content-review-packet/v1", sourceFreezeSha256: createHash("sha256").update(freezeBytes).digest("hex"), syntheticOnly: true, sourceHeadingFocus: true, screenshotOnlySuppression: "nextjs-portal development indicator; no product UI suppressed", limits: ["not full language/device/theme Cartesian coverage", "no separate stale409 capture", "local source-not-found image is a labeled synthetic wire fault", "original publicGET2 remains held; this packet is invented source data", "detector reused:0primary/5local-font-size advisories; not rerun"], images }, null, 2) + "\n", { flag: "wx" });
}, 120000);
