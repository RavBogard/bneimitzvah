import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { honoreeFixture } from "./honoree-fixture";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/honoree";
import { createHonoreeTokens } from "../../src/server/honoree/tokens";
import { createHonoreeService } from "../../src/server/honoree/service";
import { handleHonoreeRequest } from "../../src/server/http/honoree";
import * as runtimeData from "../../src/server/db/runtime";

const fixtures: Awaited<ReturnType<typeof honoreeFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() { const f = await honoreeFixture(); fixtures.push(f); return f; }

test("independent adversary: MAC/canonical rejection happens before credential discovery", async () => {
  const f = await fixture(), issued = await f.issue(), discover = vi.spyOn(data, "discover");
  const parts = issued.token.split("."), id = parts[2];
  // The last base64url character of 16 bytes has four unused bits. All aliases
  // must fail rather than accepting Node's permissive base64url decoder.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const base = alphabet.indexOf(id.at(-1)!) & 48;
  const aliases = Array.from({ length: 15 }, (_, i) => [...parts.slice(0, 2), id.slice(0, -1) + alphabet[base + i + 1], ...parts.slice(3)].join("."));
  for (const token of [...aliases, issued.token + "\n", issued.token.replace("hl1.k1", "hl1.k2"), "x".repeat(129)])
    await expect(f.honoree.read(f.guest(), token)).rejects.toMatchObject({ status: 404 });
  expect(discover).not.toHaveBeenCalled();
  const scope = { secret: "independent-synthetic-secret-more-than-32-characters", origin: "http://localhost:3000", environment: "test", project: "crc-bneimitzvah", tenantId: "crc" };
  const token = createHonoreeTokens(scope).issue().token;
  // A stable environment/domain intentionally survives reconstructing the key.
  expect(createHonoreeTokens(scope).verify(token)).toEqual(createHonoreeTokens(scope).verify(token));
  for (const change of [{ tenantId: "other" }, { project: "other" }, { environment: "preview" }, { origin: "https://example.test" }])
    expect(() => createHonoreeTokens({ ...scope, ...change }).verify(token)).toThrow();
});

test("independent adversary: live suspension restores only live membership, replaced guardian never restores old bearer", async () => {
  const f = await fixture(), issued = await f.issue();
  await f.owner(() => f.db.update(s.membership).set({ disabledAt: new Date(), authorityRevision: sql`${s.membership.authorityRevision}+1` }).where(eq(s.membership.id, f.multiMember.id)));
  await expect(f.honoree.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
  await f.owner(() => f.db.update(s.membership).set({ disabledAt: null, authorityRevision: sql`${s.membership.authorityRevision}+1` }).where(eq(s.membership.id, f.multiMember.id)));
  expect(await f.honoree.read(f.guest(), issued.token)).toMatchObject({ ok: true });
  await f.owner(async () => {
    await f.db.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id));
    await expect(f.db.update(s.guardian).set({ revokedAt: null }).where(eq(s.guardian.id, f.guardians[0].id))).rejects.toBeDefined();
    await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.selected.studentId, parentGrantId: f.parentGrant.id, linkProvenance: "synthetic independent replacement" });
  });
  await expect(f.honoree.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
});

test("independent adversary: participant permutation invalidates its group, withdrawal remains terminal after replacement release", async () => {
  const f = await fixture();
  const extra = { ...f.form.aliyot[0].participants[0], id: crypto.randomUUID(), englishName: "Synthetic second participant" };
  const form = { ...f.form, aliyot: [{ ...f.form.aliyot[0], participants: [...f.form.aliyot[0].participants, extra] }, f.form.aliyot[1]] };
  await f.service.replace(f.req(), f.selected, await f.intent(form, 1));
  const a = await f.issue(), b = await f.issue("Genesis 1:3");
  const reordered = { ...form, aliyot: [{ ...form.aliyot[0], participants: [...form.aliyot[0].participants].reverse() }, form.aliyot[1]] };
  await f.service.replace(f.req(), f.selected, await f.intent(reordered, 2));
  await f.service.replace(f.req(), f.selected, await f.intent(form, 3));
  await expect(f.honoree.read(f.guest(), a.token)).rejects.toMatchObject({ status: 404 });
  expect(await f.honoree.read(f.guest(), b.token)).toMatchObject({ ok: true });
  await f.owner(async () => {
    await f.db.update(s.honoreeMaterialRelease).set({ state: "withdrawn" }).where(eq(s.honoreeMaterialRelease.id, f.materialRelease!.id));
    await expect(f.db.update(s.honoreeMaterialRelease).set({ state: "active" }).where(eq(s.honoreeMaterialRelease.id, f.materialRelease!.id))).rejects.toBeDefined();
    const { id: _id, ...release } = f.materialRelease!;
    await f.db.insert(s.honoreeMaterialRelease).values(release);
  });
  await expect(f.honoree.read(f.guest(), b.token)).rejects.toMatchObject({ status: 404 });
});

