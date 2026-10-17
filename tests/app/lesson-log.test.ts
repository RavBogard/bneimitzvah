import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import type { AccessTransaction } from "../../src/server/access/types";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { handleLessonLogRequest } from "../../src/server/http/lesson-log";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const path = `/api/students/${f.students[0].id}/lesson-log`, body = { mode: "tutor", entryId: randomUUID(), lessonDate: "2026-10-16", summary: "Synthetic lesson summary" };
  const call = (suffix = "?mode=tutor", options: Parameters<typeof f.request>[1] = {}) => handleLessonLogRequest(f.request(path + suffix, options), f.runtime);
  return { ...f, path, body, lessonCall: call };
}
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("lesson HTTP reads are private and write-free without assignments, while create/edit/delete use CAS and clear a permanent tombstone", async () => {
  const f = await fixture(), dispatch = createHttpDispatcher(async action => action(f.runtime));
  const baseline = await f.owner(() => f.db.select().from(s.auditEvent));
  const read = (await f.lessonCall())!; expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store"); expect(read.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await read.json()).toEqual({ ok: true, studentId: f.students[0].id, mode: "tutor", entries: [], nextCursor: null });
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(baseline);
  expect(await f.owner(() => f.db.select().from(s.assignment))).toHaveLength(0);
  const mutate = (suffix: string, body: unknown) => dispatch(f.request(f.path + suffix, { body }));
  const created = await mutate("", { ...f.body, summary: "Synthetic first line\r\nSynthetic second line" }); expect(created.status).toBe(200);
  const first = (await created.json()).entry;
  expect(Object.keys(first).sort()).toEqual(["entryId", "lessonDate", "summary", "version", "displayName", "canEdit", "canDelete"].sort());
  expect(first).toMatchObject({ entryId: f.body.entryId, summary: "Synthetic first line\nSynthetic second line", version: 1, canEdit: true, canDelete: true });
  const edit = { mode: "tutor", expectedVersion: 1, lessonDate: "9999-12-31", summary: "Synthetic corrected lesson" };
  expect((await mutate(`/${first.entryId}/edit`, edit)).status).toBe(200);
  expect((await mutate(`/${first.entryId}/edit`, edit)).status).toBe(409);
  const beforeNoop = await f.owner(() => f.db.select().from(s.auditEvent));
  expect((await mutate(`/${first.entryId}/edit`, { ...edit, expectedVersion: 2 })).status).toBe(200);
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(beforeNoop);
  expect((await mutate(`/${first.entryId}/delete`, { mode: "tutor", expectedVersion: 1 })).status).toBe(409);
  const removed = await mutate(`/${first.entryId}/delete`, { mode: "tutor", expectedVersion: 2 }); expect(removed.status).toBe(200); expect(await removed.json()).toEqual({ ok: true, entryId: first.entryId, version: 3 });
  expect((await mutate(`/${first.entryId}/delete`, { mode: "tutor", expectedVersion: 3 })).status).toBe(409);
  expect((await mutate("", f.body)).status).toBe(409);
  expect((await (await f.lessonCall())!.json()).entries).toEqual([]);
  const rows = await f.owner(() => f.db.select().from(s.lessonLog)); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ summary: "", deleted: true, version: 3 });
  const audits = (await f.owner(() => f.db.select().from(s.auditEvent))).filter(row => row.action.startsWith("lesson-log."));
  expect(audits.map(row => row.action)).toEqual(["lesson-log.create", "lesson-log.edit", "lesson-log.delete"]);
  expect(JSON.stringify(audits)).not.toContain("Synthetic corrected lesson");
});

