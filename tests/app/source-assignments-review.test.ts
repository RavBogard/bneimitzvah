// Independent invented metadata and actual local SDK authority; never live source I/O.
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { discoverRelatedPage } from "../../src/server/study/sources/discovery";
import { parseRelatedMetadata, type RelatedSourceCatalog } from "../../src/server/study/sources/metadata";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { portalRoutesFixture } from "./portal-routes-fixture";

const ref = "Genesis 1:1";
function catalog(count = 3, target = ref): RelatedSourceCatalog {
  return parseRelatedMetadata(Array.from({ length: count }, (_, n) => ({ _id: `invented-${String(n).padStart(2, "0")}`, sourceRef: `Invented Commentary, Section ${n + 1}`, index_title: "Invented Complete Commentary", category: "Commentary", collectiveTitle: { en: "Invented label", he: "דג" }, anchorRef: target })), target);
}
function hash(value: RelatedSourceCatalog) { const result = discoverRelatedPage(value, value.verse, { sourceOffset: 0 }); if (result.status !== "ready") throw new Error("Synthetic catalog hash unavailable"); return result.page.catalogHash; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });

async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", setByMembershipId: f.adminMember.id, proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    return row;
  });
  const data = catalog(), related = vi.fn(async (_target: string, _signal?: AbortSignal) => data);
  function wire(load: (target: string, signal?: AbortSignal) => Promise<RelatedSourceCatalog> = related) {
    const service = createSourceAssignmentsService({ access: f.service, practice: f.runtime.practice, related: load });
    const runtime = { ...f.runtime, sourceAssignments: service };
    return { service, dispatch: createHttpDispatcher(action => action(runtime)) };
  }
  const selection = (mode: "admin" | "tutor" | "parent" | "student" | "child-practice" = "admin") => ({ mode, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1 });
  const intent = (ids = [data.entries[0].id], version = 0) => ({ verseRef: ref, expectedVersion: version, mutationId: randomUUID(), sourceIds: [...ids], catalogHash: hash(data) });
  const request = (who: "admin" | "multi" | "learner" = "admin", handle?: string) => f.request("/api/source-review", { who, method: "POST", handle });
  const path = `/api/students/${f.students[0].id}/source-assignments`;
  const body = (value = intent(), mode: "admin" | "tutor" | "parent" | "student" | "child-practice" = "admin") => { const { studentId: _id, ...scope } = selection(mode); return { ...scope, ...value }; };
  const query = (mode = "admin") => `?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&verseRef=Genesis%201%3A1`;
  function held(value: () => Promise<RelatedSourceCatalog> = async () => data) {
    const entered = deferred(), release = deferred(), load = vi.fn(async () => { entered.resolve(); await release.promise; return value(); });
    return { ...wire(load), entered: entered.promise, release: release.resolve, load };
  }
  const versions = () => f.owner(() => f.db.select().from(s.verseSourceAssignment));
  const audits = () => f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "source-assignment.set")));
  return { ...f, assignment, data, related, selection, intent, requestFor: request, path, body, query, wire, held, versions, audits };
}

test("review actual read modes include linked child but source-write remains staff-only with zero public work on denial", async () => {
  const f = await fixture(), { service } = f.wire();
  for (const [who, mode] of [["admin", "admin"], ["multi", "tutor"], ["multi", "parent"], ["learner", "student"]] as const) {
    expect(await service.read(f.requestFor(who), f.selection(mode), ref)).toMatchObject({ ok: true, currentVersion: 0, citations: [] });
    if (mode === "parent" || mode === "student") await expect(service.replace(f.requestFor(who), f.selection(mode), f.intent())).rejects.toMatchObject({ status: 403 });
  }
  const child = await f.runtime.practice.enter(f.requestFor("multi"), { studentId: f.students[0].id });
  expect(await service.read(f.requestFor("multi", child.handle), f.selection("child-practice"), ref)).toMatchObject({ ok: true, mode: "child-practice", citations: [] });
  await expect(service.replace(f.requestFor("multi", child.handle), f.selection("child-practice"), f.intent())).rejects.toMatchObject({ status: 403 });
  await expect(service.replace(f.requestFor("multi", child.handle), f.selection("tutor"), f.intent())).rejects.toMatchObject({ status: 403 });
  await expect(service.replace(f.requestFor("multi"), { ...f.selection("tutor"), studentId: f.students[2].id }, f.intent())).rejects.toMatchObject({ status: 404 });
  expect(f.related).not.toHaveBeenCalled(); expect(await f.versions()).toEqual([]);
});