test("independent adversary: native Request malformed transport never reaches guest service", async () => {
  const read = vi.fn(async () => { throw Error("Transport must deny before service"); });
  const runtime = { origin: "http://localhost:3000", honoree: { readForTransport: read } as unknown as ReturnType<typeof createHonoreeService> };
  const inputs: { body: Uint8Array<ArrayBuffer>; headers: Record<string, string> }[] = [
    { body: new Uint8Array([0xc3, 0x28]), headers: {} },
    { body: new TextEncoder().encode('{"token":"synthetic"}'), headers: { "content-length": "1" } },
    { body: new TextEncoder().encode('{"token":"synthetic"}'), headers: { "content-encoding": "gzip" } },
    { body: new TextEncoder().encode('{"token":"synthetic","constructor":{}}'), headers: {} },
    { body: new TextEncoder().encode('{"token":"synthetic"}'), headers: { authorization: "synthetic" } },
  ];
  for (const input of inputs) {
    const response = await handleHonoreeRequest(new Request(runtime.origin + "/api/honoree/read", { method: "POST", headers: { origin: runtime.origin, "content-type": "application/json", ...input.headers }, body: input.body }), runtime);
    expect(response!.status).toBe(404); expect(await response!.json()).toEqual({ error: "not-found" });
    expect(response!.headers.get("set-cookie")).toBeNull(); expect(response!.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(read).not.toHaveBeenCalled();
});

test("independent adversary: cancellation while awaiting transaction completion denies guest return", async () => {
  const f = await fixture(), issued = await f.issue(), control = new AbortController();
  const original = runtimeData.withTenantTransaction;
  let transactionCompleted = false;
  vi.spyOn(runtimeData, "withTenantTransaction").mockImplementation(async (...args) => {
    const result = await original(...args);
    transactionCompleted = true;
    // Model disconnect/concealment while COMMIT completes, after the callback's
    // final query but before the awaited transaction promise reaches service.
    control.abort();
    return result;
  });
  const outcome = await f.honoree.read(f.guest(control.signal), issued.token).then(() => "fulfilled", () => "denied");
  expect(transactionCompleted).toBe(true);
  expect(outcome).toBe("denied");
});

test("independent adversary: cancellation while mutation commit completes withholds its one-shot URL", async () => {
  const f = await fixture(), control = new AbortController(), write = await f.honoreeIntent();
  const original = runtimeData.withTenantTransaction;
  let transactionCompleted = false;
  vi.spyOn(runtimeData, "withTenantTransaction").mockImplementation(async (...args) => {
    const result = await original(...args);
    transactionCompleted = true;
    control.abort();
    return result;
  });
  // Only compare an outcome label: failing assertions must not print a raw URL.
  const outcome = await f.honoree.mutate(f.req("multi", control.signal), f.selected, write)
    .then(result => result.ok && result.outcome === "unconfirmed" && !("url" in result) ? "unconfirmed" : "success", () => "denied");
  expect(transactionCompleted).toBe(true);
  // COMMIT already happened: the correct external denial must preserve the
  // original receipt and must never pretend the mutation was rolled back.
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honoree.issue")))).toHaveLength(1);
  expect(["denied", "unconfirmed"]).toContain(outcome);
});
