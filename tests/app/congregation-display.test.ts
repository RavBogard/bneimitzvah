import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { ServiceSlotName } from "../../src/components/portal/workspace/reading";
import { serviceSlotLine, serviceSlotName, serviceSlotTime, standardSlotName } from "../../src/components/portal/workspace/service-slot";
import { parseCongregation, settingsApi } from "../../src/components/portal/workspace/settings/api";
import { resetCongregationRead } from "../../src/components/portal/workspace/settings/links";
import { savedHonorsPrint } from "../../src/components/portal/workspace/honors/print";
import { PracticeCalendar } from "../../src/components/portal/workspace/practice-calendar/store";
import { StaffPracticeDays } from "../../src/components/portal/workspace/practice-calendar/view";
import type { Assigned } from "../../src/components/portal/workspace/api";
import type { HonorsRead } from "../../src/lib/honors/types";
import type { PracticeDates, PracticeOperation } from "../../src/components/portal/workspace/practice-calendar/api";

afterEach(() => { vi.unstubAllGlobals(); resetCongregationRead(); });
const services = { morning: { label: "Shabbat morning", start: "09:30" }, havdalah: { start: "16:15" } };

test("service names follow the congregation's settings and fall back to the standard wording; no time is implied", () => {
  expect(serviceSlotName("morning")).toBe("Morning service"); expect(serviceSlotName("havdalah", {})).toBe("Havdalah service");
  expect(serviceSlotName("morning", services)).toBe("Shabbat morning"); expect(serviceSlotName("havdalah", services)).toBe("Havdalah service");
  expect(serviceSlotName("unknown", services)).toBeNull(); expect(serviceSlotName(undefined, services)).toBeNull();
  expect(serviceSlotTime("morning")).toBeNull(); expect(serviceSlotTime("morning", services)).toBe("9:30 AM"); expect(serviceSlotTime("havdalah", services)).toBe("4:15 PM");
  expect(serviceSlotTime("morning", { morning: { start: "25:00" } })).toBeNull();
  expect(serviceSlotLine("morning", services)).toBe("Shabbat morning · 9:30 AM"); expect(serviceSlotLine("havdalah", services)).toBe("Havdalah service · 4:15 PM"); expect(serviceSlotLine("morning")).toBe("Morning service");
  expect(standardSlotName("havdalah", services)).toBe(true); expect(standardSlotName("morning", services)).toBe(false);
});

test("the reading header shows the congregation's name, and its start time only in a part phones hide", () => {
  const render = (serviceSlot: "morning" | "havdalah" | "unknown", value?: typeof services) => renderToStaticMarkup(createElement(ServiceSlotName, { student: { serviceSlot }, services: value }));
  expect(render("morning")).toBe('<span class="hero-slot">Morning service</span>');
  expect(render("morning", services)).toBe('<span class="hero-slot">Shabbat morning<span class="hero-slot-time"> · 9:30 AM</span></span>');
  expect(render("unknown", services)).toBe("");
});

test("the members' settings read is closed: links, slot names and times, and the consent notice, each checked with the settings rules", () => {
  const ok = { ok: true, links: { siddurUrl: "https://siddur.centralreform.org/", musicUrl: null }, services, consentNotice: "Synthetic notice.\nSecond line." };
  expect(parseCongregation(ok)).toEqual({ links: ok.links, services, consentNotice: ok.consentNotice });
  expect(parseCongregation({ ...ok, services: {}, consentNotice: null })).toEqual({ links: ok.links, services: {}, consentNotice: null });
  for (const bad of [{ ...ok, extra: 1 }, { ...ok, ok: false }, { ...ok, services: { evening: { label: "Late" } } }, { ...ok, services: { morning: { start: "9:30" } } }, { ...ok, services: { morning: {} } },
    { ...ok, services: { morning: { label: "<b>" } } }, { ...ok, consentNotice: "<script>" }, { ...ok, consentNotice: "" }, { ...ok, consentNotice: "x".repeat(601) },
    { ...ok, links: { ...ok.links, siddurUrl: "https://example.test/" } }, (({ consentNotice: _, ...rest }) => rest)(ok)]) expect(() => parseCongregation(bad)).toThrow();
});

test("one settings read serves the page, and a failed read is not reused", async () => {
  let calls = 0, fail = true;
  vi.stubGlobal("fetch", vi.fn(async () => { calls++; if (fail) return new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, links: { siddurUrl: "https://siddur.centralreform.org/", musicUrl: null }, services: {}, consentNotice: null }), { status: 200, headers: { "content-type": "application/json" } }); }));
  await expect(settingsApi.congregation()).rejects.toThrow(); expect(calls).toBe(1);
  fail = false; expect((await settingsApi.congregation()).consentNotice).toBeNull(); expect(calls).toBe(2);
});

test("the honors print names the congregation's service and time, and keeps the short standard words otherwise", () => {
  const snapshot = { ceremonyDate: "2027-01-02", serviceSlot: "morning", torah: null };
  const read = { needsReview: false, saved: { version: 1, createdAt: "2026-10-01T00:00:00.000Z", reviewedContext: { snapshot, spans: [], status: "none", readingNeedsReview: false, unknownSlot: false },
    form: { openingArk: [], generationToGeneration: [], undressingTorah: [], aliyot: [], redressingTorah: [], closingArk: [], parentalBlessing: { participation: "undecided" } } } } as unknown as HonorsRead;
  expect(savedHonorsPrint(read, "Synthetic Family")[0].lines[1]).toBe("Ceremony: 2027-01-02 · Morning");
  expect(savedHonorsPrint(read, "Synthetic Family", services)[0].lines[1]).toBe("Ceremony: 2027-01-02 · Shabbat morning · 9:30 AM");
});

test("an assigned tutor's or admin's practice days render dates only, under a heading, and nothing for a parent's dashboard", async () => {
  const studentId = "10000000-0000-4000-8000-000000000001";
  const baseline = (mode: Assigned["mode"]) => ({ mode, context: null, student: { id: studentId, firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", revision: 1 }, readings: [] }) as unknown as Assigned;
  const operations: PracticeOperation[] = [];
  const calendar = new PracticeCalendar(async (mode, _id, operation) => { operations.push(operation); if (operation.type !== "calendar") throw new Error("Synthetic write refused");
    return { studentId, mode, serverDay: "2026-10-17", fromDate: operation.fromDate, throughDate: operation.throughDate, dates: ["2026-10-15"] } satisfies PracticeDates; }, () => undefined, () => 20_743);
  calendar.configure(baseline("parent")); await calendar.load();
  expect(renderToStaticMarkup(createElement(StaffPracticeDays, { calendar, firstName: "Synthetic" }))).toBe("");
  calendar.configure(baseline("tutor")); await calendar.load();
  const markup = renderToStaticMarkup(createElement(StaffPracticeDays, { calendar, firstName: "Synthetic" }));
  expect(markup).toContain(">Practice days</h3>"); expect(markup).toContain("Dates only."); expect(markup).toContain("Thursday, October 15: practiced");
  expect(markup).not.toMatch(/visit|play|record|minute|streak|%/i);
  expect(operations.every(value => value.type === "calendar")).toBe(true);
});
