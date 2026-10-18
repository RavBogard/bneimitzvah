import { afterAll, afterEach, beforeAll, beforeEach, expect, it, onTestFailed, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { and, eq, like } from "drizzle-orm";
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

// Deliberately invalid credential: canonical grammar only, never server-signed.
// No successful real management mutation is delivered in this file.
const fakeId = "A".repeat(22), fakeURL = `${BROWSER_ORIGIN}/honoree#token=hl1.k1.${fakeId}.${"A".repeat(43)}.${"A".repeat(43)}`;
const title = "Aliyah 2 · Genesis 1:2 – Genesis 1:3", startVerse = "Genesis 1:2";
type Child = { id: string; name: string; assignmentId: string };
type ClipboardProbe = { writes: number; hold: boolean; acceptedFakeOnly: boolean; release?: () => void };
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, isolated: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let failed = false;
const contexts: BrowserContext[] = [], children: Child[] = [];
const cookies: Partial<Record<"parent" | "admin", Awaited<ReturnType<BrowserContext["cookies"]>>>> = {};
const sheet = (tab: Page) => tab.getByRole("dialog", { name: "Family honors", exact: true });
const group = (tab: Page) => sheet(tab).getByRole("region", { name: title, exact: true });
const button = (tab: Page, name: string) => group(tab).getByRole("button", { name, exact: true });
const matches = (child: Child, suffix = "") => (url: URL) => url.origin === BROWSER_ORIGIN && url.pathname === `/api/students/${child.id}/honoree-links${suffix}` && !url.search;
const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }, body: JSON.stringify(value) });
const record = { id: fakeId, startVerse, issuedAt: "2026-10-18T12:00:00.000Z", expiresAt: "2027-01-01T12:00:00.000Z" };
const committed = (operation: "issue" | "reissue" | "revoke", secret = false) => ({ ok: true, outcome: "committed", replayed: !secret && operation !== "revoke", operation, linkId: fakeId, startVerse, ...(secret ? { url: fakeURL, expiresAt: record.expiresAt } : {}) });