test("review real dispatcher closes query/body/methods and does not enter lazy scope for unsupported methods", async () => {
  const f = await fixture(), { dispatch } = f.wire(), scope = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Synthetic unused scope"); }), early = createHttpDispatcher(scope);
  for (const method of ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) expect((await early(new Request(`http://localhost:3000${f.path}`, { method }))).status).toBe(405);
  expect((await early(new Request(`http://localhost:3000${f.path}/receipt`))).status).toBe(405);
  expect(scope).not.toHaveBeenCalled();
  for (const suffix of ["&mode=admin", "&url=ignored", "&sourceRef=ignored", "&studentId=ignored", "&catalogHash=ignored"]) expect((await dispatch(f.request(`${f.path}${f.query()}${suffix}`, { who: "admin" }))).status).toBe(400);
  for (const extra of [{ studentId: f.students[0].id }, { citations: [] }, { url: "https://example.invalid/ignored" }, { sourceIds: ["invented-00", "invented-00"] }]) expect((await dispatch(f.request(f.path, { who: "admin", body: { ...f.body(), ...extra } }))).status).toBe(400);
  expect((await dispatch(f.request(`${f.path}?mode=admin`, { who: "admin", body: f.body() }))).status).toBe(400);
  expect((await dispatch(f.request(`${f.path}${f.query()}`, { who: "admin", headers: { "content-length": "1" } }))).status).toBe(400);
  expect((await dispatch(f.request(`${f.path}${f.query()}`, { who: "admin", headers: { "transfer-encoding": "chunked" } }))).status).toBe(400);
  expect((await dispatch(f.request(f.path, { who: "admin", body: { ...f.body(), unexpected: "x".repeat(16 * 1024) } }))).status).toBe(413);
  expect((await dispatch(f.request(f.path, { who: "admin", body: f.body(), headers: { origin: "https://foreign.example.test" } }))).status).toBe(403);
  expect((await dispatch(f.request(f.path, { who: "anonymous", body: f.body() }))).status).toBe(401);
  expect(f.related).not.toHaveBeenCalled(); expect(await f.versions()).toEqual([]);
});

test("review surviving metadata stays immutable while removal and clear use no public lookup", async () => {
  const f = await fixture(), { service } = f.wire(), first = f.intent([f.data.entries[1].id, f.data.entries[0].id]);
  const saved = await service.replace(f.requestFor(), f.selection(), first); expect(saved).toMatchObject({ ok: true, committedVersion: 1, currentLatestVersion: 1 });
  const changed = { ...f.data, entries: f.data.entries.map(row => ({ ...row, labels: { ...row.labels, en: "Changed provider label" } })) };
  f.related.mockResolvedValue(changed); f.related.mockClear();
  const remove = { verseRef: ref, expectedVersion: 1, mutationId: randomUUID(), sourceIds: [f.data.entries[0].id] };
  expect(await service.replace(f.requestFor(), f.selection(), remove)).toMatchObject({ ok: true, committedVersion: 2, committed: { citations: [{ id: f.data.entries[0].id, labels: { en: "Invented label" } }] } });
  expect(await service.replace(f.requestFor(), f.selection(), { ...remove, mutationId: randomUUID(), expectedVersion: 2, sourceIds: [] })).toMatchObject({ ok: true, committedVersion: 3, committed: { citations: [] } });
  expect(f.related).not.toHaveBeenCalled(); expect((await f.versions()).map(row => row.version).sort()).toEqual([1, 2, 3]);
});

test("review no-change is not a fabricated receipt, whereas exact old intent replays before head/no-op", async () => {
  const f = await fixture(), { service } = f.wire(), first = f.intent();
  await service.replace(f.requestFor(), f.selection(), first);
  const noop = { ...first, mutationId: randomUUID(), expectedVersion: 1 };
  expect(await service.replace(f.requestFor(), f.selection(), noop)).toEqual({ ok: false, code: "no-change" });
  expect(await service.receipt(f.requestFor(), f.selection(), noop)).toMatchObject({ ok: true, outcome: "unconfirmed" });
  await service.replace(f.requestFor(), f.selection(), f.intent([f.data.entries[1].id], 1));
  f.related.mockClear();
  const replay = await service.replace(f.requestFor(), f.selection(), first);
  expect(replay).toMatchObject({ ok: true, replayed: true, committedVersion: 1, currentLatestVersion: 2, committed: { citations: [{ id: f.data.entries[0].id }] } });
  expect(f.related).not.toHaveBeenCalled(); expect(await f.versions()).toHaveLength(2);
});

