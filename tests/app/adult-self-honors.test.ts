import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { honoreeFixture } from "./honoree-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";
const fixtures: Awaited<ReturnType<typeof honoreeFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture(adult = true) {
  const f = await honoreeFixture(); fixtures.push(f);
  if (adult) await f.owner(() => f.db.update(s.student).set({ studentKind: "adult", ownEmail: "synthetic-adult@example.test" }).where(eq(s.student.id, f.selected.studentId)));
  const selected = { mode: "student" as const, studentId: f.selected.studentId };
  const req = (signal?: AbortSignal) => f.req("learner", signal);
  const intent = async () => ({ ...await f.intent(f.form), expectedVersion: (await f.service.read(req(), selected)).currentVersion });
  const issue = async () => { const write = await f.honoreeIntent(), result = await f.honoree.mutate(req(), selected, write);
    if (!result.ok || !("url" in result) || !result.url) throw Error("Synthetic adult issue refused");
    return { write, result, token: new URLSearchParams(new URL(result.url).hash.slice(1)).get("token")!, id: result.linkId }; };
  return { ...f, adultSelection: selected, adultRequest: req, adultIntent: intent, adultIssue: issue };
}
const rejected = async (work: Promise<unknown>) => { let denied = false; try { await work; } catch { denied = true; } expect(denied).toBe(true); };
const authorizationDenied = async (work: Promise<unknown>, status: 401 | 403 | 404) => {
  let error: unknown; try { await work; } catch (value) { error = value; }
  expect(error instanceof AccessDenied).toBe(true); if (error instanceof AccessDenied) expect(error.status).toBe(status);
};

test("own base adult reads saves conflicts and replays honors with exact identity but no identity DTO", async () => {
  const f = await fixture(), write = await f.adultIntent(), read = await f.service.read(f.adultRequest(), f.adultSelection);
  expect(read.currentVersion).toBe(1); expect((await f.service.replace(f.adultRequest(), f.adultSelection, write)).ok).toBe(true);
  const replay = await f.service.receipt(f.adultRequest(), f.adultSelection, write); expect(replay.ok && replay.outcome === "committed" && replay.replayed).toBe(true);
  expect((await f.service.replace(f.adultRequest(), f.adultSelection, { ...write, mutationId: randomUUID() })).ok).toBe(false);
  const rows = await f.owner(() => f.db.select().from(s.honorsVersion));
  expect(rows.find(row => row.role === "student")).toMatchObject({ studentIdentityId: f.learnerLink.id, guardianId: null, roleGrantId: f.learnerGrant.id });
  expect(JSON.stringify(replay).includes(f.learnerLink.id)).toBe(false);
});

test("adult link issue status reissue revoke and receipts retain one-time secrets and identity binding", async () => {
  const f = await fixture(), issued = await f.adultIssue();
  expect((await f.honoree.read(f.guest(), issued.token)).ok).toBe(true);
  expect((await f.honoree.status(f.adultRequest(), f.adultSelection, "Genesis 1:1")).currentLink?.id).toBe(issued.id);
  const receipt = await f.honoree.receipt(f.adultRequest(), f.adultSelection, issued.write); expect(receipt.ok && receipt.outcome === "committed" && receipt.replayed).toBe(true); expect("url" in receipt).toBe(false);
  expect("url" in await f.honoree.mutate(f.adultRequest(), f.adultSelection, issued.write)).toBe(false);
  const replace = await f.honoreeIntent("reissue", issued.id), replaced = await f.honoree.mutate(f.adultRequest(), f.adultSelection, replace);
  if (!replaced.ok || !("url" in replaced) || !replaced.url) throw Error("Synthetic adult replacement refused");
  const nextToken = new URLSearchParams(new URL(replaced.url).hash.slice(1)).get("token")!;
  await rejected(f.honoree.read(f.guest(), issued.token)); expect((await f.honoree.read(f.guest(), nextToken)).ok).toBe(true);
  const revoke = await f.honoreeIntent("revoke", replaced.linkId); expect((await f.honoree.mutate(f.adultRequest(), f.adultSelection, revoke)).ok).toBe(true);
  await rejected(f.honoree.read(f.guest(), nextToken)); expect("url" in await f.honoree.receipt(f.adultRequest(), f.adultSelection, revoke)).toBe(false);
  const rows = await f.owner(() => f.db.select().from(s.honoreeLink)), operations = await f.owner(() => f.db.select().from(s.honoreeOperation));
  expect(rows.every(r => r.role === "student" && r.guardianId === null && r.studentIdentityId === f.learnerLink.id)).toBe(true);
  expect(operations.length).toBe(3); expect(operations.every(r => r.role === "student" && r.guardianId === null && r.studentIdentityId === f.learnerLink.id)).toBe(true);
});

