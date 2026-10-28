import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "../../src/app/layout";
import Home from "../../src/app/page";
import AccountPage from "../../src/app/account/page";
import SignInPage, { generateMetadata as signInMetadata } from "../../src/app/sign-in/page";
import AcceptInvitationPage from "../../src/app/invitations/accept/page";
import ConnectPage from "../../src/app/connect/page";
import Unsubscribe from "../../src/app/unsubscribe/page";
import { removeLabel, removeText } from "../../src/components/portal/workspace/relationships/workspace";
import { signedInTitle } from "../../src/lib/site/signed-in-title";

const APP = join(process.cwd(), "src", "app");
function pages(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? pages(path) : entry === "page.tsx" ? [path] : [];
  });
}
// The signed-in surface: the workspace, and the account, connect, invitation and sign-in pages. Public pages
// (home, /read, /learn, /trope-chart, /print, /offline) carry their own titles through the product name.
const SIGNED_IN = pages(APP).map(path => relative(APP, path).split(sep).join("/"))
  // The portal group (My Readings and the workspace) adds no segment to an address; a page that only redirects is never seen, so it carries no title.
  .filter(path => !readFileSync(join(APP, path), "utf8").includes("redirect("))
  .filter(path => path.startsWith("(portal)/workspace/") || path.startsWith("(portal)/mine/") || ["account/page.tsx", "connect/page.tsx", "invitations/accept/page.tsx", "sign-in/page.tsx", "unsubscribe/page.tsx"].includes(path)).sort();

test("every signed-in page sets its own title, ending with | CRC Torah", async () => {
  expect(SIGNED_IN.length).toBeGreaterThanOrEqual(20);
  const seen = new Map<string, string>();
  const named: string[] = [];
  for (const file of SIGNED_IN) {
    const module = await import(/* @vite-ignore */ `../../src/app/${file.replace(/\.tsx$/, "")}`);
    const metadata = typeof module.generateMetadata === "function" ? await module.generateMetadata({ searchParams: Promise.resolve({}) }) : module.metadata;
    const title = metadata?.title;
    expect(typeof title, file).toBe("string");
    expect(title as string, file).toMatch(/^\S.* \| CRC Torah$/);
    // A student's own page is titled by the student's name in the browser; before that, tutor and admin share "Student".
    const shared = /^\(portal\)\/workspace\/(tutor\/\[studentId\]|admin\/students\/\[studentId\]\/reading)\/page\.tsx$/.test(file);
    if (shared) named.push(title as string);
    else expect(seen.get(title as string), `${file} repeats ${seen.get(title as string)}`).toBeUndefined();
    seen.set(title as string, file);
  }
  expect(named).toEqual(["Student | CRC Torah", "Student | CRC Torah"]);
  expect(signedInTitle("Students")).toBe("Students | CRC Torah");
  expect(await signInMetadata({ searchParams: Promise.resolve({}) })).toMatchObject({ title: "Sign in | CRC Torah" });
});

test("a page whose h1 is fixed is titled with that h1", () => {
  const source = (file: string) => readFileSync(join(process.cwd(), "src", file), "utf8");
  // A page's h1 is a literal <h1> or the one PageHeader's title (its first literal when the title is chosen by role).
  const headings = (file: string) => [...[...source(file).matchAll(/<h1[^>]*>([^<{]+)<\/h1>/g)].map(match => match[1]),
    ...[...source(file).matchAll(/<PageHeader title=(?:"([^"]+)"|\{[^"}]*"([^"]+)")/g)].map(match => match[1] ?? match[2])];
  const titleOf = (file: string) => /signedInTitle\("([^"]+)"\)/.exec(source(file))?.[1];
  for (const [component, page] of [
    ["components/portal/workspace/accounts/workspace.tsx", "app/(portal)/workspace/accounts/page.tsx"],
    ["components/portal/workspace/connections/workspace.tsx", "app/(portal)/workspace/claude/page.tsx"],
    ["components/portal/workspace/email/workspace.tsx", "app/(portal)/workspace/email/page.tsx"],
    ["components/portal/workspace/invitations/workspace.tsx", "app/(portal)/workspace/admin/invitations/page.tsx"],
    ["components/portal/workspace/reference-review/workspace.tsx", "app/(portal)/workspace/admin/reference-review/page.tsx"],
    ["components/portal/workspace/settings/workspace.tsx", "app/(portal)/workspace/admin/settings/page.tsx"],
    ["components/portal/workspace/csv-import/workspace.tsx", "app/(portal)/workspace/admin/students/import/page.tsx"],
    ["components/portal/workspace/roster.tsx", "app/(portal)/workspace/admin/students/page.tsx"],
    ["components/portal/connect.tsx", "app/connect/page.tsx"],
  ] as const) expect(headings(component), page).toContain(titleOf(page));
});

test("each page has exactly one footer landmark: the site footer, with no second page footer", async () => {
  const page = async (element: unknown) => renderToStaticMarkup(createElement(RootLayout, null, await element as never));
  const boundary = Promise.resolve({});
  const markups = [
    await page(Home({ searchParams: boundary })), await page(AccountPage()), await page(SignInPage({ searchParams: boundary })),
    await page(AcceptInvitationPage()), await page(ConnectPage()), await page(Unsubscribe()),
  ];
  for (const markup of markups) {
    expect(markup.match(/<footer\b/g) ?? []).toHaveLength(1);
    expect(markup).toContain('<footer class="site-footer">');
    expect(markup).toContain("Central Reform Congregation · <a href=\"/about\">About</a> · Your account stays private.");
    expect(markup).toContain('A project of <a href="https://danielbogard.com"');
    expect(markup).not.toContain("portal-footer");
    expect(markup).not.toContain("Learning at Central Reform Congregation");
  }
  // The workspace shell is client-only; its source must not bring a second footer either.
  expect(readFileSync(join(process.cwd(), "src", "components", "portal", "workspace", "provider.tsx"), "utf8")).not.toMatch(/<footer\b/);
});

test("a roster button's accessible name begins with its visible words", () => {
  expect(removeText("Noa")).toBe("Remove from Noa");
  expect(removeLabel("Noa", "Tamar Levin")).toBe("Remove from Noa: Tamar Levin");
  expect(removeLabel("Noa", "Tamar Levin").startsWith(removeText("Noa"))).toBe(true);
});
