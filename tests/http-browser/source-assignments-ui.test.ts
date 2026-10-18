import { beforeAll, beforeEach, afterAll, afterEach, onTestFailed, it, expect, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { parseRelatedMetadata, SourceMetadataUnavailable } from "../../src/server/study/sources/metadata";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let siblingId: string, catalogRevision = 0, relatedFailure = false, relatedCalls = 0, duplicateKeyWarnings = 0, nativeFailed = false;
const contexts: BrowserContext[] = [], cookies: Partial<Record<"admin" | "tutor" | "student", Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};
declare global { interface Window { sourceUiAudioCount: number } }
function rows(ref: string) { return Array.from({ length: 13 }, (_, index) => ({ _id: `source_${String(index).padStart(3, "0")}`, sourceRef: `Invented Commentary ${index + 1}`, index_title: "Invented Complete Commentary", category: catalogRevision ? "Commentary revised" : "Commentary", anchorRef: ref, collectiveTitle: { en: `Invented source ${index + 1}`, he: null } })); }
const detail = (tab: Page, ref = "Genesis 1:1") => tab.locator(`.study-verse-detail[data-verse-ref="${ref}"]`);
const panel = (tab: Page, ref = "Genesis 1:1") => detail(tab, ref).getByRole("region", { name: `Sources for ${ref}`, exact: true });
const assigned = (tab: Page) => panel(tab).getByRole("list", { name: "Assigned sources", exact: true });
async function api(tab: Page, path: string, body?: unknown) { return tab.evaluate(async ({ path, body }) => { const result = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" }); return { status: result.status, data: await result.json() }; }, { path, body }); }
async function page(who: "admin" | "tutor" | "student" = "admin", mobile = false, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.addInitScript(() => { window.sourceUiAudioCount = 0; window.Audio = new Proxy(window.Audio, { construct(target, args) { window.sourceUiAudioCount++; return Reflect.construct(target, args); } }); });
  await context.route("**/*", async route => { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); });
  if (cookies[who]) await context.addCookies(cookies[who]!);
  const tab = await context.newPage(); tab.on("console", message => { if (message.text().includes("Encountered two children with the same key")) duplicateKeyWarnings++; });
  await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!cookies[who]) { const email = `pg-${who}@example.test`; expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies[who] = await context.cookies(); }
  await tab.goto(who === "student" ? "/workspace/student" : `/workspace/${who === "admin" ? "admin/students" : "tutor"}/${fixture.student.id}${who === "admin" ? "/reading" : ""}`, { waitUntil: "domcontentloaded" });
  await ui(tab.locator('.study-verses [data-verse-ref="Genesis 1:1"]')).toBeVisible(); return tab;
}
async function open(tab: Page, ref = "Genesis 1:1") { await panel(tab, ref).getByRole("button", { name: "Sources", exact: true }).click(); await ui(panel(tab, ref).getByRole("button", { name: "Browse related sources", exact: true })).toBeEnabled(); }
async function browse(tab: Page, ref = "Genesis 1:1") { await panel(tab, ref).getByRole("button", { name: "Browse related sources", exact: true }).click(); await ui(panel(tab, ref).getByRole("list", { name: "Related sources", exact: true })).toBeVisible(); }
async function save(tab: Page, ref = "Genesis 1:1") { const response = tab.waitForResponse(value => new URL(value.url()).pathname.endsWith("/source-assignments") && value.request().method() === "POST" && value.status() === 200); await panel(tab, ref).getByRole("button", { name: "Save sources", exact: true }).click(); const value = await response; await ui(panel(tab, ref).getByText("Sources saved.", { exact: true })).toBeVisible(); return value.json(); }
async function quiet(tab: Page) { let sessions = 0; const response = (value: import("playwright").Response) => { if (new URL(value.url()).pathname === "/api/session" && value.status() === 200) sessions++; }; tab.on("response", response); try { await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await ui.poll(() => sessions).toBeGreaterThanOrEqual(4); } finally { tab.off("response", response); } }
async function noAudio(tab: Page) { expect(await tab.evaluate(() => window.sourceUiAudioCount)).toBe(0); }

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request), relatedReader: async ref => { relatedCalls++; if (relatedFailure) throw new SourceMetadataUnavailable(); return parseRelatedMetadata(rows(ref), ref); } });
  siblingId = (await fixture.practice()).sibling.id;
  const learner = await fixture.signIn("pg-student"), [membership] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
  const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: membership.id, role: "student" }).returning(); await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
  const [adminMembership] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  for (const studentId of [fixture.student.id, siblingId]) { const [reading] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: adminMembership.id, proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning(); await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId, assignmentId: reading.id, ordinal, verseRef: `Genesis 1:${ordinal}` }))); }
  const [haftarah] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "haftarah", basis: "custom", ref: "Isaiah 1:1-2", status: "confirmed", setByMembershipId: adminMembership.id, proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning(); await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2].map(ordinal => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: haftarah.id, ordinal, verseRef: `Isaiah 1:${ordinal}` })));
  stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
}, 120_000);

