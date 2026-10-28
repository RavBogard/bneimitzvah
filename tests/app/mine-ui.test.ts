import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseSavedReading } from "../../src/components/portal/saved/api";
import { OwnReadingsView, OWN_READINGS_FIRST, savedReadingHref } from "../../src/components/portal/mine/own-readings";
import { EMPTY_LINE, shelfModel, sortOwnReadings, type OwnReadingsState } from "../../src/components/portal/mine/model";
import { AccountSection, EmptyShelf, LearnSection, PinnedSection, Shelf, ShelfFoot, SHELF_STRINGS } from "../../src/components/portal/mine/shelf";
import type { SessionSummary } from "../../src/components/portal/api";
import { gotCount, pinnedOf, type TodaySlices } from "../../src/components/portal/workspace/today/today";
import { childCard, ChildrenView, daysWord, orderChildren } from "../../src/components/portal/mine/children";

// The shelf's session comes from the workspace; a static render has none, so the one hook is answered here.
const summary: SessionSummary = { membershipAvailable: true, roles: [], saved: true, approver: false, sessionBinding: "A".repeat(43) };
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/provider", async original => ({ ...await original<Record<string, unknown>>(), useWorkspace: () => ({ summary }) }));

// Synthetic readings only: invented names, real verse references.
const row = (index: number, extra: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Reading ${index}`, date: "2026-10-17",
  kind: "torah", ranges: "Genesis 1:1-2:3", verseCount: 34, revision: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z", ...extra });
const reading = (index: number, extra: Record<string, unknown> = {}) => parseSavedReading(row(index, extra))!;
const learn = { meta: "Start the course" } as const;
const SID = "00000000-0000-4000-8000-0000000000a1";
const torah = (verses: string[]) => ({ id: "00000000-0000-4000-8000-0000000000a2", kind: "torah", revision: 1, ranges: ["Genesis 1:1-1:4"], verses, needsReview: false, aliyahStarts: null, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "synthetic" });
const mark = (got: boolean) => ({ verseRef: "Genesis 1:1", selfCheck: { state: got ? "got-it" : "unmarked", version: 0 }, assessment: { state: "not-started", version: 0 } });
/** A ready pinned reading for a synthetic student: four verses, the first two marked "got it", a note unless told otherwise. */
const slices = (extra: Partial<Record<keyof TodaySlices, unknown>> & { note?: boolean; empty?: boolean } = {}): TodaySlices => ({
  phase: "ready", rows: [{ id: SID, firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-05-01", revision: 1 }],
  assigned: { student: { id: SID, firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-05-01", revision: 1 }, mode: "student", context: null, readings: extra.empty ? [] : [torah(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3", "Genesis 1:4"])] },
  marks: { status: "ready", value: new Map([["torah", [mark(true), mark(true), mark(false), mark(false)]]]) },
  lesson: { status: "ready", value: extra.note === false ? null : { entryId: "00000000-0000-4000-8000-0000000000a3", lessonDate: "2026-10-20", summary: "Synthetic summary.", beforeNext: null, version: 1, displayName: "Synthetic Tutor", canEdit: false, canDelete: false } },
  dates: { status: "unavailable" }, reload() {}, ...extra } as never);
const card = (value: TodaySlices) => renderToStaticMarkup(createElement(PinnedSection, { slices: value }));
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
  it("is never empty for a student, whose pinned card is there while it loads", () => {
    expect(shelfModel({ summary: { ...summary, roles: ["student"] }, own: { status: "hidden" }, pinned: null, learn }).empty).toBeNull();
    expect(shelfModel({ summary: { ...summary, roles: ["student"] }, own: { status: "hidden" }, pinned: null, learn }).sections).toEqual(["pinned", "learn", "account"]);
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

describe("The pinned reading card", () => {
  it("renders first in the section with the chip, the progress line and the Open link", () => {
    const markup = card(slices());
    expect(markup).toContain('data-testid="mine-pinned"');
    expect(markup).toContain("Beit Mitzvah · Sat, May 1, 2027");
    expect(markup).toContain("Verses you’ve got");
    expect(markup).toContain("2 of 4");
    expect(markup).toMatch(/<a [^>]*href="\/mine\/reading"[^>]*>Open<\/a>/);
    expect(markup).toContain('href="/mine/reading#service-parts"');
    expect(markup).toContain('href="/mine/reading#lessons"');
    expect(markup).toContain("Latest from");
  });
  it("shows no note block without a note, and the plain line when no verses are assigned yet", () => {
    expect(card(slices({ note: false }))).not.toContain('data-testid="today-note"');
    const empty = card(slices({ empty: true, note: false }));
    expect(empty).toContain("Your tutor or rabbi will add your verses here.");
    expect(empty).not.toContain("Verses you’ve got");
  });
  it("counts what the student marked got it against the verses of the reading, and is silent about a score", () => {
    const value = slices();
    expect(gotCount(value.assigned!.readings, value.marks)).toEqual({ got: 2, total: 4 });
    expect(gotCount(value.assigned!.readings, { status: "loading" })).toBeNull();
    expect(pinnedOf(value)).toMatchObject({ name: "Synthetic Learner", done: 2, total: 4 });
    expect(pinnedOf({ ...value, phase: "loading" })).toBeNull();
    expect(card(value)).not.toMatch(/streak|score/i);
  });
  it("loads, fails and finds no student in words the page already used", () => {
    expect(card(slices({ phase: "loading" }))).toContain("Loading the assigned reading");
    expect(card(slices({ phase: "error" }))).toContain("Reload students");
    expect(card(slices({ rows: [] }))).toContain("No student is currently linked to this role.");
    expect(card(slices({ phase: "off" }))).not.toContain("data-pinned-card");
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
    expect(card(slices())).toContain('href="/mine/reading"');
    expect(renderToStaticMarkup(createElement(AccountSection))).toMatch(/<a href="\/account"[^>]*>Account<\/a>/);
  });
  it("a student's row is the pinned card and a parent's is a card for each child; the tutor's row is gone, Your students and Find a learner take its place (plan D7)", () => {
    expect(card(slices({ phase: "off" }))).not.toContain("mine-interim");
    expect(model({ status: "ready", readings: [] }).sections).toEqual(["learn", "account"]);
    const sections = (roles: SessionSummary["roles"], own: OwnReadingsState = { status: "hidden" }) => shelfModel({ summary: { ...summary, roles }, own, pinned: null, learn }).sections;
    // A tutor: Your students, then Find a learner, then the rest; an admin who is not a tutor: Find a learner alone; a parent or student: neither.
    expect(sections(["tutor"])).toEqual(["students", "find", "learn", "account"]);
    expect(sections(["tutor", "parent"], { status: "ready", readings: [reading(1)] })).toEqual(["students", "find", "children", "own", "learn", "account"]);
    expect(sections(["admin"])).toEqual(["find", "learn", "account"]);
    expect(sections(["parent"])).toEqual(["children", "learn", "account"]);
    expect(sections(["student"])).toEqual(["pinned", "learn", "account"]);
    expect(sections(["student", "parent"])).toEqual(["pinned", "children", "learn", "account"]);
    // Neither a student nor a parent ever sees the empty shelf while their card loads.
    expect(shelfModel({ summary: { ...summary, roles: ["parent"] }, own: { status: "hidden" }, pinned: null, learn }).empty).toBeNull();
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

describe("A parent's cards, one for each child (Readings for everyone E3)", () => {
  const now = new Date(2026, 9, 27);
  const kid = (first: string, ceremonyDate: string, id = SID) => ({ id, firstName: first, lastName: "Learner", ceremonyDate, revision: 1 });
  const detail = { readings: [torah(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3", "Genesis 1:4"])] as never, marks: slices().marks, note: "Synthetic first line." };
  const view = (cards: ReturnType<typeof childCard>[]) => renderToStaticMarkup(createElement(ChildrenView, { state: { status: "ready", cards }, busy: false, onRetry: () => {}, onPractice: () => {} }));
  it("says the ceremony and the days, then the reading, what the child has got, the note's first line and the way in", () => {
    const markup = view([childCard(kid("Noa", "2026-12-12"), detail, now)]);
    expect(markup).toContain('data-testid="mine-children"');
    expect(markup).toContain("Beit Mitzvah · Sat, Dec 12, 2026");
    expect(markup).toContain("46 days");
    expect(markup).toContain("Torah Genesis 1:1–1:4");
    expect(markup).toMatch(/Verses <bdi dir="auto">Noa<\/bdi> has got: <span>2 of 4<\/span>/);
    expect(markup).toContain("Synthetic first line.");
    expect(markup).toMatch(new RegExp(`<a [^>]*href="/mine/child/${SID}"[^>]*>Open</a>`));
    expect(markup).toContain(`href="/mine/child/${SID}#service-parts"`);
    expect(markup).toContain(">Honors form</button>");
    expect(markup).toContain("Practice with <bdi dir=\"auto\">Noa</bdi>");
  });
  it("leaves out what is not known: a child with no reading has no ranges or got line, and a note-less child no note", () => {
    const markup = view([childCard(kid("Eli", "2027-03-06"), { readings: [], marks: { status: "ready", value: new Map() }, note: null }, now)]);
    expect(markup).not.toContain("has got");
    expect(markup).not.toContain("Torah");
    expect(markup).toContain("Open");
  });
  it("orders children by ceremony, nearest first, and says Tomorrow and Today as the other pages do", () => {
    expect(orderChildren([kid("B", "2027-03-06", "b"), kid("A", "2026-12-12", "a")]).map(row => row.id)).toEqual(["a", "b"]);
    expect(daysWord("2026-10-28", now)).toBe("Tomorrow");
    expect(daysWord("2026-10-27", now)).toBe("Today");
    expect(daysWord("2026-10-26", now)).toBeNull();
  });
  it("says plainly when there are none or the cards fail to load", () => {
    expect(renderToStaticMarkup(createElement(ChildrenView, { state: { status: "ready", cards: [] }, busy: false, onRetry: () => {}, onPractice: () => {} }))).toContain("No children are linked to this account yet.");
    expect(renderToStaticMarkup(createElement(ChildrenView, { state: { status: "failed" }, busy: false, onRetry: () => {}, onPractice: () => {} }))).toContain(">Try again</button>");
  });
});
