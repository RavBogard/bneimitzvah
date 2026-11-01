import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";
import { scheduleCeremony } from "../../src/server/service-ecosystem/scheduling";
import { createServiceScheduler } from "../../src/server/service-ecosystem/scheduler";
import { citation, studentName } from "../../src/server/service-ecosystem/details";
import type { DetailsInput, MusicBroker, MusicResult } from "../../src/server/service-ecosystem/contract";
import { AccessUnavailable } from "../../src/server/access/errors";
import { handleServiceEcosystemRequest } from "../../src/server/http/service-ecosystem";
import type { HttpRuntime } from "../../src/server/runtime/composition";

test("a citation is one contiguous run in one book, or nothing", () => {
  expect(citation(["Genesis 1:31", "Genesis 2:1", "Genesis 1:30", "Genesis 2:2"])).toBe("Genesis 1:30–2:2");
  expect(citation(["I Samuel 20:18", "I Samuel 20:19", "I Samuel 20:20"])).toBe("1 Samuel 20:18–20");
  expect(citation(["Exodus 40:34"])).toBe("Exodus 40:34");
  expect(citation(["Exodus 40:34", "Exodus 40:34", "Exodus 40:35"])).toBe("Exodus 40:34–35");
  expect(citation(["Genesis 1:1", "Genesis 1:3"])).toBeNull();
  expect(citation(["Genesis 50:26", "Exodus 1:1"])).toBeNull();
  expect(citation(["Genesis 1:40"])).toBeNull();
  expect(citation(["Synthetic 1:1"])).toBeNull();
  expect(citation([])).toBeNull();
});

test("only names the music side accepts leave the portal", () => {
  expect(studentName("Synthetic", "  O'Learner-Smith ")).toBe("Synthetic O'Learner-Smith");
  expect(studentName("Synthetic2", "Learner")).toBeNull();
  expect(studentName("Synthetic", "x".repeat(120))).toBeNull();
});

