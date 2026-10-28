import { expect, test, type Page, type Route } from "@playwright/test";
import { longestEvent } from "./aliyot-fixture";
import { mock as studentMock } from "./student-fixture";
import { cls, shiftsOf, structureProblems, watchShifts } from "./web-vitals";

// Area A: /mine, the shelf of My Readings, in the built, unconfigured production server. The session and saved-readings answers are
// synthetic route fulfilments, so the page's own client code is under test. Invented reading names only.
const binding = "A".repeat(43);
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const row = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Synthetic reading ${index}`, date: index % 2 ? "2026-10-24" : null,
  kind: index % 3 ? "torah" : "haftarah", ranges: index % 3 ? "Genesis 6:9-11:32" : "Isaiah 54:1-55:5", verseCount: index % 3 ? 153 : 22, revision: 1,
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" });
const session = (page: Page, roles: string[], saved = true) => page.route("**/api/session", route => json(route, 200, { membershipAvailable: true, roles, saved, approver: false, sessionBinding: binding }));

test("a member's shelf: the title, My Readings current in the bar, no tab bar, five readings and then all of them inline", async ({ page }, testInfo) => {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await session(page, ["parent"]);
    await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: Array.from({ length: 7 }, (_, i) => row(i + 1)) }));
    await page.goto("/mine");
    await expect(page.getByRole("heading", { level: 1, name: "My Readings", exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "My Readings", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-shell-tabs]")).toHaveCount(0);
    const own = page.getByRole("region", { name: "Also working on" });
    await expect(own).toBeVisible();
    await expect(own.getByRole("listitem")).toHaveCount(5);
    await expect(own.getByRole("link", { name: /Synthetic reading 1\b/ })).toHaveAttribute("href", `/read?saved=${row(1).id}`);
    for (const height of await own.getByRole("link").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);
    await own.getByRole("button", { name: "All my readings", exact: true }).click();
    await expect(own.getByRole("listitem")).toHaveCount(7);
    await expect(own.getByRole("button", { name: "Fewer readings", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("mine-account")).toHaveAttribute("href", "/account");
    expect(await noHorizontalScroll(page)).toBe(true);
    if (width === 360 && testInfo.project.name === "phone") await page.screenshot({ path: testInfo.outputPath("mine-360.png"), fullPage: true });
  }
});

test("with none saved the shelf says so and offers the first reading; a person whose saving is not open yet sees the same shelf without the line", async ({ page }) => {
  // A tutor: a student's pinned card or a parent's cards stand in for the empty state (E1, E3), so they are not the people this checks.
  await session(page, ["tutor"]);
  await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
  await page.goto("/mine");
  await expect(page.getByTestId("mine-empty")).toBeVisible();
  await expect(page.getByText("You’re signed in. Nothing is saved yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find a reading", exact: true })).toHaveAttribute("href", "/readings");
  await expect(page.getByRole("link", { name: "Add", exact: true })).toHaveAttribute("href", "/readings?add=1");
  await page.unroute("**/api/saved/readings");
  await page.route("**/api/saved/readings", route => json(route, 403, { error: "forbidden" }));
  await page.reload();
  await expect(page.getByTestId("mine-empty")).toBeVisible();
  await expect(page.getByText("You’re signed in. Nothing is saved yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("mine-own")).toHaveCount(0);
});

// Readings for everyone, plan D7: a tutor finds a learner by name, claims in one tap, opens the shelf and sees the readings; the learner sees
// "Tutor: {name}" and "Not my tutor" undoes it. Synthetic people; the learner routes are route fulfilments like the rest.
const LEARNER = "00000000-0000-4000-8000-000000000077";
const learnerRow = (claimed: boolean) => ({ membershipId: LEARNER, name: "Synthetic Learner", readings: 2, nearest: { name: "Synthetic reading 1", date: "2026-10-24" },
  tutor: claimed ? { name: "Synthetic Tutor", claimed: true, mine: true } : null, student: null });

test("a tutor's shelf: Your students, then Find a learner by name, Add to my students in one tap, then the learner's shelf and its readings", async ({ page }) => {
  let claimed = false; const posted: string[] = [];
  await session(page, ["tutor"]);
  await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
  await page.route("**/api/students?mode=tutor*", route => json(route, 200, { students: [{ id: "00000000-0000-4000-8000-000000000088", firstName: "Synthetic", lastName: "Student", ceremonyDate: "2999-05-01", revision: 1, rehearsal1: null, rehearsal2: null, serviceSlot: "morning", ownAdultHonors: false }] }));
  await page.route("**/api/students/*/lessons*", route => json(route, 200, { ok: true, studentId: "00000000-0000-4000-8000-000000000088", mode: "tutor", entries: [], nextCursor: null }));
  await page.route("**/api/mine/tutor", route => json(route, 200, { ok: true, tutor: null }));
  await page.route("**/api/learners**", route => {
    if (route.request().method() === "POST") { posted.push(new URL(route.request().url()).pathname); claimed = true; return json(route, 200, { ok: true, learner: LEARNER, created: true }); }
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    return json(route, 200, { ok: true, learners: "synthetic learner".startsWith(q.toLowerCase()) ? [learnerRow(claimed)] : [] });
  });
  await page.route(`**/api/saved/learner/readings?learner=${LEARNER}`, route => json(route, 200, { ok: true, readings: [row(1), row(2)] }));
  await page.goto("/mine");
  const students = page.getByRole("region", { name: "Your students" }), find = page.getByRole("region", { name: "Find a learner" });
  await expect(students).toBeVisible();
  await expect(students.getByRole("link", { name: /Synthetic Student/ })).toHaveAttribute("href", "/workspace/tutor/00000000-0000-4000-8000-000000000088");
  await expect(page.getByTestId("mine-interim-tutor")).toHaveCount(0);
  expect(await students.evaluate(node => node.getBoundingClientRect().top)).toBeLessThan(await find.evaluate(node => node.getBoundingClientRect().top));
  await find.getByRole("searchbox", { name: "Find a learner", exact: true }).fill("Synth");
  const learnerRowLocator = find.getByTestId("learner-row");
  await expect(learnerRowLocator).toHaveCount(1);
  await expect(learnerRowLocator).toContainText("No tutor yet");
  await learnerRowLocator.getByRole("button", { name: "Add to my students: Synthetic Learner", exact: true }).click();
  await expect(find.getByRole("status").filter({ hasText: "Synthetic Learner was added to your students." })).toBeVisible();
  expect(posted).toEqual(["/api/learners/claim"]);
  await expect(learnerRowLocator.getByRole("button", { name: "Add to my students: Synthetic Learner", exact: true })).toBeDisabled();
  await learnerRowLocator.getByRole("link", { name: "Synthetic Learner", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/mine/learner/${LEARNER}$`));
  const shelf = page.getByTestId("learner-shelf");
  await expect(shelf.getByRole("heading", { level: 1, name: "Synthetic Learner", exact: true })).toBeVisible();
  await expect(shelf.getByRole("region", { name: "Also working on" }).getByRole("listitem")).toHaveCount(2);
  await expect(shelf.getByRole("link", { name: /Synthetic reading 1\b/ })).toHaveAttribute("href", `/read?saved=${row(1).id}&learner=${LEARNER}`);
  await expect(shelf.getByRole("button")).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("the learner's shelf says Tutor: name, and Not my tutor removes the claim; a rabbi's assignment has no undo", async ({ page }) => {
  let tutor: { name: string; claimed: boolean } | null = { name: "Synthetic Tutor", claimed: true }; const posted: string[] = [];
  await session(page, []);
  await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [row(1)] }));
  await page.route("**/api/mine/tutor", route => json(route, 200, { ok: true, tutor }));
  await page.route("**/api/mine/tutor/remove", route => { posted.push(route.request().method()); tutor = null; return json(route, 200, { ok: true }); });
  await page.goto("/mine");
  const line = page.getByTestId("mine-tutor");
  await expect(line).toContainText("Tutor: Synthetic Tutor");
  await expect(page.getByTestId("mine-find")).toHaveCount(0); await expect(page.getByTestId("mine-students")).toHaveCount(0);
  await line.getByRole("button", { name: "Not my tutor", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your tutor was removed." })).toBeVisible();
  expect(posted).toEqual(["POST"]);
  await expect(page.getByRole("link", { name: "What the site records about you", exact: true })).toHaveAttribute("href", "/about#accounts");
  tutor = { name: "Synthetic Tutor", claimed: false };
  await page.reload();
  await expect(page.getByTestId("mine-tutor")).toContainText("Tutor: Synthetic Tutor");
  await expect(page.getByRole("button", { name: "Not my tutor", exact: true })).toHaveCount(0);
});

