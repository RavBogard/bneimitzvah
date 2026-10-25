import { describe, expect, it } from "vitest";
import { addDays, BOX_DAYS, effectiveDue } from "../../src/lib/learn/progress";
import { addVerseCards, answerVerseRun, compareVerseIds, currentVerse, dueVerses, emptyVerseReview, joinWith, JOIN_OFFER_ENABLED, mergeVerseReview, parseVerseCardId,
  parseVerseReview, practiseAgain, recordVerse, serializeVerseReview, startVerseRun, stumbledRefs, suggestedHelp, verseCardId, verseRunDone, VERSE_REVIEW_LIMITS,
  VERSE_REVIEW_SCHEMA, type VerseCardId } from "../../src/lib/learn/verse-review";

// 1.9 N19: the student's own verse cards. Pure; every date is passed in. Synthetic dates and Noa's synthetic assignment only.
const D = "2026-11-02", NOA = verseCardId("torah", "Genesis 23:1");
const doc = (cards: Record<string, [number, string]>) => ({ schema: VERSE_REVIEW_SCHEMA, cards: Object.fromEntries(Object.entries(cards).map(([id, [box, due]]) => [id, { box, due }])) });

describe("the learn-verses/v1 document", () => {
  it("parses strictly: real verses in their own melody, real boxes and dates, two keys, a bounded size", () => {
    expect(parseVerseReview(doc({ [NOA]: [1, D], "haftarah|Isaiah 40:1": [0, D] }))).toEqual(doc({ [NOA]: [1, D], "haftarah|Isaiah 40:1": [0, D] }));
    for (const bad of [{ ...doc({}), extra: 1 }, { schema: "learn-progress/v1", cards: {} }, { schema: VERSE_REVIEW_SCHEMA }, { schema: VERSE_REVIEW_SCHEMA, cards: [] },
      doc({ "torah|Isaiah 40:1": [1, D] }), doc({ "haftarah|Genesis 23:1": [1, D] }), doc({ "torah|Genesis 50:27": [1, D] }), doc({ "torah|Genesis 23": [1, D] }), doc({ "Genesis 23:1": [1, D] }),
      doc({ [NOA]: [BOX_DAYS.length, D] }), doc({ [NOA]: [-1, D] }), doc({ [NOA]: [1, "2026-02-30"] }), { schema: VERSE_REVIEW_SCHEMA, cards: { [NOA]: { box: 1, due: D, extra: 1 } } }, null, [], "x"])
      expect(parseVerseReview(bad), JSON.stringify(bad)).toBeNull();
    const many = Object.fromEntries(Array.from({ length: VERSE_REVIEW_LIMITS.cards + 1 }, (_, i) => [verseCardId("torah", `Genesis ${1 + Math.floor(i / 20)}:${1 + i % 20}`), [1, D] as [number, string]]));
    expect(parseVerseReview(doc(many))).toBeNull();
  });
  it("names a card by melody and verse, and orders Torah before haftarah, then in reading order", () => {
    expect(parseVerseCardId(NOA)).toEqual({ kind: "torah", ref: "Genesis 23:1" });
    expect(["haftarah|Isaiah 40:1", "torah|Genesis 23:10", "torah|Genesis 23:2", "torah|Exodus 1:1"].sort(compareVerseIds)).toEqual(["torah|Genesis 23:2", "torah|Genesis 23:10", "torah|Exodus 1:1", "haftarah|Isaiah 40:1"]);
  });
  it("serializes what it parses, and refuses a document over its size", () => {
    const review = addVerseCards(emptyVerseReview(), [NOA], D);
    expect(parseVerseReview(JSON.parse(serializeVerseReview(review)!))).toEqual(review);
  });
});

describe("Got it and Solid verses as review cards", () => {
  it("a verse marked Got it comes back in review within its box interval, and every box after it", () => {
    let review = addVerseCards(emptyVerseReview(), [NOA], D);
    expect(review.cards[NOA]).toEqual({ box: 1, due: addDays(D, BOX_DAYS[1]) });
    expect(dueVerses(review, D)).toEqual([]);
    let today = addDays(D, BOX_DAYS[1]);
    expect(dueVerses(review, today)).toEqual([NOA]);
    for (let box = 2; box < BOX_DAYS.length; box++) {
      review = recordVerse(review, NOA, true, today);
      expect(review.cards[NOA]).toEqual({ box, due: addDays(today, BOX_DAYS[box]) });
      expect(dueVerses(review, addDays(today, BOX_DAYS[box] - 1))).toEqual([]);
      today = addDays(today, BOX_DAYS[box]);
      expect(dueVerses(review, today)).toEqual([NOA]);
    }
  });
  it("never comes back after the ceremony date: gaps close in on it and no due is later than the day before", () => {
    const until = addDays(D, 12);
    let review = addVerseCards(emptyVerseReview(), [NOA], D, until), today = D;
    const asked: string[] = [];
    for (let guard = 0; guard < 40 && today < until; guard++) {
      const due = effectiveDue(review.cards[NOA], today, until);
      expect(due < until).toBe(true);
      today = due > today ? due : addDays(today, 1);
      if (today >= until) break;
      expect(dueVerses(review, today, until)).toEqual([NOA]);
      asked.push(today);
      review = recordVerse(review, NOA, true, today, { until });
    }
    expect(asked.length).toBeGreaterThan(2);
    expect(asked.every(day => day < until)).toBe(true);
    // A card due long after the ceremony is asked on the day before it at the latest.
    const far = parseVerseReview(doc({ [NOA]: [5, addDays(until, 30)] }))!;
    expect(dueVerses(far, addDays(until, -2), until)).toEqual([]);
    expect(dueVerses(far, addDays(until, -1), until)).toEqual([NOA]);
    // After the ceremony nothing is asked, even a card marked Got it on the day itself.
    const onTheDay = addVerseCards(emptyVerseReview(), [NOA], until, until);
    for (const day of [addDays(until, 1), addDays(until, 30)]) { expect(dueVerses(onTheDay, day, until)).toEqual([]); expect(dueVerses(far, day, until)).toEqual([]); }
  });
  it("keeps an existing card in place when the same verse is marked again", () => {
    const review = parseVerseReview(doc({ [NOA]: [4, "2026-12-01"] }))!;
    expect(addVerseCards(review, [NOA], D)).toBe(review);
  });
});