const open: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });
async function linkedCeremony() {
  const f = await accessFixture(); open.push(f);
  const student = f.students[0];
  const ceremonyId = await f.owner(async () => {
    await f.db.update(s.student).set({ firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", serviceSlot: "morning", rehearsal1: "2026-12-30" }).where(eq(s.student.id, student.id));
    const id = await f.db.transaction(tx => scheduleCeremony(tx as never, "crc", { id: student.id, ceremonyDate: "2027-01-02", serviceSlot: "morning" }, Date.parse("2026-11-01T12:00:00Z")));
    await f.db.update(s.serviceCeremony).set({ setlistId: "synthetic-set", state: "linked" }).where(eq(s.serviceCeremony.id, id!));
    const [assignment] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: student.id, kind: "torah", basis: "custom", ref: "Genesis 1:31-2:1", status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values(["Genesis 1:31", "Genesis 2:1"].map((verseRef, i) => ({ tenantId: "crc", assignmentId: assignment.id, studentId: student.id, ordinal: i + 1, verseRef })));
    return id!;
  });
  const sent: DetailsInput[] = [];
  let failing = false, hold: Promise<void> | null = null;
  const result: MusicResult = { version: 1, status: "review_required" };
  const broker: MusicBroker = { ensure: vi.fn(async () => result), projection: vi.fn(async () => result), resource: vi.fn(async () => { throw new Error("Synthetic unused"); }),
    details: vi.fn(async (input: DetailsInput) => { if (failing) throw new AccessUnavailable(); if (hold) { const wait = hold; hold = null; await wait; } sent.push(input); return result; }) };
  let clock = Date.parse("2026-11-01T12:00:00Z");
  const scheduler = (details?: "send") => createServiceScheduler({ db: f.db, broker, now: () => clock, ...(details ? { details } : {}) });
  const stored = async () => (await f.owner(() => f.db.select().from(s.serviceCeremony).where(eq(s.serviceCeremony.id, ceremonyId))))[0];
  return { f, ceremonyId, student, broker, sent, scheduler, stored, fail: (v: boolean) => { failing = v; }, tick: () => { clock += 60_000; },
    setClock: (at: number) => { clock = at; }, holdNextSend: (until: Promise<void>) => { hold = until; } };
}

test("a dry run reports what is due without sending or recording anything, and the worker without the flag never sends", async () => {
  const t = await linkedCeremony();
  const report = await t.scheduler().syncDetails("dry-run", Date.now() + 20_000);
  expect(report).toMatchObject({ mode: "dry-run", upcoming: 1, unchanged: 0, skipped: { tooManyStudents: 0, noStudents: 0 }, sent: 0, failed: 0 });
  expect(report.due).toEqual([{ ceremonyId: t.ceremonyId, localDate: "2027-01-02", students: 1, omittedNames: 0, torahRef: true, haftarahRef: false, rehearsals: 1 }]);
  expect(JSON.stringify(report)).not.toContain("Synthetic");
  await t.scheduler().run();
  expect(t.broker.details).not.toHaveBeenCalled();
  expect((await t.stored()).detailsDigest).toBeNull();
});

test("details are sent once, again only when they change, with a newer sentAt each time, and a failed send is retried", async () => {
  const t = await linkedCeremony();
  await t.scheduler("send").run();
  expect(t.sent).toEqual([{ ceremonyId: t.ceremonyId, sentAt: "2026-11-01T12:00:00.000Z", students: ["Synthetic Learner"], torahRef: "Genesis 1:31–2:1", rehearsals: ["2026-12-30"] }]);
  expect((await t.stored()).detailsDigest).toMatch(/^[0-9a-f]{64}$/);

  t.tick(); await t.scheduler("send").run();
  expect(t.sent).toHaveLength(1);

  await t.f.owner(() => t.f.db.update(s.student).set({ rehearsal2: "2026-12-31" }).where(eq(s.student.id, t.student.id)));
  t.fail(true); t.tick(); await t.scheduler("send").run();
  expect(t.sent).toHaveLength(1);
  t.fail(false); t.tick(); await t.scheduler("send").run();
  expect(t.sent).toHaveLength(2);
  expect(t.sent[1].rehearsals).toEqual(["2026-12-30", "2026-12-31"]);
  expect(Date.parse(t.sent[1].sentAt)).toBeGreaterThan(Date.parse(t.sent[0].sentAt));
});

test("a ceremony with no active student, or already past, sends nothing", async () => {
  const t = await linkedCeremony();
  await t.f.owner(() => t.f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, t.student.id)));
  await t.scheduler("send").run();
  expect(t.broker.details).not.toHaveBeenCalled();
  const later = createServiceScheduler({ db: t.f.db, broker: t.broker, now: () => Date.parse("2027-02-01T12:00:00Z"), details: "send" });
  expect((await later.syncDetails("dry-run", Date.now() + 20_000)).upcoming).toBe(0);
});

test("the drain's dry run still requires the cron credential", async () => {
  const t = await linkedCeremony(), secret = "s".repeat(48);
  const scheduler = createServiceScheduler({ db: t.f.db, broker: t.broker, cronSecret: secret, details: "send" });
  const request = (headers: Record<string, string>) => ({ url: "http://localhost:3000/api/internal/service-ecosystem/drain?details=dry-run", headers: new Headers(headers) });
  await expect(scheduler.drain(request({}), { detailsDryRun: true })).rejects.toThrow();
  const report = await scheduler.drain(request({ authorization: `Bearer ${secret}` }), { detailsDryRun: true });
  expect(report).toMatchObject({ details: { mode: "dry-run", sent: 0 } });
  expect(t.broker.details).not.toHaveBeenCalled();
});

