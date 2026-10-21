import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { accessFixture } from "./access-fixture";
import { createStudentService } from "../../src/server/students/service";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import type { Snapshot } from "../../src/lib/readings/proposals";
import { confirmedReadings } from "../../src/server/data/portal";
import { readingView } from "../../src/server/portal/service";
import * as s from "../../src/server/db/index";

const open: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });

const pekudei = [
  { n: 1, ref: "Exodus 38:21-39:1" }, { n: 2, ref: "Exodus 39:2-21" }, { n: 3, ref: "Exodus 39:22-32" }, { n: 4, ref: "Exodus 39:33-43" },
  { n: 5, ref: "Exodus 40:1-16" }, { n: 6, ref: "Exodus 40:17-27" }, { n: 7, ref: "Exodus 40:28-38" },
];
type Week = { parashah: string; maftir: { n: "M"; ref: string; reason?: string }; haftarah: string } | null;
const regular: Week = { parashah: "Pekudei", maftir: { n: "M", ref: "Exodus 40:34-38" }, haftarah: "I Kings 7:51-8:21" };
const shekalim: Week = { parashah: "Pekudei", maftir: { n: "M", ref: "Exodus 30:11-16", reason: "Shabbat Shekalim" }, haftarah: "II Kings 12:1-17" };

async function fixture(week: Week) {
  const f = await accessFixture(); open.push(f); const time = Date.now();
  await f.owner(async () => { await f.db.update(s.student).set({ serviceSlot: "morning" }); });
  const loadReading = vi.fn(async (date: string, calendar: "diaspora" | "israel"): Promise<{ fetchedAt: number; snapshot: Snapshot }> => ({ fetchedAt: time, snapshot: week ? {
    date: parseCeremonyDate(date), calendar, classification: "regular" as const, haftarah: week.haftarah,
    reading: { parashah: week.parashah, type: "shabbat", summary: "", source: "Hebcal", aliyot: [...pekudei, week.maftir], triennial: null },
  } : { date: parseCeremonyDate(date), calendar, classification: "missing" as const, reading: null, haftarah: null } }));
  const service = createStudentService({ access: f.service, signingSecret: randomBytes(48).toString("base64url"), loadReading, now: () => time });
  const request = () => ({ ...f.request("admin", "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" });
  const id = f.students[0].id;
  async function confirm(selection: { kind?: "torah" | "haftarah"; ranges?: string[]; pick?: string }) {
    const prepared = await service.prepareReading(request(), { mode: "admin", studentId: id, ...selection });
    if (prepared.status !== "prepared") throw new Error("Expected a prepared synthetic reading");
    const confirmed = await service.confirmReading(request(), { mode: "admin", studentId: id, binding: prepared.binding });
    expect(confirmed.ok).toBe(true);
  }
  async function keys() {
    return f.owner(async () => Object.fromEntries((await confirmedReadings(f.db as never, "crc", id)).map(row => [row.kind, readingView(row, "2027-01-02").readingKey])));
  }
  return { confirm, keys };
}

test("confirming a Hebcal proposal stores readingKey", async () => {
  const f = await fixture(regular);
  await f.confirm({ pick: "full" });
  expect(await f.keys()).toEqual({ torah: "pekudei" });
});

test("custom range inside the week's kriyah stores the key", async () => {
  const f = await fixture(regular);
  await f.confirm({ ranges: ["Exodus 40:1-8"] });
  expect(await f.keys()).toEqual({ torah: "pekudei" });
});

test("custom range outside the week's kriyah stores null", async () => {
  const f = await fixture(regular);
  await f.confirm({ ranges: ["Genesis 1:1-5"] });
  expect(await f.keys()).toEqual({ torah: null });
});

test("reading without a snapshot stores null", async () => {
  const f = await fixture(null);
  await f.confirm({ ranges: ["Exodus 40:1-8"] });
  expect(await f.keys()).toEqual({ torah: null });
});

test("haftarah on a special Shabbat keys by its passage", async () => {
  const f = await fixture(shekalim);
  await f.confirm({ kind: "haftarah", pick: "calendar-haftarah" });
  await f.confirm({ ranges: ["Exodus 30:11-16"] });
  expect(await f.keys()).toEqual({ torah: "pekudei", haftarah: "ii-kings-12-1-12-17" });
});
