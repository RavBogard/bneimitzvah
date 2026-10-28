import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// Tutor walk 2026-10-28 (H1, findings 6, 7 and 8, A1): Find a learner through the real routes. Search first; a colleague is never listed;
// a learner with a tutor has no Add button; a claim and its removal refresh Your students in place. Synthetic @example.test people only.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [];
const people: Record<"avi" | "gil" | "colleague", string> = { avi: "", gil: "", colleague: "" };
const safe = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch { throw new Error("Find a learner browser operation failed; private details withheld"); } };
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => { const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status }; }, { path, body }));
}
async function tutorPage() {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
  const email = "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200);
  await openAuthMail(tab, fixture.takeMail(email));
  return tab;
}
/** A signed-in member of the congregation with a display name, and optionally a grant. */
async function member(login: string, name: string, role: "tutor" | null) {
  const user = await fixture.signIn(login);
  await fixture.ownerDb.update(s.user).set({ name }).where(eq(s.user.id, user.id));
  const [row] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: user.id }).returning();
  const grant = role ? (await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: row.id, role }).returning())[0] : null;
  return { membershipId: row.id, grantId: grant?.id ?? null };
}

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture();
    const avi = await member("pg-find-avi", "Synthetic Avi", null), gil = await member("pg-find-gil", "Synthetic Gil", null), colleague = await member("pg-find-colleague", "Synthetic Colleague", "tutor");
    // Gil is already the colleague's student.
    await fixture.ownerDb.insert(s.learnerClaim).values({ tenantId: "crc", learnerMembershipId: gil.membershipId, tutorGrantId: colleague.grantId! });
    people.avi = avi.membershipId; people.gil = gil.membershipId; people.colleague = colleague.membershipId;
    stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
  } catch { await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Find a learner setup failed; private details withheld"); }
}, 240_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("searches first, never lists a colleague, offers no Add for a learner with a tutor, and refreshes Your students after a claim and its removal", async () => {
  const tab = await tutorPage();
  await safe(() => tab.goto("/mine", { waitUntil: "domcontentloaded" }));
  const find = tab.getByTestId("mine-find"), students = tab.getByTestId("mine-students"), rows = find.getByTestId("learner-row");
  const row = (id: string) => find.locator(`[data-learner="${id}"]`), studentLink = (id: string) => students.locator(`a[href="/mine/learner/${id}"]`);
  await ui(find.getByRole("searchbox", { name: "Find a learner", exact: true })).toBeVisible();
  await ui(students).toBeVisible();
  // Nothing is listed before anything is typed.
  await ui(rows).toHaveCount(0);
  await safe(() => find.getByRole("searchbox", { name: "Find a learner", exact: true }).fill("Synthetic"));
  await ui(row(people.avi)).toBeVisible(); await ui(row(people.gil)).toBeVisible();
  await ui(row(people.colleague)).toHaveCount(0);
  // Gil has a tutor: no Add button, a plain state instead.
  await ui(row(people.gil).getByRole("button")).toHaveCount(0);
  await ui(row(people.gil).getByTestId("learner-state")).toBeVisible();
  // Claim Avi: Your students shows Avi without a reload, and the row offers the tutor's own undo.
  await ui(studentLink(people.avi)).toHaveCount(0);
  await safe(() => row(people.avi).getByRole("button", { name: "Add to my students: Synthetic Avi", exact: true }).click());
  await ui(studentLink(people.avi)).toBeVisible();
  await safe(() => row(people.avi).getByRole("button", { name: "Remove from my students: Synthetic Avi", exact: true }).click());
  await ui(studentLink(people.avi)).toHaveCount(0);
  await ui(row(people.avi).getByRole("button", { name: "Add to my students: Synthetic Avi", exact: true })).toBeEnabled();
  // The colleague cannot be claimed through the route either: the same 404 as a stranger.
  expect((await api(tab, "/api/learners/claim", { learner: people.colleague })).status).toBe(404);
});