beforeEach(() => { onTestFailed(() => { nativeFailed = true; }); });
afterEach(async () => { for (const value of contexts.splice(0)) await value.close(); relatedFailure = false; catalogRevision = 0; });
afterAll(async () => { try { if (!nativeFailed && duplicateKeyWarnings === 0 && process.env.SOURCE_ASSIGNMENTS_CAPTURE === "1") await capturePacket(); } finally { await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.(); } expect(duplicateKeyWarnings).toBe(0); }, 120_000);

async function capturePacket() {
  const directory = join(process.cwd(), ".impeccable", "review", "source-assignments"); await mkdir(directory, { recursive: true });
  const manifest: { name: string; width: number; height: number; bytes: number; sha256: string }[] = [];
  async function capture(tab: Page, name: string, target?: ReturnType<typeof panel>) {
    await tab.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await noAudio(tab);
    const bytes = target ? await target.screenshot() : await tab.screenshot({ fullPage: true }); expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20); expect(width > 0 && height > 0).toBe(true); await writeFile(join(directory, `${name}.png`), bytes, { flag: "wx" }); manifest.push({ name, width, height, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  for (const theme of ["light", "dark"] as const) {
    const desktop = await page("admin", false, theme); await capture(desktop, `desktop-${theme}-closed`); await open(desktop); await browse(desktop); await panel(desktop).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox").nth(7).check();
    if (theme === "light") { await capture(desktop, "desktop-light-selection"); await capture(desktop, "desktop-light-selection-detail", panel(desktop)); }
    else { await desktop.route("**/source-assignments", route => route.request().method() === "POST" ? route.abort("failed") : route.continue()); await panel(desktop).getByRole("button", { name: "Save sources", exact: true }).click(); await ui(panel(desktop).getByRole("button", { name: "Check save", exact: true })).toBeVisible(); await panel(desktop).getByRole("button", { name: "Sources", exact: true }).click(); const dialog = desktop.getByRole("dialog", { name: "Leave sources?", exact: true }); await ui(dialog).toBeVisible(); await capture(desktop, "desktop-dark-uncertain-departure"); await capture(desktop, "desktop-dark-uncertain-departure-detail", dialog); }
    const phone = await page("student", true, theme); await capture(phone, `phone-${theme}-closed`); await open(phone); await browse(phone); await capture(phone, `phone-${theme}-open`); await capture(phone, `phone-${theme}-open-detail`, panel(phone));
  }
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ schema: "source-assignment-capture/v1", images: manifest }, null, 2) + "\n", { flag: "wx" });
}