test("overlapping runs: the run that read later carries the later sentAt, and the earlier run cannot overwrite it", async () => {
  const t = await linkedCeremony();
  let release!: () => void; t.holdNextSend(new Promise<void>(resolve => { release = resolve; }));
  // A reads the old rehearsal and is held inside its send; the data changes; B reads it later and finishes first.
  const first = t.scheduler("send").syncDetails("send", Date.now() + 20_000);
  await vi.waitFor(() => expect(t.broker.details).toHaveBeenCalledTimes(1));
  await t.f.owner(() => t.f.db.update(s.student).set({ rehearsal1: "2026-12-29" }).where(eq(s.student.id, t.student.id)));
  t.tick(); await t.scheduler("send").syncDetails("send", Date.now() + 20_000);
  release(); await first;
  const [newer, older] = t.sent;
  expect(newer.rehearsals).toEqual(["2026-12-29"]);
  expect(older.rehearsals).toEqual(["2026-12-30"]);
  expect(Date.parse(newer.sentAt)).toBeGreaterThan(Date.parse(older.sentAt));
  expect((await t.stored()).detailsSentAt?.toISOString()).toBe(newer.sentAt);
});

test("a clock that goes backwards still sends a sentAt after the last accepted one", async () => {
  const t = await linkedCeremony();
  await t.scheduler("send").run();
  const last = Date.parse(t.sent[0].sentAt);
  t.setClock(last - 3_600_000);
  await t.f.owner(() => t.f.db.update(s.student).set({ rehearsal1: "2026-12-29" }).where(eq(s.student.id, t.student.id)));
  await t.scheduler("send").run();
  expect(Date.parse(t.sent[1].sentAt)).toBe(last + 1);
});

test("the dry run counts ceremonies skipped for more than six students or for no sendable name", async () => {
  const t = await linkedCeremony();
  await t.f.owner(() => t.f.db.update(s.student).set({ firstName: "Synthetic2" }).where(eq(s.student.id, t.student.id)));
  expect((await t.scheduler().syncDetails("dry-run", Date.now() + 20_000)).skipped).toEqual({ tooManyStudents: 0, noStudents: 1 });
  await t.f.owner(async () => {
    const extra = await t.f.db.insert(s.student).values(Array.from({ length: 6 }, (_, i) => ({ tenantId: "crc", firstName: "Synthetic", lastName: `Joint ${"abcdef"[i]}`, ceremonyDate: "2027-01-02",
      serviceSlot: "morning" as const, parentEmail: "synthetic@example.test" }))).returning();
    await t.f.db.insert(s.studentCeremony).values(extra.map(row => ({ tenantId: "crc", studentId: row.id, ceremonyId: t.ceremonyId })));
  });
  const report = await t.scheduler().syncDetails("dry-run", Date.now() + 20_000);
  expect(report.skipped).toEqual({ tooManyStudents: 1, noStudents: 0 });
  expect(report.due).toEqual([]);
});

test("over HTTP the drain authenticates before it reads details, and refuses any value but dry-run", async () => {
  const t = await linkedCeremony(), secret = "s".repeat(48);
  const real = createServiceScheduler({ db: t.f.db, broker: t.broker, cronSecret: secret, now: () => Date.parse("2026-11-01T12:00:00Z") });
  const serviceScheduler = { authorize: vi.fn(real.authorize), drain: vi.fn(real.drain) };
  const runtime = { serviceScheduler } as unknown as HttpRuntime;
  const call = (query: string, auth = true) => handleServiceEcosystemRequest(new Request(`http://localhost:3000/api/internal/service-ecosystem/drain${query}`,
    { headers: auth ? { authorization: `Bearer ${secret}` } : {} }), runtime).then(response => response!);
  expect((await call("?details=dry-run", false)).status).toBe(401);
  expect((await call("?details=everything", false)).status).toBe(401);
  expect(serviceScheduler.drain).not.toHaveBeenCalled();
  expect((await call("?details=everything")).status).toBe(400);
  expect((await call("?details=dry-run&details=dry-run")).status).toBe(400);
  expect((await call("?other=1")).status).toBe(400);
  expect(serviceScheduler.drain).not.toHaveBeenCalled();
  const dry = await call("?details=dry-run");
  expect(dry.status).toBe(200);
  expect(await dry.json()).toMatchObject({ details: { mode: "dry-run", upcoming: 1, sent: 0 } });
  expect(t.broker.details).not.toHaveBeenCalled();
});
