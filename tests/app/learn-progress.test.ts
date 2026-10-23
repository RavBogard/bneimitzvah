import { describe, expect, it } from "vitest";
import { lessonById, pathLessons } from "../../src/lib/learn/course";
import { BOX_DAYS, gapDays, mergeProgress, PROGRESS_KEY, PROGRESS_LIMITS, addDays, answerCard, browserProgressStore, comesBack, completeLesson, composeReview, courseDone, dueCards, emptyProgress, heard,
  isUnlocked, lessonCards, localDay, nextLesson, parseProgress, recordAnswer, reviewSummary, serializeProgress, type Progress } from "../../src/lib/learn/progress";
import { seededRandom } from "../../src/lib/learn/pools";
import { COURSE } from "../../src/lib/learn/course";

// Fixed clocks only: noon local time on a Tuesday, so a local day never slips across midnight.
const TUESDAY = new Date(2026, 9, 20, 12).getTime(), DAY = 86_400_000;
const today = localDay(TUESDAY);
const done = (progress: Progress, ...ids: string[]) => ids.reduce((value, id) => completeLesson(value, lessonById(id)!, TUESDAY), progress);
class MemoryStorage { values = new Map<string, string>(); fail = false;
  getItem(key: string) { if (this.fail) throw Error("blocked"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw Error("blocked"); this.values.set(key, value); } }

describe("the Leitner scheduler", () => {
  it("moves a right answer up one box and drops a wrong one two, back today", () => {
    expect(BOX_DAYS).toEqual([0, 1, 3, 7, 16, 35]);
    expect(answerCard({ box: 1, due: today }, true, today)).toEqual({ box: 2, due: addDays(today, 3) });
    expect(answerCard({ box: 5, due: today }, true, today)).toEqual({ box: 5, due: addDays(today, 35) });
    expect(answerCard({ box: 3, due: today }, false, today)).toEqual({ box: 1, due: addDays(today, 1) });
    expect(answerCard({ box: 1, due: today }, false, today)).toEqual({ box: 0, due: today });
  });
  it("gives a done lesson its cards in box 1, due tomorrow, and keeps existing cards where they are", () => {
    const lesson = lessonById("torah-etnachta")!;
    expect(lessonCards(lesson)).toEqual(expect.arrayContaining(["etnachta:torah:name", "etnachta:torah:end"]));
    const progress = done(emptyProgress(), "torah-etnachta");
    expect(progress.lessons["torah-etnachta"].done).toBe(new Date(TUESDAY).toISOString());
    expect(progress.cards["etnachta:torah:name"]).toEqual({ box: 1, due: addDays(today, 1) });
    const moved = recordAnswer(progress, "etnachta:torah:name", true, today);
    expect(completeLesson(moved, lesson, TUESDAY + DAY).cards["etnachta:torah:name"].box).toBe(2);
    expect(recordAnswer(progress, "zakef:torah:name", true, today)).toBe(progress);
    expect(lessonCards(lessonById("intro-phrases")!)).toEqual([]);
  });
  it("moves a card up at most one box in one run, however often it comes up right, but still drops it on a miss", () => {
    const moved = new Set<string>();
    let progress = done(emptyProgress(), "torah-sof-pasuk");
    for (let i = 0; i < 8; i++) progress = recordAnswer(progress, "sof-pasuk:torah:name", true, today, { moved });
    expect(progress.cards["sof-pasuk:torah:name"].box).toBe(2);
    progress = recordAnswer(progress, "sof-pasuk:torah:name", false, today, { moved });
    expect(progress.cards["sof-pasuk:torah:name"].box).toBe(0);
  });
});

describe("the course path", () => {
  it("unlocks in order, offers the haftarah path after the two endings, and names one next lesson", () => {
    let progress = emptyProgress();
    expect(nextLesson(progress)!.id).toBe("intro-phrases");
    expect(isUnlocked(progress, lessonById("torah-sof-pasuk")!)).toBe(false);
    progress = done(progress, "intro-phrases", "torah-sof-pasuk");
    expect(nextLesson(progress)!.id).toBe("torah-etnachta");
    expect(isUnlocked(progress, lessonById("haftarah-sof-pasuk")!)).toBe(false);
    progress = done(progress, "torah-etnachta");
    expect(isUnlocked(progress, lessonById("haftarah-sof-pasuk")!)).toBe(true);
    expect(nextLesson(progress)!.id).toBe("torah-zakef");
    expect(heard(progress, "torah")).toEqual({ heard: 2, of: 10 });
    expect(heard(progress, "haftarah")).toEqual({ heard: 0, of: 11 });
    progress = done(progress, ...pathLessons("torah").map(l => l.id));
    expect(nextLesson(progress)!.id).toBe("haftarah-sof-pasuk");
    progress = done(progress, ...pathLessons("haftarah").map(l => l.id));
    expect(nextLesson(progress)).toBeNull();
    expect(courseDone(progress)).toBe(true);
  });
  it("lets a linked lesson be done out of order without relocking anything", () => {
    const progress = done(emptyProgress(), "torah-pazer");
    expect(isUnlocked(progress, lessonById("torah-pazer")!)).toBe(true);
    expect(nextLesson(progress)!.id).toBe("intro-phrases");
  });
});

describe("review", () => {
  const studied = () => done(emptyProgress(), "intro-phrases", "torah-sof-pasuk", "torah-etnachta", "torah-zakef", "torah-revia");
  it("shows nothing until a card is due, then the phrases due and about how long", () => {
    const progress = studied();
    expect(reviewSummary(progress, today)).toBeNull();
    const tomorrow = addDays(today, 1), due = dueCards(progress, tomorrow);
    expect(due.length).toBeGreaterThan(4);
    expect(reviewSummary(progress, tomorrow)).toEqual({ phrases: 4, minutes: 2 });
  });
  it("composes 8 to 12 slots, each due card at least once, confusable families back to back and no card twice in a row", () => {
    const progress = studied(), tomorrow = addDays(today, 1), due = dueCards(progress, tomorrow);
    const slots = composeReview(progress, tomorrow, seededRandom(4));
    expect(slots.length).toBeGreaterThanOrEqual(8);
    expect(slots.length).toBeLessThanOrEqual(12);
    for (const id of due) expect(slots.some(slot => slot.card === id)).toBe(true);
    for (let i = 1; i < slots.length; i++) expect(slots[i].card).not.toBe(slots[i - 1].card);
    const neighbours = slots.slice(1).filter((slot, i) => COURSE.families[slots[i].family].confusedWith.includes(slot.family)).length;
    expect(neighbours).toBeGreaterThan(0);
    expect(composeReview(emptyProgress(), today, seededRandom(1))).toEqual([]);
  });
  it("says when the reviewed phrases come back: a weekday, or next week beyond seven days", () => {
    let progress = studied();
    const ids = dueCards(progress, addDays(today, 1));
    expect(comesBack(progress, ids, today)).toEqual({ weekday: "Wednesday" });
    for (const id of ids) progress = recordAnswer(recordAnswer(recordAnswer(progress, id, true, today), id, true, today), id, true, today);
    expect(comesBack(progress, ids, today)).toEqual({ nextWeek: true });
  });
});

describe("browser storage", () => {
  it("round-trips progress through one key and survives a reload", () => {
    const storage = new MemoryStorage(), store = browserProgressStore(() => storage as unknown as Storage);
    const progress = done(emptyProgress(), "intro-phrases", "torah-sof-pasuk");
    expect(store.save(progress)).toBe(true);
    expect([...storage.values.keys()]).toEqual([PROGRESS_KEY]);
    expect(browserProgressStore(() => storage as unknown as Storage).load()).toEqual(progress);
  });
  it("starts fresh, never errors, on corrupt, foreign, oversized or blocked storage", () => {
    const storage = new MemoryStorage(), store = browserProgressStore(() => storage as unknown as Storage);
    for (const bad of ["{", "null", "[]", '"x"', JSON.stringify({ schema: "learn-progress/v2", lessons: {}, cards: {} }),
      JSON.stringify({ schema: "learn-progress/v1", lessons: { "no-such": { done: "2026-10-20T10:00:00.000Z" } }, cards: {} }),
      JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: { "zakef:torah:name": { box: 9, due: "2026-10-21" } } }),
      JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: { "sof-haftarah:torah:name": { box: 1, due: "2026-10-21" } } }),
      JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: { "zakef:torah:name": { box: 1, due: "2026-02-30" } } }),
      JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: {}, extra: 1 }),
      "x".repeat(PROGRESS_LIMITS.bytes + 1)]) {
      storage.values.set(PROGRESS_KEY, bad);
      expect(store.load(), bad.slice(0, 60)).toEqual(emptyProgress());
    }
    storage.fail = true;
    expect(store.load()).toEqual(emptyProgress());
    expect(store.save(emptyProgress())).toBe(false);
    expect(browserProgressStore(() => null).load()).toEqual(emptyProgress());
  });
  it("parses only the closed v1 shape and keeps it under the size bound", () => {
    const progress = done(emptyProgress(), ...COURSE.lessons.map(lesson => lesson.id));
    expect(parseProgress(JSON.parse(serializeProgress(progress)!))).toEqual(progress);
    expect(serializeProgress(progress)!.length).toBeLessThan(PROGRESS_LIMITS.bytes);
  });
});