test("child other-adult cross-tenant tutor missing-grant and delegated contexts deny every management lane", async () => {
  const f = await fixture(false), honorWrite = await f.intent(f.form), seeded = await f.issue();
  const writes = await Promise.all((["issue", "reissue", "revoke"] as const).map(operation => f.honoreeIntent(operation, operation === "issue" ? null : seeded.id)));
  const denyAll = async (request: ReturnType<typeof f.req>, selected: { mode: "student" | "parent" | "tutor" | "admin"; studentId: string }, status: 403 | 404) => {
    await authorizationDenied(f.service.read(request, selected), status); await authorizationDenied(f.service.replace(request, selected, honorWrite), status); await authorizationDenied(f.service.receipt(request, selected, honorWrite), status);
    for (const write of writes) { await authorizationDenied(f.honoree.mutate(request, selected, write), status); await authorizationDenied(f.honoree.receipt(request, selected, write), status); }
    await authorizationDenied(f.honoree.status(request, selected, "Genesis 1:1"), status);
  };
  await denyAll(f.adultRequest(), f.adultSelection, 403);
  await f.owner(() => f.db.update(s.student).set({ studentKind: "adult", ownEmail: "synthetic-adult@example.test" }));
  await denyAll(f.adultRequest(), { ...f.adultSelection, studentId: f.students[1].id }, 404);
  await denyAll(f.adultRequest(), { ...f.adultSelection, studentId: f.students[3].id }, 404);
  await denyAll(f.req("multi"), { mode: "tutor", studentId: f.selected.studentId }, 403);
  await denyAll(f.req("multi"), f.adultSelection, 403);
  const delegated = f.adultRequest(); delegated.headers.set("X-Practice-Context", "synthetic-denied"); await denyAll(delegated, f.adultSelection, 403);
  expect((await f.owner(() => f.db.select().from(s.honoreeOperation))).length).toBe(1);
  expect((await f.owner(() => f.db.select().from(s.honoreeLink))).length).toBe(1);
  expect((await f.owner(() => f.db.select().from(s.honorsVersion))).length).toBe(1);
});

test.each(["kind", "grant", "identity", "member", "session"] as const)("adult %s revocation denies reads receipts and status and scopes guest authority", async change => {
  const f = await fixture(), honorWrite = await f.adultIntent(); await f.service.replace(f.adultRequest(), f.adultSelection, honorWrite); const issued = await f.adultIssue();
  await f.owner(async () => {
    if (change === "kind") await f.db.update(s.student).set({ studentKind: "child" }).where(eq(s.student.id, f.selected.studentId));
    if (change === "grant") await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.learnerGrant.id));
    if (change === "identity") await f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id));
    if (change === "member") await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.learnerMember.id));
    if (change === "session") await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.id, f.identities.learner.sessionId));
  });
  const status = change === "session" ? 401 : change === "identity" ? 404 : 403;
  await authorizationDenied(f.service.read(f.adultRequest(), f.adultSelection), status); await authorizationDenied(f.service.receipt(f.adultRequest(), f.adultSelection, honorWrite), status);
  await authorizationDenied(f.honoree.receipt(f.adultRequest(), f.adultSelection, issued.write), status); await authorizationDenied(f.honoree.status(f.adultRequest(), f.adultSelection, "Genesis 1:1"), status);
  // Bearer authority remains independent of issuer login-session lifetime.
  if (change === "session") expect((await f.honoree.read(f.guest(), issued.token)).ok).toBe(true); else await rejected(f.honoree.read(f.guest(), issued.token));
});

test("adult to child to adult permanently invalidates links without wiping saved honors", async () => {
  const f = await fixture(), issued = await f.adultIssue();
  const before = await f.owner(() => f.db.select().from(s.honoreeReadingEpoch).where(eq(s.honoreeReadingEpoch.studentId, f.selected.studentId)));
  await f.owner(async () => { await f.db.update(s.student).set({ studentKind: "child" }).where(eq(s.student.id, f.selected.studentId)); await f.db.update(s.student).set({ studentKind: "adult" }).where(eq(s.student.id, f.selected.studentId)); });
  await rejected(f.honoree.read(f.guest(), issued.token)); expect((await f.service.read(f.adultRequest(), f.adultSelection)).currentVersion).toBe(1);
  const after = await f.owner(() => f.db.select().from(s.honoreeReadingEpoch).where(eq(s.honoreeReadingEpoch.studentId, f.selected.studentId))); expect(after[0].epoch).toBe(before[0].epoch + 2n);
});

test("successor identity on the same student grant cannot replay prior receipts or revive its guest link", async () => {
  const f = await fixture(), write = await f.adultIntent(); await f.service.replace(f.adultRequest(), f.adultSelection, write); const issued = await f.adultIssue();
  await f.owner(async () => {
    await f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id));
    await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.selected.studentId, roleGrantId: f.learnerGrant.id });
  });
  expect((await f.service.read(f.adultRequest(), f.adultSelection)).currentVersion).toBe(2);
  expect((await f.service.receipt(f.adultRequest(), f.adultSelection, write)).ok).toBe(false);
  expect((await f.honoree.receipt(f.adultRequest(), f.adultSelection, issued.write)).ok).toBe(false);
  await rejected(f.honoree.read(f.guest(), issued.token));
});

