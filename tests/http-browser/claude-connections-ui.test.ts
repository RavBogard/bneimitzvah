import { openAuthMail } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Claude connections browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(role: "admin" | "tutor", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await navigate(tab, "/"); const email = role === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status === 200).toBe(true); await openAuthMail(tab, fixture.takeMail(email)); return tab;
}
const main = (tab: Page) => tab.locator("#workspace-main");
async function capture(tab: Page, name: string) {
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CI) return;
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
}
/** A live connection for a fixture staff member, as an Allow on the consent page would make it. */
async function connect(who: "admin" | "tutor", scope: string) {
  const userId = who === "admin" ? fixture.admin.id : fixture.tutor.id;
  const [member] = await fixture.ownerDb.select().from(s.membership).where(and(eq(s.membership.tenantId, "crc"), eq(s.membership.userId, userId)));
  const [grant] = await fixture.ownerDb.select().from(s.roleGrant).where(and(eq(s.roleGrant.membershipId, member.id), eq(s.roleGrant.role, who)));
  const [row] = await fixture.ownerDb.insert(s.mcpConnection).values({ tenantId: "crc", userId, membershipId: member.id, roleGrantId: grant.id, role: who, roleGrantRevision: grant.revision,
    authorityRevision: member.authorityRevision, scope, unattended: false, clientName: "Claude", clientHash: "c".repeat(64), redirectUri: "https://claude.ai/api/mcp/auth_callback",
    expiresAt: new Date(Date.now() + 30 * 86_400_000) }).returning();
  return { ...row, member, grant };
}
beforeAll(async () => {
  try { assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture(); stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true }); }
  catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Claude connections setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("an admin opens Claude connections from the admin nav, sees every staff connection in plain words, and ends a tutor's", async () => {
  const mine = await connect("admin", "portal:read portal:study portal:roster"), theirs = await connect("tutor", "portal:read");
  const tab = await page("admin"); await navigate(tab, "/workspace/admin/students");
  await safe(() => tab.getByRole("navigation", { name: "Admin", exact: true }).getByRole("link", { name: "Claude", exact: true }).click());
  await ui(tab.getByRole("heading", { name: "Claude connections", level: 1, exact: true })).toBeVisible();
  const own = main(tab).getByRole("region", { name: "Your connections", exact: true }), staff = main(tab).getByRole("region", { name: "Other staff", exact: true });
  await ui(own.getByRole("listitem")).toHaveCount(1);
  for (const chip of ["Read", "Study guides", "Roster"]) await ui(own.getByText(chip, { exact: true })).toBeVisible();
  await ui(staff.getByRole("listitem")).toHaveCount(1);
  await ui(staff.getByText("Read", { exact: true })).toBeVisible();
  expect(await main(tab).textContent()).not.toContain("@");
  await capture(tab, "claude-connections-desktop");
  // Ending asks once; Keep leaves it.
  await safe(() => staff.getByRole("button", { name: /^End connection: / }).click());
  await safe(() => staff.getByRole("button", { name: /^Keep / }).click());
  await ui(staff.getByRole("button", { name: /^End connection: / })).toBeVisible();
  await safe(() => staff.getByRole("button", { name: /^End connection: / }).click());
  await safe(() => staff.getByRole("button", { name: /^End now: / }).click());
  await ui(main(tab).getByRole("status").filter({ hasText: "Connection ended." })).toBeVisible();
  await ui(staff.getByText("No other staff member has Claude connected.", { exact: true })).toBeVisible();
  await ui(own.getByRole("listitem")).toHaveCount(1);
  const [ended] = await fixture.ownerDb.select().from(s.mcpConnection).where(eq(s.mcpConnection.id, theirs.id));
  expect(ended.revokedAt).not.toBeNull();
  const [still] = await fixture.ownerDb.select().from(s.mcpConnection).where(eq(s.mcpConnection.id, mine.id));
  expect(still.revokedAt).toBeNull();
  const [audit] = await fixture.ownerDb.select().from(s.auditEvent).where(and(eq(s.auditEvent.action, "mcp-connection.revoke"), eq(s.auditEvent.targetId, theirs.id)));
  expect(audit).toMatchObject({ mode: "admin", targetType: "mcp_connection", actorUserId: fixture.admin.id });
  await fixture.ownerDb.update(s.mcpConnection).set({ revokedAt: new Date() }).where(eq(s.mcpConnection.id, mine.id));
});