async function page(who: "parent" | "admin", mobile = false, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", route => new URL(route.request().url()).origin === BROWSER_ORIGIN ? route.continue() : route.abort());
  // Test-only clipboard, installed before app code. Never invokes system clipboard,
  // keeps no URL/body, and rejects anything other than the known invalid fake.
  await context.addInitScript(expected => {
    const probe: ClipboardProbe = { writes: 0, hold: false, acceptedFakeOnly: true };
    (window as Window & { honoreeClipboard?: ClipboardProbe }).honoreeClipboard = probe;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(value: string) {
      probe.writes++; if (value !== expected) { probe.acceptedFakeOnly = false; throw Error("Unexpected clipboard value withheld"); }
      if (probe.hold) await new Promise<void>(resolve => { probe.release = resolve; });
    } } });
  }, fakeURL);
  if (cookies[who]) await context.addCookies(cookies[who]!);
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!cookies[who]) {
    const email = who === "parent" ? "pg-tutor@example.test" : "pg-admin@example.test";
    expect(await tab.evaluate(async email => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })).status, email)).toBe(200);
    await openAuthMail(tab, fixture.takeMail(email)); cookies[who] = await context.cookies();
  }
  return tab;
}
async function open(tab: Page, child: Child, who: "parent" | "admin") {
  await tab.goto(who === "parent" ? "/workspace/parent" : "/workspace/admin/students", { waitUntil: "domcontentloaded" });
  if (who === "parent") { await tab.locator(`button.student-card[data-student-id="${child.id}"]`).click(); await tab.getByRole("button", { name: "Family honors", exact: true }).click(); }
  else await tab.getByRole("button", { name: `Honors for ${child.name}`, exact: true }).click();
  await ui(group(tab)).toBeVisible();
}
async function add(tab: Page, name: string) {
  await group(tab).getByRole("button", { name: `Add person to ${title}`, exact: true }).click();
  await group(tab).getByLabel("English name", { exact: true }).last().fill(name);
}
async function save(tab: Page, child: Child) {
  const predicate = (url: URL) => url.origin === BROWSER_ORIGIN && url.pathname === `/api/students/${child.id}/honors` && !url.search;
  let resolve!: (body: string) => void, reject!: (error: unknown) => void;
  const captured = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    try { const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 }); const status = response.status(); await response.body(); await route.fulfill({ response }); expect(status).toBe(200); resolve(route.request().postData()!); }
    catch (error) { try { await route.abort("failed"); } catch {} reject(error); }
  };
  await tab.route(predicate, handler);
  try { const [body] = await Promise.all([captured, sheet(tab).getByRole("button", { name: "Save honors", exact: true }).click()]); await ui(sheet(tab).getByRole("status").filter({ hasText: "Honors saved." })).toBeVisible(); return body; }
  finally { await tab.unroute(predicate, handler); }
}
async function prepare(tab: Page, child: Child, who: "parent" | "admin", name: string) { await open(tab, child, who); await add(tab, name); return save(tab, child); }
async function counts(child: Child) {
  const [forms, links, operations, audits] = await Promise.all([
    fixture.ownerDb.select({ id: s.honorsVersion.id }).from(s.honorsVersion).where(eq(s.honorsVersion.studentId, child.id)),
    fixture.ownerDb.select({ id: s.honoreeLink.id }).from(s.honoreeLink).where(eq(s.honoreeLink.studentId, child.id)),
    fixture.ownerDb.select({ id: s.honoreeOperation.id }).from(s.honoreeOperation).where(eq(s.honoreeOperation.studentId, child.id)),
    fixture.ownerDb.select({ id: s.auditEvent.id }).from(s.auditEvent).where(and(eq(s.auditEvent.actingStudentId, child.id), like(s.auditEvent.action, "honoree.%"))),
  ]); return { forms: forms.length, links: links.length, operations: operations.length, audits: audits.length };
}
async function fakeStatus(tab: Page, child: Child, currentLink: typeof record | null = null) {
  const predicate = matches(child, "/status"), handler = async (route: Route) => route.request().method() === "POST" ? json(route, { ok: true, currentLink }) : route.fallback();
  await tab.route(predicate, handler); return () => tab.unroute(predicate, handler);
}
async function knownEmpty(tab: Page) { await button(tab, "Check link").click(); await ui(group(tab).getByText("No current link is recorded for this aliyah.", { exact: true }).first()).toBeVisible(); }

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture();
    const [guardian] = await fixture.ownerDb.select().from(s.guardian).where(eq(s.guardian.studentId, fixture.student.id)), [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const suffix of ["Gating", "Copy", "Recovery", "Capture"]) {
      const [child] = await fixture.ownerDb.insert(s.student).values({ tenantId: "crc", firstName: "Synthetic", lastName: `Honoree ${suffix}`, ceremonyDate: "2027-01-02", parentEmail: "synthetic@example.test", serviceSlot: "morning" }).returning();
      await fixture.ownerDb.insert(s.guardian).values({ tenantId: "crc", studentId: child.id, parentGrantId: guardian.parentGrantId, linkProvenance: "synthetic-honoree-ui" });
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: child.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", aliyahStarts: ["Genesis 1:2"], setByMembershipId: admin.id, proposalSnapshot: { confirmationDate: "2027-01-02", serviceSlot: "morning", slotProvenance: 1, needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(ordinal => ({ tenantId: "crc", studentId: child.id, assignmentId: assignment.id, ordinal, verseRef: `Genesis 1:${ordinal}` })));
      children.push({ id: child.id, name: `${child.firstName} ${child.lastName}`, assignmentId: assignment.id });
    }
    stop = await startBrowserServer(fixture.withRuntime); isolated = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolated.env });
  } catch { await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.(); await isolated?.cleanup(); throw Error("Synthetic honoree management UI setup failed; private details withheld"); }
}, 120000);
beforeEach(() => { onTestFailed(() => { failed = true; }); });
afterEach(async () => { await Promise.all(contexts.splice(0).map(context => context.close())); });
afterAll(async () => { try { if (!failed && process.env.HONOREE_MANAGEMENT_CAPTURE === "1") await capturePacket(); } finally { await Promise.all(contexts.map(context => context.close().catch(() => {}))); await browser?.close().catch(() => {}); await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.(); await isolated?.cleanup(); } }, 120000);

