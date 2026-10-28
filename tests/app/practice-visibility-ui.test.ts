import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { canHearLines, dayLine, markLine, mixedUpLine, parentCountLine, rosterLine, verseRanges } from "../../src/lib/practice-visibility/lines";
import { learnSummary } from "../../src/lib/practice-visibility/learn";
import { PRACTICE_VISIBILITY_FROM, practiceVisibilityFrom } from "../../src/lib/practice-visibility/release";
import { PRACTICE_DISCLOSURE, parentDisclosure } from "../../src/lib/practice-visibility/copy";
import { ChildPracticeDisclosure, ParentAccountDisclosureList, PracticeDisclosure } from "../../src/components/portal/practice-visibility/disclosure";
import { pathLessons } from "../../src/lib/learn/course";

// 1.9 N23: the approved lines word for word (the one deliberate wording test for these lines), the Learn derivation, and the
// student's disclosure behind the release gate.
const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("the approved lines, word for word", () => {
  const opened = Array.from({ length: 9 }, (_, i) => `Exodus 23:${i + 1}`);
  expect(dayLine({ day: "2026-10-20", readings: [{ kind: "torah", opened, marked: [{ verseRef: "Exodus 23:4", state: "got-it" }] }] })).toBe("Tue Oct 20 · Torah 23:1–23:9 · marked 23:4 Got it");
  expect(mixedUpLine({ torah: { heard: 2, of: 10 }, haftarah: { heard: 0, of: 11 }, mixedUp: ["tevir", "etnachta"] })).toBe("Often mixed up: tevir and etnachta");
  expect(PRACTICE_DISCLOSURE.learn).toBe("Your tutor sees which phrases you can hear.");
  expect(rosterLine({ practisedDays: 3, lastLesson: "2026-10-17", stillWorking: 2 })).toBe("Practiced 3 of last 7 days · Last lesson Oct 17 · 2 verses still working");
  expect(markLine("got-it", true)).toBe("Student (with parent): got it");
});

test("the lines' small cases: ranges across chapters, one verse, no lesson, nothing still working, a mark made before sources were recorded", () => {
  expect(verseRanges(["Exodus 22:29", "Exodus 22:30", "Exodus 23:1", "Exodus 23:4"])).toBe("22:29–23:1, 23:4");
  expect(verseRanges(["Exodus 22:29", "Exodus 23:1"])).toBe("22:29, 23:1");
  expect(rosterLine({ practisedDays: 0, lastLesson: null, stillWorking: 1 })).toBe("Practiced 0 of last 7 days · 1 verse still working");
  expect(rosterLine({ practisedDays: 2, lastLesson: null, stillWorking: 0 })).toBe("Practiced 2 of last 7 days");
  expect(markLine("working", false)).toBe("Student: still working");
  expect(markLine("got-it", null)).toBe("Student: got it");
  expect(dayLine({ day: "2026-10-21", readings: [{ kind: "torah", opened: ["Exodus 23:1"], marked: [] }, { kind: "haftarah", opened: ["Isaiah 1:1", "Isaiah 1:2"], marked: [{ verseRef: "Isaiah 1:2", state: "working" }] }] }))
    .toBe("Wed Oct 21 · Torah 23:1 · Haftarah 1:1–1:2 · marked 1:2 Still working");
  expect(canHearLines({ torah: { heard: 0, of: 10 }, haftarah: { heard: 0, of: 11 }, mixedUp: null })).toEqual(["Can hear: 0 of 10 Torah phrases"]);
  expect(canHearLines({ torah: { heard: 6, of: 10 }, haftarah: { heard: 2, of: 11 }, mixedUp: null })).toEqual(["Can hear: 6 of 10 Torah phrases", "Can hear: 2 of 11 haftarah phrases"]);
});

test("Learn's lines come from lesson ids and boxes only; a pair shows only when both are taught, weak, and one was missed", () => {
  const lessons = pathLessons("torah").filter(lesson => lesson.family === "tevir" || lesson.family === "etnachta").map(lesson => lesson.id);
  const learn = learnSummary(lessons, { "tevir:torah:name": 0, "etnachta:torah:find": 1, "etnachta:torah:name": 3 });
  expect(learn.torah.heard).toBe(2); expect(learn.haftarah.heard).toBe(0);
  expect(learn.mixedUp).toEqual(["tevir", "etnachta"]);
  // Neither missed: no pair. One not yet taught: no pair. A malformed box is ignored.
  expect(learnSummary(lessons, { "tevir:torah:name": 1, "etnachta:torah:name": 1 }).mixedUp).toBeNull();
  expect(learnSummary(lessons.slice(0, 1), { "tevir:torah:name": 0, "etnachta:torah:name": 0 }).mixedUp).toBeNull();
  expect(learnSummary(lessons, { "tevir:torah:name": "0", "etnachta:torah:name": 0 }).mixedUp).toBeNull();
  // Families the course does not list as confusable never pair.
  const far = pathLessons("torah").filter(lesson => lesson.family === "sof-pasuk" || lesson.family === "pazer").map(lesson => lesson.id);
  expect(learnSummary(far, { "sof-pasuk:torah:name": 0, "pazer:torah:name": 0 }).mixedUp).toBeNull();
});