it.runIf(process.env.SOURCE_ASSIGNMENTS_RECAPTURE === "1")("recaptures only the three reviewed Sources detail crops with normal task focus", async () => {
  const directory = join(process.cwd(), ".impeccable", "review", "source-assignments"), manifestPath = join(directory, "manifest.json"), originalBytes = await readFile(manifestPath);
  expect(createHash("sha256").update(originalBytes).digest("hex")).toBe("fdd87e51458b3b24ceda3757a020c6e10abd5bec79fbc03bd9b2684af038cf89");
  type Image = { name: string; width: number; height: number; bytes: number; sha256: string };
  const manifest = JSON.parse(originalBytes.toString("utf8")) as { schema: string; images: Image[] }, names = ["desktop-light-selection-detail", "phone-light-open-detail", "phone-dark-open-detail"];
  const originals = join(directory, "invalid-detail-crops"); await mkdir(originals);
  await writeFile(join(originals, "manifest.json"), originalBytes, { flag: "wx" });
  for (const name of names) { const bytes = await readFile(join(directory, `${name}.png`)); expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.images.find(image => image.name === name)?.sha256); await writeFile(join(originals, `${name}.png`), bytes, { flag: "wx" }); }
  const unchanged = manifest.images.filter(image => !names.includes(image.name)).map(image => ({ ...image }));
  const focusFacts: { name: string; focusBeforeWasSkip: boolean; sourcesFocused: boolean; skipOffscreenBefore: boolean; skipOffscreenAfter: boolean; developmentIndicatorSuppressed: true }[] = [];
  async function detailCapture(tab: Page, name: string) {
    const target = panel(tab), sources = target.getByRole("button", { name: "Sources", exact: true });
    const focusBeforeWasSkip = await tab.evaluate(() => document.activeElement?.matches(".skip-link") ?? false);
    await sources.focus(); await ui(sources).toBeFocused(); await target.scrollIntoViewIfNeeded();
    await tab.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
    const skipOffscreen = () => tab.evaluate(() => { const link = document.querySelector<HTMLElement>(".skip-link"); return link !== null && document.activeElement !== link && link.getBoundingClientRect().bottom <= 0; });
    const skipOffscreenBefore = await skipOffscreen(); expect(skipOffscreenBefore).toBe(true); await noAudio(tab);
    // Screenshot-only suppression of a Next development artifact, never product UI.
    const bytes = await target.screenshot({ style: "nextjs-portal { display: none !important; }" });
    const skipOffscreenAfter = await skipOffscreen(); expect(skipOffscreenAfter).toBe(true); await ui(sources).toBeFocused(); expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const image = { name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; expect(image.width > 0 && image.height > 0).toBe(true);
    await writeFile(join(directory, `${name}.png`), bytes); manifest.images = manifest.images.map(value => value.name === name ? image : value);
    focusFacts.push({ name, focusBeforeWasSkip, sourcesFocused: true, skipOffscreenBefore, skipOffscreenAfter, developmentIndicatorSuppressed: true });
  }
  const desktop = await page("admin"); await open(desktop); await browse(desktop); const choices = panel(desktop).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox"); await choices.nth(2).check(); await choices.nth(3).check(); const actual = await save(desktop); expect(actual.committed.citations.map((entry: { id: string }) => entry.id)).toEqual(["source_002", "source_003"]); await choices.nth(7).check();
  await detailCapture(desktop, names[0]);
  for (const theme of ["light", "dark"] as const) { const phone = await page("student", true, theme); await open(phone); await browse(phone); await ui(assigned(phone).getByRole("listitem")).toHaveCount(2); await detailCapture(phone, `phone-${theme}-open-detail`); }
  expect(manifest.images.filter(image => !names.includes(image.name))).toEqual(unchanged);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(process.cwd(), ".local-logs", "source-assignments-detail-recapture.json"), JSON.stringify({ schema: "source-assignment-detail-recapture/v1", replaced: names, untouchedImages: unchanged.length, sourceStateMatches: true, focusFacts, originalManifestSha256: createHash("sha256").update(originalBytes).digest("hex"), manifestSha256: createHash("sha256").update(await readFile(manifestPath)).digest("hex") }, null, 2) + "\n", { flag: "wx" });
});

it("keeps Sources closed and metadata idle until explicit open/browse; readonly student and child can page without mutation or audio", async () => {
  const tab = await page("student", true); let posts = 0, calendars = 0; tab.on("request", request => { const path = new URL(request.url()).pathname; if (path.endsWith("/source-assignments") && request.method() === "POST") posts++; if (path.includes("practice-calendar") && request.method() === "POST") calendars++; });
  const before = relatedCalls; await ui(panel(tab).getByRole("button", { name: "Sources", exact: true })).toHaveAttribute("aria-expanded", "false"); expect(relatedCalls).toBe(before);
  await open(tab); expect(relatedCalls).toBe(before); await browse(tab); expect(relatedCalls).toBe(before + 1);
  await ui(panel(tab).getByRole("list", { name: "Related sources", exact: true }).getByRole("listitem")).toHaveCount(10);
  await panel(tab).getByRole("button", { name: "Next sources", exact: true }).click(); await ui(panel(tab)).toContainText("Invented source 13");
  await ui(panel(tab).getByRole("checkbox")).toHaveCount(0); await ui(panel(tab).getByRole("button", { name: "Save sources", exact: true })).toHaveCount(0); expect(posts).toBe(0); expect(calendars).toBe(0); await noAudio(tab);
  const child = await page("tutor"); await child.getByRole("link", { name: "Parent", exact: true }).click();
  await child.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click(); await child.getByRole("button", { name: "Enter child practice", exact: true }).click();
  await ui(child.locator(".study-verses")).toBeVisible(); await open(child); await browse(child); await ui(panel(child).getByRole("checkbox")).toHaveCount(0); await ui(panel(child).getByRole("button", { name: "Save sources", exact: true })).toHaveCount(0); await noAudio(child);
});

