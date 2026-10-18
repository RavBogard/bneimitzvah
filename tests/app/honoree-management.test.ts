import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { honoreeFixture } from "./honoree-fixture";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import * as s from "../../src/server/db/index";
type Fixture = Awaited<ReturnType<typeof honoreeFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() { const f = await honoreeFixture(); fixtures.push(f); return f; }
function path(f: Fixture, suffix = "", studentId = f.selected.studentId) { return `/api/students/${studentId}/honoree-links${suffix}`; }
function request(f: Fixture, write: unknown, suffix = "", options: { who?: "multi" | "admin" | "learner" | "anonymous"; mode?: string; studentId?: string; headers?: Record<string,string>; signal?: AbortSignal } = {}) {
  const req = f.request(path(f, suffix, options.studentId), { method: "POST", who: options.who ?? "multi", headers: options.headers, body: { mode: options.mode ?? "parent", ...write as object } });
  return options.signal ? new Request(req, { signal: options.signal }) : req;
}
function dispatcher(f: Fixture) { return createHttpDispatcher(action => action({ ...f.runtime, honoree: f.honoree })); }
async function privateResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  for (const name of ["set-cookie", "location", "X-Honoree-Remaining-Ms"]) expect(response.headers.get(name)).toBeNull();
  return response.json();
}
function token(dto: { url?: string }) {
  if (typeof dto.url !== "string") throw Error("Synthetic issue response unavailable");
  return new URLSearchParams(new URL(dto.url).hash.slice(1)).get("token")!;
}
function metadataOnly(value: object) { expect("url" in value).toBe(false); expect("assertReturnLive" in value).toBe(false); expect("sessionExpiresAt" in value).toBe(false); }

test("actual private dispatch issues once, returns record-only status/receipts, explicitly replaces and revokes without mail", async () => {
  const f = await fixture(), dispatch = dispatcher(f), write = await f.honoreeIntent();
  const issued = await privateResponse(await dispatch(request(f, write)), 200), oldToken = token(issued);
  expect(issued.ok && issued.outcome === "committed" && issued.replayed === false).toBe(true);
  expect(Object.keys(issued).sort()).toEqual(["expiresAt", "linkId", "ok", "operation", "outcome", "replayed", "startVerse", "url"]);
  const status = await privateResponse(await dispatch(request(f, { startVerse: write.startVerse }, "/status")), 200);
  expect(Object.keys(status).sort()).toEqual(["currentLink", "ok"]);
  expect(Object.keys(status.currentLink).sort()).toEqual(["expiresAt", "id", "issuedAt", "startVerse"]); metadataOnly(status.currentLink);
  for (const suffix of ["", "/receipt"]) {
    const replay = await privateResponse(await dispatch(request(f, write, suffix)), 200);
    expect(replay).toMatchObject({ ok: true, outcome: "committed", replayed: true, linkId: issued.linkId }); metadataOnly(replay);
  }
  const replacement = await f.honoreeIntent("reissue", issued.linkId);
  const reissued = await privateResponse(await dispatch(request(f, replacement)), 200), nextToken = token(reissued);
  expect(reissued.linkId === issued.linkId).toBe(false);
  await expect(f.honoree.read(f.guest(), oldToken)).rejects.toMatchObject({ status: 404 });
  expect(await f.honoree.read(f.guest(), nextToken)).toMatchObject({ ok: true });
  // Record metadata is still present when context is stale; it makes no validity claim.
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "havdalah" }).where(eq(s.student.id, f.selected.studentId)));
  const stale = await privateResponse(await dispatch(request(f, { startVerse: write.startVerse }, "/status")), 200);
  expect(stale.currentLink.id).toBe(reissued.linkId); expect("valid" in stale.currentLink || "active" in stale.currentLink).toBe(false);
  const revoked = await privateResponse(await dispatch(request(f, await f.honoreeIntent("revoke", reissued.linkId))), 200); metadataOnly(revoked);
  await expect(f.honoree.read(f.guest(), nextToken)).rejects.toMatchObject({ status: 404 });
  expect(await privateResponse(await dispatch(request(f, { startVerse: write.startVerse }, "/status")), 200)).toEqual({ ok: true, currentLink: null });
  expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(3);
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(2); expect(f.deliveries).toHaveLength(0);
});

