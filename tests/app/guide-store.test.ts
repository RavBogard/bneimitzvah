import { expect, test, vi } from "vitest";
import { GuideStore } from "../../src/components/portal/workspace/study/guide-store";
import type { StudyKind } from "../../src/components/portal/workspace/study/api";
import { parseGuideView, type GuideOperation, type StudentGuideView } from "../../src/components/portal/workspace/study/guide-api";
import type { Assigned } from "../../src/components/portal/workspace/api";

const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const baseline = (mode: Assigned["mode"] = "student", readingKey: string | null = "pekudei"): Assigned => ({
  student: { id: a, firstName: "Synthetic", lastName: "Student", ceremonyDate: "2027-03-13", revision: 1 } as Assigned["student"], mode, context: null,
  readings: [{ id: b, kind: "torah", revision: 1, ranges: ["Exodus 40:34-35"], verses: ["Exodus 40:34", "Exodus 40:35"], needsReview: false, aliyahStarts: null, readingKey,
    source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "custom" }],
});
const theme = (id: string, read = false, readVersion = 0) => ({ id, title: "A finished work", intro: "Invented.", notes: [{ verseRef: "Exodus 40:34", body: "Invented note.", sources: [] }], read, readVersion });
const view = (themes = [theme("cloud")], tickable = true): StudentGuideView => ({ kind: "torah", readingKey: "pekudei", tickable,
  base: { version: 1, label: { origin: "claude", reviewed: false, rabbiName: "the rabbi" }, overview: "Invented overview.", themes, updatedAt: "2026-10-21T00:00:00.000Z" }, additions: null });

test("loads view for kind", async () => {
  const request = vi.fn(async () => ({ view: view(), sheet: null }));
  const store = new GuideStore(request); store.configure(baseline());
  await store.load("torah");
  expect(request).toHaveBeenCalledWith(baseline(), "torah", { type: "view" }, expect.any(AbortSignal), undefined);
  expect(store.view("torah")?.base?.themes[0].id).toBe("cloud"); expect(store.loaded("torah")).toBe(true);
});

test("\"I read this\" is gone: the store has no tick, no pending state and no notice, and the only request it ever makes is the view", async () => {
  const request = vi.fn(async (_b: Assigned, _k: StudyKind, op: GuideOperation) => { expect(op).toEqual({ type: "view" }); return { view: view(), sheet: null }; });
  const store = new GuideStore(request); store.configure(baseline()); await store.load("torah");
  for (const name of ["tick", "pending", "notice"]) expect(name in store).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  // The payload's read marks are inert: nothing in the store or the view writes them.
  expect(store.view("torah")?.base?.themes.every(row => row.read === false)).toBe(true);
});

test("a new student or assignment scope drops the old guide", async () => {
  const store = new GuideStore(async () => ({ view: view(), sheet: null })); store.configure(baseline()); await store.load("torah");
  store.configure({ ...baseline(), readings: [{ ...baseline().readings[0], revision: 2 }] });
  expect(store.view("torah")).toBeNull();
});

test("parser rejects a note outside the student's verses, a mismatched reading key and a tickable parent view", () => {
  const ok = { ok: true, view: view() };
  expect(parseGuideView(ok, baseline(), "torah")?.base?.themes).toHaveLength(1);
  expect(parseGuideView({ ok: true, view: null }, baseline(), "torah")).toBeNull();
  const outside = view([{ ...theme("cloud"), notes: [{ verseRef: "Exodus 39:1", body: "x", sources: [] }] }]);
  expect(() => parseGuideView({ ok: true, view: outside }, baseline(), "torah")).toThrow();
  expect(() => parseGuideView(ok, baseline("student", "vayakhel"), "torah")).toThrow();
  expect(() => parseGuideView(ok, baseline("parent"), "torah")).toThrow();
  expect(() => parseGuideView({ ...ok, extra: 1 }, baseline(), "torah")).toThrow();
  expect(() => parseGuideView({ ok: true, view: { ...view(), base: null } }, baseline(), "torah")).toThrow();
});

test("sheet links are haftarah-only and must be a library week page", async () => {
  const { parseSheet } = await import("../../src/components/portal/workspace/study/guide-api");
  expect(parseSheet({ ok: true, view: null }, "haftarah")).toBeNull();
  expect(parseSheet({ ok: true, view: null, sheet: null }, "haftarah")).toBeNull();
  expect(parseSheet({ ok: true, view: null, sheet: "https://haftarah.centralreform.org/2026-10-17-noach" }, "haftarah")).toBe("https://haftarah.centralreform.org/2026-10-17-noach");
  for (const sheet of ["https://haftarah.centralreform.org/2026-10-17-noach", "https://evil.example/2026-10-17-noach", "https://haftarah.centralreform.org/../x", "javascript:alert(1)", 7])
    expect(() => parseSheet({ ok: true, view: null, sheet }, sheet === "https://haftarah.centralreform.org/2026-10-17-noach" ? "torah" : "haftarah")).toThrow();
});
