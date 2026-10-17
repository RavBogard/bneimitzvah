import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { chicagoDate, retention, RAW_RETENTION_MS, serverInstant } from "../../src/server/practice-calendar/policy";
import * as validate from "../../src/server/practice-calendar/validation";

test.each([
  ["2026-03-08T07:59:59.999Z", "2026-03-08"], ["2026-03-08T08:00:00.000Z", "2026-03-08"],
  ["2026-11-01T06:59:59.999Z", "2026-11-01"], ["2026-11-01T07:00:00.000Z", "2026-11-01"],
  ["2026-10-16T04:59:59.999Z", "2026-10-15"], ["2026-10-16T05:00:00.000Z", "2026-10-16"],
])("Chicago server day at %s is %s across midnight and both DST transitions", (instant, expected) => {
  expect(chicagoDate(Date.parse(instant)).date).toBe(expected);
});

test("retention is rolling UTC age plus Chicago anniversary midnight, including leap day and year 10000", () => {
  const instant = Date.parse("2026-03-08T08:00:00.123Z"), state = retention("2026-02-28", instant);
  expect(state.rawAfter.getTime()).toBe(instant - RAW_RETENTION_MS);
  expect(retention("2024-02-29", Date.parse("2025-02-28T05:59:59.999Z")).expired).toBe(false);
  expect(retention("2024-02-29", Date.parse("2025-02-28T06:00:00.000Z")).expired).toBe(true);
  expect(retention("2025-03-08", Date.parse("2026-03-08T06:00:00.000Z")).expired).toBe(true);
  expect(retention("9999-12-31", Date.parse("+010000-12-31T05:59:59.999Z")).expired).toBe(false);
  expect(retention("9999-12-31", Date.parse("+010000-12-31T06:00:00.000Z")).expired).toBe(true);
  for (const value of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) expect(() => serverInstant(value)).toThrow();
  expect(() => retention("1900-02-29", instant)).toThrow();
});

test("calendar windows and raw cursors are canonical, closed and bounded without scheduling rules", () => {
  expect(validate.window({ fromDate: "2024-01-01", throughDate: "2024-12-31" })).toEqual({ fromDate: "2024-01-01", throughDate: "2024-12-31" });
  expect(validate.window({ fromDate: "9999-12-31", throughDate: "9999-12-31" }).fromDate).toBe("9999-12-31");
  for (const row of [{ fromDate: "2024-01-01", throughDate: "2025-01-01" }, { fromDate: "2026-10-17", throughDate: "2026-10-16" }, { fromDate: "2026-02-30", throughDate: "2026-03-01" }, { fromDate: "2026-01-01", throughDate: "2026-01-01", tenantId: "other" }]) expect(() => validate.window(row)).toThrow();
  const eventId = "10000000-0000-4000-8000-000000000001";
  expect(validate.cursor({ receivedAt: "2026-10-16T05:00:00.001Z", eventId })).toEqual({ receivedAt: "2026-10-16T05:00:00.001Z", eventId });
  for (const receivedAt of ["2026-10-16T05:00:00Z", "2026-10-16T05:00:00.0001Z", "2026-10-16T00:00:00.000-05:00", "2026-02-30T05:00:00.000Z"]) expect(() => validate.cursor({ receivedAt, eventId })).toThrow();
});
