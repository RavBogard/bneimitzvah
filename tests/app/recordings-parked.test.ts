import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import type { HttpRuntime } from "../../src/server/runtime/composition";

// Student recordings are parked (MISSION, 2026-10-17 revision): until PORTAL_RECORDINGS_ENABLED=true the
// runtime has no recordings service and every recordings route is a 404 for every method and every caller,
// so a parked deployment does not even reveal which methods the routes take.
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });

test("parked recordings routes are 404 for every method and caller while the runtime has no recordings service", async () => {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const parked = createHttpDispatcher(async action => action({ ...f.runtime, recordings: null } as HttpRuntime));
  const enabled = createHttpDispatcher(async action => action(f.runtime));
  const base = `/api/students/${f.students[0].id}/recordings`, recording = randomUUID();
  const paths = [`${base}?mode=student`, base, `${base}/${recording}/submit`, `${base}/${recording}/delete`];
  for (const path of paths) for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) for (const who of ["learner", "anonymous"] as const) {
    const body = method === "GET" || method === "HEAD" ? undefined : { mode: "student", expectedRevision: 1 };
    const response = await parked(f.request(path, { who, method, body }));
    expect(response.status).toBe(404);
    expect(response.headers.get("allow")).toBeNull();
  }
  // With the service present (the flag set), the same routes answer as before.
  expect((await enabled(f.request(`${base}?mode=student`, { who: "learner" }))).status).toBe(200);
  const wrongMethod = await enabled(f.request(`${base}?mode=student`, { who: "learner", method: "PUT", body: {} }));
  expect(wrongMethod.status).toBe(405); expect(wrongMethod.headers.get("allow")).toBe("GET");
  expect((await enabled(f.request(`${base}?mode=student`, { who: "anonymous" }))).status).toBe(401);
});