test("the student's disclosure renders only with the release gate open, the same gate the server checks", () => {
  // Opened by 1.9 bundle C (tests/app/practice-visibility-gate.test.ts holds the ordering); a closed gate still renders nothing.
  expect(practiceVisibilityFrom(PRACTICE_VISIBILITY_FROM)).toBe(PRACTICE_VISIBILITY_FROM);
  expect(renderToStaticMarkup(createElement(PracticeDisclosure, { place: "account", from: null }))).toBe("");
  expect(renderToStaticMarkup(createElement(PracticeDisclosure, { place: "learn", from: null }))).toBe("");
  for (const bad of ["", "2026-02-30", "soon", "2026-10-1"]) expect(practiceVisibilityFrom(bad), bad).toBeNull();
  const account = renderToStaticMarkup(createElement(PracticeDisclosure, { place: "account", from: "2026-10-27" }));
  expect(account).toContain('data-practice-disclosure="account"'); expect(account).toContain('role="note"');
  expect(renderToStaticMarkup(createElement(PracticeDisclosure, { place: "learn", from: "2026-10-27" }))).toContain('data-practice-disclosure="learn"');
  // Account shows it to a student; Learn to a signed-in student; and the server's read path imports the same gate.
  expect(source("components/portal/account-page.tsx")).toMatch(/student && <PracticeDisclosure place="account" \/>/);
  expect(source("components/learn/home.tsx")).toMatch(/<LearnPracticeDisclosure signedIn=\{account\.state === "synced"\} isStudent=\{isStudent\} \/>/);
  expect(source("server/practice-visibility/service.ts")).toMatch(/import \{ practiceVisibilityFrom \} from "..\/..\/lib\/practice-visibility\/release"/);
  expect(source("components/portal/practice-visibility/disclosure.tsx")).toMatch(/import \{ PRACTICE_VISIBILITY_FROM, practiceVisibilityFrom \} from "..\/..\/..\/lib\/practice-visibility\/release"/);
});

test("Daniel's Account line word for word, the parent line named and pronoun-free, and the parent's count line", () => {
  expect(PRACTICE_DISCLOSURE.account).toBe("Your tutor sees which days you practiced, which verses you opened, how you marked them and whether a parent was with you, and in Learn to lein which phrases you can hear and the two you mix up most. Your parents see how you marked each verse. No one sees how long you practice or a score.");
  expect(parentDisclosure("Noa")).toBe("Noa's tutor sees which days Noa practiced, which verses Noa opened, how Noa marked them and whether a parent was there, and in Learn to lein which phrases Noa can hear and the two Noa mixes up most. You see how Noa marked each verse. No one sees how long Noa practices or a score.");
  // No pronoun for the child ("them" is the verses).
  expect(PRACTICE_DISCLOSURE.parent).not.toMatch(/\b(he|she|they|his|her|hers|their|him)\b/i);
  expect(parentCountLine("Noa", { gotIt: 12, working: 3 })).toBe("Noa has marked 12 verses Got it and 3 Still working.");
  expect(parentCountLine("Noa", { gotIt: 1, working: 0 })).toBe("Noa has marked 1 verse Got it.");
  expect(parentCountLine("Noa", { gotIt: 0, working: 2 })).toBe("Noa has marked 2 verses Still working.");
  expect(parentCountLine("Noa", { gotIt: 0, working: 0 })).toBe("Noa has not marked any verses yet.");
});

test("a child who practices only with a parent is told in child practice, and a parent on Account, behind the same gate", () => {
  for (const place of ["child-practice", "parent-account"] as const) {
    expect(renderToStaticMarkup(createElement(ChildPracticeDisclosure, { name: "Noa", place, from: null }))).toBe("");
    const open = renderToStaticMarkup(createElement(ChildPracticeDisclosure, { name: "Noa", place, from: "2026-10-27" }));
    expect(open).toContain(`data-practice-disclosure="${place}"`); expect(open).toContain('<bdi dir="auto">Noa</bdi>'); expect(open).toContain('role="note"');
  }
  const list = renderToStaticMarkup(createElement(ParentAccountDisclosureList, { names: [{ id: "a", firstName: "Noa" }, { id: "b", firstName: "Eli" }], from: "2026-10-27" }));
  expect(list.match(/data-practice-disclosure="parent-account"/g)).toHaveLength(2);
  expect(renderToStaticMarkup(createElement(ParentAccountDisclosureList, { names: [{ id: "a", firstName: "Noa" }], from: null }))).toBe("");
  // The practice bar shows it for the child being practiced with; the parent's Account shows it for each linked child.
  expect(source("components/portal/workspace/students.tsx")).toMatch(/\{child && <ChildPracticeDisclosure name=\{child\.firstName\} place="child-practice" \/>\}/);
  expect(source("components/portal/account-page.tsx")).toMatch(/roles\.includes\("parent"\) && <ParentAccountDisclosure load=\{parentChildren\} \/>/);
  expect(source("components/portal/account-page.tsx")).toMatch(/const parentChildren = \(\) => workspaceApi\.students\("parent"\);/);
});
