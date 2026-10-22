import { openAuthMail } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// Tikkun view and printable practice sheet, on synthetic invented syllables only.
// Window.print is never invoked: the Print button is exercised against a stub.
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let calls = 0;
const contexts: BrowserContext[] = [];
const cookies = new Map<"admin" | "student", Awaited<ReturnType<BrowserContext["cookies"]>>>();
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Tikkun UI browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(who: "admin" | "student", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin !== BROWSER_ORIGIN) await route.abort(); else await route.continue(); } catch { await route.abort(); } });
  const signedIn = cookies.get(who); if (signedIn) await context.addCookies(signedIn);
  const tab = await context.newPage(); await navigate(tab, "/"); if (signedIn) return tab;
  const email = who === "student" ? "pg-tikkun-student@example.test" : "pg-admin@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies.set(who, await context.cookies()); return tab;
}
async function loaded(tab: Page, ref: string) { await ui(tab.locator(".study-verses").getByRole("heading", { name: ref, level: 4, exact: true })).toBeVisible({ timeout: 30_000 }); }
const toolbar = (tab: Page) => tab.getByRole("navigation", { name: "Reading tools", exact: true });
// The Tikkun control opens a three-way menu; its accessible name carries the current view.
const tikkunControl = (tab: Page) => toolbar(tab).getByRole("button", { name: /^Tikkun: / });
async function chooseTikkun(tab: Page, view: "Pointed text" | "Side by side" | "Tikkun only") {
  await safe(() => tikkunControl(tab).click());
  await safe(() => toolbar(tab).getByRole("group", { name: "Tikkun view", exact: true }).getByRole("button", { name: view, exact: true }).click());
  await ui(tikkunControl(tab)).toHaveAccessibleName(`Tikkun: ${view}`);
}
/** Each verse row: the tikkun column sits left of the pointed text, top-aligned, both visible. */
async function besideGeometry(tab: Page, ref: string) {
  return tab.locator(`.assigned-study .study-verses [data-verse-ref="${ref}"]`).evaluate(row => {
    const pointed = row.querySelector("[data-hebrew-ref]")!.getBoundingClientRect(), tikkun = row.querySelector("[data-tikkun-ref]")!.getBoundingClientRect();
    return { pointedLeft: pointed.left, tikkunRight: tikkun.right, tikkunLeft: tikkun.left, pointedRight: pointed.right, top: Math.abs(pointed.top - tikkun.top), widths: [pointed.width, tikkun.width] };
  });
}
// Marks are counted by code point inside the page; nothing here writes a raw mark.
const markCount = (nodes: Element[]) => nodes.reduce((total, node) => total + [...(node.textContent ?? "")].filter(char => { const point = char.codePointAt(0)!; return point >= 0x0591 && point <= 0x05c7; }).length, 0);
async function stamGlyphs(tab: Page, selector: string) {
  const cdp = await tab.context().newCDPSession(tab);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const dom = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: dom.root.nodeId, selector });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  await cdp.detach();
  return fonts;
}
async function capture(tab: Page, name: string) {
  if (process.env.CI) return;
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.addStyleTag({ content: "nextjs-portal { display: none !important; }" }));
  await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
}

beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard();
    fixture = await browserFixture({ referenceStudentRelease: false, studyLoad: async request => { calls++; return syntheticUiStudyPage(request, "available"); } });
    const learner = await fixture.signIn("pg-tikkun-student");
    const [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning();
    const [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    const [adminMember] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    for (const [kind, ranges] of [["torah", ["Genesis 1:1-3"]], ["haftarah", ["Isaiah 1:1-2"]]] as const) {
      const [assignment] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind, basis: "custom", ref: ranges.join("; "), status: "confirmed", setByMembershipId: adminMember.id, proposalSnapshot: { ranges: [...ranges], confirmationDate: "2027-01-02", needsReview: false } }).returning();
      await fixture.ownerDb.insert(s.assignmentVerse).values(expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS).map((verseRef, index) => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: assignment.id, ordinal: index + 1, verseRef })));
    }
    stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true });
  } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Tikkun UI setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("shows a remembered consonant-only tikkun column in the STaM face beside Torah, and never for the haftarah", async () => {
  const tab = await page("student"); await navigate(tab, "/workspace/student"); await loaded(tab, "Genesis 1:1");
  const flow = tab.locator(".assigned-study .study-verses");
  await ui(tikkunControl(tab)).toHaveAttribute("aria-pressed", "false");
  expect(await flow.locator("[data-tikkun-ref]").count()).toBe(0);
  await ui(tikkunControl(tab)).toHaveAccessibleName("Tikkun: Pointed text");
  const before = calls;
  await chooseTikkun(tab, "Side by side"); await ui(tikkunControl(tab)).toHaveAttribute("aria-pressed", "true");
  await ui(flow.locator("[data-tikkun-ref]")).toHaveCount(3);
  expect(calls).toBe(before); // A display preference: no text is fetched again.
  await safe(() => tab.evaluate(async () => { await document.fonts.ready; }));
  const cells = await flow.locator("[data-tikkun-ref]").evaluateAll(nodes => nodes.map(node => ({ ref: node.getAttribute("data-tikkun-ref"), font: getComputedStyle(node).fontFamily, hidden: node.getAttribute("aria-hidden"), lang: node.getAttribute("lang"), interactive: node.querySelectorAll("button, [role=button], [tabindex]").length })));
  expect(cells.map(cell => cell.ref)).toEqual(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]);
  for (const cell of cells) { expect(cell.font.startsWith('"CRC Stam Ashkenaz"')).toBe(true); expect(cell.hidden).toBe("true"); expect(cell.lang).toBe("he"); expect(cell.interactive).toBe(0); }
  expect(await flow.locator("[data-tikkun-ref]").evaluateAll(markCount)).toBe(0);
  const fonts = await stamGlyphs(tab, '.assigned-study [data-tikkun-ref="Genesis 1:1"]');
  expect(fonts.some(font => font.isCustomFont && font.familyName === "Stam Ashkenaz CLM" && font.glyphCount > 0)).toBe(true);
  expect(fonts.every(font => font.isCustomFont)).toBe(true);
  // Wide screens keep the pointed, playable text and put the tikkun on its left, verse by verse.
  await ui(flow.locator('[data-verse-ref="Genesis 1:1"] .study-hebrew')).toBeVisible();
  expect(await flow.locator(".study-hebrew").evaluateAll(markCount)).toBeGreaterThan(0);
  const geometry = await besideGeometry(tab, "Genesis 1:2");
  expect(geometry.tikkunRight).toBeLessThanOrEqual(geometry.pointedLeft); expect(geometry.top).toBeLessThan(4);
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Colors are on by default: each colored pointed word has its colored tikkun word, and Colors off clears both.
  const colored = async () => [await flow.locator(".study-hebrew [data-word-index][data-family]").count(), await flow.locator("[data-tikkun-ref] [data-tikkun-word][data-family]").count()];
  const [pointedColored, tikkunColored] = await colored();
  if (pointedColored > 0) expect(tikkunColored).toBeGreaterThan(0);
  const colorsButton = toolbar(tab).getByRole("button", { name: "Colors", exact: true });
  await safe(() => colorsButton.click()); await ui(colorsButton).toHaveAttribute("aria-pressed", "false");
  await ui(flow.locator("[data-family]")).toHaveCount(0);
  await safe(() => colorsButton.click()); await ui(colorsButton).toHaveAttribute("aria-pressed", "true");
  expect(await colored()).toEqual([pointedColored, tikkunColored]);
  await capture(tab, "tikkun-desktop");
  // Remembered like the other reading choices.
  await navigate(tab, "/workspace/student"); await loaded(tab, "Genesis 1:1");
  await ui(tikkunControl(tab)).toHaveAttribute("aria-pressed", "true"); await ui(tikkunControl(tab)).toHaveAccessibleName("Tikkun: Side by side");
  await ui(flow.locator("[data-tikkun-ref]")).toHaveCount(3);
  // A haftarah is read from a book: no control and no scroll lettering.
  await safe(() => tab.getByRole("button", { name: "Haftarah text", exact: true }).click()); await loaded(tab, "Isaiah 1:1");
  await ui(tikkunControl(tab)).toHaveCount(0); expect(await tab.locator("[data-tikkun-ref]").count()).toBe(0);
  await safe(() => tab.getByRole("button", { name: "Torah text", exact: true }).click()); await loaded(tab, "Genesis 1:1");
  await ui(flow.locator("[data-tikkun-ref]")).toHaveCount(3);
});

