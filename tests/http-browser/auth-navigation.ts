import type { Page } from "playwright";

// Synthetic mail only. Production links require the same explicit user action.
export async function openAuthMail(tab: Page, link: string) {
  try {
    const path = new URL(link).pathname;
    await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const label = path === "/auth/email" ? "Continue signing in" : "Review invitation";
    await Promise.all([
      tab.waitForURL(url => url.pathname !== path, { waitUntil: "domcontentloaded", timeout: 30_000 }),
      tab.getByRole("button", { name: label, exact: true }).click(),
    ]);
  } catch { throw new Error("Synthetic mail confirmation failed; details withheld"); }
}

/** Roles are switched on the Account page's Roles list (the old role pills are gone): open Account from the header, then choose the role. */
export async function switchRole(tab: Page, role: "Parent" | "Tutor" | "Student") {
  await tab.getByRole("banner").getByRole("link", { name: "Account", exact: true }).click();
  await tab.getByRole("list", { name: "Roles" }).getByRole("link", { name: new RegExp(`^${role}`) }).click();
}
