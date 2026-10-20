import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as pollDelay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { postgresAccessFixture, deferred, waitForEntry, settleRace } from "./access-fixture";
import { disposableConfig } from "./disposable.mjs";
import * as s from "../../src/server/db/index";
import { createHonorsService } from "../../src/server/honors/service";
import { createHonoreeService } from "../../src/server/honoree/service";
import { material, unitPair } from "../../src/server/honoree/recipient-material";
import { digest } from "../../src/server/honoree/validation";
import { AccessDenied } from "../../src/server/access/errors";
import type { HonorsForm } from "../../src/lib/honors/types";
const { Client } = createRequire(import.meta.url)("pg");
const fixtures: { close: () => Promise<void> }[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0).reverse()) await f.close(); });
const projected = material({ version: "synthetic-pg-v1", before: [{ he: "Synthetic before Hebrew", en: "Synthetic before English" }], after: [{ he: "Synthetic after Hebrew", en: "Synthetic after English" }], credits: ["Synthetic native fixture only"] });
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const database = (await f.owner.query("select current_database() db")).rows[0].db;
  const monitor = new Client({ ...disposableConfig(), database }); await monitor.connect();
  fixtures.push({ close: () => monitor.end() });
  const ownerPid = (await f.owner.query("select pg_backend_pid() pid")).rows[0].pid;
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  await f.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, f.student.id));
  const [assignment] = await f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", aliyahStarts: [], setByMembershipId: member.id,
    proposalSnapshot: { confirmationDate: f.student.ceremonyDate, serviceSlot: "morning", slotProvenance: 1, needsReview: false } }).returning();
  await f.ownerDb.insert(s.assignmentVerse).values([1, 2].map(i => ({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal: i, verseRef: `Genesis 1:${i}` })));
  const aHonors = createHonorsService({ access: f.a }), bHonors = createHonorsService({ access: f.b });
  const selected = { mode: "parent" as const, studentId: f.student.id };
  const request = (signal?: AbortSignal) => ({ url: "http://localhost:3000/api/private-honoree", headers: new Headers({ cookie: f.tutor.cookie, origin: "http://localhost:3000" }), method: "POST", signal });
  const guest = () => ({ url: "http://localhost:3000/api/honoree/read", headers: new Headers({ origin: "http://localhost:3000" }), method: "POST" });
  const form: HonorsForm = { schemaVersion: 1, openingArk: [], generationToGeneration: [], undressingTorah: [], redressingTorah: [], closingArk: [], aliyot: [{ startVerse: "Genesis 1:1", participants: [{ id: randomUUID(), englishName: "Synthetic participant", hebrewName: null, parent1HebrewName: null, parent2HebrewName: null, relationship: null }] }], parentalBlessing: { participation: null, delivery: null } };
  const contextHash = (await aHonors.read(request(), selected)).currentContext.hash;
  await aHonors.replace(request(), selected, { mutationId: randomUUID(), expectedVersion: 0, contextHash, form });
  const [catalog] = await f.ownerDb.insert(s.serviceCatalog).values({ tenantId: "crc", identity: digest("native synthetic catalog"), feedBytes: Buffer.from("synthetic feed"), provenanceBytes: Buffer.from("synthetic provenance"), pins: { feedSha256: "0".repeat(64), provenanceSha256: "0".repeat(64), artifactRepo: "synthetic/repo", artifactCommit: "0".repeat(40), artifactRunId: "1", sourceGitSha: "0".repeat(40) } }).returning();
  await f.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId: catalog.id, state: "active" });
  const pair = unitPair("morning");
  await f.ownerDb.insert(s.honoreeMaterialRelease).values({ tenantId: "crc", catalogId: catalog.id, catalogIdentity: catalog.identity, slot: "morning", beforeId: pair[0], afterId: pair[1], materialVersion: projected.version, projectionDigest: digest(projected), approvalBasis: "Synthetic native tests, never real approval", notices: projected.credits, state: "active" });
  const signingSecret = randomBytes(48).toString("base64url"), common = { origin: "http://localhost:3000", deployment: { environment: "test" as const, deployment: "postgres" }, signingSecret, projectMaterial: async () => projected };
  const aLinks = createHonoreeService({ ...common, db: f.aDb, access: f.a }), bLinks = createHonoreeService({ ...common, db: f.bDb, access: f.b });
  const write = { operation: "issue" as const, mutationId: randomUUID(), expectedVersion: 1, contextHash, startVerse: "Genesis 1:1", linkId: null };
  async function issue() { const result = await aLinks.mutate(request(), selected, write); if (!("url" in result) || !result.url) throw Error("Synthetic issue failed"); const token = new URLSearchParams(new URL(result.url).hash.slice(1)).get("token")!; return { token, id: token.split(".")[2] }; }
  async function lockEdge(blocked: number, blocker: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if ((await monitor.query("select $1::integer=any(pg_blocking_pids($2::integer)) blocked", [blocker, blocked])).rows[0].blocked) return; await pollDelay(10); }
    throw Error("Required physical PostgreSQL lock edge absent");
  }
  return { ...f, aHonors, bHonors, aLinks, bLinks, selected, request, guest, form, write, issue, assignment, catalog, ownerPid, lockEdge };
}