it("guardian saved/dirty gates and actual absent-material404 preserve local honors without link writes", async () => {
  const child = children[0], tab = await page("parent"); await open(tab, child, "parent");
  await ui(button(tab, "Create blessing link")).toBeDisabled(); await add(tab, "Synthetic Saved Group"); await ui(button(tab, "Create blessing link")).toBeDisabled();
  await save(tab, child); await knownEmpty(tab); await ui(button(tab, "Create blessing link")).toBeEnabled();
  const name = group(tab).getByLabel("English name", { exact: true }); await name.fill("Synthetic Unsaved Group"); await ui(button(tab, "Create blessing link")).toBeDisabled();
  // Explicit synthetic ambiguous status404 seam: prove local draft retention.
  const predicate = matches(child, "/status"), denied = async (route: Route) => route.request().method() === "POST" ? json(route, { ok: false, code: "not_found" }, 404) : route.fallback();
  await tab.route(predicate, denied);
  try { await button(tab, "Check link").click(); await ui(group(tab).getByRole("status")).toContainText("unavailable here"); await ui(name).toHaveValue("Synthetic Unsaved Group"); await ui(sheet(tab).getByRole("button", { name: "Save honors", exact: true })).toBeEnabled(); }
  finally { await tab.unroute(predicate, denied); }
  await save(tab, child); await knownEmpty(tab);
  // This response is actual restricted-runtime service output, not a stub.
  let actualStatus = 0, resolve!: () => void; const observed = new Promise<void>(yes => { resolve = yes; });
  const issue = matches(child), unavailable = async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    try { const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 }); actualStatus = response.status(); await response.body(); await route.fulfill({ response }); resolve(); }
    catch { try { await route.abort("failed"); } catch {} resolve(); }
  };
  await tab.route(issue, unavailable);
  try { await button(tab, "Create blessing link").click(); await observed; expect(actualStatus).toBe(404); await ui(group(tab).getByRole("status")).toContainText("original action is unconfirmed"); await ui(name).toHaveValue("Synthetic Unsaved Group"); await ui(sheet(tab)).toBeVisible(); await ui(button(tab, "Check what saved")).toBeVisible(); }
  finally { await tab.unroute(issue, unavailable); }
  expect(await counts(child)).toEqual({ forms: 2, links: 0, operations: 0, audits: 0 }); await ui(tab.locator("[data-honoree-secret]")).toHaveCount(0);
});

it("admin original fake URL requires explicit copy and edits suppress a late clipboard completion", async () => {
  const child = children[1], tab = await page("admin"); await prepare(tab, child, "admin", "Synthetic Copy Group");
  const removeStatus = await fakeStatus(tab, child), issue = matches(child), handler = async (route: Route) => route.request().method() === "POST" ? json(route, committed(JSON.parse(route.request().postData()!).operation, true)) : route.fallback();
  await tab.route(issue, handler);
  try {
    await knownEmpty(tab); await button(tab, "Create blessing link").click(); const secret = group(tab).getByLabel("New blessing link · copy it now", { exact: true });
    await ui(secret).toHaveValue(fakeURL); await ui(secret).toHaveAttribute("readonly", ""); await ui(sheet(tab).locator('a[href*="#token="]')).toHaveCount(0);
    expect(await tab.evaluate(() => (window as unknown as { honoreeClipboard: ClipboardProbe }).honoreeClipboard.writes)).toBe(0);
    await button(tab, "Copy link").click(); await ui(button(tab, "Copied")).toBeVisible();
    await button(tab, "Replace link…").click(); await button(tab, "Replace recorded link").click(); await ui(secret).toHaveValue(fakeURL); await ui(group(tab).getByRole("status")).toContainText("Copy this link now.");
    await tab.evaluate(() => { (window as unknown as { honoreeClipboard: ClipboardProbe }).honoreeClipboard.hold = true; });
    await button(tab, "Copy link").click(); await ui.poll(() => tab.evaluate(() => (window as unknown as { honoreeClipboard: ClipboardProbe }).honoreeClipboard.writes)).toBe(2);
    await group(tab).getByLabel("English name", { exact: true }).fill("Synthetic Draft Clears URL"); await ui(tab.locator("[data-honoree-secret]")).toHaveCount(0);
    await tab.evaluate(async () => { (window as unknown as { honoreeClipboard: ClipboardProbe }).honoreeClipboard.release?.(); await new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null); }); });
    await ui(button(tab, "Copied")).toHaveCount(0); await ui(group(tab).getByRole("status")).not.toContainText("Link copied."); await ui(group(tab).getByLabel("English name", { exact: true })).toHaveValue("Synthetic Draft Clears URL");
    expect(await tab.evaluate(() => { const probe = (window as unknown as { honoreeClipboard: ClipboardProbe }).honoreeClipboard; return { writes: probe.writes, acceptedFakeOnly: probe.acceptedFakeOnly, persisted: [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes("hl1.k1.")) }; })).toEqual({ writes: 2, acceptedFakeOnly: true, persisted: false });
    await sheet(tab).getByRole("button", { name: "Close family honors", exact: true }).click(); await sheet(tab).getByRole("button", { name: "Discard changes and leave", exact: true }).click(); await ui(sheet(tab)).toHaveCount(0); await ui(tab.locator("[data-honoree-secret]")).toHaveCount(0);
    expect(await counts(child)).toEqual({ forms: 1, links: 0, operations: 0, audits: 0 });
  } finally { await tab.unroute(issue, handler); await removeStatus(); await tab.evaluate(() => (window as unknown as { honoreeClipboard: ClipboardProbe }).honoreeClipboard.release?.()).catch(() => {}); }
});