test("unconfirmed then lost original response is reconciled by the same UUID without remint or plaintext recovery", async () => {
  const f = await fixture(), write = await f.honoreeIntent(), normal = dispatcher(f);
  expect(await privateResponse(await normal(request(f, write, "/receipt")), 200)).toEqual({ ok: true, outcome: "unconfirmed" });
  expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(0);
  const lose = createHttpDispatcher(async action => { const response = await action({ ...f.runtime, honoree: f.honoree }); expect(response.status).toBe(200); throw Error("Synthetic lost response after commit"); });
  await privateResponse(await lose(request(f, write)), 503);
  for (const suffix of ["/receipt", ""]) {
    const original = await privateResponse(await normal(request(f, write, suffix)), 200);
    expect(original).toMatchObject({ ok: true, outcome: "committed", replayed: true, operation: "issue" }); metadataOnly(original);
  }
  const conflict = await privateResponse(await normal(request(f, { ...write, mutationId: randomUUID() })), 409);
  expect(conflict).toEqual({ ok: false, code: "conflict" });
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honoree.issue")))).toHaveLength(1);
});

test("management remains exact, bounded and cookie-origin protected; invalid paths/methods/cookies do not construct runtime", async () => {
  const scope = vi.fn<HttpRuntimeScope>(async () => { throw Error("No runtime expected"); }), dispatch = createHttpDispatcher(scope);
  const id = "00000000-0000-0000-0000-000000000000", endpoint = `/api/students/${id}/honoree-links`;
  for (const suffix of ["/issue", "/reissue", "/revoke", "/status/", "/receipt/", "/other"]) expect((await dispatch(new Request("http://localhost:3000" + endpoint + suffix, { method: "POST" }))).status).toBe(404);
  expect((await dispatch(new Request("http://localhost:3000" + endpoint.replace(id, "bad-id"), { method: "POST" }))).status).toBe(404);
  expect((await dispatch(new Request("http://localhost:3000" + endpoint.toUpperCase(), { method: "POST" }))).status).toBe(404);
  for (const suffix of ["", "/receipt", "/status"]) for (const method of ["GET", "HEAD", "DELETE", "OPTIONS"]) {
    const response = await dispatch(new Request("http://localhost:3000" + endpoint + suffix, { method }));
    expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("POST");
  }
  for (const cookie of ["x=one; x=two", "x=" + "x".repeat(17000)]) expect((await dispatch(new Request("http://localhost:3000" + endpoint, { method: "POST", headers: { cookie } }))).status).toBe(400);
  expect(scope).not.toHaveBeenCalled();
  const f = await fixture(), real = dispatcher(f), write = await f.honoreeIntent();
  const invalidHeaders: Record<string,string>[] = [{ origin: "https://foreign.example.test" }, { "sec-fetch-site": "cross-site" }];
  for (const suffix of ["", "/receipt", "/status"]) {
    const body = suffix === "/status" ? { startVerse: write.startVerse } : write;
    for (const headers of invalidHeaders) expect((await real(request(f, body, suffix, { headers }))).status).toBe(403);
    expect((await real(request(f, { ...body, tenantId: "crc" }, suffix))).status).toBe(400);
    expect((await real(request(f, body, suffix + "?mode=parent"))).status).toBe(400);
    const base = request(f, body, suffix);
    expect((await real(new Request(base, { body: JSON.stringify({ mode: "parent", token: "x".repeat(1025) }) }))).status).toBe(413);
  }
});

test("base guardian/admin only: tutor, student/adult self-edit, practice, unrelated/foreign and unknown-cookie-only requests are denied", async () => {
  const f = await fixture(), dispatch = dispatcher(f), write = await f.honoreeIntent();
  const deniedActors: Parameters<typeof request>[3][] = [
    { mode: "tutor" }, { who: "learner", mode: "student" }, { headers: { "X-Practice-Context": "synthetic" } },
    { studentId: f.students[2].id }, { studentId: f.students[3].id }, { who: "anonymous", headers: { cookie: "unknown=synthetic" } },
  ];
  for (const suffix of ["", "/receipt", "/status"]) {
    const body = suffix === "/status" ? { startVerse: write.startVerse } : write;
    for (const options of deniedActors) expect([401, 403, 404]).toContain((await dispatch(request(f, body, suffix, options))).status);
  }
  const admin = await privateResponse(await dispatch(request(f, write, "", { who: "admin", mode: "admin" })), 200);
  expect(admin.ok && typeof admin.url === "string").toBe(true);
  const status = await privateResponse(await dispatch(request(f, { startVerse: write.startVerse }, "/status", { who: "admin", mode: "admin" })), 200);
  expect(status.currentLink.id).toBe(admin.linkId);
  expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(1); expect(f.deliveries).toHaveLength(0);
});