describe("a verse result", () => {
  it("feeds review on a stumble: a new card in box 0 due today, an existing one two boxes down", () => {
    const fresh = recordVerse(emptyVerseReview(), NOA, false, D);
    expect(fresh.cards[NOA]).toEqual({ box: 0, due: D });
    expect(dueVerses(fresh, D)).toEqual([NOA]);
    const settled = parseVerseReview(doc({ [NOA]: [3, "2026-12-01"] }))!;
    expect(recordVerse(settled, NOA, false, D).cards[NOA]).toEqual({ box: 1, due: D });
    expect(dueVerses(recordVerse(settled, NOA, false, D), D)).toEqual([NOA]);
  });
  it("moves a card up on Clean only when it is due, and only once per run", () => {
    const early = parseVerseReview(doc({ [NOA]: [2, addDays(D, 2)] }))!;
    expect(recordVerse(early, NOA, true, D)).toBe(early);
    expect(recordVerse(emptyVerseReview(), NOA, true, D)).toEqual(emptyVerseReview());
    const due = parseVerseReview(doc({ [NOA]: [2, D] }))!, moved = new Set<string>();
    const once = recordVerse(due, NOA, true, D, { moved });
    expect(once.cards[NOA].box).toBe(3);
    expect(recordVerse({ ...once, cards: { ...once.cards, [NOA]: { box: 3, due: D } } }, NOA, true, D, { moved }).cards[NOA]).toEqual({ box: 3, due: D });
  });
  it("merges two devices' cards at the higher box", () => {
    const a = parseVerseReview(doc({ [NOA]: [1, D], "torah|Genesis 23:2": [3, D] }))!, b = parseVerseReview(doc({ [NOA]: [2, addDays(D, 3)] }))!;
    expect(mergeVerseReview(a, b)).toEqual(doc({ [NOA]: [2, addDays(D, 3)], "torah|Genesis 23:2": [3, D] }));
  });
});

describe("the Run-through", () => {
  const ids = Array.from({ length: 9 }, (_, i) => verseCardId("torah", `Genesis 23:${i + 1}`)) as VerseCardId[];
  it("records one result per verse and names only the stumbled verses, with no tally", () => {
    let run = startVerseRun(ids);
    for (const id of ids) { expect(currentVerse(run)).toBe(id); run = answerVerseRun(run, id.endsWith(":3") || id.endsWith(":8") ? "stumbled" : "clean"); }
    expect(verseRunDone(run)).toBe(true);
    expect(stumbledRefs(run)).toEqual(["Genesis 23:3", "Genesis 23:8"]);
    const line = practiseAgain(stumbledRefs(run));
    expect(line).toBe("Practise verses 3 and 8 again.");
    expect(line).not.toMatch(/Clean|of 9|\b7\b|\b9\b/);
  });
  it("words the summary for one verse, several, across chapters and across books, and says nothing when nothing stumbled", () => {
    expect(practiseAgain(["Genesis 23:3"])).toBe("Practise verse 3 again.");
    expect(practiseAgain(["Genesis 23:10", "Genesis 23:3", "Genesis 23:8"])).toBe("Practise verses 3, 8 and 10 again.");
    expect(practiseAgain(["Genesis 24:2", "Genesis 23:20"])).toBe("Practise verses 23:20 and 24:2 again.");
    expect(practiseAgain(["Isaiah 61:10", "Isaiah 62:1"])).toBe("Practise verses 61:10 and 62:1 again.");
    expect(practiseAgain(["Isaiah 54:1", "I Kings 2:1"])).toBe("Practise verses I Kings 2:1 and Isaiah 54:1 again.");
    expect(practiseAgain([])).toBeNull();
  });
  it("suggests the fade and never locks it: a Run-through starts with the colours off, settled verses suggest the tikkun", () => {
    expect(suggestedHelp(undefined, "run-through")).toBe("marks");
    expect(suggestedHelp({ box: 1, due: D }, "run-through")).toBe("marks");
    expect(suggestedHelp({ box: 0, due: D }, "review")).toBe("colors");
    expect(suggestedHelp({ box: 2, due: D }, "review")).toBe("marks");
    expect(suggestedHelp({ box: 3, due: D }, "review")).toBe("tikkun");
    expect(suggestedHelp({ box: 5, due: D }, "run-through")).toBe("tikkun");
  });
  it("builds the stumble's join with its neighbour but keeps it off, since its wording is a gap", () => {
    const run = startVerseRun(ids);
    expect(joinWith(run, ids[2])).toEqual([ids[1], ids[2]]);
    expect(joinWith(run, ids[0])).toEqual([ids[0], ids[1]]);
    expect(JOIN_OFFER_ENABLED).toBe(false);
  });
});
