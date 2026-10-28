import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteBarView } from "../../src/components/site/site-bar";
import { AccountView } from "../../src/components/portal/account-page";
import type { Role, SessionSummary } from "../../src/components/portal/api";

const bar = (props: Partial<Parameters<typeof SiteBarView>[0]> = {}) => renderToStaticMarkup(createElement(SiteBarView, { signedIn: true, pathname: "/mine", ...props }));
const account = (roles: Role[]) => {
  const summary: SessionSummary = { membershipAvailable: true, roles, saved: true, approver: false, sessionBinding: "A".repeat(43) };
  return renderToStaticMarkup(createElement(AccountView, { summary, current: roles[0] ?? null, signingOut: false, problem: "", onRole: () => {}, onSignOut: () => {} }));
};

test("signed in, the site row carries the Account button to /account on a shelf page and a workspace page", () => {
  for (const pathname of ["/mine", "/workspace/tutor", "/readings"]) {
    const markup = bar({ pathname });
    expect(markup, pathname).toMatch(/<a [^>]*data-testid="account-button"[^>]*href="\/account"[^>]*aria-label="Account"/);
    expect(markup, pathname).not.toMatch(/data-testid="account-button"[^>]*aria-current/);
  }
});
test("on /account the button is the current page", () => {
  expect(bar({ pathname: "/account" })).toMatch(/data-testid="account-button"[^>]*aria-current="page"/);
});
test("signed out and in the minimal (print and shelf) bar there is no Account button", () => {
  expect(bar({ signedIn: false })).not.toContain("account-button");
  expect(bar({ mode: "minimal", pathname: "/print" })).not.toContain("account-button");
});
test("only an admin sees the Congregation settings row, which goes to the admin settings", () => {
  expect(account(["admin"])).toMatch(/href="\/workspace\/admin\/settings"[^>]*>.*Congregation settings/s);
  for (const roles of [["tutor"], ["parent"], ["student"]] as Role[][]) expect(account(roles)).not.toContain("Congregation settings");
});
