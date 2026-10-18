import { afterAll, afterEach, beforeAll, beforeEach, expect, it, onTestFailed, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, isolated: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let failed = false;
const contexts: BrowserContext[] = [], children: { id: string; name: string; assignmentId: string }[] = [];
const cookies: Partial<Record<"parent" | "admin" | "student", Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};
const sheet = (page: Page) => page.getByRole("dialog", { name: "Family honors", exact: true });
const group = (page: Page, name: string) => sheet(page).getByRole("region", { name, exact: true });
async function api(page: Page, path: string, body?: unknown) { return page.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }, { path, body }); }
async function page(who: "parent" | "admin" | "student", mobile = false, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", route => new URL(route.request().url()).origin === BROWSER_ORIGIN ? route.continue() : route.abort());
  if (cookies[who]) await context.addCookies(cookies[who]!); const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!cookies[who]) { const email = who === "parent" ? "pg-tutor@example.test" : `pg-${who}@example.test`; expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies[who] = await context.cookies(); }
  return tab;
}
async function open(tab: Page, child: typeof children[number], who: "parent" | "admin") {
  await tab.goto(who === "parent" ? "/workspace/parent" : "/workspace/admin/students", { waitUntil: "domcontentloaded" });
  if (who === "parent") { await tab.locator(`button.student-card[data-student-id="${child.id}"]`).click(); await tab.getByRole("button", { name: "Family honors", exact: true }).click(); }
  else await tab.getByRole("button", { name: `Honors for ${child.name}`, exact: true }).click();
  await ui(sheet(tab).getByRole("heading", { name: "Opening the ark", exact: true })).toBeVisible();
}
async function add(tab: Page, title: string, name: string) { const section = group(tab, title); await section.getByRole("button", { name: `Add person to ${title}`, exact: true }).click(); await section.getByLabel("English name", { exact: true }).last().fill(name); }
async function observe(tab: Page, id: string, receipt: boolean, action: () => Promise<void>) {
  const matches = (url: URL) => url.origin === BROWSER_ORIGIN && url.pathname === `/api/students/${id}/honors${receipt ? "/receipt" : ""}`;
  let resolve!: (value: Record<string, any>) => void, reject!: (error: unknown) => void;
  const captured = new Promise<Record<string, any>>((yes, no) => { resolve = yes; reject = no; });
  const handler = async (route: Route) => { if (route.request().method() !== "POST") return route.fallback();
    try { const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 }); let parsed: { value: Record<string, any> } | { error: unknown };
      try { expect(response.status()).toBe(200); parsed = { value: await response.json() }; } catch (error) { parsed = { error }; }
      await route.fulfill({ response }); if ("error" in parsed) reject(parsed.error); else resolve(parsed.value);
    } catch (error) { try { await route.abort("failed"); } catch {} reject(error); }
  };
  await tab.route(matches, handler); try { const [value] = await Promise.all([captured, action()]); return value; } finally { await tab.unroute(matches, handler); }
}
async function save(tab: Page, id: string) { const result = await observe(tab, id, false, () => sheet(tab).getByRole("button", { name: "Save honors", exact: true }).click()); await ui(sheet(tab).getByRole("status").filter({ hasText: "Honors saved." })).toBeVisible(); return result; }
async function focus(tab: Page) {
  // Parent: provider2 + reading2 + honors2 proofs; admin roster: provider2 + honors2.
  // The provider's final proof starts only after every registered scope settles.
  const expected = new URL(tab.url()).pathname === "/workspace/admin/students" ? 4 : 6;
  await tab.evaluate(expected => {
    const browser = window as Window & { honorsQuietWitness?: { complete: boolean; failed: boolean; dispose(): void } }, original = window.fetch, channel = new MessageChannel(); let eof = 0;
    const witness = { complete: false, failed: false, dispose() { if (window.fetch === wrapped) window.fetch = original; channel.port1.close(); channel.port2.close(); if (browser.honorsQuietWitness === witness) delete browser.honorsQuietWitness; } };
    channel.port1.onmessage = () => { witness.complete = true; };
    const wrapped: typeof window.fetch = async (...args) => {
      const response = await original(...args), input = args[0], url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin !== location.origin || url.pathname !== "/api/session") return response;
      if (response.status !== 200) witness.failed = true;
      const body = response.body;
      if (body) { const getReader = body.getReader;
        Object.defineProperty(body, "getReader", { configurable: true, value: (...readerArgs: unknown[]) => {
          const reader = Reflect.apply(getReader, body, readerArgs), read = reader.read; let ended = false;
          reader.read = (...readArgs: unknown[]) => (Reflect.apply(read, reader, readArgs) as Promise<{ done: boolean }>).then(part => {
            // Observe only the parser's actual EOF. Forward the original result,
            // bytes, rejection, cancellation and release semantics unchanged.
            if (part.done && !ended) { ended = true; if (++eof === expected) channel.port2.postMessage(null); } return part;
          }, (error: unknown) => { witness.failed = true; throw error; });
          return reader;
        } });
      }
      return response;
    };
    browser.honorsQuietWitness = witness; window.fetch = wrapped; window.dispatchEvent(new Event("focus"));
  }, expected);
  try { await ui.poll(() => tab.evaluate(() => { const witness = (window as Window & { honorsQuietWitness?: { complete: boolean; failed: boolean } }).honorsQuietWitness; return { complete: witness?.complete ?? false, failed: witness?.failed ?? false }; })).toEqual({ complete: true, failed: false }); }
  finally { await tab.evaluate(() => (window as Window & { honorsQuietWitness?: { dispose(): void } }).honorsQuietWitness?.dispose()); }
}
async function rows(id: string) { return fixture.ownerDb.select().from(s.honorsVersion).where(eq(s.honorsVersion.studentId, id)); }
async function audits(id: string) { return fixture.ownerDb.select().from(s.auditEvent).where(and(eq(s.auditEvent.actingStudentId, id), eq(s.auditEvent.action, "honors.set"))); }
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture();
    const [guardian] = await fixture.ownerDb.select().from(s.guardian).where(eq(s.guardian.studentId, fixture.student.id)), [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const suffix of ["Flexible", "Review", "Receipt", "Print"]) {
      const [child] = await fixture.ownerDb.insert(s.student).values({ tenantId: "crc", firstName: "Synthetic", lastName: `Honors ${suffix}`, ceremonyDate: "2027-01-02", parentEmail: "synthetic@example.test", serviceSlot: "morning" }).returning();
      await fixture.ownerDb.insert(s.guardian).values({ tenantId: "crc", studentId: child.id, parentGrantId: guardian.parentGrantId, linkProvenance: "synthetic-honors-ui" });
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: child.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", aliyahStarts: ["Genesis 1:2"], setByMembershipId: admin.id, proposalSnapshot: { confirmationDate: "2027-01-02", serviceSlot: "morning", slotProvenance: 1, needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId: child.id, assignmentId: assignment.id, ordinal, verseRef: `Genesis 1:${ordinal}` }))); children.push({ id: child.id, name: `${child.firstName} ${child.lastName}`, assignmentId: assignment.id });
    }
    const learner = await fixture.signIn("pg-student"), [membership] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning(), [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: membership.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    await fixture.ownerDb.update(s.student).set({ studentKind: "adult", ownEmail: "synthetic-student@example.test" }).where(eq(s.student.id, fixture.student.id));
    stop = await startBrowserServer(fixture.withRuntime); isolated = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolated.env });
  } catch { await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.(); await isolated?.cleanup(); throw Error("Synthetic honors UI setup failed; private details withheld"); }
}, 120000);
beforeEach(() => { onTestFailed(() => { failed = true; }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(c => c.close())); });
afterAll(async () => { try { if (!failed && process.env.HONORS_UI_CAPTURE === "1") await capturePacket(); } finally { await Promise.all(contexts.map(c => c.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.(); await isolated?.cleanup(); } }, 120000);

it("base guardian saves flexible ordered groups, actual aliyot, Hebrew names and blessing logistics exactly once", async () => {
  const tab = await page("parent"), child = children[0]; await open(tab, child, "parent");
  for (const name of ["Synthetic One", "Synthetic Two", "Synthetic Three"]) await add(tab, "Opening the ark", name);
  await sheet(tab).getByRole("button", { name: "Close family honors", exact: true }).click(); await ui(sheet(tab).getByRole("heading", { name: "Leave your unsaved changes?", exact: true })).toBeVisible(); await sheet(tab).getByRole("button", { name: "Keep editing", exact: true }).click(); await ui(group(tab, "Opening the ark").getByLabel("English name", { exact: true }).last()).toHaveValue("Synthetic Three");
  await group(tab, "Opening the ark").getByRole("button", { name: "Move person 3 up in Opening the ark", exact: true }).click();
  await add(tab, "Generation to generation", "Synthetic Generation"); await group(tab, "Generation to generation").getByLabel("Relationship (optional)", { exact: true }).fill("Grandparent");
  const title = "Aliyah 2 · Genesis 1:2 – Genesis 1:3"; await add(tab, title, "Synthetic Aliyah One"); await add(tab, title, "Synthetic Aliyah Two"); const aliyah = group(tab, title);
  await aliyah.getByLabel("Hebrew name (if known)", { exact: true }).first().fill("שֵׁם"); await aliyah.getByText("Parents’ Hebrew names & relationship", { exact: true }).first().click(); await aliyah.getByLabel("First parent’s Hebrew name (if known)", { exact: true }).first().fill("שֵׁם הוֹרֶה");
  await sheet(tab).getByRole("radio", { name: "Yes", exact: true }).check(); await sheet(tab).getByRole("radio", { name: "Separately", exact: true }).check();
  const saved = await save(tab, child.id); expect(saved.committed.form.openingArk.map((p: { englishName: string }) => p.englishName)).toEqual(["Synthetic One", "Synthetic Three", "Synthetic Two"]); expect(saved.committed.form.aliyot).toHaveLength(1); expect(saved.committed.form.aliyot[0]).toMatchObject({ startVerse: "Genesis 1:2", participants: [{ englishName: "Synthetic Aliyah One", hebrewName: "שֵׁם", parent1HebrewName: "שֵׁם הוֹרֶה", parent2HebrewName: null }, { englishName: "Synthetic Aliyah Two", hebrewName: null }] }); expect(saved.committed.form.parentalBlessing).toEqual({ participation: "yes", delivery: "separately" });
  expect(await rows(child.id)).toHaveLength(1); expect(await audits(child.id)).toHaveLength(1); expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
it("quiet return preserves a dirty field/focus/scroll; date-only review and changed actual-span mapping remain explicit", async () => {
  const tab = await page("parent", true), child = children[1]; await open(tab, child, "parent"); const title = "Aliyah 2 · Genesis 1:2 – Genesis 1:3"; await add(tab, title, "Synthetic Kept Group"); await save(tab, child.id);
  const name = group(tab, title).getByLabel("English name", { exact: true }); await name.fill("Synthetic Unsaved Group"); await name.focus(); const scroll = await sheet(tab).evaluate(node => node.scrollTop); await focus(tab); await ui(name).toHaveValue("Synthetic Unsaved Group"); await ui(name).toBeFocused(); expect(await sheet(tab).evaluate(node => node.scrollTop)).toBe(scroll);
  await fixture.ownerDb.update(s.student).set({ ceremonyDate: "2027-02-06" }).where(eq(s.student.id, child.id)); await focus(tab); await ui(sheet(tab).getByRole("region", { name: "Review changed ceremony", exact: true })).toBeVisible(); await ui(sheet(tab).getByRole("button", { name: "Save honors", exact: true })).toBeDisabled();
  expect(await sheet(tab).getByRole("combobox").count()).toBe(0); await sheet(tab).getByRole("button", { name: "I reviewed the current ceremony", exact: true }).click(); await ui(name).toHaveValue("Synthetic Unsaved Group"); await save(tab, child.id);
  await fixture.ownerDb.update(s.assignment).set({ aliyahStarts: ["Genesis 1:3"], revision: 2 }).where(eq(s.assignment.id, child.assignmentId)); await focus(tab); const choice = sheet(tab).getByRole("combobox", { name: "Current span for Genesis 1:2", exact: true }); await ui(choice).toBeVisible(); await ui(group(tab, title).getByLabel("English name", { exact: true })).toHaveValue("Synthetic Unsaved Group");
  await sheet(tab).getByRole("button", { name: "I reviewed the current ceremony", exact: true }).click(); await ui(choice).toBeVisible(); await choice.selectOption("Genesis 1:3"); await sheet(tab).getByRole("button", { name: "I reviewed the current ceremony", exact: true }).click();
  await ui(group(tab, "Aliyah 2 · Genesis 1:3").getByLabel("English name", { exact: true })).toHaveValue("Synthetic Unsaved Group"); const saved = await save(tab, child.id); expect(saved.committed.form.aliyot[0].startVerse).toBe("Genesis 1:3"); expect(await rows(child.id)).toHaveLength(3); expect(await audits(child.id)).toHaveLength(3);
});
it("lost committed response and unconfirmed receipt keep exact original UUID/body without duplicate delivery", async () => {
  const tab = await page("parent"), child = children[2]; await open(tab, child, "parent"); await add(tab, "Opening the ark", "Synthetic Receipt"); const path = `/api/students/${child.id}/honors`, bodies: string[] = [];
  const lost = async (route: Route) => { if (route.request().method() !== "POST") return route.fallback(); bodies.push(route.request().postData()!); const result = await route.fetch({ maxRedirects: 0, maxRetries: 0 }); expect(result.status()).toBe(200); await result.body(); await route.abort("failed"); };
  const exact = (url: URL) => url.origin === BROWSER_ORIGIN && url.pathname === path;
  await tab.route(exact, lost); await sheet(tab).getByRole("button", { name: "Save honors", exact: true }).click(); await ui(sheet(tab).getByRole("button", { name: "Check save", exact: true })).toBeVisible(); await tab.unroute(exact, lost);
  await sheet(tab).getByRole("button", { name: "Close family honors", exact: true }).click(); await ui(sheet(tab).getByRole("heading", { name: "Leave with the save unconfirmed?", exact: true })).toBeVisible();
  const check = sheet(tab).getByRole("button", { name: "Check save", exact: true }), retryButton = sheet(tab).getByRole("button", { name: "Retry same save", exact: true });
  await ui(check).toBeDisabled(); await ui(retryButton).toBeDisabled();
  let promptPosts = 0; const promptRequest = (request: import("playwright").Request) => { if (request.method() === "POST" && [path, path + "/receipt"].includes(new URL(request.url()).pathname)) promptPosts++; }; tab.on("request", promptRequest);
  await check.evaluate(button => (button as HTMLButtonElement).click()); await retryButton.evaluate(button => (button as HTMLButtonElement).click()); expect(promptPosts).toBe(0); tab.off("request", promptRequest);
  await ui(sheet(tab).getByRole("heading", { name: "Leave with the save unconfirmed?", exact: true })).toBeVisible(); await sheet(tab).getByRole("button", { name: "Keep editing", exact: true }).click();
  let receiptBody = ""; const record = (request: import("playwright").Request) => { if (new URL(request.url()).pathname === path + "/receipt") receiptBody = request.postData()!; }; tab.on("request", record);
  const recovered = await observe(tab, child.id, true, () => sheet(tab).getByRole("button", { name: "Check save", exact: true }).click()); tab.off("request", record); expect(recovered.committedVersion).toBe(1); expect(receiptBody).toBe(bodies[0]); await ui(sheet(tab).getByRole("status").filter({ hasText: "Honors saved." })).toBeVisible(); expect(await rows(child.id)).toHaveLength(1);
  await group(tab, "Opening the ark").getByLabel("English name", { exact: true }).fill("Synthetic Exact Retry");
  const matches = (url: URL) => url.pathname === path, before = async (route: Route) => { if (route.request().method() !== "POST") return route.fallback(); bodies.push(route.request().postData()!); await route.abort("failed"); };
  await tab.route(matches, before); await sheet(tab).getByRole("button", { name: "Save honors", exact: true }).click(); await ui(sheet(tab).getByRole("button", { name: "Check save", exact: true })).toBeVisible(); await tab.unroute(matches, before);
  expect((await observe(tab, child.id, true, () => sheet(tab).getByRole("button", { name: "Check save", exact: true }).click())).outcome).toBe("unconfirmed");
  let retry = "", retryBegan = false, release!: () => void, delivered!: () => void, rejectDelivery!: (error: unknown) => void;
  const held = new Promise<void>(resolve => { release = resolve; }), completed = new Promise<void>((resolve, reject) => { delivered = resolve; rejectDelivery = reject; });
  const holdRetry = async (route: Route) => { if (route.request().method() !== "POST") return route.fallback(); retryBegan = true; retry = route.request().postData()!;
    try { await held; const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 }); expect(response.status()).toBe(200); const value = await response.json(); expect(value.committedVersion).toBe(2); await route.fulfill({ response }); delivered(); }
    catch (error) { try { await route.abort("failed"); } catch {} rejectDelivery(error); }
  };
  await tab.route(exact, holdRetry);
  try {
    await retryButton.click(); await ui.poll(() => retry).toBe(bodies[1]);
    await ui(sheet(tab).getByRole("status").filter({ hasText: "Saving honors…" })).toBeVisible(); await ui(sheet(tab).getByRole("button", { name: "Close family honors", exact: true })).toBeDisabled(); await ui(group(tab, "Opening the ark").getByLabel("English name", { exact: true })).toBeDisabled();
    await sheet(tab).press("Escape"); await sheet(tab).evaluate(node => (node as HTMLDialogElement).close()); await ui(sheet(tab)).toBeVisible(); await ui(sheet(tab).getByRole("button", { name: "Leave without confirmation", exact: true })).toHaveCount(0); await ui(sheet(tab).getByRole("status").filter({ hasText: "Saving honors…" })).toBeVisible();
  } finally { release(); try { if (retryBegan) await completed; } finally { await tab.unroute(exact, holdRetry); } }
  await ui(sheet(tab).getByRole("status").filter({ hasText: "Honors saved." })).toBeVisible(); expect(retry).toBe(bodies[1]); expect(JSON.parse(bodies[0]).mutationId).not.toBe(JSON.parse(bodies[1]).mutationId); expect(await rows(child.id)).toHaveLength(2); expect(await audits(child.id)).toHaveLength(2);
});
it("admin printing verifies only the saved copy; real guardian denial clears private fields", async () => {
  const child = children[3], tab = await page("admin"); await open(tab, child, "admin"); await add(tab, "Opening the ark", "Synthetic Saved Print"); await save(tab, child.id); await group(tab, "Opening the ark").getByLabel("English name", { exact: true }).fill("Synthetic Unsaved Never Print");
  await tab.evaluate(() => { const append = Element.prototype.append; Element.prototype.append = function (...nodes: (Node | string)[]) { append.apply(this, nodes); for (const node of nodes) if (node instanceof HTMLIFrameElement && node.title === "Saved family honors print copy") node.contentWindow!.print = () => { (window as unknown as { honorsPrinted: string }).honorsPrinted = node.contentDocument!.body.textContent ?? ""; }; }; });
  await sheet(tab).getByRole("button", { name: "Print saved form", exact: true }).click(); await ui.poll(() => tab.evaluate(() => (window as unknown as { honorsPrinted?: string }).honorsPrinted ?? "")).toContain("Synthetic Saved Print"); expect(await tab.evaluate(() => (window as unknown as { honorsPrinted: string }).honorsPrinted)).not.toContain("Synthetic Unsaved Never Print");
  const parent = await page("parent"); await open(parent, child, "parent"); await ui(group(parent, "Opening the ark").getByLabel("English name", { exact: true })).toHaveValue("Synthetic Saved Print"); await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.studentId, child.id));
  await parent.evaluate(() => window.dispatchEvent(new Event("focus"))); await ui(parent.locator('input[value="Synthetic Saved Print"]')).toHaveCount(0); expect(await rows(child.id)).toHaveLength(1);
});
it("adult student and child-practice views expose no honors controls or family form", async () => {
  const student = await page("student"); await student.goto("/workspace/student", { waitUntil: "domcontentloaded" }); await ui(student.locator(".role-workspace")).toBeVisible(); await ui(student.getByRole("button", { name: "Family honors", exact: true })).toHaveCount(0); expect((await api(student, `/api/students/${fixture.student.id}/honors?mode=student`)).status).toBe(403);
  const parent = await page("parent"), entered = await api(parent, "/api/practice/enter", { studentId: children[0].id }); expect(entered.status).toBe(201); const denied = await parent.evaluate(async ({ id, handle }) => { const r = await fetch(`/api/students/${id}/honors?mode=parent`, { headers: { "X-Practice-Context": handle }, cache: "no-store" }); return r.status; }, { id: children[0].id, handle: entered.data.handle }); expect(denied).toBe(403);
  await parent.goto("/workspace/parent", { waitUntil: "domcontentloaded" }); await parent.locator(`button.student-card[data-student-id="${children[0].id}"]`).click(); await parent.getByRole("button", { name: "Enter child practice", exact: true }).click(); await ui(parent.getByRole("button", { name: "Return to parent view", exact: true })).toBeVisible(); await ui(parent.getByRole("button", { name: "Family honors", exact: true })).toHaveCount(0);
  await parent.goto("/workspace/tutor", { waitUntil: "domcontentloaded" }); await ui(parent.locator(".role-workspace")).toBeVisible(); await ui(parent.getByRole("button", { name: "Family honors", exact: true })).toHaveCount(0);
});