test("native issue first-acquisition student UPDATE excludes A SHARE save, then committed group change invalidates", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const restore = await f.intercept("a", text => text.includes('from "student"') && text.endsWith("for update"), async go => { const result = await go(); entered.resolve(); await release.promise; return result; });
  const issuing = f.aLinks.mutate(f.request(), f.selected, f.write); let saving: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, issuing);
    const changed = { ...f.form, aliyot: [{ ...f.form.aliyot[0], participants: [{ ...f.form.aliyot[0].participants[0], englishName: "Synthetic changed" }] }] };
    saving = f.bHonors.replace(f.request(), f.selected, { expectedVersion: 1, mutationId: randomUUID(), contextHash: f.write.contextHash, form: changed });
    await f.lockEdge(f.pidB, f.pidA); release.resolve();
    const issued = await issuing; expect(issued).toMatchObject({ ok: true, replayed: false }); expect(await saving).toMatchObject({ ok: true, committedVersion: 2 });
    const token = new URLSearchParams(new URL((issued as {url:string}).url).hash.slice(1)).get("token")!;
    await expect(f.bLinks.read(f.guest(), token)).rejects.toMatchObject({ status: 404 });
  } finally { release.resolve(); await settleRace([issuing, ...(saving ? [saving] : [])]); restore(); }
});
test("native same UUID serializes at student and returns only one raw credential/one audit", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const restore = await f.intercept("a", text => text.includes('from "student"') && text.endsWith("for update"), async go => { const result = await go(); entered.resolve(); await release.promise; return result; });
  const first = f.aLinks.mutate(f.request(), f.selected, f.write); let second: ReturnType<typeof f.bLinks.mutate> | undefined;
  try {
    await waitForEntry(entered.promise, first); second = f.bLinks.mutate(f.request(), f.selected, f.write); await f.lockEdge(f.pidB, f.pidA); release.resolve();
    const results = await Promise.all([first, second]); expect(results.every(r => r.ok)).toBe(true); expect(results.filter(r => "url" in r)).toHaveLength(1); expect(results.filter(r => "replayed" in r && r.replayed)).toHaveLength(1);
    expect(await f.ownerDb.select().from(s.honoreeLink)).toHaveLength(1); expect(await f.ownerDb.select().from(s.honoreeOperation)).toHaveLength(1); expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action,"honoree.issue"))).toHaveLength(1);
  } finally { release.resolve(); await settleRace([first, ...(second ? [second] : [])]); restore(); }
});
test("native reader SHARE authority precedes explicit revocation and later read is denied", async () => {
  const f = await fixture(), issued = await f.issue(), entered = deferred(), release = deferred();
  const restore = await f.intercept("a", text => text.includes('from "honoree_link"') && text.endsWith("for share"), async go => { const result = await go(); entered.resolve(); await release.promise; return result; });
  const reading = f.aLinks.read(f.guest(), issued.token); let revoking: ReturnType<typeof f.bLinks.mutate> | undefined;
  try {
    await waitForEntry(entered.promise, reading); revoking = f.bLinks.mutate(f.request(), f.selected, { ...f.write, operation: "revoke", linkId: issued.id, mutationId: randomUUID() });
    await f.lockEdge(f.pidB, f.pidA); release.resolve(); expect(await reading).toMatchObject({ ok: true }); expect(await revoking).toMatchObject({ ok: true });
    await expect(f.bLinks.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
  } finally { release.resolve(); await settleRace([reading, ...(revoking ? [revoking] : [])]); restore(); }
});
for (const mutation of ["verse", "grant", "material"] as const) test(`native read linearizes before ${mutation} invalidation with a measured physical lock edge`, async () => {
  const f = await fixture(), issued = await f.issue(), entered = deferred(), release = deferred();
  const restore = await f.intercept("a", text => text.includes('from "honoree_link"') && text.endsWith("for share"), async go => { const result = await go(); entered.resolve(); await release.promise; return result; });
  const reading = f.aLinks.read(f.guest(), issued.token); let updating: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, reading);
    updating = (async () => {
      if (mutation === "verse") await f.ownerDb.update(s.assignmentVerse).set({ verseRef: "Genesis 1:3" }).where(eq(s.assignmentVerse.ordinal, 2));
      if (mutation === "grant") { const [link] = await f.ownerDb.select().from(s.honoreeLink); await f.ownerDb.update(s.roleGrant).set({ revokedAt: new Date(), revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, link.roleGrantId)); }
      if (mutation === "material") await f.ownerDb.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: sql`${s.serviceCatalogLifecycle.revision}+1` }).where(eq(s.serviceCatalogLifecycle.catalogId, f.catalog.id));
    })();
    await f.lockEdge(f.ownerPid, f.pidA); release.resolve(); expect(await reading).toMatchObject({ ok: true }); await updating;
    await expect(f.bLinks.read(f.guest(), issued.token)).rejects.toMatchObject({ status: 404 });
  } finally { release.resolve(); await settleRace([reading, ...(updating ? [updating] : [])]); restore(); }
});

