import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { PRACTICE_STUDENT_HEADER } from "../../src/lib/learn/child-practice";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createPracticeCompletion } from "../../src/server/practice-calendar/completion";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";

const path = "/api/learn/practice-days";
const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

it("credits a delayed Tuesday once and keeps date-only work with its selected student", async () => {
  const f = await portalRoutesFixture(); opened.push(f);
  let instant = Date.parse("2026-03-10T18:00:00Z");
  Object.assign(f.runtime, { practiceCompletion: createPracticeCompletion({ access: f.service, practice: f.runtime.practice, now: () => instant }) });
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const call = async (url: string, init?: Parameters<typeof f.request>[1]) => {
    const response = await dispatch(f.request(url, init));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    return { status: response.status, json: await response.json() };
  };
  const enter = async (studentId: string, handle?: string) => {
    const { status, json } = await call(handle ? "/api/practice/switch" : "/api/practice/enter", { body: { studentId }, handle });
    expect(status).toBe(201);
    return { handle: json.handle, headers: { [PRACTICE_STUDENT_HEADER]: studentId } };
  };
  const [a, b] = f.students;
  const tab = await enter(a.id), second = await enter(b.id), direct = { who: "learner" as const };
  const aProof = (await call(path, tab)).json, bProof = (await call(path, second)).json;
  expect((await call(path, direct)).json.owner).toBe(aProof.owner);
  expect(bProof.owner).not.toBe(aProof.owner);
  expect((await call(path)).status).toBe(403);
  expect((await call(path, { who: "anonymous" })).status).toBe(401);
  instant = Date.parse("2026-03-12T17:00:00Z");
  const day = { owner: aProof.owner, dates: ["2026-03-10"] };
  expect((await call(path, { ...second, body: day })).status).toBe(403);
  expect((await call(path, { ...tab, body: { ...day, activity: "learn" } })).status).toBe(400);
  expect((await call(path, { ...tab, body: { ...day, dates: ["2026-02-29"] } })).status).toBe(400);
  expect((await call(path, { ...tab, headers: { ...tab.headers, origin: "https://other.example.test" }, body: day })).status).toBe(403);
  for (const selection of [tab, direct, tab]) {
    expect(await call(path, { ...selection, body: day })).toMatchObject({ status: 200, json: { accepted: ["2026-03-10"], discarded: [] } });
  }
  expect((await call(path, { ...tab, body: { ...day, dates: ["2026-03-12", "2026-03-13", "2025-11-01"] } })).json).toEqual({
    ok: true, accepted: ["2026-03-12"], discarded: ["2025-11-01", "2026-03-13"],
  });
  const newSibling = await enter(b.id, tab.handle);
  expect((await call(path, { ...tab, body: day })).status).toBe(404);
  expect((await call(path, { ...newSibling, body: day })).status).toBe(403);
  expect((await call(path, { ...newSibling, body: { owner: bProof.owner, dates: ["2026-03-12"] } })).status).toBe(200);

  const from = "2026-03-10", through = "2026-03-12";
  const calendar = (studentId: string, mode: string) => `/api/students/${studentId}/practice-calendar?mode=${mode}&fromDate=${from}&throughDate=${through}`;
  for (const [mode, actor] of [["student", direct], ["tutor", { who: "multi" as const }], ["parent", { who: "multi" as const }]] as const) {
    expect((await call(calendar(a.id, mode), actor)).json.dates).toEqual([from, through]);
  }
  expect((await call(calendar(b.id, "child-practice"), second)).json.dates).toEqual([through]);
  expect(await f.owner(() => f.db.select().from(s.practiceEvent))).toEqual([]);
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toHaveLength(3);
  await f.owner(() => f.db.update(s.guardian).set({ practiceEnabled: false }).where(eq(s.guardian.id, f.guardians[1].id)));
  expect((await call(path, { ...newSibling, body: { owner: bProof.owner, dates: [through] } })).status).toBe(404);
});

it("never recreates a calendar after its ceremony retention boundary", async () => {
  const f = await portalRoutesFixture(); opened.push(f);
  let instant = Date.parse("2028-01-02T05:59:59Z");
  const completion = createPracticeCompletion({ access: f.service, practice: f.runtime.practice, now: () => instant });
  const get = f.request(path, { who: "learner" }), put = f.request(path, { who: "learner", method: "POST" });
  const { owner } = await completion.owner(get);
  expect(await completion.record(put, { owner, dates: ["2028-01-01"] })).toMatchObject({ accepted: ["2028-01-01"] });
  await f.owner(() => f.db.delete(s.practiceDay));
  instant = Date.parse("2028-01-02T06:00:00Z");
  await expect(completion.owner(get)).rejects.toMatchObject({ status: 403 });
  expect(await completion.record(put, { owner, dates: ["2028-01-01"] })).toMatchObject({ accepted: [], discarded: ["2028-01-01"] });
  expect(await f.owner(() => f.db.select().from(s.practiceDay))).toEqual([]);
});