it("unknown original action keeps exact UUID/body, receipts never recover URL, replacement is explicit and stale groups remain revocable", async () => {
  const child = children[2], tab = await page("parent"), saveBody = await prepare(tab, child, "parent", "Synthetic Recovery Group");
  const removeEmpty = await fakeStatus(tab, child), issue = matches(child), receipt = matches(child, "/receipt"), bodies: string[] = [], receiptBodies: string[] = [];
  let operations = 0;
  const mutate = async (route: Route) => { if (route.request().method() !== "POST") return route.fallback(); const body = route.request().postData()!; bodies.push(body); const operation = JSON.parse(body).operation as "issue" | "reissue" | "revoke"; operations++; if (operations <= 2) return route.abort("failed"); return json(route, committed(operation, operation !== "revoke")); };
  const check = async (route: Route) => { if (route.request().method() !== "POST") return route.fallback(); receiptBodies.push(route.request().postData()!); return json(route, receiptBodies.length === 1 ? { ok: true, outcome: "unconfirmed" } : committed("issue")); };
  await tab.route(issue, mutate); await tab.route(receipt, check);
  try {
    await knownEmpty(tab); await button(tab, "Create blessing link").click(); await ui(button(tab, "Check what saved")).toBeVisible();
    await ui(sheet(tab).getByRole("button", { name: "Save honors", exact: true })).toBeDisabled(); await ui(group(tab).getByLabel("English name", { exact: true })).toBeDisabled();
    await button(tab, "Check what saved").click(); await ui(group(tab).getByRole("status")).toContainText("No committed receipt was found");
    expect(receiptBodies).toEqual([bodies[0]]); await button(tab, "Send the same request again").click(); await ui(button(tab, "Check what saved")).toBeVisible();
    await button(tab, "Check what saved").click(); await ui(button(tab, "Replace link…")).toBeVisible(); expect(receiptBodies).toEqual([bodies[0], bodies[0]]);
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); expect(JSON.parse(bodies[0]).mutationId).not.toBe(JSON.parse(saveBody).mutationId);
    expect(Object.keys(JSON.parse(bodies[0])).sort()).toEqual(["contextHash", "expectedVersion", "linkId", "mode", "mutationId", "operation", "startVerse"].sort());
    expect(JSON.parse(bodies[0])).toMatchObject({ mode: "parent", operation: "issue", expectedVersion: 1, contextHash: JSON.parse(saveBody).contextHash, startVerse, linkId: null });
    await ui(tab.locator("[data-honoree-secret]")).toHaveCount(0); await ui(group(tab).getByRole("status")).toContainText("full URL cannot be recovered");
    await button(tab, "Replace link…").click(); await ui(button(tab, "Replace recorded link")).toBeVisible(); expect(bodies).toHaveLength(2);
    await button(tab, "Keep current link").click(); expect(bodies).toHaveLength(2); await button(tab, "Replace link…").click(); await button(tab, "Replace recorded link").click();
    await ui(group(tab).getByLabel("New blessing link · copy it now", { exact: true })).toHaveValue(fakeURL); expect(bodies).toHaveLength(3); expect(JSON.parse(bodies[2])).toMatchObject({ operation: "reissue", linkId: fakeId }); expect(JSON.parse(bodies[2]).mutationId).not.toBe(JSON.parse(bodies[0]).mutationId);
    await sheet(tab).getByRole("button", { name: "Close family honors", exact: true }).click(); await ui(sheet(tab)).toHaveCount(0);
    await fixture.ownerDb.update(s.assignment).set({ aliyahStarts: ["Genesis 1:3"], revision: 2 }).where(eq(s.assignment.id, child.assignmentId));
    await removeEmpty(); const removeRecorded = await fakeStatus(tab, child, record);
    try {
      await open(tab, child, "parent"); await ui(sheet(tab).getByRole("region", { name: "Review changed ceremony", exact: true })).toBeVisible();
      await button(tab, "Check link").click(); await ui(button(tab, "Revoke link…")).toBeEnabled(); await ui(button(tab, "Replace link…")).toBeDisabled();
      await button(tab, "Revoke link…").click(); expect(bodies).toHaveLength(3); await button(tab, "Revoke recorded link").click(); await ui(group(tab).getByRole("status")).toHaveText("The recorded link was revoked.");
      expect(bodies).toHaveLength(4); expect(JSON.parse(bodies[3])).toMatchObject({ operation: "revoke", linkId: fakeId, startVerse }); expect(JSON.parse(bodies[3]).mutationId).not.toBe(JSON.parse(bodies[2]).mutationId);
      await ui(tab.locator("[data-honoree-secret]")).toHaveCount(0); expect(await counts(child)).toEqual({ forms: 1, links: 0, operations: 0, audits: 0 });
    } finally { await removeRecorded(); }
  } finally { await tab.unroute(issue, mutate); await tab.unroute(receipt, check); await removeEmpty(); }
});