// Native adult-authority races: source only until the separately selected PG lane.
async function adultFixture() {
  const f = await fixture(), adult = await f.signIn("pg-adult-self");
  const [member] = await f.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: adult.id }).returning();
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  const [identity] = await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id }).returning();
  await f.ownerDb.update(s.student).set({ studentKind: "adult", ownEmail: "synthetic-native-adult@example.test" }).where(eq(s.student.id, f.student.id));
  const selected = { mode: "student" as const, studentId: f.student.id };
  const request = () => ({ ...f.request(), headers: new Headers({ cookie: adult.cookie, origin: "http://localhost:3000" }) });
  return { ...f, adult, adultGrant: grant, adultIdentity: identity, adultSelection: selected, adultRequest: request };
}

test("native adult issue holding student excludes kind transition then permanent epoch denies former credential", async () => {
  const f = await adultFixture(), entered = deferred(), release = deferred();
  const restore = await f.intercept("a", text => text.includes('from "student"') && text.endsWith("for update"), async go => { const value = await go(); entered.resolve(); await release.promise; return value; });
  const issuing = f.aLinks.mutate(f.adultRequest(), f.adultSelection, f.write); let changing: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, issuing);
    changing = f.owner.query("update student set student_kind='child' where id=$1", [f.student.id]);
    await f.lockEdge(f.ownerPid, f.pidA); release.resolve();
    const result = await issuing; if (!result.ok || !("url" in result) || !result.url) throw Error("Synthetic native adult issue refused");
    await changing;
    const token = new URLSearchParams(new URL(result.url).hash.slice(1)).get("token")!;
    await expect(f.bLinks.read(f.guest(), token)).rejects.toMatchObject({ status: 404 });
    await expect(f.bLinks.receipt(f.adultRequest(), f.adultSelection, f.write)).rejects.toMatchObject({ status: 403 });
    await f.owner.query("update student set student_kind='adult' where id=$1", [f.student.id]);
    await expect(f.bLinks.read(f.guest(), token)).rejects.toMatchObject({ status: 404 });
    const rows = await f.ownerDb.select().from(s.honoreeLink); expect(rows[0].studentIdentityId).toBe(f.adultIdentity.id); expect(rows[0].guardianId).toBeNull();
  } finally { release.resolve(); await settleRace([issuing, ...(changing ? [changing] : [])]); restore(); }
});

test.each(["kind", "grant", "identity"] as const)("native adult %s revocation wins before locked guard and blocks all new link work", async change => {
  const f = await adultFixture(); await f.owner.query("begin"); let transaction = true, pending: Promise<unknown> | undefined;
  try {
    if (change === "kind") await f.owner.query("update student set student_kind='child' where id=$1", [f.student.id]);
    if (change === "grant") await f.owner.query("update role_grant set revoked_at=now() where id=$1", [f.adultGrant.id]);
    if (change === "identity") await f.owner.query("update student_identity set revoked_at=now() where id=$1", [f.adultIdentity.id]);
    const issuing = f.aLinks.mutate(f.adultRequest(), f.adultSelection, f.write);
    const observed = issuing.then(() => false, error => error instanceof AccessDenied && error.status === (change === "identity" ? 404 : 403)); pending = observed;
    await f.lockEdge(f.pidA, f.ownerPid); await f.owner.query("commit"); transaction = false;
    expect(await observed).toBe(true);
    expect((await f.ownerDb.select().from(s.honoreeOperation)).length).toBe(0);
    expect((await f.ownerDb.select().from(s.honoreeLink)).length).toBe(0);
  } finally { if (transaction) await f.owner.query("rollback"); if (pending) await settleRace([pending]); }
});