test("adult writes preserve cookie Origin and cancellation fences", async () => {
  const f = await fixture(), write = await f.adultIntent(), link = await f.honoreeIntent(), wrong = f.adultRequest(); wrong.headers.set("origin", "https://wrong.example.test");
  await rejected(f.service.replace(wrong, f.adultSelection, write)); await rejected(f.honoree.mutate(wrong, f.adultSelection, link));
  const abort = new AbortController(); abort.abort(); await rejected(f.service.replace(f.adultRequest(abort.signal), f.adultSelection, write)); await rejected(f.honoree.mutate(f.adultRequest(abort.signal), f.adultSelection, link));
  expect((await f.owner(() => f.db.select().from(s.honoreeOperation))).length).toBe(0);
});

test("actual adult HTTP management routes retain no-store and one-time receipt/status projection", async () => {
  const f = await fixture(), dispatch = createHttpDispatcher(async action => action({ ...f.runtime, honoree: f.honoree }));
  const base = `/api/students/${f.selected.studentId}`, write = await f.honoreeIntent();
  const send = (suffix: string, body: object) => dispatch(f.request(base + suffix, { who: "learner", method: "POST", body: { mode: "student", ...body } }));
  const read = await dispatch(f.request(base + "/honors?mode=student", { who: "learner", method: "GET" })); expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toContain("no-store");
  const issued = await send("/honoree-links", write); expect(issued.status).toBe(200); expect(issued.headers.get("cache-control")).toContain("no-store");
  const first = await issued.json(); expect(typeof first.url === "string").toBe(true);
  const receipt = await send("/honoree-links/receipt", write); expect(receipt.status).toBe(200); const replay = await receipt.json(); expect(replay.replayed === true && !("url" in replay)).toBe(true);
  const status = await send("/honoree-links/status", { startVerse: "Genesis 1:1" }); expect(status.status).toBe(200); expect(JSON.stringify(await status.json()).includes(f.learnerLink.id)).toBe(false);
});

test("adult post-commit session ceiling withholds URL while original receipt remains confirmable", async () => {
  const f = await fixture(), write = await f.honoreeIntent(), [session] = await f.owner(() => f.db.select().from(s.session).where(eq(s.session.id, f.identities.learner.sessionId)));
  let produced = false;
  const dispatch = createHttpDispatcher(async action => { const response = await action({ ...f.runtime, honoree: f.honoree }); produced = response.status === 200; vi.spyOn(Date, "now").mockReturnValue(session.expiresAt.getTime()); return response; });
  const response = await dispatch(f.request(`/api/students/${f.selected.studentId}/honoree-links`, { who: "learner", method: "POST", body: { mode: "student", ...write } }));
  expect(produced).toBe(true); expect(response.status).toBe(404); vi.restoreAllMocks();
  expect((await f.owner(() => f.db.select().from(s.honoreeOperation))).length).toBe(1);
  const receipt = await f.honoree.receipt(f.adultRequest(), f.adultSelection, write); expect(receipt.ok && receipt.outcome === "committed" && receipt.replayed).toBe(true); expect("url" in receipt).toBe(false);
});

test("restricted runtime inherits identity-column privileges and rejects identity substitution and mixed actor shapes", async () => {
  const f = await fixture(), issued = await f.adultIssue(); await f.client.exec("SET app.tenant_id='crc'");
  for (const table of ["honors_version", "honoree_link", "honoree_operation"]) for (const privilege of ["SELECT", "INSERT"]) {
    const r = await f.db.execute(sql`select has_column_privilege(current_user, ${table}, 'student_identity_id', ${privilege}) as allowed`); expect(r.rows[0].allowed).toBe(true);
  }
  await rejected(f.db.execute(sql`insert into honoree_operation(tenant_id,student_id,mutation_id,request_digest,operation,link_id,actor_user_id,actor_membership_id,role_grant_id,guardian_id,student_identity_id,role) select tenant_id,student_id,${randomUUID()}::uuid,request_digest,operation,link_id,actor_user_id,actor_membership_id,role_grant_id,guardian_id,${randomUUID()}::uuid,role from honoree_operation where link_id=${issued.id}`));
  await rejected(f.db.execute(sql`insert into honoree_operation(tenant_id,student_id,mutation_id,request_digest,operation,link_id,actor_user_id,actor_membership_id,role_grant_id,guardian_id,student_identity_id,role) select tenant_id,student_id,${randomUUID()}::uuid,request_digest,operation,link_id,actor_user_id,actor_membership_id,role_grant_id,${f.guardians[0].id}::uuid,student_identity_id,role from honoree_operation where link_id=${issued.id}`));
});