test("lesson HTTP bounds plain UTF-8 text, real dates, paired cursors and closed bodies without accepting provenance or scheduling fields", async () => {
  const f = await fixture();
  for (const change of [{ extra: true }, { actorUserId: "untrusted" }, { tenantId: "other" }, { timestamp: 1 }, { hours: 1 }, { lessonDate: "1900-02-29" }, { lessonDate: "0000-01-01" }, { lessonDate: "2026-1-01" }, { lessonDate: "2026-10-16T00:00:00Z" }, { summary: "\n\t " }, { summary: "\u0000" }, { summary: "\ud800" }, { summary: "א".repeat(2049) }, { entryId: "untrusted" }]) {
    expect((await f.lessonCall("", { body: { ...f.body, ...change } }))!.status).toBe(400);
  }
  for (const suffix of ["?mode=tutor&mode=admin", "?mode=tutor&token=untrusted", "?mode=tutor&beforeDate=2026-10-16", `?mode=tutor&beforeId=${f.body.entryId}`, `?mode=tutor&beforeDate=2026-02-30&beforeId=${f.body.entryId}`]) expect((await f.lessonCall(suffix))!.status).toBe(400);
  expect((await f.lessonCall("?mode=tutor", { body: f.body }))!.status).toBe(400);
  expect((await f.lessonCall("", { body: f.body, headers: { origin: "https://foreign.example.test" } }))!.status).toBe(403);
  expect((await f.lessonCall("", { body: f.body, headers: { "content-type": "text/plain" } }))!.status).toBe(415);
  expect((await f.lessonCall("", { body: { ...f.body, summary: "x".repeat(17000) } }))!.status).toBe(413);
  expect(await f.owner(() => f.db.select().from(s.lessonLog))).toHaveLength(0);
  const bounded = await f.lessonCall("", { body: { ...f.body, lessonDate: "2000-02-29", summary: "א".repeat(2048) } }); expect(bounded!.status).toBe(200);
  expect((await bounded!.json()).entry.summary).toHaveLength(2048);
});

test("unowned and wrong-method lesson routes refuse before runtime and failures remain fixed private errors", async () => {
  let starts = 0; const dispatch = createHttpDispatcher(async () => { starts++; throw new Error("Synthetic private diagnostic"); });
  for (const [method, path, status] of [["DELETE", "/api/students/synthetic/lesson-log", 405], ["GET", "/api/students/synthetic/lesson-log/synthetic/edit", 405], ["POST", "/api/students/synthetic/lesson-log/history", 404]] as const) expect((await dispatch(new Request(`http://localhost:3000${path}`, { method }))).status).toBe(status);
  expect(starts).toBe(0);
  const response = await dispatch(new Request("http://localhost:3000/api/students/synthetic/lesson-log")); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "unavailable" });
});

test("lesson SQL has forced tenant RLS, qualified creator identity, minimal grants and irreversible consecutive tombstones", async () => {
  const f = await fixture(), within = <T>(action: (tx: AccessTransaction<PgliteQueryResultHKT>) => Promise<T>) => withTenantTransaction(f.db, { tenantId: "crc" }, action);
  const row = { tenantId: "crc", studentId: f.students[0].id, entryId: randomUUID(), creatorMembershipId: f.multiMember.id, creatorUserId: f.identities.multi.id, lessonDate: "2026-10-16", summary: "Synthetic protected lesson", version: 1 };
  await within(tx => tx.insert(s.lessonLog).values(row));
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.select().from(s.lessonLog))).toHaveLength(0);
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.insert(s.lessonLog).values({ ...row, entryId: randomUUID() })))).toBe("42501");
  expect(await sqlState(within(tx => tx.insert(s.lessonLog).values({ ...row, entryId: randomUUID(), creatorUserId: f.identities.admin.id })))).toBe("23503");
  expect(await sqlState(within(tx => tx.insert(s.lessonLog).values({ ...row, entryId: randomUUID(), version: 2 })))).toBe("23514");
  expect(await sqlState(within(tx => tx.insert(s.lessonLog).values({ ...row, entryId: randomUUID(), deleted: true, summary: "" })))).toBe("23514");
  expect(await sqlState(within(tx => tx.update(s.lessonLog).set({ summary: "Synthetic unversioned edit" })))).toBe("23514");
  expect(await sqlState(within(tx => tx.update(s.lessonLog).set({ creatorUserId: f.identities.admin.id, version: 2 })))).toBe("42501");
  expect(await sqlState(within(tx => tx.delete(s.lessonLog)))).toBe("42501");
  expect(await sqlState(within(tx => tx.update(s.lessonLog).set({ deleted: true, version: 2 })))).toBe("23514");
  await within(tx => tx.update(s.lessonLog).set({ deleted: true, summary: "", version: 2 }));
  expect(await sqlState(within(tx => tx.update(s.lessonLog).set({ deleted: false, summary: "Synthetic revival", version: 3 })))).toBe("23514");
  const policies = await f.owner(() => f.db.execute(sql`select relrowsecurity,relforcerowsecurity from pg_class where relname='lesson_log'`)); expect(policies.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  expect(await within(tx => tx.select({ summary: s.lessonLog.summary, version: s.lessonLog.version, deleted: s.lessonLog.deleted }).from(s.lessonLog))).toEqual([{ summary: "", version: 2, deleted: true }]);
});