test("review caller mutation cannot replace the original cookie, target, UUID, expected version or desired IDs", async () => {
  const f = await fixture(), held = f.held(), request = f.requestFor(), selection = f.selection(), intent = f.intent(), originalId = intent.mutationId;
  const pending = held.service.replace(request, selection, intent); await held.entered;
  request.headers.set("cookie", f.identities.learner.cookie); selection.studentId = f.students[3].id; selection.assignmentRevision = 99;
  intent.sourceIds.splice(0, 1, f.data.entries[2].id); intent.verseRef = "Genesis 1:2"; intent.mutationId = randomUUID(); intent.expectedVersion = 40;
  held.release(); expect(await pending).toMatchObject({ ok: true, committedVersion: 1, verseRef: ref, committed: { citations: [{ id: f.data.entries[0].id }] } });
  const [row] = await f.versions(); expect(row).toMatchObject({ mutationId: originalId, studentId: f.students[0].id, verseRef: ref, baseVersion: 0 });
});

test.each(["unavailable", "changed"] as const)("review exact receipt that appears during retry metadata outranks its staged %s and newer head", async outcome => {
  const f = await fixture(), intent = f.intent(), held = f.held(async () => { if (outcome === "unavailable") throw new Error("Synthetic delayed public failure"); return catalog(0); });
  const pending = held.service.replace(f.requestFor(), f.selection(), intent); await held.entered;
  const { service } = f.wire(); expect(await service.replace(f.requestFor(), f.selection(), intent)).toMatchObject({ ok: true, replayed: false, committedVersion: 1 });
  expect(await service.replace(f.requestFor(), f.selection(), f.intent([f.data.entries[1].id], 1))).toMatchObject({ ok: true, committedVersion: 2 });
  held.release(); expect(await pending).toMatchObject({ ok: true, replayed: true, committedVersion: 1, currentLatestVersion: 2, committed: { citations: [{ id: f.data.entries[0].id }] } });
  expect(await f.versions()).toHaveLength(2); expect(await f.audits()).toHaveLength(2);
});

test.each(["unavailable", "changed", "missing"] as const)("review staged public %s cannot hide an actual tutor relationship revocation", async outcome => {
  const f = await fixture(), held = f.held(async () => { if (outcome === "unavailable") throw new Error("Synthetic withheld provider details"); return outcome === "missing" ? catalog(0) : f.data; });
  const intent = f.intent(); if (outcome === "changed") intent.catalogHash = "a".repeat(64);
  const pending = held.service.replace(f.requestFor("multi"), f.selection("tutor"), intent), refusal = expect(pending).rejects.toMatchObject({ status: 404 }); await held.entered;
  await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id))); held.release(); await refusal;
  expect(await f.versions()).toEqual([]);
});

test.each(["student", "grant", "membership", "assignment"] as const)("review original %s revision drift prevents insertion after metadata, even while still authorized", async field => {
  const f = await fixture(), held = f.held(), pending = held.service.replace(f.requestFor(), f.selection(), f.intent()); await held.entered;
  await f.owner(async () => {
    if (field === "student") await f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id));
    if (field === "grant") await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id));
    if (field === "membership") await f.db.update(s.membership).set({ authorityRevision: sql`${s.membership.authorityRevision}+1` }).where(eq(s.membership.id, f.adminMember.id));
    if (field === "assignment") await f.db.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id));
  }); held.release(); expect(await pending).toEqual({ ok: false, code: "stale-revision" }); expect(await f.versions()).toEqual([]);
});

test("review original session expiry outranks source error and caller replacement cookie", async () => {
  const f = await fixture(), held = f.held(async () => { throw new Error("Synthetic withheld source error"); }), request = f.requestFor(), pending = held.service.replace(request, f.selection(), f.intent()), refusal = expect(pending).rejects.toMatchObject({ status: 401 }); await held.entered;
  request.headers.set("cookie", f.identities.multi.cookie); await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.admin.sessionId))); held.release(); await refusal; expect(await f.versions()).toEqual([]);
});