test("signed out, /mine shows the sign-in step under the same bar and asks for no saved readings", async ({ page }) => {
  const saved: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/saved/")) saved.push(new URL(request.url()).pathname); });
  await page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
  await page.goto("/mine");
  await expect(page.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("mine-own")).toHaveCount(0);
  expect(saved).toEqual([]);
});

// Readings for everyone E6, the performance and accessibility gate (spec, Done means): on /mine for the student fixture, layout shift at most 0.07 and the
// slowest interaction at most 80 ms at 4x CPU; and the structure axe checks (one h1, no skipped level, named controls, no repeated id, one main) on all four pages.
test("/mine for a student does not jump while the pinned card arrives (CLS at most 0.07 at 4x CPU) and answers an interaction within 80 ms", async ({ page }) => {
  test.setTimeout(90_000);
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await watchShifts(page);
  // A returning student: this browser remembers being signed in, so the site bar is already the signed-in one (a first visit's bar changing is the bar's, not the shelf's).
  await page.addInitScript(() => { try { window.localStorage.setItem("crc-torah:signed-in/v1", "1"); } catch { /* Storage blocked. */ } });
  await studentMock(page, { practised: ["2026-10-14"], got: [0, 1, 2] });
  await page.goto("/mine");
  await expect(page.getByTestId("pinned-reading")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("pinned-progress")).toContainText(" of ", { timeout: 30_000 });
  await page.waitForTimeout(2000);
  const shifts = await shiftsOf(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(cls(shifts), JSON.stringify(shifts)).toBeLessThanOrEqual(0.07);
  // Interaction to Next Paint: the card's disclosure and the keyboard, the two things a person does on it.
  const { longest, entries } = await longestEvent(page, 4, async () => {
    await page.getByText("Practice calendar", { exact: true }).click();
    await page.getByRole("button", { name: "Next month", exact: true }).first().click().catch(() => undefined);
    for (let step = 0; step < 6; step++) await page.keyboard.press("Tab");
  });
  console.log("MINE longest event (ms) at 4x CPU", Math.round(longest), JSON.stringify(entries.slice(0, 4)));
  expect(longest).toBeLessThanOrEqual(80);
});

for (const [name, address, signedIn] of [["/", "/", false], ["/read", "/read", false], ["/readings", "/readings", false], ["/mine", "/mine", true]] as const) {
  test(`${name} has one h1, no skipped heading level, named controls, no repeated id and one main (what axe checks)`, async ({ page }) => {
    if (signedIn) await studentMock(page, { practised: ["2026-10-14"], got: [0] });
    else await page.route("**/api/session", route => json(route, 401, { error: "unauthenticated" }));
    await page.goto(address);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await structureProblems(page)).toEqual([]);
  });
}