it("on a phone keeps both columns side by side, or shows the tikkun in place of the pointed text, keeping verse numbers", async () => {
  const tab = await page("student", true); await navigate(tab, "/workspace/student"); await loaded(tab, "Genesis 1:1");
  const flow = tab.locator(".assigned-study .study-verses");
  // Side by side is two columns on a phone too, with no sideways page scroll at 390 or 360 pixels.
  await chooseTikkun(tab, "Side by side");
  await ui(flow).toHaveAttribute("data-tikkun", "beside"); await ui(flow.locator("[data-tikkun-ref]")).toHaveCount(3);
  await ui(flow.locator(".study-hebrew")).toHaveCount(3);
  for (const width of [390, 360]) {
    await safe(() => tab.setViewportSize({ width, height: 844 }));
    for (const ref of ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]) {
      const geometry = await besideGeometry(tab, ref);
      expect(geometry.tikkunRight).toBeLessThanOrEqual(geometry.pointedLeft); expect(geometry.top).toBeLessThan(4);
      expect(geometry.tikkunLeft).toBeGreaterThanOrEqual(0); expect(geometry.pointedRight).toBeLessThanOrEqual(width);
      for (const size of geometry.widths) expect(size).toBeGreaterThan(width / 4);
    }
    expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await safe(() => tab.setViewportSize({ width: 390, height: 844 }));
  await capture(tab, "tikkun-phone-beside");
  await chooseTikkun(tab, "Tikkun only");
  await ui(flow.locator("[data-tikkun-ref]")).toHaveCount(3);
  await ui(flow).toHaveAttribute("data-tikkun", "only");
  expect(await flow.locator(".study-hebrew").count()).toBe(0);
  // The verse number stays (a play button when listening is on, otherwise a plain number).
  await ui(flow.locator('[data-hebrew-ref="Genesis 1:1"] > :is(button, sup)')).toHaveText("1");
  for (const cell of await flow.locator("[data-tikkun-ref]").all()) { await ui(cell).toBeVisible(); expect(await cell.getAttribute("aria-hidden")).toBeNull(); }
  expect(await flow.locator("[data-tikkun-ref]").evaluateAll(markCount)).toBe(0);
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(tab, "tikkun-phone");
  await chooseTikkun(tab, "Pointed text"); await ui(tikkunControl(tab)).toHaveAttribute("aria-pressed", "false");
  await ui(flow.locator("[data-tikkun-ref]")).toHaveCount(0);
  await ui(flow.locator(".study-hebrew").first()).toBeVisible();
  // On a phone the print action sits under the reading, so the first verse stays above the fold.
  const print = tab.getByRole("button", { name: "Print practice sheet", exact: true });
  await ui(print).toHaveCount(1); expect(await print.evaluate(node => node.closest(".study-more") !== null)).toBe(true);
  await safe(() => print.click());
  const dialog = tab.getByRole("dialog", { name: "Practice sheet", exact: true });
  await ui(dialog.locator("li[data-verse-ref]")).toHaveCount(3, { timeout: 30_000 });
  expect(await tab.evaluate(() => { const host = document.querySelector(".practice-sheet-host")!; return host.scrollWidth <= innerWidth; })).toBe(true);
  await capture(tab, "practice-sheet-phone");
  await safe(() => dialog.getByRole("button", { name: "Close practice sheet", exact: true }).click()); await ui(dialog).toHaveCount(0);
});