it("assigns a full set, removes one and clears it through actual admin services; assigned tutor can separately save without autosave or source text", async () => {
  const tab = await page("admin"); let writes = 0; tab.on("request", request => { if (new URL(request.url()).pathname.endsWith("/source-assignments") && request.method() === "POST") writes++; });
  await open(tab); await browse(tab); const related = panel(tab).getByRole("list", { name: "Related sources", exact: true }); await related.getByRole("checkbox").nth(0).check(); await related.getByRole("checkbox").nth(1).check(); expect(writes).toBe(0);
  const added = await save(tab); expect(added.committed.citations.map((value: { id: string }) => value.id)).toEqual(["source_000", "source_001"]); await ui(assigned(tab).getByRole("listitem")).toHaveCount(2);
  await assigned(tab).getByRole("checkbox").nth(0).uncheck(); const removed = await save(tab); expect(removed.committed.citations.map((value: { id: string }) => value.id)).toEqual(["source_001"]);
  await assigned(tab).getByRole("checkbox").nth(0).uncheck(); const cleared = await save(tab); expect(cleared.committed.citations).toEqual([]); await ui(assigned(tab)).toHaveCount(0); expect(writes).toBe(3);
  const tutor = await page("tutor"); await open(tutor); await browse(tutor); await panel(tutor).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox").nth(2).check(); const saved = await save(tutor); expect(saved.committed.citations[0].id).toBe("source_002");
  await ui(panel(tutor).getByRole("link", { name: /Read/ })).toHaveCount(0); await noAudio(tab); await noAudio(tutor);
});

it("holds changed catalog proof until explicit review, retains assignments on metadata outage, and removes without provider I/O", async () => {
  const ref = "Genesis 1:2", tab = await page("admin"); await open(tab, ref); await browse(tab, ref); const related = panel(tab, ref).getByRole("list", { name: "Related sources", exact: true });
  await related.getByRole("checkbox").nth(0).check(); await save(tab, ref); await related.getByRole("checkbox").nth(1).check();
  let writes = 0; tab.on("request", request => { if (new URL(request.url()).pathname.endsWith("/source-assignments") && request.method() === "POST") writes++; });
  catalogRevision = 1; await panel(tab, ref).getByRole("button", { name: "Next sources", exact: true }).click(); await ui(panel(tab, ref).getByRole("button", { name: "Review related sources", exact: true })).toBeVisible();
  await panel(tab, ref).getByRole("button", { name: "Save sources", exact: true }).click(); expect(writes).toBe(0);
  await panel(tab, ref).getByRole("button", { name: "Review related sources", exact: true }).click(); await ui(related.getByRole("checkbox").nth(1)).toBeChecked(); await save(tab, ref);
  relatedFailure = true; await panel(tab, ref).getByRole("button", { name: "Browse related sources", exact: true }).click(); await ui(panel(tab, ref).getByText("Related sources couldn’t be loaded. The assigned sources are still available.", { exact: true })).toBeVisible();
  const assignedList = panel(tab, ref).getByRole("list", { name: "Assigned sources", exact: true }); await ui(assignedList.getByRole("listitem")).toHaveCount(2); const before = relatedCalls;
  await assignedList.getByRole("checkbox").nth(0).uncheck(); await assignedList.getByRole("checkbox").nth(1).uncheck(); const cleared = await save(tab, ref); expect(cleared.committed.citations).toEqual([]); expect(relatedCalls).toBe(before); expect(writes).toBe(2); await noAudio(tab);
});

