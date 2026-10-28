import type { Page } from "playwright";

// Readings for everyone E2/E3: where the signed-in pages went. A student's reading is /mine/reading, a child's is /mine/child/<id>, the tutor's list is
// Your students on /mine, Service parts and Lessons follow the text on one page, and every staff action is in the Manage sheet. These helpers say each
// move once so a suite names what it wants and not the route.

/** Brings the Service parts or Lessons section into view (they follow the text; there are no tabs to choose). */
export async function toSection(tab: Page, section: "service" | "lessons") {
  // On a student's page the sections are inside "Your plan" at the foot: it is opened first, as a reader would.
  const heading = tab.locator(section === "service" ? "#service-parts" : "#lessons");
  await heading.waitFor({ state: "attached" });
  await tab.locator('[data-testid="reading-loading"]').waitFor({ state: "detached" }).catch(() => undefined);
  // The plan folds once the reading has loaded, so it is opened again until the section stays in view.
  for (let attempt = 0; attempt < 50 && !(await heading.isVisible()); attempt++) {
    if (await heading.evaluate(node => Boolean(node.closest("details[data-reading-plan]:not([open])")))) await openPlan(tab);
    // A parent's page folds Lesson notes and Service parts into rows that open in place: the row is opened, as a reader would.
    else if (await heading.evaluate(node => Boolean(node.closest("details[data-section-fold]:not([open])")))) await heading.evaluate(node => { const fold = node.closest<HTMLDetailsElement>("details[data-section-fold]"); fold?.querySelector<HTMLElement>(":scope > summary")?.click(); });
    else await tab.waitForTimeout(100);
  }
  await heading.scrollIntoViewIfNeeded();
}

/** A student's page (and a parent's sitting with a child) folds the rehearsals, service parts and lesson notes into "Your plan" at the foot: opens it. Nothing elsewhere. */
export async function openPlan(tab: Page) {
  const plan = tab.getByTestId("reading-plan");
  if (await plan.count() && !(await plan.evaluate(node => (node as HTMLDetailsElement).open))) await plan.locator("> summary").click();
}

/** A parent's child page, as the shelf's card opens it. */
export async function openChild(tab: Page, studentId: string) {
  await tab.goto(`/mine/child/${encodeURIComponent(studentId)}`, { waitUntil: "domcontentloaded" });
}

/** A tutor's student page, as the Your students row opens it. */
export async function openStudent(tab: Page, studentId: string) {
  await tab.goto(`/workspace/tutor/${encodeURIComponent(studentId)}`, { waitUntil: "domcontentloaded" });
}

/** The signed-in student's own reading. */
export async function openOwnReading(tab: Page) {
  await tab.goto("/mine/reading", { waitUntil: "domcontentloaded" });
}

/** Opens the Manage sheet (staff) and returns the row with this name. */
export async function manageRow(tab: Page, name: string) {
  await tab.getByRole("button", { name: "Manage", exact: true }).click();
  return tab.getByRole("dialog", { name: "Manage", exact: true }).getByRole("button", { name, exact: true });
}

/** Chooses a Manage row by name: the sheet opens, the row is pressed and the sheet closes behind its action. */
export async function manage(tab: Page, name: string) {
  await (await manageRow(tab, name)).click();
}

/** The verse editor: through Manage's "Change verses", or the "Assign verses" button a reading with nothing assigned keeps. */
export async function openVerseEditor(tab: Page) {
  const assign = tab.getByRole("button", { name: "Assign verses", exact: true });
  if (await assign.count()) await assign.click(); else await manage(tab, "Change verses");
}

/**
 * Asks the reading page to load again. Staff have it in Manage ("Refresh reading"); a learner's page has no such control (Readings for everyone E2), so the
 * page itself is reloaded, which asks for everything again as well.
 */
export async function refreshReading(tab: Page) {
  if (await tab.getByRole("button", { name: "Manage", exact: true }).count()) await manage(tab, "Refresh reading");
  else await tab.reload({ waitUntil: "domcontentloaded" });
}

/** Opens a child from the shelf's card and waits for the child's page, so a button pressed next is the page's own and not the card's. */
export async function goChild(tab: Page, studentId: string) {
  // A child's page has no way to another child (the cards are on the shelf), so from one the shelf comes first.
  if (new URL(tab.url()).pathname !== "/mine") await tab.getByRole("banner").getByRole("link", { name: "My Readings", exact: true }).click();
  await tab.locator(`a[href="/mine/child/${studentId}"]`).click();
  await tab.waitForURL(url => url.pathname === `/mine/child/${studentId}`);
  await openChildReading(tab);
}

/**
 * A parent's child page opens on This week, with the text folded under "See Noa's reading" (parent walk 2026-10-28). The tests that read or tap the text
 * open it as a reader would; a page that never shows the reading (not found, access changed, failed) is left as it is.
 */
export async function openChildReading(tab: Page) {
  await tab.waitForFunction(() => {
    const fold = document.querySelector<HTMLDetailsElement>('[data-testid="parent-reading"]:not([hidden])');
    if (fold) { if (!fold.open) fold.querySelector<HTMLElement>(":scope > summary")?.click(); return true; }
    return Boolean(document.querySelector('[data-testid="student-not-found"], [data-workspace-state]:not([data-workspace-state="checking"])'))
      || [...document.querySelectorAll(".workspace-state h1, .workspace-state h2")].some(node => node.textContent === "Reading unavailable");
  }, undefined, { timeout: 30_000 }).catch(() => undefined);
}
