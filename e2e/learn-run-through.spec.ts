import { expect, test, type Page, type Route } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

// 1.9 N19: the Run-through and the student's own verse cards. Every account answer is a route fulfilment with a synthetic
// student ("Noa", example.test, no real data); the reading's text is the synthetic course data. Nothing may play.
const OWNER = "a".repeat(32), VERSE_OWNER = "c".repeat(32), STUDENT = "11111111-1111-4111-8111-111111111111", READING = "22222222-2222-4222-8222-222222222222";
const VERSES = ["Genesis 23:1", "Genesis 23:2", "Genesis 23:3"];
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Noa is signed in with a live course grant, one assigned reading, Got it on its first verse, and no verse cards yet. */
async function signIn(page: Page, puts: unknown[]) {
  await page.route("**/api/learn/progress**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/learn/progress") return json(route, { ok: true, owner: OWNER, progress: null, version: 0, until: null });
    return json(route, { ok: true, owner: OWNER, progress: (route.request().postDataJSON() as { progress: unknown }).progress, version: 1, until: null });
  });
  let version = 0;
  await page.route("**/api/learn/verses**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/learn/verses") return json(route, { ok: true, owner: VERSE_OWNER, review: null, version: 0, until: "2027-03-06" });
    const body = route.request().postDataJSON() as { review: unknown; expectedVersion: number; expectedOwner: string }; puts.push(body);
    if (body.expectedOwner !== VERSE_OWNER) return json(route, { error: "forbidden" }, 403);
    if (body.expectedVersion !== version) return json(route, { ok: false, code: "conflict", current: { ok: true, owner: VERSE_OWNER, review: null, version, until: "2027-03-06" } }, 409);
    version++; return json(route, { ok: true, owner: VERSE_OWNER, review: body.review, version, until: "2027-03-06" });
  });
  const student = { id: STUDENT, firstName: "Noa", lastName: "Fixture", ceremonyDate: "2027-03-06", revision: 1 };
  await page.route("**/api/students?**", route => json(route, { students: [student] }));
  await page.route(`**/api/students/${STUDENT}/reading?**`, route => json(route, { student, mode: "student", context: null,
    readings: [{ id: READING, status: "confirmed", kind: "torah", basis: "selection", revision: 1, ranges: ["Genesis 23:1-3"], verses: VERSES, confirmationDate: null, needsReview: false,
      source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, aliyahStarts: null }] }));
  await page.route(`**/api/students/${STUDENT}/progress?**`, route => json(route, { ok: true, binding: { studentId: STUDENT, mode: "student", kind: "torah", assignmentId: READING, assignmentRevision: 1 },
    offset: 0, nextOffset: null, totalVerses: 3, verses: VERSES.map((verseRef, i) => ({ verseRef, selfCheck: { state: i === 0 ? "got-it" : "unmarked", version: i === 0 ? 1 : 0 }, assessment: { state: "not-started", version: 0 } })),
    counts: { selfCheck: { unmarked: 2, working: 0, "got-it": 1 }, assessment: { "not-started": 3, working: 0, solid: 0 } } }));
}

test("Noa runs through her reading with the colours off and nothing playing, and the summary names only the stumbled verse", async ({ page }) => {
  const routes = syntheticCourseRoutes(); await routes.install(page);
  const puts: unknown[] = [], asked: string[] = [];
  page.on("request", request => asked.push(new URL(request.url()).pathname));
  await signIn(page, puts);
  await page.goto("/learn/run-through");
  await expect(page.getByRole("heading", { level: 1, name: "Run-through" })).toBeVisible();
  for (const [i, ref] of VERSES.entries()) {
    await expect(page.getByRole("heading", { name: "Chant this verse" })).toBeVisible();
    await expect(page.locator("main bdi").first()).toHaveText(ref);
    await expect(page.getByRole("group", { name: "Help" })).toHaveText("Help: Colors → Marks only → Tikkun");
    await expect(page.getByRole("button", { name: "Marks only" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-help]")).toHaveAttribute("data-help", "marks");
    if (i === 0) {
      // The fade is a suggestion, never a lock: the colours and the tikkun are each one tap away.
      await page.getByRole("button", { name: "Colors" }).click(); await expect(page.locator("[data-help]")).toHaveAttribute("data-help", "colors");
      await page.getByRole("button", { name: "Tikkun" }).click(); await expect(page.locator("[data-help]")).toHaveAttribute("data-help", "tikkun");
    }
    await page.getByRole("button", { name: i === 1 ? "Stumbled" : "Clean", exact: true }).click();
  }
  await expect(page.locator("[data-run-summary]")).toHaveText("Practice verse 2 again.");
  await expect(page.getByText(/Clean: | of 3/)).toHaveCount(0);
  // Nothing played and nothing asked for a recording: no audio element, no clip, no reference metadata.
  expect(await page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays)).toEqual([]);
  expect(await page.locator("audio, video").count()).toBe(0);
  expect(asked.filter(path => /reference|audio|\.mp3$/.test(path))).toEqual([]);
  expect(routes.seen.filter(path => path.startsWith("/api/public/") && !path.startsWith("/api/public/text") && !path.startsWith("/api/public/manifest") && !path.startsWith("/api/public/view"))).toEqual([]);
  // The stumble fed review, and Noa's Got it verse became a card: both in her own document.
  await expect.poll(() => puts.length).toBeGreaterThan(0);
  const last = puts.at(-1) as { review: { cards: Record<string, { box: number; due: string }> } };
  await expect.poll(() => Object.keys((puts.at(-1) as typeof last).review.cards).sort()).toEqual(["torah|Genesis 23:1", "torah|Genesis 23:2"]);
  expect((puts.at(-1) as typeof last).review.cards["torah|Genesis 23:2"].box).toBe(0);
  expect((puts.at(-1) as typeof last).review.cards["torah|Genesis 23:1"].box).toBe(1);
});

test("a signed-out visitor gets no Run-through row and no run, and asks for no verse cards", async ({ page }) => {
  await syntheticCourseRoutes().install(page);
  const asked: string[] = []; page.on("request", request => asked.push(new URL(request.url()).pathname));
  await page.route("**/api/learn/progress**", route => json(route, { error: "unauthenticated" }, 401));
  await page.goto("/learn");
  await expect(page.getByRole("heading", { level: 1, name: "Learn to lein" })).toBeVisible();
  await expect(page.locator("[data-run-through]")).toHaveCount(0);
  await page.goto("/learn/run-through");
  await expect(page.getByRole("link", { name: "Back to the path" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chant this verse" })).toHaveCount(0);
  expect(asked.filter(path => path.startsWith("/api/learn/verses") || path.startsWith("/api/students"))).toEqual([]);
});
