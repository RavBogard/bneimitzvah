import { describe, expect, it } from "vitest";
import { independentPreparation, preparationJoin, preparationParts, preparationStep, startPreparation } from "../../src/lib/learn/preparation";
import { lessonById } from "../../src/lib/learn/course";
import { completeLesson, emptyProgress, parseProgress } from "../../src/lib/learn/progress";
import { A, end, verse, w } from "./learn-synthetic";

describe("a guided preparation task", () => {
  it("uses actual complete phrases for each part and keeps their transition in join practice", () => {
    const torah = verse("Genesis 1:1", [w(A.mercha), w(A.tipcha), w(A.etnachta), w(A.mercha), w(A.tipcha), w(A.mercha), end()]);
    const parts = preparationParts(torah);
    expect(parts).toEqual([[0, 2], [3, 6]]);
    expect(preparationJoin(parts, 0)).toEqual([0, 6]);
    const haftarah = verse("Isaiah 40:1", [w(A.mercha), w(A.tipcha), w(A.etnachta), w(A.tipcha), end()], "haftarah");
    expect(preparationParts(haftarah)).toEqual([[0, 2], [3, 4]]);
  });
  it("moves from preparing each part to joins and an independent whole; repairs do not award accuracy", () => {
    let state = startPreparation();
    state = preparationStep(state, { type: "part", part: 0 });
    state = preparationStep(state, { type: "stage", stage: "word-repair" });
    state = preparationStep(state, { type: "word", word: 1 });
    state = preparationStep(state, { type: "stage", stage: "echo" });
    expect(state.word).toBe(1);
    state = preparationStep(state, { type: "next-part", count: 3 });
    expect(state).toMatchObject({ stage: "words", part: 1, word: null });
    state = preparationStep(state, { type: "next-part", count: 3 });
    state = preparationStep(state, { type: "next-part", count: 3 });
    expect(state).toMatchObject({ stage: "join-model", join: 0 });
    state = preparationStep(state, { type: "next-join", count: 3 });
    expect(state).toMatchObject({ stage: "join-model", join: 1 });
    state = preparationStep(state, { type: "next-join", count: 3 });
    expect(state.stage).toBe("whole-attempt");
    expect(independentPreparation(state.stage)).toBe(true);
    expect(independentPreparation("join-attempt")).toBe(true);
    expect(independentPreparation("check")).toBe(false);
  });
  it("keeps existing lesson completion IDs, card history and the progress schema", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const old = completeLesson(emptyProgress(), lessonById("torah-etnachta")!, now);
    const practiced = completeLesson(old, lessonById("torah-first-verse")!, now);
    expect(practiced.cards).toEqual(old.cards);
    expect(practiced.lessons["torah-etnachta"]).toEqual(old.lessons["torah-etnachta"]);
    expect(practiced.lessons["torah-first-verse"]).toBeDefined();
    expect(parseProgress(JSON.parse(JSON.stringify(practiced)))).toEqual(practiced);
  });
  it("lets whole-verse repair choose a word from any part and returns to its real phrase", () => {
    let state = preparationStep(startPreparation(), { type: "stage", stage: "whole-check" });
    state = preparationStep(state, { type: "stage", stage: "word-repair" });
    expect(state.repairScope).toBe("whole");
    state = preparationStep(state, { type: "word", word: 6, part: 2 });
    expect(state).toMatchObject({ stage: "word-repair", part: 2, word: 6, repairScope: "part" });
    state = preparationStep(state, { type: "stage", stage: "echo" });
    expect(state.part).toBe(2);
    state = preparationStep(state, { type: "part", part: 0, stage: "tune-repair" });
    expect(state).toMatchObject({ stage: "tune-repair", part: 0, word: null });
  });
  it("gates the temporary learner-reported result behind an explicit whole-verse comparison", () => {
    const initial = startPreparation();
    expect(preparationStep(initial, { type: "self-report", same: true })).toEqual(initial);
    expect(preparationStep(initial, { type: "stage", stage: "summary" }).selfComparison).toBeNull();
    const check = preparationStep(initial, { type: "stage", stage: "whole-check" });
    const notYet = preparationStep(check, { type: "self-report", same: false });
    expect(notYet).toMatchObject({ stage: "choose-part", selfComparison: null });
    const same = preparationStep(check, { type: "self-report", same: true });
    expect(same).toMatchObject({ stage: "summary", selfComparison: "same" });
    expect(preparationStep(same, { type: "stage", stage: "whole-attempt" }).selfComparison).toBeNull();
    expect(preparationStep(same, { type: "stage", stage: "summary" }).selfComparison).toBeNull();
  });
});
