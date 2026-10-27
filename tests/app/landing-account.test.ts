import { afterAll, describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { signedInDestination } from "../../src/components/portal/entry";
import { FrontDoor, signedInDoor } from "../../src/components/portal/front-door/front-door";
import { AccountView } from "../../src/components/portal/account-page";
import { homeRole, rolePaths, workspaceDestination } from "../../src/components/portal/shell/role-home";
import { rememberedRole, rememberRole } from "../../src/components/portal/shell/role-memory";
import type { Role, SessionSummary } from "../../src/components/portal/api";

const summary = (roles: Role[], extra: Partial<SessionSummary> = {}): SessionSummary => ({ membershipAvailable: roles.length > 0, roles, saved: roles.length > 0, approver: false, sessionBinding: "A".repeat(43), ...extra });
type Pinned = NonNullable<NonNullable<Parameters<typeof signedInDoor>[1]>["pinned"]>;
const door = (roles: Role[] | "signed-out" | "loading", count: number | null = null, pinned: Pinned | null = null) => {
  const account = roles === "loading" ? null : roles === "signed-out" ? { kind: "sign-in" } as const : { kind: "account", saved: roles.length > 0, roles, count, pinned } as const;
  const markup = renderToStaticMarkup(createElement(FrontDoor, { account, children: createElement("p", null, "Synthetic task") }));
  const start = markup.lastIndexOf("<section", markup.indexOf('data-door="beit-mitzvah"'));
  return markup.slice(start, markup.indexOf("</section>", start));
};
afterAll(() => { rememberRole("student"); });

describe("the landing role rule: the remembered role, else the highest of admin, tutor, parent, student", () => {
  test("with nothing remembered the highest role leads", () => {
    expect(homeRole(["student", "parent", "tutor", "admin"], null)).toBe("admin");
    expect(homeRole(["student", "parent"], null)).toBe("parent");
    expect(homeRole(["student", "tutor"], null)).toBe("tutor");
    expect(homeRole(["student"], null)).toBe("student");
    expect(homeRole([], null)).toBeNull();
  });
  test("the role last in wins when the account still has it, and is ignored when it does not", () => {
    expect(homeRole(["student", "tutor"], "student")).toBe("student");
    expect(homeRole(["parent", "admin"], "parent")).toBe("parent");
    expect(homeRole(["parent", "admin"], "student")).toBe("admin");
    expect(homeRole([], "admin")).toBeNull();
  });
  test("/workspace leads to My Readings, and an admin to This week", () => {
    expect(workspaceDestination(["student", "tutor"], null)).toBe("/mine");
    expect(workspaceDestination(["student", "tutor"], "student")).toBe("/mine");
    expect(workspaceDestination(["admin"], null)).toBe("/workspace/admin/students");
    expect(workspaceDestination([], "parent")).toBe("/mine");
    expect(workspaceDestination(["admin", "tutor"], "tutor")).toBe("/workspace/admin/students");
  });
  test("the page memory is per page load: nothing is written to the device", () => {
    rememberRole("tutor");
    expect(rememberedRole()).toBe("tutor");
  });
});

describe("the root never leaves for the workspace", () => {
  test("on the front door a signed-in person stays, whatever the return address", () => {
    for (const back of [null, "/read", "/account", "/"]) expect(signedInDestination(true, back)).toBeNull();
  });
  test("only the sign-in form leaves: back to the page the person left, else My Readings", () => {
    expect(signedInDestination(false, "/read?date=2026-10-31")).toBe("/read?date=2026-10-31");
    expect(signedInDestination(false, "/account")).toBe("/account");
    expect(signedInDestination(false, null)).toBe("/mine");
  });
});

describe("the signed-in door", () => {
  test("every role but the admin has Your readings, opening My Readings; the admin keeps This week", () => {
    for (const role of ["student", "parent", "tutor"] as const) expect(signedInDoor(role)).toEqual({ title: "Your readings", line: null, action: "Open My Readings" });
    expect(signedInDoor("admin")).toEqual({ title: "This week", line: "Needs you, ceremonies and rehearsals.", action: "Open This week" });
  });
  test("the line is the pinned reading when there is one, else how many are saved, else nothing", () => {
    expect(signedInDoor("student", { pinned: { name: "Noa", ceremony: "2027-05-01", done: 3, total: 12 } }).line).toBe("Noa · Beit Mitzvah, Sat, May 1, 2027 · 3 of 12 verses");
    expect(signedInDoor("tutor", { count: 3 }).line).toBe("3 saved");
    expect(signedInDoor("tutor", { count: 0 }).line).toBeNull();
    expect(signedInDoor("parent", { count: null }).line).toBeNull();
  });
  test("it leads the home, under the hero, once a reading is kept or pinned, and otherwise sits beside Learn", () => {
    const place = (account: Parameters<typeof FrontDoor>[0]["account"]) => /data-door-place="(\w+)"/.exec(renderToStaticMarkup(createElement(FrontDoor, { account, children: null })))![1];
    expect(place({ kind: "account", saved: true, roles: ["tutor"], count: 3, pinned: null })).toBe("hero");
    expect(place({ kind: "account", saved: true, roles: ["student"], count: 0, pinned: { name: "Noa", ceremony: "2027-05-01", done: 0, total: 4 } })).toBe("hero");
    expect(place({ kind: "account", saved: true, roles: ["tutor"], count: 0, pinned: null })).toBe("doors");
    expect(place({ kind: "sign-in" })).toBe("doors");
    const markup = renderToStaticMarkup(createElement(FrontDoor, { account: { kind: "account", saved: true, roles: ["tutor"], count: 3, pinned: null }, children: null }));
    expect(markup.indexOf('id="this-week-title"')).toBeLessThan(markup.indexOf('data-door="beit-mitzvah"'));
    expect(markup.indexOf('data-door="beit-mitzvah"')).toBeLessThan(markup.indexOf('data-door="learn"'));
  });
  test("it replaces the Beit Mitzvah door, leads with the role's home, and is not a second lake pill", () => {
    rememberRole("student");
    const student = door(["student"]);
    expect(student).toContain(">Your readings</h2>");
    expect(student).toMatch(/href="\/mine"[^>]*>Open My Readings<\/a>/);
    expect(student).not.toContain(">Beit Mitzvah</h2>");
    expect(student).not.toContain("button-start");
    // No remembered role among these: the highest leads.
    const both = door(["parent", "admin"]);
    expect(both).toContain(">This week</h2>");
    expect(both).toMatch(/href="\/workspace\/admin\/students"[^>]*>Open This week<\/a>/);
    expect(both).not.toContain("Sign in");
    // The role last in leads: a parent who is also an admin, last in as a parent, gets the readings door.
    rememberRole("parent");
    expect(door(["parent", "admin"])).toContain(">Your readings</h2>");
    expect(door(["parent", "admin"])).not.toContain("<p class=\"_doorLine");
    rememberRole("student");
  });
  test("an account with no role keeps the request and Sign out in the door", () => {
    const none = door([]);
    expect(none).toContain(">Beit Mitzvah</h2>");
    expect(none).toContain("Synthetic task");
    expect(none).not.toContain("Open My Readings");
  });
});

describe("the signed-out door and the page's one lake pill", () => {
  test("Sign in goes to /sign-in, How accounts work to About, Ask for an account is gone, and the form is not here", () => {
    const out = door("signed-out");
    expect(out).toContain(">Your readings</h2>");
    expect(out).toMatch(/href="\/sign-in"[^>]*>Sign in<\/a>/);
    expect(out).toContain('href="/about#accounts">How accounts work</a>');
    expect(out).not.toContain("Ask for an account");
    for (const form of ["<form", "Continue with Google", "name=\"email\"", "Synthetic task"]) expect(out).not.toContain(form);
  });
  test("while access is checked the door says so and keeps its height", () => {
    const wait = door("loading");
    expect(wait).toContain('data-door-state="loading"');
    expect(wait).toContain('aria-busy="true"');
  });
  test("Lein is the only lake pill on the page; the Learn door's Start is the white secondary pill", () => {
    for (const account of [null, { kind: "sign-in" } as const, { kind: "account", saved: true, roles: ["tutor"], count: null, pinned: null } as const]) {
      const markup = renderToStaticMarkup(createElement(FrontDoor, { account, children: null }));
      expect(markup.match(/button-start/g)).toHaveLength(1);
      expect(markup).toContain('<a class="button-start" href="/read">Lein</a>');
      expect(markup).toMatch(/class="button-hero-secondary[^"]*"[^>]*href="\/learn"[^>]*>Start<\/a>/);
    }
  });
});

describe("Account is a list: who is signed in, Roles with the current one marked, the account's rows, then Sign out", () => {
  const view = (roles: Role[], current: Role | null, extra: Partial<SessionSummary> = {}) => renderToStaticMarkup(createElement(AccountView, { summary: summary(roles, extra), current, signingOut: false, problem: "", onRole: () => undefined, onSignOut: () => undefined }));
  test("one row per role, each to its home, the current one marked", () => {
    const markup = view(["student", "tutor"], "tutor");
    expect(markup).toContain(">Account</h1>");
    for (const [name, path] of [["Student", "/mine"], ["Tutor", "/mine"]]) expect(markup).toContain(`href="${path}"`), expect(markup).toContain(`>${name}</span>`);
    expect(markup.match(/>Current</g)).toHaveLength(1);
    expect(markup.indexOf(">Current<")).toBeGreaterThan(markup.indexOf(">Tutor</span>"));
    expect(markup.indexOf(">Roles</h2>")).toBeLessThan(markup.indexOf(">Email settings<"));
    expect(markup.indexOf(">Email settings<")).toBeLessThan(markup.indexOf(">Sign out</button>"));
  });
  test("Claude connections are for staff and Account requests for approvers; a student gets the help link, a parent neither", () => {
    expect(view(["tutor"], "tutor")).toContain(">Claude connections<");
    expect(view(["admin"], "admin", { approver: true })).toContain(">Account requests<");
    const student = view(["student"], "student");
    expect(student).not.toContain(">Claude connections<");
    expect(student).not.toContain(">Account requests<");
    expect(student).toMatch(/href="https:\/\/www\.centralreform\.org\/beit-mitzvah\/"[^>]*target="_blank"[^>]*>.*Need help\?/);
    expect(view(["parent"], "parent")).not.toContain("Need help?");
  });
  test("an account with no role asks for one here; a role's account does not unless it has no saved layer", () => {
    expect(view([], null)).toContain("account-request");
    expect(view(["tutor"], "tutor")).not.toContain("account-request");
  });
});

// The one deliberate wording test for the landing doors and the one for Account: the visible words, in order.
const words = (markup: string) => markup.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "|").split("|").map(part => part.replace(/&#x27;/g, "'").trim()).filter(Boolean);
describe("wording", () => {
  test("the landing doors", () => {
    const out = "Save the readings you’re working on, mark verses, keep notes. Beit Mitzvah students and families find their assigned reading and tutor here too.";
    expect(words(door("signed-out"))).toEqual(["Your readings", out, "Sign in", "How accounts work"]);
    expect(words(door("loading"))).toEqual(["Your readings", out, "One moment while we check your access."]);
    rememberRole("tutor");
    expect(words(door(["tutor", "student"]))).toEqual(["Your readings", "Open My Readings"]);
    expect(words(door(["tutor"], 3))).toEqual(["Your readings", "3 saved", "Open My Readings"]);
    rememberRole("student");
    expect(words(door(["student"], null, { name: "Noa", ceremony: "2027-05-01", done: 3, total: 12 }))).toEqual(["Your readings", "Noa · Beit Mitzvah, Sat, May 1, 2027 · 3 of 12 verses", "Open My Readings"]);
    expect(words(door(["parent"]))).toEqual(["Your readings", "Open My Readings"]);
    rememberRole("admin");
    expect(words(door(["admin"]))).toEqual(["This week", "Needs you, ceremonies and rehearsals.", "Open This week"]);
    rememberRole("student");
    const learn = renderToStaticMarkup(createElement(FrontDoor, { account: null, children: null }));
    expect(words(learn.slice(learn.indexOf('<h2 id="learn-title"')))).toEqual(["Learn to lein", "Hear the phrases, then lein a verse of this week's reading.", "Start", "Trope chart"]);
  });
  test("Account", () => {
    const markup = renderToStaticMarkup(createElement(AccountView, { summary: summary(["tutor"], { approver: true }), current: "tutor", signingOut: false, problem: "", onRole: () => undefined, onSignOut: () => undefined }));
    expect(words(markup)).toEqual(["Account", "You’re signed in", "Roles", "Tutor", "the students you teach", "Current", "Email settings", "choose which portal emails you get",
      "Claude connections", "see and end Claude’s access to the portal", "Account requests", "approve accounts for people who ask",
      "Signing out removes your private reading and notes from this device’s screen. Use it on a shared phone or computer.", "Sign out"]);
  });
});
