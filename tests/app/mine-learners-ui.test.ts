import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchLearnerPage, fetchLearnerReadings, fetchLearners, parseLearners, parseMyTutor, type Learner } from "../../src/components/portal/mine/api";
import { FIND_STRINGS, FindALearnerView, LearnerRow, learnerShelfHref } from "../../src/components/portal/mine/find-a-learner";
import { MY_TUTOR_STRINGS, MyTutorView } from "../../src/components/portal/mine/my-tutor";
import { firstLine, StudentRowMeta, studentRows, YOUR_STUDENTS_STRINGS, YourStudentsView } from "../../src/components/portal/mine/your-students";
import { nextDate } from "../../src/components/portal/workspace/reading";
import { LEARNER_SHELF_STRINGS, LearnerShelfView, learnerReadingHref } from "../../src/components/portal/mine/learner-shelf";
import { PortalRequestError } from "../../src/components/portal/api";
import { parseSavedReading } from "../../src/components/portal/saved/api";
import { readFileSync } from "node:fs";
import { READINGS_DISCLOSURE } from "../../src/lib/readings/disclosure";

// Readings for everyone, plan D7: Your students, Find a learner, the Tutor line and a learner's shelf, as pure views and strict parsers.
// Synthetic people and readings only.
const M1 = "00000000-0000-4000-8000-000000000011", M2 = "00000000-0000-4000-8000-000000000022", R1 = "00000000-0000-4000-8000-000000000101";
const learner = (extra: Partial<Learner> = {}): Learner => ({ membershipId: M1, name: "Synthetic Learner", readings: 3, nearest: { name: "Noach", date: "2026-10-24" }, tutor: null, student: null, ...extra });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the shelf's learners client", () => {
  it("accepts exactly the directory's shape and refuses an address, an extra field or a malformed id", () => {
    expect(parseLearners({ ok: true, learners: [learner()] })).toEqual([learner()]);
    expect(parseLearners({ ok: true, learners: [learner({ tutor: { name: "Synthetic Tutor", claimed: true, mine: false }, student: { id: R1, firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-01-02" } })] })[0].tutor).toEqual({ name: "Synthetic Tutor", claimed: true, mine: false });
    for (const bad of [{ ok: true }, { ok: true, learners: [{ ...learner(), name: "a@example.test" }] }, { ok: true, learners: [{ ...learner(), extra: 1 }] }, { ok: true, learners: [{ ...learner(), membershipId: "nope" }] },
      { ok: true, learners: [{ ...learner(), readings: -1 }] }, { ok: true, learners: [{ ...learner(), nearest: { name: "X" } }] }, { ok: true, learners: [{ ...learner(), tutor: { name: "T", claimed: "yes", mine: false } }] }])
      expect(() => parseLearners(bad), JSON.stringify(bad)).toThrow(PortalRequestError);
    expect(parseMyTutor({ ok: true, tutor: null })).toBeNull();
    expect(parseMyTutor({ ok: true, tutor: { name: "Synthetic Tutor", claimed: true } })).toEqual({ name: "Synthetic Tutor", claimed: true });
    expect(() => parseMyTutor({ ok: true, tutor: { name: "t@example.test", claimed: true } })).toThrow(PortalRequestError);
  });
  it("asks same-origin and uncached, searches by prefix, and reads a learner's shelf through the staff routes only", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    let next = () => answer(200, { ok: true, learners: [learner()] });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { calls.push({ url, init }); return next(); });
    expect((await fetchLearners("Syn")).length).toBe(1);
    expect(calls[0].url).toBe("/api/learners?q=Syn");
    expect(calls[0].init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    await fetchLearners("  ");
    expect(calls[1].url).toBe("/api/learners");
    next = () => answer(200, { ok: true, readings: [{ id: R1, name: "Noach", date: "2026-10-24", kind: "torah", ranges: "Genesis 6:9-11:32", verseCount: 153, revision: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" }] });
    expect((await fetchLearnerReadings(M1)).state).toBe("ready");
    expect(calls[2].url).toBe(`/api/saved/learner/readings?learner=${M1}`);
    next = () => answer(404, { error: "not-found" });
    expect(await fetchLearnerReadings(M1)).toEqual({ state: "missing" });
    expect(await fetchLearnerReadings("nope")).toEqual({ state: "missing" });
    next = () => answer(404, {});
    expect((await fetchLearnerPage(M1, R1, 0)).state).toBe("missing");
    expect(calls.at(-1)!.url).toBe(`/api/saved/learner/reading?learner=${M1}&id=${R1}`);
    await fetchLearnerPage(M1, R1, 10);
    expect(calls.at(-1)!.url).toBe(`/api/saved/learner/page?learner=${M1}&id=${R1}&offset=10`);
    // Nothing on the staff path ever posts.
    expect(calls.every(call => call.init.method === "GET")).toBe(true);
  });
});

describe("Find a learner", () => {
  const view = (rows: readonly Learner[], roles: string[] = ["tutor"], extra: Partial<Parameters<typeof FindALearnerView>[0]> = {}) => renderToStaticMarkup(createElement(FindALearnerView, { query: "", state: { status: "ready", rows },
    tutor: roles.includes("tutor"), admin: roles.includes("admin"), pending: null, status: null, problem: null, inputId: "find", onQuery: () => {}, onClaim: () => {}, onUnclaim: () => {}, ...extra }));
  it("is a search field named Find a learner, with each row's name, count, nearest date and tutor; Add to my students only for a learner with no tutor", () => {
    const markup = view([learner(), learner({ membershipId: M2, name: "Synthetic Other", readings: 1, nearest: null, tutor: { name: "Synthetic Tutor", claimed: true, mine: false } })]);
    expect(markup).toContain('<label for="find"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain(`>${FIND_STRINGS.title}</label>`);
    expect(markup).toContain("3 readings"); expect(markup).toContain("1 reading ");
    expect(markup).toContain("Saturday, October 24, 2026");
    // A learner with no dated reading has no "next" part at all (finding 8).
    expect(markup.split('data-learner="')[2]).not.toContain(FIND_STRINGS.next);
    expect(markup).toContain(FIND_STRINGS.noTutor); expect(markup).toContain("Tutor: <bdi dir=\"auto\">Synthetic Tutor</bdi>");
    // A learner who already has a tutor says so in place of the button (finding 7).
    expect(markup.match(/aria-label="Add to my students: /g)).toHaveLength(1);
    expect(markup).toContain('data-testid="learner-state"');
    expect(markup).not.toContain("Remove from my students");
    // Nobody's name is a link until the claim is the viewer's own: the shelf behind it is 404 to anyone else.
    expect(markup).not.toContain(`href="${learnerShelfHref(M1)}"`);
  });
  it("the tutor who claimed a learner may remove the claim and opens the learner's shelf; an assigned student has no undo; an admin gets Remove from my students", () => {
    const mine = learner({ tutor: { name: "Synthetic Me", claimed: true, mine: true } });
    const markup = view([mine]);
    expect(markup).toContain('aria-label="Remove from my students: Synthetic Learner"');
    expect(markup).not.toContain("Add to my students");
    expect(markup).toContain(`href="${learnerShelfHref(M1)}"`);
    const assigned = view([learner({ tutor: { name: "Synthetic Me", claimed: false, mine: true } })]);
    expect(assigned).not.toContain("Remove from my students"); expect(assigned).not.toContain("Add to my students"); expect(assigned).toContain('data-testid="learner-state"');
    const admin = view([mine, learner({ membershipId: M2, name: "Rabbi's claim", tutor: { name: "Synthetic Tutor", claimed: true, mine: false } })], ["admin"]);
    expect(admin.match(/Remove from my students: /g)).toHaveLength(2);
    expect(admin).not.toContain("Add to my students");
    expect(admin).toContain(`href="${learnerShelfHref(M2)}"`);
    expect(view([learner({ tutor: { name: "Synthetic Tutor", claimed: false, mine: false } })], ["admin"])).not.toContain("Remove from my students");
  });
  it("says what happened after a claim, and when a learner already has a tutor, in the house tone", () => {
    const after = view([learner()], ["tutor"], { status: FIND_STRINGS.claimed("Synthetic Learner") });
    expect(after).toContain('role="status">Synthetic Learner was added to your students.</p>');
    expect(view([learner()], ["tutor"], { problem: FIND_STRINGS.hasTutor })).toContain('role="alert"');
    expect(view([])).toContain(FIND_STRINGS.none);
    // Before anything is typed there is only the search field: no rows and no "No learners found." (finding 8).
    const idle = view([], ["tutor"], { state: { status: "idle" } });
    expect(idle).toContain('type="search"'); expect(idle).not.toContain("learner-row"); expect(idle).not.toContain(FIND_STRINGS.none);
    for (const markup of [after, view([]), view([learner()], ["tutor"], { state: { status: "failed" } })]) expect(markup).not.toMatch(/!/);
    expect(renderToStaticMarkup(createElement(LearnerRow, { row: learner(), tutor: true, admin: false, pending: true, onClaim: () => {}, onUnclaim: () => {} }))).toMatch(/disabled=""/);
  });
});

describe("Your students", () => {
  const student = (id: string, lastName: string, ceremonyDate: string) => ({ id, firstName: "Synthetic", lastName, ceremonyDate, revision: 1 });
  it("orders students by the nearest ceremony, then claimed learners without a record by name, never listing a linked student twice", () => {
    const linked = learner({ membershipId: M2, name: "Synthetic Linked", tutor: { name: "Me", claimed: true, mine: true }, student: { id: R1, firstName: "Synthetic", lastName: "Linked", ceremonyDate: "2027-05-01" } });
    const bare = learner({ name: "Synthetic Bare", tutor: { name: "Me", claimed: true, mine: true } });
    const other = learner({ membershipId: "00000000-0000-4000-8000-000000000033", name: "Synthetic Other", tutor: { name: "Someone", claimed: true, mine: false } });
    const rows = studentRows([student(R1, "Linked", "2027-05-01"), student("00000000-0000-4000-8000-000000000102", "Sooner", "2027-01-02")], [other, bare, linked], new Map([[R1, "Practiced the first aliyah"]]));
    expect(rows.map(row => [row.name, row.href])).toEqual([["Synthetic Sooner", "/workspace/tutor/00000000-0000-4000-8000-000000000102"], ["Synthetic Linked", `/workspace/tutor/${R1}`], ["Synthetic Bare", learnerShelfHref(M1)]]);
    expect(rows[1].note).toBe("Practiced the first aliyah");
    expect(firstLine("  First line\nSecond")).toBe("First line"); expect(firstLine("\n\n")).toBeNull(); expect(firstLine(null)).toBeNull();
  });
  it("renders each row with the days to go, the note's first line and Open, under the Your students heading", () => {
    const markup = renderToStaticMarkup(createElement(YourStudentsView, { state: { status: "ready", rows: studentRows([student(R1, "Linked", "2999-01-02")], [], new Map([[R1, "Practiced the first aliyah"]])) }, onRetry: () => {} }));
    expect(markup).toContain(`>${YOUR_STUDENTS_STRINGS.title}</h2>`);
    expect(markup).toContain('data-testid="mine-students"');
    expect(markup).toContain("days to go"); expect(markup).toContain("Practiced the first aliyah"); expect(markup).toContain(">Open<");
    expect(markup).toContain(`href="/workspace/tutor/${R1}"`);
    expect(renderToStaticMarkup(createElement(YourStudentsView, { state: { status: "ready", rows: [] }, onRetry: () => {} }))).toContain(YOUR_STUDENTS_STRINGS.none);
  });
  it("leads a row with the next rehearsal or Beit Mitzvah only when it is two weeks away or less (findings 1 and 2)", () => {
    const now = new Date(2026, 9, 28);
    const at = (rehearsal1: string | null, ceremonyDate: string) => ({ ceremonyDate, rehearsal1, rehearsal2: null });
    expect(nextDate(at("2026-10-29", "2026-12-12"), now)).toMatchObject({ kind: "rehearsal", days: 1, chip: "Rehearsal tomorrow" });
    expect(nextDate(at("2026-10-28", "2026-12-12"), now)).toMatchObject({ kind: "rehearsal", days: 0, chip: "Rehearsal today" });
    expect(nextDate(at("2026-11-07", "2026-11-14"), now)).toMatchObject({ kind: "rehearsal", days: 10, chip: "Rehearsal in 10 days" });
    expect(nextDate(at(null, "2026-11-06"), now)).toMatchObject({ kind: "ceremony", days: 9, chip: "Beit Mitzvah in 9 days" });
    expect(nextDate(at("2026-11-12", "2027-04-10"), now)).toMatchObject({ kind: "rehearsal", days: 15, chip: null });
    expect(nextDate(at("2026-10-01", "2026-10-20"), now)).toBeNull();
    const row = studentRows([{ ...student(R1, "Linked", "2026-12-12"), rehearsal1: "2026-10-29", rehearsal2: "2026-11-01" }], [])[0];
    const markup = renderToStaticMarkup(createElement(StudentRowMeta, { row, now }));
    expect(markup).toMatch(/data-testid="student-row-date"><span[^>]*data-tone="attention"[^>]*>Rehearsal tomorrow<\/span>/);
    expect(markup).toContain("45 days to go");
    expect(renderToStaticMarkup(createElement(StudentRowMeta, { row: studentRows([student(R1, "Later", "2027-06-05")], [])[0], now }))).not.toContain('data-tone="attention"');
    expect(renderToStaticMarkup(createElement(YourStudentsView, { state: { status: "failed" }, onRetry: () => {} }))).toContain(">Try again</button>");
  });
});

describe("what the site says it records (plan D8)", () => {
  it("is the one sentence, on Account under the N23 line and on About, word for word", () => {
    expect(READINGS_DISCLOSURE).toBe("Readings you keep, with their marks and notes, can be seen by tutors and the rabbi.");
    const account = readFileSync("src/components/portal/account-page.tsx", "utf8");
    expect(account).toMatch(/\{student && <PracticeDisclosure place="account" \/>\}\r?\n\s*<p className="field-help" role="note" data-readings-disclosure="account">\{READINGS_DISCLOSURE\}<\/p>/);
    expect(readFileSync("src/app/about/page.tsx", "utf8")).toContain("<p>{READINGS_DISCLOSURE}</p>");
  });
});

describe("the Tutor line and a learner's shelf", () => {
  it("shows Tutor: name with Not my tutor for a claim only, then Your tutor was removed., and nothing without a tutor", () => {
    const view = (state: Parameters<typeof MyTutorView>[0]["state"]) => renderToStaticMarkup(createElement(MyTutorView, { state, pending: false, notice: null, onRemove: () => {} }));
    const claimed = view({ status: "ready", tutor: { name: "Synthetic Tutor", claimed: true } });
    expect(claimed).toContain("Tutor: <bdi dir=\"auto\">Synthetic Tutor</bdi>");
    expect(claimed).toContain(`>${MY_TUTOR_STRINGS.undo}</button>`);
    const assigned = view({ status: "ready", tutor: { name: "Synthetic Tutor", claimed: false } });
    expect(assigned).toContain("Tutor: "); expect(assigned).not.toContain(MY_TUTOR_STRINGS.undo);
    expect(view({ status: "removed" })).toContain('role="status"'); expect(view({ status: "removed" })).toContain("Your tutor was removed.");
    expect(view({ status: "ready", tutor: null })).toBe(""); expect(view({ status: "hidden" })).toBe(""); expect(view({ status: "loading" })).toBe("");
  });
  it("a learner's shelf is the same Also working on list, read-only, each row opening the reading in the learner view", () => {
    const reading = parseSavedReading({ id: R1, name: "Noach", date: "2026-10-24", kind: "torah", ranges: "Genesis 6:9-11:32", verseCount: 153, revision: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" })!;
    const markup = renderToStaticMarkup(createElement(LearnerShelfView, { membershipId: M1, learner: learner(), state: { status: "ready", readings: { state: "ready", readings: [reading] } }, onRetry: () => {} }));
    expect(markup).toContain("Synthetic Learner"); expect(markup).toContain(">Synthetic Learner’s readings</h2>");
    expect(renderToStaticMarkup(createElement(LearnerShelfView, { membershipId: M1, learner: null, state: { status: "loading" }, onRetry: () => {} }))).toContain(`>${LEARNER_SHELF_STRINGS.title}</h2>`);
    // Static markup escapes the ampersand; the address itself is plain.
    expect(markup).toContain(`href="${learnerReadingHref(M1, R1).replace("&", "&amp;")}"`);
    expect(learnerReadingHref(M1, R1)).toBe(`/read?saved=${R1}&learner=${M1}`);
    for (const absent of ["Edit", "Remove", "All my readings", "rename"]) expect(markup).not.toContain(absent);
    expect(renderToStaticMarkup(createElement(LearnerShelfView, { membershipId: M1, learner: null, state: { status: "ready", readings: { state: "missing" } }, onRetry: () => {} }))).toContain(LEARNER_SHELF_STRINGS.missing);
  });
});
