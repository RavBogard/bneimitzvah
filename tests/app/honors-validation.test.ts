import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { emptyForm, person } from "./honors-fixture";
import * as v from "../../src/server/honors/validation";

test("normalizes Hebrew/Unicode and preserves ordered groups, repeated names, unknown components and logistics drafts", () => {
  const form = { ...emptyForm(), openingArk: [person(" Same "), person("Same"), person("Avi-Lev O'Name")],
    generationToGeneration: [{ ...person("Synthetic"), relationship: null }], aliyot: [{ startVerse: "Genesis 1:1", participants: [{ ...person("Synthetic"), hebrewName: "שָׁלוֹם", parent1HebrewName: null, parent2HebrewName: null, relationship: null }] }],
    parentalBlessing: { participation: "yes" as const, delivery: null } };
  const actual = v.form(form); expect(actual.openingArk.map(p => p.englishName)).toEqual(["Same", "Same", "Avi-Lev O'Name"]); expect(actual.aliyot[0].participants[0].hebrewName).toBe("שָׁלוֹם".normalize("NFC"));
  expect(v.form({ ...form, openingArk: [person("e\u0301")] }).openingArk[0].englishName).toBe("é");
  for (const participation of [null, "no", "yes"] as const) expect(v.form({ ...emptyForm(), parentalBlessing: { participation, delivery: null } }).parentalBlessing.participation).toBe(participation);
});

test("rejects unknown/prototype/accessor/sparse shapes, duplicate UUIDs, markup, controls and malformed Unicode", () => {
  const p = person();
  const accessor = Object.defineProperty({ id: randomUUID() }, "englishName", { enumerable: true, get() { throw new Error("Getter must not execute"); } });
  const arrayAccessor = Object.defineProperty([], "0", { enumerable: true, get() { throw new Error("Array getter must not execute"); } });
  for (const bad of [ { ...emptyForm(), notes: "forbidden" }, { ...emptyForm(), openingArk: [Object.assign(Object.create({ phone: "forbidden" }), p)] }, { ...emptyForm(), openingArk: [accessor] },
    { ...emptyForm(), openingArk: arrayAccessor }, { ...emptyForm(), openingArk: new Array(1) }, { ...emptyForm(), openingArk: [p], closingArk: [p] },
    { ...emptyForm(), parentalBlessing: { participation: "no", delivery: "together" } }, ...["", "   ", "<b>Name</b>", "Name\n", "Name\u202e", "\ud800"].map(n => ({ ...emptyForm(), openingArk: [person(n)] })) ]) expect(() => v.form(bad)).toThrow();
});

test("enforces UTF8, per-list/whole-form/1000 mapping and complete normalized payload bounds", () => {
  expect(v.form({ ...emptyForm(), openingArk: [person("א".repeat(128))] }).openingArk).toHaveLength(1);
  for (const form of [{ ...emptyForm(), openingArk: [person("א".repeat(129))] }, { ...emptyForm(), openingArk: Array.from({ length: 33 }, () => person()) },
    { ...emptyForm(), generationToGeneration: [{ ...person(), relationship: "r".repeat(161) }] },
    { ...emptyForm(), aliyot: Array.from({ length: 1001 }, (_, i) => ({ startVerse: `Genesis 1:${i + 1}`, participants: [] })) },
    { ...emptyForm(), aliyot: Array.from({ length: 9 }, (_, i) => ({ startVerse: `Genesis 1:${i + 1}`, participants: Array.from({ length: 32 }, () => ({ ...person(), hebrewName: null, parent1HebrewName: null, parent2HebrewName: null, relationship: null })) })) }]) expect(() => v.form(form)).toThrow();
  const large = { ...emptyForm(), aliyot: Array.from({ length: 8 }, (_, i) => ({ startVerse: `Genesis 1:${i + 1}`, participants: Array.from({ length: 32 }, () => ({ ...person("a".repeat(256)), hebrewName: "b".repeat(256), parent1HebrewName: null, parent2HebrewName: null, relationship: null })) })) };
  expect(() => v.form(large)).toThrow();
  expect(v.form({ ...emptyForm(), aliyot: Array.from({ length: 1000 }, (_, i) => ({ startVerse: `Genesis 1:${i + 1}`, participants: [] })) }).aliyot).toHaveLength(1000);
});
