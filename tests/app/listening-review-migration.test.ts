import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { accessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";

const TAG = "0034_listening_review";

test("0034 additive migration upgrades and replays, with the generated snapshot limited to listening_review_verdict and the audit action list", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    // Everything before this migration: a later one applied first would make the migrator skip this one as already past.
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(own).toBeGreaterThan(0);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const before = (await client.query("select count(*)::int n from audit_event")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect((await client.query("select count(*)::int n from audit_event")).rows).toEqual(before);
    expect((await client.query("select count(*)::int as n from listening_review_verdict")).rows).toEqual([{ n: 0 }]);
    // Compared with whichever migration precedes it, so a renumbering beside parallel migrations keeps this check honest.
    const snapshot = (tag: string) => join(folder, `meta/${tag.slice(0, 4)}_snapshot.json`);
    const previous = JSON.parse(await readFile(snapshot(journal.entries[own - 1].tag), "utf8")), current = JSON.parse(await readFile(snapshot(TAG), "utf8"));
    const expected = structuredClone(previous.tables);
    expected["public.listening_review_verdict"] = current.tables["public.listening_review_verdict"];
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
    const actions = current.tables["public.audit_event"].checkConstraints.audit_action_known.value as string;
    // The earlier list is kept whole; only new actions are added.
    for (const action of previous.tables["public.audit_event"].checkConstraints.audit_action_known.value.match(/'[^']+'/g)) expect(actions).toContain(action);
    expect(actions).toContain("'listening-review.set'");
  } finally { await client.close(); await isolation.cleanup(); }
});

test("listening_review_verdict is tenant-isolated, admin-only, insert-only for the runtime, closed in shape and immutable", async () => {
  const f = await accessFixture();
  try {
    const admin = { actorUserId: f.identities.admin.id, actorMembershipId: f.adminMember.id, roleGrantId: f.adminGrant.id, role: "admin" as const, mode: "admin" as const };
    const row = { tenantId: "crc", sampleVersion: "listening-sample/v1", itemId: "pt-genesis-1-1", verseRef: "Genesis 1:1", source: "pocket-torah", sourcePin: "a".repeat(64),
      asset: `rs_${"b".repeat(64)}`, verdict: "pass", reasons: [] as string[], note: null as string | null, latencyMs: 300, ...admin };
    await f.owner(async () => { await f.db.insert(s.listeningReviewVerdict).values({ ...row, mutationId: randomUUID() }); });
    const tutor = { actorUserId: f.identities.multi.id, actorMembershipId: f.multiMember.id, roleGrantId: f.tutorGrant.id, role: "tutor" as const, mode: "tutor" as const };
    for (const bad of [
      { ...row, ...tutor }, { ...row, mode: "tutor" }, { ...row, actorMembershipId: f.multiMember.id }, { ...row, source: "other" }, { ...row, sourcePin: "nope" }, { ...row, asset: "../x" },
      { ...row, verdict: "maybe" }, { ...row, reasons: ["slow-start"] }, { ...row, verdict: "needs-work", reasons: ["other"] }, { ...row, verdict: "needs-work", reasons: [null] },
      { ...row, note: "<b>" }, { ...row, note: "x".repeat(1001) }, { ...row, note: " padded" }, { ...row, latencyMs: -1 }, { ...row, latencyMs: 60001 },
      { ...row, sampleVersion: "v1" }, { ...row, itemId: "Genesis 1:1" }, { ...row, verseRef: "x" },
    ]) await expect(f.owner(async () => { await f.db.insert(s.listeningReviewVerdict).values({ ...bad, mutationId: randomUUID() } as never); }), JSON.stringify(bad).slice(0, 120)).rejects.toBeDefined();
    await f.owner(async () => { await f.db.insert(s.listeningReviewVerdict).values({ ...row, verdict: "needs-work", reasons: ["verse-cut", "would-teach-wrong"], note: "Line one\nline two", mutationId: randomUUID() }); });
    // Triggers refuse even the owner; the runtime role has no UPDATE or DELETE at all.
    await expect(f.owner(() => f.client.exec("update listening_review_verdict set verdict='pass'"))).rejects.toBeDefined();
    await expect(f.owner(() => f.client.exec("delete from listening_review_verdict"))).rejects.toBeDefined();
    await f.client.exec("select set_config('app.tenant_id','crc',false)");
    await expect(f.client.exec("update listening_review_verdict set verdict='pass'")).rejects.toThrow(/permission denied/);
    await expect(f.client.exec("delete from listening_review_verdict")).rejects.toThrow(/permission denied/);
    expect((await f.client.query("select count(*)::int n from listening_review_verdict")).rows).toEqual([{ n: 2 }]);
    const insert = `insert into listening_review_verdict(tenant_id,sample_version,item_id,verse_ref,source,source_pin,asset,verdict,reasons,actor_user_id,actor_membership_id,role_grant_id,role,mode,mutation_id)
      values($1,'listening-sample/v1','pt-genesis-1-1','Genesis 1:1','pocket-torah',$2,$3,'pass','{}',$4,$5,$6,'admin','admin',$7)`;
    const values = (tenant: string) => [tenant, "a".repeat(64), `rs_${"b".repeat(64)}`, admin.actorUserId, admin.actorMembershipId, admin.roleGrantId, randomUUID()];
    // Another congregation's context can neither see nor write this congregation's verdicts.
    await f.client.exec("select set_config('app.tenant_id','other',false)");
    expect((await f.client.query("select count(*)::int n from listening_review_verdict")).rows).toEqual([{ n: 0 }]);
    await expect(f.client.query(insert, values("crc"))).rejects.toThrow(/row-level security/);
    await f.client.exec("select set_config('app.tenant_id','crc',false)");
    await f.client.query(insert, values("crc"));
    // A tutor-shaped row is refused by the policy as well as the checks.
    await expect(f.client.query(insert.replace("'admin','admin'", "'tutor','tutor'"), values("crc"))).rejects.toBeDefined();
    await f.client.exec("select set_config('app.tenant_id','',false)");
    expect((await f.client.query("select count(*)::int n from listening_review_verdict")).rows).toEqual([{ n: 0 }]);
    const rights = await f.client.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; rls: boolean; force: boolean }>(
      `select has_table_privilege('portal_runtime','listening_review_verdict','SELECT') sel, has_table_privilege('portal_runtime','listening_review_verdict','INSERT') ins,
        has_table_privilege('portal_runtime','listening_review_verdict','UPDATE') upd, has_table_privilege('portal_runtime','listening_review_verdict','DELETE') del,
        relrowsecurity rls, relforcerowsecurity force from pg_class where relname='listening_review_verdict'`);
    expect(rights.rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false, rls: true, force: true });
    const policies = await f.client.query<{ n: number }>("select count(*)::int n from pg_policies where tablename='listening_review_verdict'");
    expect(policies.rows[0].n).toBe(1);
  } finally { await f.client.close(); }
});
