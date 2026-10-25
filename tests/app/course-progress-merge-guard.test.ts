import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// The merge can be made to return a document the parser refuses, which two real Learn documents cannot produce today
// (their lessons and cards are bounded by the course), so the server's re-check is tested with that merge switched on.
const broken = vi.hoisted(() => ({ on: false }));
vi.mock("../../src/lib/learn/progress", async original => {
  const real = await original<typeof import("../../src/lib/learn/progress")>();
  return { ...real, mergeProgress: (a: Parameters<typeof real.mergeProgress>[0], b: Parameters<typeof real.mergeProgress>[1]) => {
    const merged = real.mergeProgress(a, b);
    return broken.on ? { ...merged, lessons: { ...merged.lessons, "intro-phrases": { done: "not-an-instant" } } } : merged;
  } };
});
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { PROGRESS_SCHEMA } from "../../src/lib/learn/progress";

// Learn to lein: a merged document is re-read with the browser's own parser before it is stored. Synthetic people only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { broken.on = false; await Promise.all(opened.splice(0).map(f => f.client.close())); });
const doc = (lessons: Record<string, string>) => ({ schema: PROGRESS_SCHEMA, lessons: Object.fromEntries(Object.entries(lessons).map(([id, done]) => [id, { done }])), cards: {} });

describe("course progress merge re-validation", () => {
  it("answers 409 with the account's copy for a merge the parser would refuse, and stores nothing new", async () => {
    const f = await portalRoutesFixture(); opened.push(f);
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const cookie = f.identities.learner.cookie;
    const owner = (await (await dispatch(new Request(`${ORIGIN}/api/learn/progress`, { headers: { cookie } }))).json() as { owner: string }).owner;
    const post = async (body: unknown) => {
      const response = await dispatch(new Request(`${ORIGIN}/api/learn/progress/merge`, { method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) }));
      return { status: response.status, json: await response.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const first = doc({ "intro-phrases": "2026-10-20T10:00:00.000Z" });
    expect(await post({ progress: first, owner })).toMatchObject({ status: 200, json: { ok: true, version: 1 } });
    broken.on = true;
    const refused = await post({ progress: doc({ "torah-sof-pasuk": "2026-10-21T10:00:00.000Z" }), owner });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ ok: false, code: "too-large", current: { ok: true, owner, version: 1, progress: first } });
    broken.on = false;
    const after = await (await dispatch(new Request(`${ORIGIN}/api/learn/progress`, { headers: { cookie } }))).json();
    expect(after).toMatchObject({ ok: true, version: 1, progress: first });
    expect(await f.owner(async () => (await f.db.select().from(s.courseProgressTable)).length)).toBe(1);
  });
});
