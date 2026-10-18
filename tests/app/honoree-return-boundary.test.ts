import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { honoreeFixture } from "./honoree-fixture";
import * as s from "../../src/server/db/index";
import * as runtimeData from "../../src/server/db/runtime";

const fixtures: Awaited<ReturnType<typeof honoreeFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() { const f = await honoreeFixture(); fixtures.push(f); return f; }

for (const clock of ["wall", "monotonic"] as const) test(`hard expiry crossing transaction completion denies guest DTO using ${clock} time`, async () => {
  const f = await fixture(), issued = await f.issue(), expiresAt = Date.parse(issued.result.expiresAt!);
  const original = runtimeData.withTenantTransaction; let completed = false;
  vi.spyOn(runtimeData, "withTenantTransaction").mockImplementation(async (...args) => {
    const result = await original(...args); completed = true;
    if (clock === "wall") vi.spyOn(Date, "now").mockReturnValue(expiresAt);
    else vi.spyOn(performance, "now").mockReturnValue(performance.now() + Math.max(0, expiresAt - Date.now()) + 1000);
    return result;
  });
  const outcome = await f.honoree.read(f.guest(), issued.token).then(() => "disclosed", () => "denied");
  expect(completed).toBe(true); expect(outcome).toBe("denied");
});

for (const deadline of ["session", "credential"] as const) test(`post-COMMIT ${deadline} expiry suppresses one-shot URL and preserves original receipt`, async () => {
  const f = await fixture();
  if (deadline === "credential") await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date("2100-01-01T00:00:00Z") }).where(eq(s.session.id, f.identities.multi.sessionId)); });
  const [session] = await f.owner(() => f.db.select().from(s.session).where(eq(s.session.id, f.identities.multi.sessionId)));
  const write = await f.honoreeIntent(), original = runtimeData.withTenantTransaction; let completed = false;
  const transaction = vi.spyOn(runtimeData, "withTenantTransaction").mockImplementation(async (...args) => {
    const result = await original(...args); completed = true;
    const [link] = await f.owner(() => f.db.select().from(s.honoreeLink));
    expect(link).toBeDefined();
    vi.spyOn(Date, "now").mockReturnValue(deadline === "session" ? session.expiresAt.getTime() : link.expiresAt.getTime());
    return result;
  });
  let outcome: string;
  try { outcome = await f.honoree.mutate(f.req(), f.selected, write).then(result => result.ok && result.outcome === "unconfirmed" && !("url" in result) ? "unconfirmed" : "disclosed", () => "denied"); }
  finally { transaction.mockRestore(); vi.restoreAllMocks(); }
  expect(completed).toBe(true); expect(["denied", "unconfirmed"]).toContain(outcome);
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honoree.issue")))).toHaveLength(1);
  const receipt = await f.honoree.receipt(f.req(), f.selected, write);
  expect(receipt).toMatchObject({ ok: true, outcome: "committed", replayed: true, operation: "issue", startVerse: "Genesis 1:1" });
  expect("url" in receipt).toBe(false);
});

test("private status rechecks cancellation and session expiry after transaction completion", async () => {
  const f = await fixture(); await f.issue();
  const [session] = await f.owner(() => f.db.select().from(s.session).where(eq(s.session.id, f.identities.multi.sessionId)));
  for (const failure of ["abort", "session"] as const) {
    const control = new AbortController(), original = runtimeData.withTenantTransaction; let completed = false;
    const spy = vi.spyOn(runtimeData, "withTenantTransaction").mockImplementation(async (...args) => {
      const result = await original(...args); completed = true;
      if (failure === "abort") control.abort(); else vi.spyOn(Date, "now").mockReturnValue(session.expiresAt.getTime());
      return result;
    });
    try { const outcome = await f.honoree.status(f.req("multi", control.signal), f.selected, "Genesis 1:1").then(() => "disclosed", () => "denied"); expect(completed).toBe(true); expect(outcome).toBe("denied"); }
    finally { spy.mockRestore(); vi.restoreAllMocks(); }
  }
});
