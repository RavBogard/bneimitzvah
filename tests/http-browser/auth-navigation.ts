import type { Locator, Page } from "playwright";

// Synthetic mail only. Production links require the same explicit user action.
// The confirm button on both landing pages (sign-in link and invitation link) carries one test ID, so the helper never reads its label.
export async function openAuthMail(tab: Page, link: string) {
  try {
    const path = new URL(link).pathname;
    await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await Promise.all([
      tab.waitForURL(url => url.pathname !== path, { waitUntil: "domcontentloaded", timeout: 30_000 }),
      tab.getByTestId("auth-landing-continue").click(),
    ]);
  } catch { throw new Error("Synthetic mail confirmation failed; details withheld"); }
}

/** The entry task (sign-in, code, invitation review and the states after it), found by its state rather than by its heading. */
export type EntryState = "loading" | "unavailable" | "sign-in" | "signed-in" | "invitation" | "accepted" | "invalid-invitation" | "uncertain" | "forbidden";
export function entryTask(tab: Page, state: EntryState, step?: "address" | "code"): Locator {
  return tab.locator(`[data-testid="entry-task"][data-entry-state="${state}"]${step ? `[data-entry-step="${step}"]` : ""}`);
}

/**
 * Roles are reached from My Readings (Readings for everyone E2, E3): open it from the header, then go the way the shelf goes. A student's pinned card opens
 * /mine/reading; a parent's card for a child opens /mine/child/<id>; a tutor's Your students row opens /workspace/tutor/<id>. With no `studentId` a parent or
 * tutor stays on the shelf, where the cards and rows are.
 */
export async function switchRole(tab: Page, role: "Parent" | "Tutor" | "Student", studentId?: string) {
  await tab.getByRole("banner").getByRole("link", { name: "My Readings", exact: true }).click();
  if (role === "Tutor") { await tab.getByTestId("mine-students").waitFor(); if (studentId) await tab.locator(`a[href="/workspace/tutor/${studentId}"]`).click(); return; }
  if (role === "Parent") { await tab.getByTestId("mine-children").waitFor(); if (studentId) await tab.locator(`a[href="/mine/child/${studentId}"]`).click(); return; }
  await tab.locator('a[href="/mine/reading"]').first().click();
}
