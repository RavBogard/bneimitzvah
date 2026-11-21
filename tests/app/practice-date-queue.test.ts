import { expect, it } from "vitest";
import { createPracticeDateQueue, PRACTICE_DATE_PREFIX } from "../../src/lib/practice-calendar/completion-queue";
import { chicagoDate, practiceDateOrdinal } from "../../src/lib/practice-calendar/day";

const A = "a".repeat(32), B = "b".repeat(32);
function memory() {
  const rows = new Map<string, string>();
  return { rows, storage: () => ({ length: rows.size, key: (i: number) => [...rows.keys()][i] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); } }) };
}

it("keeps the Chicago practice day through a reload, retries only that student, and preserves another student's queue", async () => {
  const device = memory();
  let now = Date.parse("2026-03-11T04:58:00Z"), online = true, owner = A;
  const posted: { owner: string; dates: string[] }[] = [];
  const fetcher: typeof fetch = async (_request, init) => {
    if (!online) throw new TypeError("offline");
    if (!init?.body) return Response.json({ ok: true, owner, expiresAt: Date.parse("2026-03-20T17:00:00Z") });
    const body = JSON.parse(String(init.body)); posted.push(body);
    if (body.owner !== owner) return new Response(null, { status: 403 });
    return Response.json({ ok: true, accepted: body.dates, discarded: [] });
  };
  const open = () => createPracticeDateQueue({ ...device, fetch: fetcher, now: () => now });
  const beforeReload = open();
  await beforeReload.verifyAndReplay();
  online = false;
  beforeReload.complete();
  beforeReload.complete();
  expect([...device.rows]).toEqual([[PRACTICE_DATE_PREFIX + A + ":2026-03-10", "1"]]);

  const reloaded = open();
  await reloaded.verifyAndReplay();
  expect(posted).toEqual([]);
  now = Date.parse("2026-03-12T20:00:00Z"); online = true; owner = B;
  await reloaded.verifyAndReplay();
  expect(posted).toEqual([]);
  expect(device.rows.size).toBe(1);
  owner = A;
  const afterSignIn = open();
  await afterSignIn.verifyAndReplay();
  await afterSignIn.verifyAndReplay();
  expect(posted).toEqual([{ owner: A, dates: ["2026-03-10"] }]);
  expect(device.rows.size).toBe(0);
});

it("uses Chicago midnight before and after daylight-saving changes", () => {
  const cases = [
    ["2026-03-08T05:59:59Z", "2026-03-07"], ["2026-03-08T06:00:00Z", "2026-03-08"],
    ["2026-03-09T04:59:59Z", "2026-03-08"], ["2026-03-09T05:00:00Z", "2026-03-09"],
    ["2026-11-01T05:00:00Z", "2026-11-01"], ["2026-11-02T05:59:59Z", "2026-11-01"],
    ["2026-11-02T06:00:00Z", "2026-11-02"],
  ];
  for (const [instant, date] of cases) expect(chicagoDate(Date.parse(instant)).date).toBe(date);
  expect(practiceDateOrdinal("2026-02-30")).toBeNull();
  expect(practiceDateOrdinal("2028-02-29")).not.toBeNull();
});