async function capturePacket() {
  const directory = join(process.cwd(), ".impeccable", "review", "family-honors"); await mkdir(directory, { recursive: true }); const images: { name: string; width: number; height: number; sha256: string }[] = [];
  for (const mobile of [false, true]) for (const theme of ["light", "dark"] as const) {
    await fixture.ownerDb.update(s.student).set({ ceremonyDate: "2027-01-02" }).where(eq(s.student.id, children[0].id));
    const tab = await page("admin", mobile, theme); await open(tab, children[0], "admin");
    if (theme === "dark") { await fixture.ownerDb.update(s.student).set({ ceremonyDate: "2027-03-06" }).where(eq(s.student.id, children[0].id)); await focus(tab); await ui(sheet(tab).getByRole("region", { name: "Review changed ceremony", exact: true })).toBeVisible(); }
    if (mobile && theme === "light") await group(tab, "Aliyah 2 · Genesis 1:2 – Genesis 1:3").getByLabel("Hebrew name (if known)", { exact: true }).first().focus(); else await sheet(tab).getByRole("heading", { name: "Family honors", exact: true }).focus();
    await tab.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const name = `${mobile ? "phone" : "desktop"}-${theme}`, bytes = await tab.screenshot({ style: "nextjs-portal { display:none !important; }" }); await writeFile(join(directory, `${name}.png`), bytes, { flag: "wx" }); images.push({ name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash("sha256").update(bytes).digest("hex") });
    await tab.context().close();
  }
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ schema: "family-honors-capture/v1", synthetic: true, images }, null, 2) + "\n", { flag: "wx" });
}