describe("signed-in progress", () => {
  it("merges two copies: every lesson either finished with its earliest done, every card at the higher box with that copy's due", () => {
    const early = "2026-10-01T10:00:00.000Z", late = "2026-10-05T10:00:00.000Z";
    const browser = parseProgress({ schema: "learn-progress/v1", lessons: { "intro-phrases": { done: late }, "torah-sof-pasuk": { done: late } },
      cards: { "sof-pasuk:torah:name": { box: 3, due: "2026-10-30" }, "etnachta:torah:name": { box: 1, due: "2026-10-21" } } })!;
    const account = parseProgress({ schema: "learn-progress/v1", lessons: { "intro-phrases": { done: early }, "torah-etnachta": { done: late } },
      cards: { "sof-pasuk:torah:name": { box: 2, due: "2026-10-22" }, "etnachta:torah:name": { box: 1, due: "2026-10-20" }, "zakef:torah:name": { box: 4, due: "2026-11-10" } } })!;
    const merged = mergeProgress(browser, account);
    expect(merged.lessons).toEqual({ "intro-phrases": { done: early }, "torah-etnachta": { done: late }, "torah-sof-pasuk": { done: late } });
    expect(merged.cards).toEqual({ "etnachta:torah:name": { box: 1, due: "2026-10-20" }, "sof-pasuk:torah:name": { box: 3, due: "2026-10-30" }, "zakef:torah:name": { box: 4, due: "2026-11-10" } });
    expect(mergeProgress(account, browser)).toEqual(merged);
    expect(mergeProgress(merged, merged)).toEqual(merged);
    expect(parseProgress(JSON.parse(serializeProgress(merged)!))).toEqual(merged);
    expect(mergeProgress(emptyProgress(), browser)).toEqual(mergeProgress(browser, emptyProgress()));
  });
  it("caps every gap at a fifth of the days left before a known date, and resumes the normal gaps after it", () => {
    expect(gapDays(5, "2026-10-20", null)).toBe(35);
    expect(gapDays(5, "2026-10-20", "2027-10-20")).toBe(35);
    expect(gapDays(5, "2026-10-20", "2026-12-09")).toBe(10);
    expect(gapDays(3, "2026-10-20", "2026-10-30")).toBe(2);
    expect(gapDays(2, "2026-10-20", "2026-10-22")).toBe(1);
    expect(gapDays(0, "2026-10-20", "2026-10-22")).toBe(0);
    expect(gapDays(4, "2026-10-20", "2026-10-20")).toBe(16);
    expect(gapDays(4, "2026-10-20", "2026-10-01")).toBe(16);
    // Each review then lands within the final fifth of the time left, closing in on the date.
    let today = "2026-10-20"; const until = "2026-12-31"; const seen: number[] = [];
    for (let box = 1; today < until && seen.length < 40; box = Math.min(5, box + 1)) { const gap = gapDays(box, today, until); seen.push(gap); today = addDays(today, gap); }
    expect(today).toBe(until);
    expect(Math.max(...seen.slice(-3))).toBeLessThanOrEqual(2);
    const card = recordAnswer(done(emptyProgress(), "torah-sof-pasuk"), "sof-pasuk:torah:name", true, "2026-10-20", { until: "2026-10-30" }).cards["sof-pasuk:torah:name"];
    expect(card).toEqual({ box: 2, due: "2026-10-22" });
  });
});