async function capturePacket() {
  const directory = join(process.cwd(), ".impeccable", "review", "honoree-management"); await mkdir(directory, { recursive: true });
  const images: { name: string; width: number; height: number; sha256: string }[] = [];
  for (const mobile of [false, true]) for (const theme of ["light", "dark"] as const) {
    const child = children[3], tab = await page("admin", mobile, theme); await open(tab, child, "admin");
    if (images.length === 0) { await add(tab, "Synthetic Capture Group"); await save(tab, child); }
    const removeStatus = await fakeStatus(tab, child), issue = matches(child), handler = async (route: Route) => route.request().method() === "POST" ? json(route, committed("issue", true)) : route.fallback(); await tab.route(issue, handler);
    try {
      await knownEmpty(tab); await button(tab, "Create blessing link").click(); await ui(group(tab).getByLabel("New blessing link · copy it now", { exact: true })).toHaveValue(fakeURL);
      await tab.evaluate(async () => { await document.fonts.ready; });
      const copy = button(tab, "Copy link");
      await copy.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      await tab.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const framed = await copy.evaluate(node => {
        const dialog = node.closest("dialog"), input = dialog?.querySelector<HTMLInputElement>("input[data-honoree-secret]"), bar = dialog?.querySelector(".sheet-bar"), footer = dialog?.querySelector("footer");
        if (!dialog || !input || !bar || !footer) return { input: false, copy: false };
        const bounds = dialog.getBoundingClientRect(), top = Math.max(0, bounds.top, bar.getBoundingClientRect().bottom), bottom = Math.min(innerHeight, bounds.bottom, footer.getBoundingClientRect().top);
        const visible = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.top >= top && rect.bottom <= bottom && rect.left >= Math.max(0, bounds.left) && rect.right <= Math.min(innerWidth, bounds.right); };
        return { input: visible(input), copy: visible(node) };
      });
      expect(framed).toEqual({ input: true, copy: true });
      expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const name = `${mobile ? "phone" : "desktop"}-${theme}`, bytes = await tab.screenshot({ style: "nextjs-portal { display:none !important; }" });
      await writeFile(join(directory, name + ".png"), bytes, { flag: "wx" }); images.push({ name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash("sha256").update(bytes).digest("hex") });
    } finally { await tab.unroute(issue, handler); await removeStatus(); await tab.context().close(); }
  }
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ schema: "honoree-management-capture/v1", synthetic: true, invalidFakeCredentialOnly: true, images }, null, 2) + "\n", { flag: "wx" });
}
