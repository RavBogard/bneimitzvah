import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { PRACTICE_VISIBILITY_FROM, practiceVisibilityFrom } from "../../src/lib/practice-visibility/release";
import { ChildPracticeDisclosure, ParentAccountDisclosureList, PracticeDisclosure } from "../../src/components/portal/practice-visibility/disclosure";
import { parseParentPractice, parseTutorPractice, practiceVisibilityApi } from "../../src/components/portal/practice-visibility/api";

// 1.9 bundle C: opening N23's release gate. The order decision 7 requires: the student (and the parent) is told what the tutor sees
// before any tutor or parent line about the student's practice can render. Three things hold that order:
// 1. with the gate as released, every disclosure placement renders: Account, Learn, the parent's practice bar, the parent's Account;
// 2. no tutor or parent line can render without the gate: the lines are built only in one module, only from #120's read, and that
//    read asks the server nothing while the gate is closed (the server refuses it too);
// 3. for every value the gate could take, a tutor line reachable implies every disclosure renders.
const src = join(process.cwd(), "src"), read = (path: string) => readFileSync(join(src, path), "utf8");
const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : []; });
const STUDENT = "11111111-1111-4111-8111-111111111111";
afterEach(() => { vi.unstubAllGlobals(); });

/** Every disclosure placement, rendered as the app mounts it, with the gate at `from`. */
function disclosures(from: string | null) {
  return {
    account: renderToStaticMarkup(createElement(PracticeDisclosure, { place: "account", from })),
    learn: renderToStaticMarkup(createElement(PracticeDisclosure, { place: "learn", from })),
    practiceBar: renderToStaticMarkup(createElement(ChildPracticeDisclosure, { name: "Noa", place: "child-practice", from })),
    parentAccount: renderToStaticMarkup(createElement(ParentAccountDisclosureList, { names: [{ id: "a", firstName: "Noa" }], from })),
  };
}
/** Whether a tutor or parent line could be built: whether #120's read asks the server anything. */
async function linesReachable(from: string | null) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { asked.push(String(url)); throw new TypeError("no network in this test"); });
  const settle = (promise: Promise<unknown>) => promise.then(() => undefined, () => undefined);
  await settle(practiceVisibilityApi.tutor(STUDENT, undefined, from));
  await settle(practiceVisibilityApi.parent(STUDENT, undefined, from));
  vi.unstubAllGlobals();
  return asked;
}

test("the gate is open, on a real date, and every disclosure placement renders with it", () => {
  expect(PRACTICE_VISIBILITY_FROM).not.toBeNull();
  expect(practiceVisibilityFrom(PRACTICE_VISIBILITY_FROM)).toBe(PRACTICE_VISIBILITY_FROM);
  const shown = disclosures(PRACTICE_VISIBILITY_FROM);
  expect(shown.account).toContain('data-practice-disclosure="account"');
  expect(shown.learn).toContain('data-practice-disclosure="learn"');
  expect(shown.practiceBar).toContain('data-practice-disclosure="child-practice"');
  expect(shown.parentAccount).toContain('data-practice-disclosure="parent-account"');
  // And the app mounts each of them, with the default gate (no `from` passed anywhere in the app).
  expect(read("components/portal/account-page.tsx")).toMatch(/student && <PracticeDisclosure place="account" \/>/);
  expect(read("components/portal/account-page.tsx")).toMatch(/roles\.includes\("parent"\) && <ParentAccountDisclosure load=\{parentChildren\} \/>/);
  expect(read("components/learn/home.tsx")).toMatch(/<LearnPracticeDisclosure signedIn=\{account\.state === "synced"\} isStudent=\{isStudent\} \/>/);
  // The sitting's line moved from the bar to under the tutor's ask (parent walk 2026-10-28, finding 1).
  expect(read("components/portal/workspace/reading.tsx")).toMatch(/\{mode === "child-practice" && <ChildPracticeDisclosure name=\{student\.firstName\} place="child-practice" \/>\}/);
});

