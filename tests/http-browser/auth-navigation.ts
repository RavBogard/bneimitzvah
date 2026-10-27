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

/** Roles are switched on the Account page's Roles list (the old role pills are gone): open Account from the header, then choose the role by its route. */
export async function switchRole(tab: Page, role: "Parent" | "Tutor" | "Student") {
  await tab.getByRole("banner").getByRole("link", { name: "Account", exact: true }).click();
  await tab.getByTestId("account-roles").locator(`a[href="/workspace/${role.toLowerCase()}"]`).click();
}
