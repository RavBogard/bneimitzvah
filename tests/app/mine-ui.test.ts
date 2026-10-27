import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseSavedReading } from "../../src/components/portal/saved/api";
import { OwnReadingsView, OWN_READINGS_FIRST, savedReadingHref } from "../../src/components/portal/mine/own-readings";
import { EMPTY_LINE, shelfModel, sortOwnReadings, type OwnReadingsState } from "../../src/components/portal/mine/model";
import { AccountSection, EmptyShelf, LearnSection, PinnedSection, Shelf, ShelfFoot, SHELF_STRINGS } from "../../src/components/portal/mine/shelf";
import type { SessionSummary } from "../../src/components/portal/api";

// The shelf's session comes from the workspace; a static render has none, so the one hook is answered here.
const summary: SessionSummary = { membershipAvailable: true, roles: [], saved: true, approver: false, sessionBinding: "A".repeat(43) };
vi.mock("../../src/components/portal/workspace/provider", () => ({ useWorkspace: () => ({ summary }) }));

// Synthetic readings only: invented names, real verse references.
const row = (index: number, extra: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Reading ${index}`, date: "2026-10-17",
  kind: "torah", ranges: "Genesis 1:1-2:3", verseCount: 34, revision: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z", ...extra });
const reading = (index: number, extra: Record<string, unknown> = {}) => parseSavedReading(row(index, extra))!;
const learn = { meta: "Start the course" } as const;
const model = (own: OwnReadingsState, pinned = null as Parameters<typeof shelfModel>[0]["pinned"]) => shelfModel({ summary, own, pinned, learn });
const view = (state: OwnReadingsState, expanded = false) => renderToStaticMarkup(createElement(OwnReadingsView, { state, expanded, listId: "mine", onExpand: () => {}, onRetry: () => {} }));

describe("the shelf's model", () => {
  it("is empty only once nothing is kept and nothing is pinned, and says so only where saving is open", () => {
    expect(model({ status: "ready", readings: [] }).empty).toEqual({ line: EMPTY_LINE });
    expect(model({ status: "hidden" }).empty).toEqual({ line: null });
    expect(model({ status: "loading" }).empty).toBeNull();
    expect(model({ status: "failed" }).empty).toBeNull();
    expect(model({ status: "ready", readings: [reading(1)] }).empty).toBeNull();
    expect(model({ status: "hidden" }, { name: "Noa", ceremony: null, done: 0, total: 0, href: "/mine/reading" }).empty).toBeNull();
  });
  it("orders the sections: pinned, also working on, Learn, Account", () => {
    const pinned = { name: "Noa", ceremony: null, done: 1, total: 4, href: "/mine/reading" };
    expect(model({ status: "ready", readings: [reading(1)] }, pinned).sections).toEqual(["pinned", "own", "learn", "account"]);
    expect(model({ status: "ready", readings: [] }).sections).toEqual(["learn", "account"]);
    expect(model({ status: "loading" }).sections).toEqual(["own", "learn", "account"]);
  });
  it("sorts dated readings earliest first and undated ones last, keeping the server's order among them", () => {
    const sorted = sortOwnReadings([reading(1, { date: null }), reading(2, { date: "2026-12-05" }), reading(3, { date: "2026-10-31" }), reading(4, { date: null })]);
    expect(sorted.map(item => item.name)).toEqual(["Reading 3", "Reading 2", "Reading 1", "Reading 4"]);
  });
});

describe("Also working on", () => {
  it("lists readings in date order, the undated one last, each opening the reading", () => {
    const some = view({ status: "ready", readings: [reading(1, { date: null }), reading(2, { date: "2026-12-05" }), reading(3, { date: "2026-10-31" })] });
    expect(some.match(/<li>/g)).toHaveLength(3);
    expect(some.indexOf("Reading 3")).toBeLessThan(some.indexOf("Reading 2"));
    expect(some.indexOf("Reading 2")).toBeLessThan(some.indexOf("Reading 1"));
    expect(some).toContain(`href="${savedReadingHref(row(1).id)}"`);
    expect(savedReadingHref(row(1).id)).toBe(`/read?saved=${row(1).id}`);
    expect(some).toContain('data-testid="mine-own"');
    expect(some).toContain("No date");
    expect(some).not.toContain("All my readings");
  });
  it("shows five, and the rest inline on request", () => {
    const readings = Array.from({ length: 7 }, (_, i) => reading(i + 1));
    expect(view({ status: "ready", readings }).match(/<li>/g)).toHaveLength(OWN_READINGS_FIRST);
    expect(view({ status: "ready", readings }, true).match(/<li>/g)).toHaveLength(7);
    expect(view({ status: "ready", readings })).toContain('aria-expanded="false"');
  });
  it("says plainly when it is loading or fails, and is not there when refused", () => {
    expect(view({ status: "loading" })).toContain('aria-busy="true"');
    expect(view({ status: "failed" })).toContain(">Try again</button>");
    expect(view({ status: "hidden" })).toBe("");
  });
});

describe("the shelf's sections", () => {
  it("the empty state offers the two chips, and the linking card only to an account with no role", () => {
    const plain = renderToStaticMarkup(createElement(EmptyShelf, { line: EMPTY_LINE, linkable: false }));
    expect(plain).toContain('href="/read"');
    expect(plain).toContain('href="/readings"');
    expect(plain).not.toContain("shelf-link-title");
    expect(renderToStaticMarkup(createElement(EmptyShelf, { line: null, linkable: true }))).toContain("shelf-link-title");
    expect(renderToStaticMarkup(createElement(EmptyShelf, { line: null, linkable: false }))).not.toContain(EMPTY_LINE);
  });
  it("the Learn row opens Learn, the pinned card opens the pinned reading, and Account is a plain link", () => {
    expect(renderToStaticMarkup(createElement(LearnSection, { learn }))).toContain('href="/learn"');
    expect(renderToStaticMarkup(createElement(PinnedSection, { pinned: { name: "Noa", ceremony: "Beit Mitzvah, Sat, May 1, 2027", done: 2, total: 9, href: "/mine/reading" }, roles: [] }))).toContain('href="/mine/reading"');
    expect(renderToStaticMarkup(createElement(AccountSection))).toMatch(/<a href="\/account"[^>]*>Account<\/a>/);
  });
  it("interim: a student and a parent each get a row to their Beit Mitzvah pages; the tutor's row is gone, Your students and Find a learner take its place (plan D7)", () => {
    const markup = renderToStaticMarkup(createElement(PinnedSection, { pinned: null, roles: ["student", "parent", "tutor", "admin"] }));
    for (const [role, href] of [["student", "/workspace/student"], ["parent", "/workspace/parent"]]) {
      expect(markup).toContain(`data-testid="mine-interim-${role}"`);
      expect(markup).toContain(`href="${href}"`);
    }
    expect(markup).not.toContain("mine-interim-tutor");
    expect(renderToStaticMarkup(createElement(PinnedSection, { pinned: null, roles: ["admin", "tutor"] }))).not.toContain("mine-interim");
    expect(model({ status: "ready", readings: [] }).sections).toEqual(["learn", "account"]);
    const sections = (roles: SessionSummary["roles"], own: OwnReadingsState = { status: "hidden" }) => shelfModel({ summary: { ...summary, roles }, own, pinned: null, learn }).sections;
    // A tutor: Your students, then Find a learner, then the rest; an admin who is not a tutor: Find a learner alone; a parent or student: neither.
    expect(sections(["tutor"])).toEqual(["students", "find", "learn", "account"]);
    expect(sections(["tutor", "parent"], { status: "ready", readings: [reading(1)] })).toEqual(["students", "find", "pinned", "own", "learn", "account"]);
    expect(sections(["admin"])).toEqual(["find", "learn", "account"]);
    expect(sections(["parent"])).toEqual(["pinned", "learn", "account"]);
    expect(sections(["student"])).toEqual(["pinned", "learn", "account"]);
  });
  it("the page has exactly one h1 and a link named Account", () => {
    const markup = renderToStaticMarkup(createElement(Shelf));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<a href="\/account"[^>]*>Account<\/a>/);
    expect(markup).toContain('href="/readings?add=1"');
  });
  it("wording: the title, the empty line and the foot line", () => {
    expect(renderToStaticMarkup(createElement(Shelf))).toContain(">My Readings</h1>");
    expect(EMPTY_LINE).toBe("You’re signed in. Nothing is saved yet.");
    expect(renderToStaticMarkup(createElement(ShelfFoot))).toContain("Your tutor and the rabbi can see the readings you keep.");
    // Plan D8: the foot line ends in the way to what the site records.
    expect(renderToStaticMarkup(createElement(ShelfFoot))).toContain(`<a href="/about#accounts">${SHELF_STRINGS.records}</a>`);
    expect(SHELF_STRINGS.records).toBe("What the site records about you");
  });
});