test("no tutor or parent line can render without the gate: built in one module, only from the read, which asks nothing while closed", async () => {
  // The approved lines' builders are used in the tutor and parent displays only through staff/practice.tsx.
  const builders = /\b(dayLine|rosterLine|markLine|mixedUpLine|canHearLines|parentCountLine)\(/;
  const users = sources(join(src, "components")).filter(path => builders.test(readFileSync(path, "utf8"))).map(path => relative(src, path).split(sep).join("/"));
  expect(users).toEqual(["components/portal/workspace/staff/practice.tsx"]);
  const practice = read("components/portal/workspace/staff/practice.tsx");
  // Its only data is #120's read, through the client that checks the gate first.
  expect(practice).toMatch(/import \{ practiceVisibilityApi \} from "..\/..\/practice-visibility\/api";/);
  expect(practice).not.toMatch(/\bfetch\(|\bcall\(|readProgress|readPracticeCalendar/);
  expect(read("components/portal/practice-visibility/api.ts")).toMatch(/if \(!practiceVisibilityFrom\(from\)\) return null;\s*return parseTutorPractice/);
  expect(read("components/portal/practice-visibility/api.ts")).toMatch(/if \(!practiceVisibilityFrom\(from\)\) return null;\s*return parseParentPractice/);
  // Closed, the read never reaches the network; open, it asks the one route.
  for (const closed of [null, "", "soon", "2026-02-30"]) expect(await linesReachable(closed), String(closed)).toEqual([]);
  expect(await linesReachable(PRACTICE_VISIBILITY_FROM)).toEqual([`/api/students/${STUDENT}/practice-visibility?mode=tutor`, `/api/students/${STUDENT}/practice-visibility?mode=parent`]);
});

test("for every value the gate can take, a reachable tutor or parent line implies every disclosure renders", async () => {
  for (const from of [null, "", "soon", "2026-02-30", "2026-10-1", "2026-10-27", PRACTICE_VISIBILITY_FROM, "2030-01-01"]) {
    const reachable = (await linesReachable(from)).length > 0, shown = disclosures(from);
    if (reachable) for (const [place, markup] of Object.entries(shown)) expect(markup, `${String(from)}: ${place}`).not.toBe("");
    // And the converse: a closed gate shows neither, so nothing is said about lines no one can see.
    if (!practiceVisibilityFrom(from)) { expect(reachable).toBe(false); for (const markup of Object.values(shown)) expect(markup).toBe(""); }
  }
});

test("the tutor read is refused whole for a day outside the release window, an extra field, or a malformed mark", () => {
  const good = { from: "2026-10-27", today: "2026-10-29", days: [{ day: "2026-10-28", readings: [{ kind: "torah", opened: ["Exodus 23:1"], marked: [{ verseRef: "Exodus 23:1", state: "got-it" }] }] }],
    marks: [{ kind: "torah", verseRef: "Exodus 23:1", state: "got-it", withParent: true }], practisedDays: 1, lastLesson: null, stillWorking: 0,
    learn: { torah: { heard: 2, of: 10 }, haftarah: { heard: 0, of: 11 }, mixedUp: ["tevir", "etnachta"] } };
  expect(parseTutorPractice(good).marks[0].withParent).toBe(true);
  for (const bad of [{ ...good, days: [{ ...good.days[0], day: "2026-10-26" }] }, { ...good, days: [{ ...good.days[0], day: "2026-10-30" }] }, { ...good, minutes: 4 },
    { ...good, marks: [{ ...good.marks[0], at: "10:15" }] }, { ...good, marks: [{ ...good.marks[0], withParent: "yes" }] }, { ...good, practisedDays: 8 }])
    expect(() => parseTutorPractice(bad)).toThrow();
  expect(parseParentPractice({ gotIt: 12, working: 3 })).toEqual({ gotIt: 12, working: 3 });
  expect(() => parseParentPractice({ gotIt: 12, working: 3, days: [] })).toThrow();
});