test("absent material mapping honestly denies new issue/reissue while status and revocation remain usable", async () => {
  const f = await fixture(), dispatch = createHttpDispatcher(action => action({ ...f.runtime, honoree: f.noProjector }));
  await privateResponse(await dispatch(request(f, await f.honoreeIntent())), 404);
  const issued = await f.issue();
  await privateResponse(await dispatch(request(f, await f.honoreeIntent("reissue", issued.id))), 404);
  expect((await privateResponse(await dispatch(request(f, { startVerse: "Genesis 1:1" }, "/status")), 200)).currentLink.id).toBe(issued.id);
  metadataOnly(await privateResponse(await dispatch(request(f, await f.honoreeIntent("revoke", issued.id))), 200));
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(1);
});

for (const failure of ["session", "credential-wall", "credential-monotonic", "abort"] as const) test(`new raw URL is withheld when ${failure} crosses runtime cleanup without undoing committed rows`, async () => {
  const f = await fixture(), write = await f.honoreeIntent(), control = new AbortController();
  if (failure.startsWith("credential")) await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date("2100-01-01T00:00:00Z") }).where(eq(s.session.id, f.identities.multi.sessionId)));
  const [session] = await f.owner(() => f.db.select().from(s.session).where(eq(s.session.id, f.identities.multi.sessionId)));
  const dispatch = createHttpDispatcher(async action => {
    const response = await action({ ...f.runtime, honoree: f.honoree }); expect(response.status).toBe(200);
    const dto = await response.clone().json(); expect(typeof dto.url === "string").toBe(true);
    if (failure === "session") vi.spyOn(Date, "now").mockReturnValue(session.expiresAt.getTime());
    if (failure === "credential-wall") vi.spyOn(Date, "now").mockReturnValue(Date.parse(dto.expiresAt));
    if (failure === "credential-monotonic") { vi.spyOn(performance, "now").mockReturnValue(performance.now() + 91 * 86400000); vi.spyOn(Date, "now").mockReturnValue(0); }
    if (failure === "abort") control.abort();
    return response;
  });
  const response = await dispatch(request(f, write, "", { signal: control.signal }));
  expect(await privateResponse(response, 404)).toEqual({ error: "not-found" });
  vi.restoreAllMocks();
  expect(await f.owner(() => f.db.select().from(s.honoreeLink))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.honoreeOperation))).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "honoree.issue")))).toHaveLength(1);
  const receipt = await privateResponse(await dispatcher(f)(request(f, write, "/receipt")), 200);
  expect(receipt).toMatchObject({ ok: true, outcome: "committed", replayed: true }); metadataOnly(receipt);
});

for (const action of ["status", "receipt", "revoke", "conflict"] as const) test(`${action} metadata also rechecks session expiry after runtime cleanup`, async () => {
  const f = await fixture(), issued = await f.issue(), [session] = await f.owner(() => f.db.select().from(s.session).where(eq(s.session.id, f.identities.multi.sessionId)));
  const write = action === "status" ? { startVerse: "Genesis 1:1" } : action === "receipt" ? issued.write : await f.honoreeIntent(action === "revoke" ? "revoke" : "issue", action === "revoke" ? issued.id : null);
  const dispatch = createHttpDispatcher(async run => { const response = await run({ ...f.runtime, honoree: f.honoree }); expect(response.status).toBe(action === "conflict" ? 409 : 200); vi.spyOn(Date, "now").mockReturnValue(session.expiresAt.getTime()); return response; });
  expect(await privateResponse(await dispatch(request(f, write, action === "status" ? "/status" : action === "receipt" ? "/receipt" : "")), 404)).toEqual({ error: "not-found" });
});

test("management response provenance rejects clones, reconstructions and forged success/conflicts", async () => {
  const f = await fixture();
  for (const replacement of ["clone", "reconstruct", "forge", "conflict"] as const) {
    const dispatch = createHttpDispatcher(async run => {
      const response = await run({ ...f.runtime, honoree: f.honoree }); expect(response.status).toBe(200);
      if (replacement === "clone") return response.clone();
      if (replacement === "reconstruct") return new Response(await response.text(), { status: response.status, headers: response.headers });
      return new Response(JSON.stringify(replacement === "conflict" ? { ok: false, code: "conflict" } : { ok: true, outcome: "unconfirmed" }), { status: replacement === "conflict" ? 409 : 200 });
    });
    expect(await privateResponse(await dispatch(request(f, { startVerse: "Genesis 1:1" }, "/status")), 404)).toEqual({ error: "not-found" });
  }
});