test("review committed receipt accepts new live login and incidental revisions, but not a different current staff mode", async () => {
  const f = await fixture(), { service } = f.wire(), intent = f.intent();
  await service.replace(f.requestFor("multi"), f.selection("tutor"), intent);
  await f.owner(async () => {
    await f.db.update(s.membership).set({ authorityRevision: sql`${s.membership.authorityRevision}+1` }).where(eq(s.membership.id, f.multiMember.id));
    await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.tutorGrant.id));
    await f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id));
  });
  const signedIn = await f.owner(() => f.signIn("multi@example.test")), request = f.requestFor("multi"); request.headers.set("cookie", signedIn.cookie);
  const proof = await f.auth.api.getSession({ headers: request.headers, query: { disableRefresh: true, disableCookieCache: true } });
  expect(proof?.session.id).not.toBe(f.identities.multi.sessionId);
  await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.multi.sessionId)));
  expect(await service.receipt(request, f.selection("tutor"), intent)).toMatchObject({ ok: true, outcome: "committed", committedVersion: 1 });
  expect(await service.replace(request, f.selection("tutor"), intent)).toMatchObject({ ok: true, replayed: true, committedVersion: 1 });
  await f.owner(() => f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "admin" }));
  expect(await service.receipt(request, f.selection("admin"), intent)).toEqual({ ok: false, code: "conflict" });
  expect(await f.versions()).toHaveLength(1);
});

test("review a removed and re-added verse begins an empty stream and cannot expose its historical receipt", async () => {
  const f = await fixture(), { service } = f.wire(), intent = f.intent(); await service.replace(f.requestFor(), f.selection(), intent);
  for (const [revision, verses] of [[2, [2]], [3, [1, 2]]] as const) {
    await f.owner(async () => { await f.db.update(s.assignment).set({ revision, ref: revision === 2 ? "Genesis 1:2" : "Genesis 1:1-2" }).where(eq(s.assignment.id, f.assignment.id)); await f.db.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id)); await f.db.insert(s.assignmentVerse).values(verses.map((n, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: f.assignment.id, ordinal: i + 1, verseRef: `Genesis 1:${n}` }))); });
  }
  expect(await service.receipt(f.requestFor(), f.selection(), intent)).toEqual({ ok: false, code: "stale-revision" });
  expect(await service.read(f.requestFor(), { ...f.selection(), assignmentRevision: 3 }, ref)).toMatchObject({ ok: true, currentVersion: 0, citations: [] });
  expect(await service.receipt(f.requestFor(), { ...f.selection(), assignmentRevision: 3 }, intent)).toEqual({ ok: false, code: "conflict" });
});

test("review 32 escaped citation snapshots fit complete private response cap; 33 IDs and caller metadata cannot enter", async () => {
  const f = await fixture(), raw = Array.from({ length: 32 }, (_, i) => ({ _id: `escape-${i.toString().padStart(2, "0")}`, sourceRef: '"'.repeat(512), index_title: '"'.repeat(512), category: '"'.repeat(128), collectiveTitle: { en: '"'.repeat(256), he: '"'.repeat(256) }, anchorRef: ref })), data = parseRelatedMetadata(raw, ref), { dispatch } = f.wire(async () => data);
  expect(data.entries).toHaveLength(32);
  const response = await dispatch(f.request(f.path, { who: "admin", body: f.body({ verseRef: ref, expectedVersion: 0, mutationId: randomUUID(), sourceIds: data.entries.map(row => row.id), catalogHash: hash(data) }) }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const encoded = await response.text(); expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(128 * 1024); const parsed = JSON.parse(encoded); expect(parsed.committed.citations).toHaveLength(32); expect(parsed).not.toHaveProperty("current"); expect(encoded).not.toMatch(/actorUserId|roleGrantId|authSession|requestDigest|catalogHash|sourceIds/);
  expect((await dispatch(f.request(f.path, { who: "admin", body: f.body({ ...f.intent(), sourceIds: Array.from({ length: 33 }, (_, i) => `new-${i}`) }) }))).status).toBe(400);
});

test("review abort during metadata never inserts or reports the staged source result", async () => {
  const f = await fixture(), held = f.held(), controller = new AbortController(), request = f.requestFor();
  const pending = held.service.replace({ url: request.url, headers: request.headers, method: "POST", signal: controller.signal }, f.selection(), f.intent()), refusal = expect(pending).rejects.toBeDefined(); await held.entered; controller.abort(); held.release(); await refusal; expect(await f.versions()).toEqual([]);
});
