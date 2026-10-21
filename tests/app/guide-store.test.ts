import { expect, test, vi } from "vitest";
import { GuideStore } from "../../src/components/portal/workspace/study/guide-store";
import { GuideError, parseGuideView, type GuideOperation, type StudentGuideView } from "../../src/components/portal/workspace/study/guide-api";
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
  const request = vi.fn(async () => view());
  const store = new GuideStore(request); store.configure(baseline());
  await store.load("torah");
  expect(request).toHaveBeenCalledWith(baseline(), "torah", { type: "view" }, expect.any(AbortSignal), undefined);
  expect(store.view("torah")?.base?.themes[0].id).toBe("cloud"); expect(store.loaded("torah")).toBe(true);
});

test("tick sends expectedVersion and applies result", async () => {
  const calls: GuideOperation[] = [];
  const store = new GuideStore(async (_b, _k, op) => { calls.push(op); return op.type === "view" ? view([theme("cloud", false, 4)]) : { themeId: "cloud", read: true, version: 5 }; });
  store.configure(baseline()); await store.load("torah");
  const pending = store.tick("torah", "cloud", true);
  expect(store.view("torah")?.base?.themes[0].read).toBe(true); expect(store.pending("torah", "cloud")).toBe(true);
  await pending;
  expect(calls[1]).toEqual({ type: "theme-read", readingKey: "pekudei", themeId: "cloud", read: true, expectedVersion: 4 });
  expect(store.view("torah")?.base?.themes[0]).toMatchObject({ read: true, readVersion: 5 }); expect(store.pending("torah", "cloud")).toBe(false);
});

test("conflict refetches", async () => {
  let views = 0;
  const store = new GuideStore(async (_b, _k, op) => {
    if (op.type === "view") { views++; return view([theme("cloud", views > 1, views > 1 ? 1 : 0)]); }
    throw new GuideError(409, "conflict");
  });
  store.configure(baseline()); await store.load("torah");
  await store.tick("torah", "cloud", true);
  expect(views).toBe(2);
  expect(store.view("torah")?.base?.themes[0]).toMatchObject({ read: true, readVersion: 1 });
  expect(store.notice("torah", "cloud")).toContain("latest");
});

test("a failed tick reverts and never retries; a view that is not tickable offers nothing", async () => {
  const request = vi.fn(async (_b: Assigned, _k: string, op: GuideOperation) => { if (op.type === "view") return view(); throw new GuideError(503); });
  const store = new GuideStore(request); store.configure(baseline()); await store.load("torah");
  await store.tick("torah", "cloud", true);
  expect(store.view("torah")?.base?.themes[0].read).toBe(false); expect(store.notice("torah", "cloud")).toContain("Couldn't save");
  expect(request).toHaveBeenCalledTimes(2);
  const parent = new GuideStore(vi.fn(async () => view(undefined, false))); parent.configure(baseline("parent")); await parent.load("torah");
  await parent.tick("torah", "cloud", true);
  expect(parent.view("torah")?.base?.themes[0].read).toBe(false);
});

test("a new student or assignment scope drops the old guide", async () => {
  const store = new GuideStore(async () => view()); store.configure(baseline()); await store.load("torah");
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