it("fits a phone, and a tutor finds the page from the account page and sees only their own connections", async () => {
  const theirs = await connect("tutor", "portal:read"), mine = await connect("admin", "portal:read");
  const phone = await page("admin", true); await navigate(phone, "/workspace/claude");
  await ui(phone.getByRole("heading", { name: "Claude connections", level: 1, exact: true })).toBeVisible();
  await ui(main(phone).getByRole("region", { name: "Other staff", exact: true }).getByRole("listitem")).toHaveCount(1);
  await capture(phone, "claude-connections-mobile");
  const tutor = await page("tutor", true); await navigate(tutor, "/account");
  await safe(() => tutor.getByRole("link", { name: "Claude connections", exact: true }).click());
  await ui(tutor.getByRole("heading", { name: "Claude connections", level: 1, exact: true })).toBeVisible();
  await ui(main(tutor).getByRole("region", { name: "Your connections", exact: true }).getByRole("listitem")).toHaveCount(1);
  expect(await main(tutor).getByRole("region", { name: "Other staff", exact: true }).count()).toBe(0);
  expect(await tutor.getByRole("navigation", { name: "Admin", exact: true }).count()).toBe(0);
  await capture(tutor, "claude-connections-tutor-mobile");
  // The tutor cannot end the admin's connection, even by asking the API directly.
  expect((await api(tutor, "/api/staff/claude-connections/revoke", { connectionId: mine.id })).status).toBe(404);
  await safe(() => main(tutor).getByRole("button", { name: /^End connection: / }).click());
  await safe(() => main(tutor).getByRole("button", { name: /^End now: / }).click());
  await ui(main(tutor).getByText("No Claude connection is active.", { exact: true })).toBeVisible();
  const rows = await fixture.ownerDb.select().from(s.mcpConnection).where(eq(s.mcpConnection.id, theirs.id));
  expect(rows[0].revokedAt).not.toBeNull();
  const [admin] = await fixture.ownerDb.select().from(s.mcpConnection).where(eq(s.mcpConnection.id, mine.id));
  expect(admin.revokedAt).toBeNull();
});

it("shows a student's Maven link in the roster sheet and unlinks it there", async () => {
  const connection = await connect("admin", "portal:read portal:roster");
  const [identity] = await fixture.ownerDb.insert(s.studentSourceIdentity).values({ tenantId: "crc", sourceNamespace: "maven", sourceRecordId: "SYN000000000000042", studentId: fixture.student.id,
    createdByUserId: fixture.admin.id, createdByMembershipId: connection.member.id, roleGrantId: connection.grant.id, role: "admin", mcpConnectionId: connection.id, linkKind: "linked" }).returning();
  for (const mobile of [true, false]) {
    const tab = await page("admin", mobile); await navigate(tab, "/workspace/admin/students");
    const sheet = tab.getByRole("dialog");
    await safe(() => main(tab).getByRole("button", { name: "Edit details for Synthetic Learner", exact: true }).click());
    await ui(sheet.getByRole("heading", { name: "Maven record", exact: true })).toBeVisible();
    await ui(sheet.getByText("SYN000000000000042", { exact: true })).toBeVisible();
    await capture(tab, `roster-maven-link-${mobile ? "mobile" : "desktop"}`);
    if (mobile) { await safe(() => sheet.getByRole("button", { name: "Close student details", exact: true }).click()); continue; }
    await safe(() => sheet.getByRole("button", { name: "Unlink from Maven", exact: true }).click());
    await safe(() => sheet.getByRole("button", { name: "Confirm unlink", exact: true }).click());
    await ui(sheet.getByRole("status").filter({ hasText: "Unlinked from Maven." })).toBeVisible();
    await ui(sheet.getByText("SYN000000000000042", { exact: true })).toHaveCount(0);
  }
  const [row] = await fixture.ownerDb.select().from(s.studentSourceIdentity).where(eq(s.studentSourceIdentity.id, identity.id));
  expect(row).toMatchObject({ revokedChannel: "web", revokedMcpConnectionId: null, revokedByUserId: fixture.admin.id });
  expect(row.revokedAt).not.toBeNull();
  // A tutor neither reads nor undoes a link.
  const tutor = await page("tutor");
  expect((await api(tutor, `/api/admin/maven-link?studentId=${fixture.student.id}`)).status).toBe(403);
  expect((await api(tutor, "/api/admin/maven-link/unlink", { studentId: fixture.student.id, mavenContactId: "SYN000000000000042" })).status).toBe(403);
});
