import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
const contexts: BrowserContext[] = [], blobs = new Map<string, Uint8Array>();
// A synthetic silent PCM container assembled in memory, never a saved media fixture.
const wav = () => { const buffer = Buffer.alloc(44 + 8000); buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(8000, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34); buffer.write("data", 36); buffer.writeUInt32LE(8000, 40); buffer.fill(128, 44); return buffer; };

beforeAll(async () => {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
  fixture = await browserFixture({ studyLoad: async request => syntheticUiStudyPage(request, "available"), tutorSpokenTransport: {
    put: async (path, value) => { blobs.set(path, value); },
    get: async path => { const bytes = blobs.get(path); if (!bytes) throw new Error("Synthetic missing clip"); return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }); },
    remove: async path => { blobs.delete(path); },
  } });
  const [member] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
  const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-4", status: "confirmed", setByMembershipId: member.id, aliyahStarts: [], proposalSnapshot: { ranges: ["Genesis 1:1-4"], confirmationDate: "2027-01-02", needsReview: false } }).returning();
  await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3, 4].map(n => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
  stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await isolation?.cleanup(); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("previews before private sharing, exposes Hear it read, and omits every management control in Practice", async () => {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, viewport: { width: 390, height: 844 }, serviceWorkers: "block", acceptDownloads: false }); contexts.push(context);
  await context.route("**/*", route => new URL(route.request().url()).origin === BROWSER_ORIGIN ? route.continue() : route.abort());
  const tab = await context.newPage(); await tab.goto("/");
  const email = "pg-tutor@example.test";
  expect(await tab.evaluate(async email => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).status, email)).toBe(200);
  await openAuthMail(tab, fixture.takeMail(email)); await tab.goto(`/workspace/tutor/${fixture.student.id}`);
  const spoken = tab.getByTestId("tutor-spoken");
  await ui(spoken.getByRole("button", { name: "Record spoken Hebrew", exact: true })).toBeVisible();
  await spoken.getByLabel("Choose audio").setInputFiles({ name: "synthetic.wav", mimeType: "audio/wav", buffer: wav() });
  await ui(spoken.getByLabel("Your recording preview", { exact: true })).toBeVisible(); expect(blobs.size).toBe(0);
  await spoken.getByRole("button", { name: "Share privately", exact: true }).click();
  await ui(spoken.getByRole("button", { name: "Hear it read", exact: true })).toBeVisible(); expect(blobs.size).toBe(1);
  await ui(spoken.getByRole("button", { name: "Withdraw recording", exact: true })).toBeVisible();
  await tab.getByRole("button", { name: "Practice", exact: true }).click();
  await ui(tab.locator("[data-assigned-practice]")).toBeVisible();
  await ui(spoken.getByRole("button", { name: "Hear it read", exact: true })).toBeVisible();
  await ui(spoken.getByRole("button", { name: "Record spoken Hebrew", exact: true })).toHaveCount(0);
  await ui(spoken.getByLabel("Choose audio")).toHaveCount(0);
  await ui(spoken.getByRole("button", { name: "Withdraw recording", exact: true })).toHaveCount(0);
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tab.getByTestId("close-assigned-practice").click();
  await spoken.getByRole("button", { name: "Withdraw recording", exact: true }).click();
  await ui(spoken.getByRole("button", { name: "Hear it read", exact: true })).toHaveCount(0); expect(blobs.size).toBe(0);
});