it("previews a print-only practice sheet with an optional tikkun column and no English, for the student and staff", async () => {
  const tab = await page("student"); await navigate(tab, "/workspace/student"); await loaded(tab, "Genesis 1:1");
  await chooseTikkun(tab, "Side by side"); await ui(tikkunControl(tab)).toHaveAttribute("aria-pressed", "true");
  const opener = tab.getByRole("button", { name: "Print practice sheet", exact: true });
  await safe(() => opener.click());
  const dialog = tab.getByRole("dialog", { name: "Practice sheet", exact: true }); await ui(dialog).toBeVisible();
  const sheet = dialog.locator("[data-practice-sheet-document]"); await ui(sheet).toBeVisible({ timeout: 30_000 });
  await ui(sheet.locator("header")).toContainText("Beit Mitzvah");
  await ui(sheet.locator("h1")).toHaveText(`${fixture.student.firstName} ${fixture.student.lastName}`);
  await ui(sheet.locator("header")).toContainText("Torah · Genesis 1:1\u20133");
  await ui(sheet.locator("li[data-verse-ref]")).toHaveCount(3);
  expect(await sheet.locator(".study-hebrew").evaluateAll(markCount)).toBeGreaterThan(0);
  expect(await sheet.textContent()).not.toContain("Synthetic reference");
  const option = dialog.getByLabel("Include a tikkun column", { exact: true });
  // The remembered Tikkun choice from the reading starts the option on.
  await ui(option).toBeChecked(); await ui(sheet.locator("[data-tikkun-ref]")).toHaveCount(3);
  expect(await sheet.locator("[data-tikkun-ref]").evaluateAll(markCount)).toBe(0);
  await safe(() => option.uncheck()); await ui(sheet.locator("[data-tikkun-ref]")).toHaveCount(0);
  await safe(() => option.check()); await ui(sheet.locator("[data-tikkun-ref]")).toHaveCount(3);
  await capture(tab, "practice-sheet-preview-desktop");
  // Print media: only the paper remains; controls and the workspace are set aside.
  await safe(() => tab.emulateMedia({ media: "print" }));
  const layout = await tab.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".practice-sheet-host")!;
    const others = [...document.body.children].filter(child => child !== host && child instanceof HTMLElement && getComputedStyle(child).display !== "none").map(child => child.tagName);
    const controls = getComputedStyle(host.querySelector("[data-practice-sheet-controls]")!).display;
    const line = host.querySelector("li[data-verse-ref] > div")!, cells = [...line.children].map(child => child.getBoundingClientRect());
    const tikkun = host.querySelector<HTMLElement>("[data-tikkun-ref]")!;
    return { position: getComputedStyle(host).position, page: getComputedStyle(host).getPropertyValue("page"), others, controls, columns: getComputedStyle(line).gridTemplateColumns.split(" ").length,
      ordered: cells[0].left > cells[1].left && cells[1].left > cells[2].left, pointedSize: parseFloat(getComputedStyle(host.querySelector(".study-hebrew")!).fontSize), font: getComputedStyle(tikkun).fontFamily };
  });
  expect(layout.position).toBe("static"); expect(layout.page).toBe("practice-sheet"); expect(layout.others).toEqual([]); expect(layout.controls).toBe("none");
  expect(layout.columns).toBe(3); expect(layout.ordered).toBe(true); expect(layout.pointedSize).toBeGreaterThanOrEqual(28); expect(layout.font.startsWith('"CRC Stam Ashkenaz"')).toBe(true);
  if (!process.env.CI) { const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true }); await safe(() => tab.pdf({ path: join(directory, "practice-sheet-letter.pdf"), format: "Letter" })); }
  await safe(() => tab.emulateMedia({ media: "screen" }));
  // The Print button waits for both faces, then calls the browser's print, stubbed here.
  await safe(() => tab.evaluate(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; }));
  await safe(() => dialog.getByRole("button", { name: "Print", exact: true }).click());
  await ui.poll(() => tab.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await safe(() => dialog.getByRole("button", { name: "Back to reading", exact: true }).click());
  await ui(dialog).toHaveCount(0); await ui(opener).toBeFocused();
  expect(await tab.locator("#workspace-main").evaluate(node => node.closest("[inert]") === null)).toBe(true);
  // Haftarah prints without a tikkun option.
  await safe(() => opener.click()); await ui(dialog.locator("[data-practice-sheet-document]")).toBeVisible({ timeout: 30_000 });
  await safe(() => dialog.getByRole("group", { name: "Reading to print", exact: true }).getByRole("button", { name: "Haftarah", exact: true }).click());
  await ui(dialog.locator("[data-practice-sheet-document] header")).toContainText("Haftarah · Isaiah 1:1\u20132");
  await ui(dialog.getByLabel("Include a tikkun column", { exact: true })).toHaveCount(0); await ui(dialog.locator("[data-tikkun-ref]")).toHaveCount(0);
  await safe(() => tab.keyboard.press("Escape")); await ui(dialog).toHaveCount(0);
  // Staff reach the same sheet from the student's reading page.
  const admin = await page("admin"); await navigate(admin, `/workspace/admin/students/${fixture.student.id}/reading`); await loaded(admin, "Genesis 1:1");
  await safe(() => admin.getByRole("button", { name: "Print practice sheet", exact: true }).click());
  await ui(admin.getByRole("dialog", { name: "Practice sheet", exact: true }).locator("li[data-verse-ref]")).toHaveCount(3, { timeout: 30_000 });
});
