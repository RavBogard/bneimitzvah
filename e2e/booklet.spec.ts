import { expect, test, type Page } from "@playwright/test";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { verseOf, versesOf } from "./aliyot-fixture";

// The study booklet (replacing the study-guide booklet, B4) on the built, unconfigured production server: a signed-in student's booklet
// renders its sections. Every answer is a synthetic route fulfilment (session, reading, text pages, guide); no verse, translation or real
// guide anywhere. Desktop only: the booklet is a print page.
const SID = "11111111-1111-4111-8111-111111111111", TID = "33333333-3333-4333-8333-333333333333", HID = "44444444-4444-4444-8444-444444444444";
const TORAH = "Genesis 18:1-8", HAFTARAH = "Isaiah 54:1-3";
const SOURCE = { status: "available", fetchedAt: 0, date: "2026-12-12", calendar: "diaspora", attribution: { name: "Hebcal", url: "https://www.hebcal.com/" } };
const reply = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const LABEL = { origin: "claude", reviewed: false, rabbiName: "Synthetic Rabbi" };

async function mock(page: Page) {
  const student = { id: SID, firstName: "Noa", lastName: "Synthetic", ceremonyDate: "2026-12-12", revision: 1, rehearsal1: "2026-11-07", rehearsal2: null };
  const lists = { torah: versesOf(TORAH), haftarah: versesOf(HAFTARAH, "haftarah") };
  const readings = [
    { id: TID, status: "confirmed", kind: "torah", basis: "custom", revision: 1, ranges: [TORAH], verses: lists.torah, confirmationDate: null, needsReview: false, source: SOURCE, aliyahStarts: ["Genesis 18:5"], readingKey: "vayera" },
    { id: HID, status: "confirmed", kind: "haftarah", basis: "custom", revision: 1, ranges: [HAFTARAH], verses: lists.haftarah, confirmationDate: null, needsReview: false, source: SOURCE, aliyahStarts: null, readingKey: null },
  ];
  await page.route("**/api/**", route => route.fulfill(reply({}, 503)));
  await page.route("**/api/students/*/booklet", route => route.fulfill(reply({ ok: true, mode: "student", tutor: "Synthetic Tutor" })));
  await page.route("**/api/students/*/reading?*", route => route.fulfill(reply({ student, mode: "student", context: null, readings, referenceListeningEnabled: false })));
  await page.route("**/api/students/*/study-text?*", route => {
    const q = new URL(route.request().url()).searchParams, kind = q.get("kind") as "torah" | "haftarah", offset = Number(q.get("offset") ?? "0");
    const reading = readings.find(row => row.kind === kind)!, plan = studyRangePlan(reading.ranges, kind, offset), list = lists[kind];
    return route.fulfill(reply({ studentId: SID, studentRevision: 1, mode: "student", context: null, assignment: { id: reading.id, revision: 1, kind, needsReview: false }, offset, nextOffset: plan.nextOffset, totalVerses: list.length,
      translation: { key: "jps2023", status: "available" }, verses: plan.refs.map(ref => verseOf(ref, list.indexOf(ref))),
      chapters: plan.chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) }));
  });
  await page.route("**/api/students/*/study-guide?*", route => {
    const kind = new URL(route.request().url()).searchParams.get("kind") as "torah" | "haftarah", note = kind === "torah" ? "Genesis 18:2" : "Isaiah 54:2";
    return route.fulfill(reply({ ok: true, view: { kind, readingKey: kind === "torah" ? "vayera" : null, tickable: false, additions: null,
      base: { version: 1, label: LABEL, overview: "A synthetic overview.", updatedAt: "2026-10-28T00:00:00.000Z",
        themes: [{ id: "synthetic-theme", title: "A synthetic theme", intro: "A synthetic intro.", read: false, readVersion: 0, notes: [{ verseRef: note, body: "A synthetic note.", sources: [] }] }] } } }));
  });
  await page.route("**/api/students/*/service-plan?*", route => route.fulfill(reply({ state: "no-plan" })));
}

test("a student's booklet renders its sections by test id, in trope colour, with a black and white switch", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The booklet is a print page; one desktop check.");
  await mock(page);
  await page.goto(`/print/booklet/${SID}`);
  for (const id of ["booklet-cover", "booklet-blessings", "booklet-about-torah", "booklet-reading-torah", "booklet-practice-torah", "booklet-haftarah",
    "booklet-about-haftarah", "booklet-reading-haftarah", "booklet-practice-haftarah", "booklet-credits"]) await expect(page.getByTestId(id), id).toBeVisible();
  // Study v6 (2026-10-28): the mocked guide still carries a base theme and note, and neither prints; the overview does.
  await expect(page.getByText("A synthetic note.")).toHaveCount(0);
  await expect(page.getByText("A synthetic theme")).toHaveCount(0);
  await expect(page.getByText("A synthetic overview.").first()).toBeVisible();
  await expect(page.getByTestId("booklet-service")).toHaveCount(0);
  await expect(page.locator("[data-booklet-aliyah]")).toHaveCount(3);
  await expect(page.locator("[data-booklet-document]")).toHaveAttribute("data-colour", "trope");
  await page.getByTestId("booklet-black-and-white").check();
  await expect(page.locator("[data-booklet-document]")).toHaveAttribute("data-colour", "black-and-white");
  await expect(page.getByRole("button", { name: "Print", exact: true })).toBeEnabled();
});
