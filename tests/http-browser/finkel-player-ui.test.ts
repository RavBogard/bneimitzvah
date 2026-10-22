import { openAuthMail } from "./auth-navigation";
import { generateSyntheticShortAudio } from "./synthetic-short-reference";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { FINKEL_MANIFEST_SCHEMA, finkelAudioKey, finkelManifestKey } from "../../src/server/reference-audio/finkel-manifest";
import { createFinkelReferenceService, resetFinkelManifestCache } from "../../src/server/reference-audio/finkel-service";
import { ReviewUnavailable } from "../../src/server/reference-review/batch-contract";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// Synthetic tone only: no real recording, catalog or private label is used here.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let directory: string | undefined, sha256 = "", mediaRequests = 0;
const contexts: BrowserContext[] = [], sessions = new Map<"admin" | "student", Awaited<ReturnType<BrowserContext["storageState"]>>>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function page(who: "admin" | "student") {
  const known = sessions.get(who);
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 }, ...(known ? { storageState: known } : {}) }); contexts.push(context);
  await context.route("**/*", async route => { try {
    const url = new URL(route.request().url()); if (url.origin !== BROWSER_ORIGIN) { await route.abort(); return; }
    if (url.pathname.startsWith("/api/reference-audio/finkel/media/")) mediaRequests++;
    await route.continue();
  } catch { await route.abort().catch(() => {}); } });
  const tab = await context.newPage(); await tab.goto("/", { waitUntil: "domcontentloaded" });
  if (!known) {
    const email = who === "admin" ? "pg-admin@example.test" : "pg-finkel-student@example.test";
    const status = await tab.evaluate(async email => (await fetch("/api/auth/sign-in/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).status, email);
    expect(status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); sessions.set(who, await context.storageState());
  }
  return tab;
}
const region = (tab: Page) => tab.getByRole("region", { name: "Cantor Finkel’s recordings", exact: true });
const loaded = (tab: Page) => ui(tab.locator(".study-verses").getByRole("heading", { name: "Genesis 1:1", level: 4, exact: true })).toBeVisible({ timeout: 30_000 });
// A sign-in or role redirect may supersede the first navigation; the reading itself is the barrier.
async function open(tab: Page, path: string) { await tab.goto(path, { waitUntil: "commit" }).catch(() => undefined); await loaded(tab); }
async function status(tab: Page, path: string) { return tab.evaluate(async path => (await fetch(path, { cache: "no-store" })).status, path); }

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); resetFinkelManifestCache();
    directory = await realpath(await mkdtemp(join(tmpdir(), "finkel-player-audio-")));
    const audio = new Uint8Array((await generateSyntheticShortAudio(directory, "torah", 330)).parent); sha256 = hash(audio);
    const manifest = new TextEncoder().encode(JSON.stringify({ schema: FINKEL_MANIFEST_SCHEMA, clips: [
      { asset: "fj_" + "1".repeat(20), kind: "torah", mode: "chant", verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], sha256, bytes: audio.byteLength, durationSeconds: 8, preferred: true }] }));
    const objects = new Map([[finkelManifestKey(hash(manifest)), manifest], [finkelAudioKey(sha256), audio]]);
    const get = async (path: string) => { const body = objects.get(path); if (!body) throw new ReviewUnavailable(); return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(body.slice()); c.close(); } }); };
    fixture = await browserFixture({ referenceStudentRelease: false, studyLoad: async request => syntheticUiStudyPage(request), finkelManifestSha256: hash(manifest), finkelGet: get });
    const learner = await fixture.signIn("pg-finkel-student");
    const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [adminMember] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: adminMember.id, proposalSnapshot: { confirmationDate: "2027-01-02", needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    // Keep the getter for the released case below.
    Object.assign(fixture, { finkelGet: get, finkelPin: hash(manifest) });
    stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Finkel player setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.();
  if (directory && resolve(directory).startsWith(await realpath(tmpdir()) + sep)) await rm(directory, { recursive: true, force: true });
}, 120_000);

it("an admin hears the whole passage with its credit, loop and speed, and its verses are marked while it plays", async () => {
  const tab = await page("admin");
  await open(tab, `/workspace/admin/students/${fixture.student.id}/reading`);
  await ui(region(tab)).toBeVisible();
  await ui(region(tab)).toContainText("Hear the chant · Genesis 1:1–3"); await ui(region(tab)).toContainText("Chanted by Cantor Josh Finkel");
  expect(mediaRequests).toBe(0); // Nothing is fetched before Play.
  await region(tab).getByRole("button", { name: "Repeat", exact: true }).click();
  await region(tab).getByLabel("Speed", { exact: true }).selectOption("0.75");
  await region(tab).getByRole("button", { name: "Play", exact: true }).click();
  await ui(region(tab).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(mediaRequests).toBe(1);
  await ui(tab.locator('.study-verses [data-verse-ref="Genesis 1:2"][data-playing="true"]')).toBeVisible();
  const native = await tab.evaluate(() => [...document.querySelectorAll("audio")].length);
  expect(native).toBe(0); // Detached Audio elements only; nothing is injected into the page.
  await region(tab).getByRole("button", { name: "Pause", exact: true }).click();
  await ui(region(tab).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await ui(tab.locator('.study-verses [data-playing="true"]')).toHaveCount(0);
  // Resuming reuses the verified bytes already in the browser.
  await region(tab).getByRole("button", { name: "Play", exact: true }).click();
  await ui(region(tab).getByRole("button", { name: "Pause", exact: true })).toBeVisible(); expect(mediaRequests).toBe(1);
  // A verse tap hands the voice to the verse player and stops the passage.
  await tab.locator('.study-verses [data-verse-ref="Genesis 1:3"]').getByRole("button", { name: "Hear Genesis 1:3", exact: true }).click();
  await ui(region(tab).getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

it("before the student release a student sees no Finkel player and every Finkel route answers 404", async () => {
  const tab = await page("student");
  await open(tab, "/workspace/student");
  await ui(region(tab)).toHaveCount(0);
  expect(await status(tab, "/api/reference-audio/finkel/clips?mode=student&from=Genesis+1%3A1&to=Genesis+1%3A3")).toBe(404);
  expect(await status(tab, `/api/reference-audio/finkel/media/${sha256}.mp3?mode=student`)).toBe(404);
  expect(await status(tab, `/api/reference-audio/finkel/media/${sha256}.mp3?mode=admin`)).toBe(404);
  expect(await status(tab, "/api/reference-audio/finkel/clips?mode=admin")).toBe(404);
});

it("after the shared release the student hears the chosen take", async () => {
  const state = fixture as unknown as { finkelGet: Parameters<typeof createFinkelReferenceService>[0]["get"]; finkelPin: string };
  Object.assign(fixture.runtime, { finkelReference: createFinkelReferenceService({ access: fixture.runtime.access, manifestSha256: state.finkelPin, get: state.finkelGet, studentRelease: true }) });
  const tab = await page("student");
  expect(await status(tab, `/api/reference-audio/finkel/media/${sha256}.mp3?mode=student`)).toBe(200);
  expect(await status(tab, "/api/reference-audio/finkel/clips?mode=student")).toBe(404); // the full list stays admin-only
});
