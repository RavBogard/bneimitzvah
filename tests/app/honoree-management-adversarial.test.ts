import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { honoreeFixture } from "./honoree-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import * as s from "../../src/server/db/index";

afterEach(() => vi.restoreAllMocks());

test("independent management: renewing stored session during cleanup cannot extend captured return authority", async () => {
  const f = await honoreeFixture();
  try {
    const write = await f.honoreeIntent(), [session] = await f.owner(() => f.db.select().from(s.session).where(eq(s.session.id, f.identities.multi.sessionId)));
    const req = () => f.request(`/api/students/${f.selected.studentId}/honoree-links`, { method: "POST", body: { mode: "parent", ...write } });
    let responseProduced = false;
    const dispatch = createHttpDispatcher(async action => {
      const response = await action({ ...f.runtime, honoree: f.honoree });
      responseProduced = response.status === 200;
      // An independently renewed row must not mutate this operation's original
      // session deadline captured by its opaque return fence.
      await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date("2100-01-01T00:00:00.000Z") }).where(eq(s.session.id, session.id)));
      vi.spyOn(Date, "now").mockReturnValue(session.expiresAt.getTime());
      return response;
    });
    const response = await dispatch(req());
    expect(responseProduced).toBe(true); expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
    vi.restoreAllMocks();
    expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(1);
    expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(1);
    const receipt = await f.honoree.receipt(f.req(), f.selected, write);
    expect(receipt).toMatchObject({ ok: true, outcome: "committed", replayed: true });
    expect("url" in receipt).toBe(false); expect("assertReturnLive" in receipt).toBe(false);
  } finally { vi.restoreAllMocks(); await f.client.close(); }
});