it("keeps a genuinely committed save unknown when the final session probe fails, then reconciles the original separately from a newer head", async () => {
  const ref = "Genesis 1:3", tab = await page("admin"); await open(tab, ref); await browse(tab, ref); await panel(tab, ref).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox").nth(0).check();
  let failFinalProbe = false, captured: Record<string, unknown> | undefined;
  await tab.route("**/api/session", async route => { if (failFinalProbe) { failFinalProbe = false; await route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' }); } else await route.continue(); });
  const committedThenUnverified = async (route: Route) => { if (route.request().method() !== "POST") return route.continue(); captured = route.request().postDataJSON(); const response = await route.fetch(); expect(response.status()).toBe(200); failFinalProbe = true; await route.fulfill({ response }); };
  await tab.route("**/source-assignments", committedThenUnverified); await panel(tab, ref).getByRole("button", { name: "Save sources", exact: true }).click();
  await ui(panel(tab, ref).getByRole("button", { name: "Check save", exact: true })).toBeEnabled(); await ui(panel(tab, ref)).toContainText("Save not confirmed. It may still complete."); expect(captured).toBeDefined();
  const stored = await fixture.ownerDb.select().from(s.verseSourceAssignment).where(and(eq(s.verseSourceAssignment.studentId, fixture.student.id), eq(s.verseSourceAssignment.verseRef, ref))); expect(stored).toHaveLength(1);
  await tab.unroute("**/source-assignments", committedThenUnverified);
  const original = captured!, newer = await api(tab, `/api/students/${fixture.student.id}/source-assignments`, { ...original, expectedVersion: Number(original.expectedVersion) + 1, mutationId: await tab.evaluate(() => crypto.randomUUID()), sourceIds: ["source_000", "source_001"] }); expect(newer.status).toBe(200);
  await panel(tab, ref).getByRole("button", { name: "Check save", exact: true }).click(); await ui(panel(tab, ref).getByRole("button", { name: "Load latest assigned sources", exact: true })).toBeVisible();
  await ui(panel(tab, ref).getByRole("list", { name: "Assigned sources", exact: true })).toHaveCount(0);
  await panel(tab, ref).getByRole("button", { name: "Load latest assigned sources", exact: true }).click(); await ui(panel(tab, ref).getByRole("list", { name: "Assigned sources", exact: true }).getByRole("listitem")).toHaveCount(2); await noAudio(tab);
});

it("keeps a missing receipt unconfirmed and retries only the exact original UUID and full intent after an explicit action", async () => {
  const tab = await page("admin"); await open(tab); await browse(tab); await panel(tab).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox").nth(3).check();
  const sent: unknown[] = []; let drop = true;
  await tab.route("**/source-assignments", async route => { if (route.request().method() !== "POST") return route.continue(); sent.push(route.request().postDataJSON()); if (drop) { drop = false; await route.abort("failed"); } else await route.continue(); });
  await panel(tab).getByRole("button", { name: "Save sources", exact: true }).click(); await ui(panel(tab).getByRole("button", { name: "Check save", exact: true })).toBeEnabled(); expect(sent).toHaveLength(1);
  const checked = tab.waitForResponse(value => new URL(value.url()).pathname.endsWith("/source-assignments/receipt") && value.status() === 200); await panel(tab).getByRole("button", { name: "Check save", exact: true }).click(); expect((await (await checked).json()).outcome).toBe("unconfirmed");
  await ui(panel(tab).getByRole("button", { name: "Retry same save", exact: true })).toBeEnabled(); expect(sent).toHaveLength(1);
  await panel(tab).getByRole("button", { name: "Retry same save", exact: true }).click(); await ui(panel(tab).getByText("Sources saved.", { exact: true })).toBeVisible(); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); await noAudio(tab);
});

it("retains a dirty draft on quiet return and Keep working; explicit discard reloads, while delivered authority loss cancels an old departure review", async () => {
  const ref = "Genesis 1:2", tab = await page("admin"); await open(tab, ref); await browse(tab, ref); const choice = panel(tab, ref).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox").nth(4); await choice.check();
  let posts = 0, texts = 0; tab.on("request", request => { const path = new URL(request.url()).pathname; if (path.endsWith("/source-assignments") && request.method() === "POST") posts++; if (path.endsWith("/study-text")) texts++; }); const before = relatedCalls;
  await quiet(tab); await ui(choice).toBeChecked(); expect(posts).toBe(0); expect(texts).toBe(0); expect(relatedCalls).toBe(before);
  const refresh = tab.getByRole("button", { name: "Refresh reading", exact: true }), dialog = tab.getByRole("dialog", { name: "Leave sources?", exact: true });
  await refresh.click(); await ui(dialog).toBeVisible(); await dialog.getByRole("button", { name: "Keep working", exact: true }).click(); await ui(choice).toBeChecked(); expect(texts).toBe(0); expect(posts).toBe(0);
  await refresh.click(); await ui(dialog).toBeVisible(); const loaded = tab.waitForResponse(value => new URL(value.url()).pathname.endsWith("/study-text") && value.status() === 200); await dialog.getByRole("button", { name: "Discard changes", exact: true }).click(); await loaded;
  await ui(panel(tab, ref).getByRole("button", { name: "Sources", exact: true })).toHaveAttribute("aria-expanded", "false"); expect(posts).toBe(0);
  await open(tab, ref); await browse(tab, ref); await panel(tab, ref).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox").nth(5).check();
  await tab.getByRole("button", { name: "Haftarah text", exact: true }).click(); await ui(dialog).toBeVisible();
  const denied = tab.waitForResponse(value => new URL(value.url()).pathname === "/api/session" && value.status() === 401); await tab.context().clearCookies(); await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await denied;
  await ui(dialog).toHaveCount(0); await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); await ui(tab.locator(".study-verses")).toHaveCount(0); await ui(panel(tab, ref)).toHaveCount(0); expect(posts).toBe(0); await noAudio(tab);
});

it("offers an honest unknown-save departure without automatic retry, then clears source scope on sibling switch and actual session expiry", async () => {
  const tab = await page("tutor"); await open(tab); await browse(tab); await panel(tab).getByRole("list", { name: "Related sources", exact: true }).getByRole("checkbox").nth(4).check();
  const before = await fixture.ownerDb.select().from(s.verseSourceAssignment).where(and(eq(s.verseSourceAssignment.studentId, fixture.student.id), eq(s.verseSourceAssignment.verseRef, "Genesis 1:1"))); let posts = 0;
  await tab.route("**/source-assignments", async route => { if (route.request().method() === "POST") { posts++; await route.abort("failed"); } else await route.continue(); });
  await panel(tab).getByRole("button", { name: "Save sources", exact: true }).click(); await ui(panel(tab).getByRole("button", { name: "Check save", exact: true })).toBeVisible();
  const disclosure = panel(tab).getByRole("button", { name: "Sources", exact: true }), dialog = tab.getByRole("dialog", { name: "Leave sources?", exact: true });
  await disclosure.click(); await ui(dialog).toContainText("It may still complete if you leave"); await dialog.getByRole("button", { name: "Keep working", exact: true }).click(); await ui(panel(tab).getByRole("button", { name: "Check save", exact: true })).toBeVisible(); expect(posts).toBe(1);
  await disclosure.click(); await dialog.getByRole("button", { name: "Leave without confirming", exact: true }).click(); await ui(disclosure).toHaveAttribute("aria-expanded", "false"); expect(posts).toBe(1);
  const after = await fixture.ownerDb.select().from(s.verseSourceAssignment).where(and(eq(s.verseSourceAssignment.studentId, fixture.student.id), eq(s.verseSourceAssignment.verseRef, "Genesis 1:1"))); expect(after.length).toBe(before.length);
  await tab.getByRole("link", { name: "Parent", exact: true }).click(); await tab.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click(); await tab.getByRole("button", { name: "Enter child practice", exact: true }).click(); await ui(tab.locator(".study-verses")).toBeVisible(); await open(tab); await browse(tab);
  await tab.getByRole("button", { name: "Switch practice to Synthetic Sibling", exact: true }).click(); await ui(tab.getByRole("heading", { name: "Synthetic Sibling", exact: true })).toBeVisible(); await ui(panel(tab).getByRole("button", { name: "Sources", exact: true })).toHaveAttribute("aria-expanded", "false");
  await open(tab); await ui(assigned(tab)).toHaveCount(0); await browse(tab);
  await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, fixture.tutor.id)); const expired = tab.waitForResponse(value => new URL(value.url()).pathname === "/api/session" && value.status() === 401); await tab.evaluate(() => window.dispatchEvent(new Event("focus"))); await expired;
  await ui(tab.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible(); await ui(tab.locator(".study-verses")).toHaveCount(0); await ui(panel(tab)).toHaveCount(0); await noAudio(tab);
});
