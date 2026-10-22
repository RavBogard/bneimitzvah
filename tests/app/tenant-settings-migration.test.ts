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
import { validateSettings } from "../../src/server/settings/validation";

const TAG = "0030_congregation_settings";
const sheet = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
// Invisible and control characters are built from code points so none sits raw in this file.
const ch = (code: number) => String.fromCharCode(code);

test("0030 additive migration upgrades and replays, with the generated snapshot limited to tenant_settings and the audit action list", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const entries = journal.entries.filter((e: { tag: string }) => e.tag !== TAG), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const before = (await client.query("select id, customs from tenant order by id")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    // Customs are neither migrated nor rewritten; no settings version is invented for CRC.
    expect((await client.query("select id, customs from tenant order by id")).rows).toEqual(before);
    expect((await client.query("select count(*)::int as n from tenant_settings")).rows).toEqual([{ n: 0 }]);
    // Compared with whichever migration precedes it, so a renumbering beside parallel migrations keeps this check honest.
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG), snapshot = (tag: string) => join(folder, `meta/${tag.slice(0, 4)}_snapshot.json`);
    expect(own).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(snapshot(journal.entries[own - 1].tag), "utf8")), current = JSON.parse(await readFile(snapshot(TAG), "utf8"));
    const expected = structuredClone(previous.tables);
    expected["public.tenant_settings"] = current.tables["public.tenant_settings"];
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
    expect(current.tables["public.audit_event"].checkConstraints.audit_action_known.value).toContain("'tenant-settings.set'");
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the SQL settings check and the TypeScript validator agree: limits accept, one past them rejects", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const sql = async (body: unknown) => (await client.query<{ valid: boolean }>("select portal_tenant_settings_valid($1::jsonb) as valid", [JSON.stringify(body)])).rows[0].valid;
    const siddur = "https://siddur.centralreform.org/";
    const accepted: unknown[] = [
      {}, { rabbiDisplayName: "Rabbi Daniel" }, { rabbiDisplayName: "ש".repeat(80) }, { rabbiDisplayName: "a".repeat(80) },
      { services: { morning: { label: "Shacharit", start: "10:00" } } }, { services: { havdalah: { start: "23:59" } } }, { services: { morning: { label: "m".repeat(40) }, havdalah: { label: "Havdalah", start: "00:00" } } },
      { preferredSources: ["Rashi"] }, { preferredSources: Array.from({ length: 12 }, (_, i) => `Work ${i}`) }, { preferredSources: ["t".repeat(160)] }, { preferredSources: ["Rashi", "rashi"] },
      { siddurUrl: siddur }, { musicUrl: "https://centralreform.live/" }, { siddurUrl: "https://a.b.centralreform.org/book?p=12&service=x" },
      { siddurUrl: `${siddur}${"p".repeat(512 - siddur.length)}` },
      { rosterSheetId: sheet }, { rosterSheetId: "a".repeat(25) }, { rosterSheetId: "a".repeat(100) },
      { consentNotice: "We record lessons only with your permission.\nAsk us any time." }, { consentNotice: "c".repeat(600) },
      { rabbiDisplayName: "Rabbi Daniel", services: { morning: { label: "Morning", start: "10:00" } }, preferredSources: ["Rashi", "Ramban on Genesis"], siddurUrl: siddur, musicUrl: "https://centralreform.live/", rosterSheetId: sheet, consentNotice: "Notice." },
    ];
    const rejected: unknown[] = [
      null, [], "text", { unknown: 1 }, { rabbiDisplayName: "" }, { rabbiDisplayName: "a".repeat(81) }, { rabbiDisplayName: "ש".repeat(81) }, { rabbiDisplayName: " padded" },
      { rabbiDisplayName: "<b>Rabbi</b>" }, { rabbiDisplayName: "line\nbreak" }, { rabbiDisplayName: `zero${ch(0x200b)}width` }, { rabbiDisplayName: `bidi${ch(0x202e)}mark` }, { rabbiDisplayName: `c1${ch(0x85)}control` }, { rabbiDisplayName: 7 },
      { services: {} }, { services: { evening: { start: "18:00" } } }, { services: { morning: {} } }, { services: { morning: { start: "24:00" } } }, { services: { morning: { start: "9:30" } } },
      { services: { morning: { label: "m".repeat(41) } } }, { services: { morning: { label: "Morning", note: "x" } } }, { services: [] },
      { preferredSources: [] }, { preferredSources: Array.from({ length: 13 }, (_, i) => `Work ${i}`) }, { preferredSources: ["t".repeat(161)] }, { preferredSources: ["Rashi", "Rashi"] }, { preferredSources: [""] }, { preferredSources: [1] }, { preferredSources: "Rashi" },
      { siddurUrl: "http://siddur.centralreform.org/" }, { siddurUrl: "https://siddur.centralreform.org" }, { siddurUrl: "https://evil.example/" }, { siddurUrl: "https://centralreform.org.evil.example/" },
      { siddurUrl: "https://centralreform.org/" }, { siddurUrl: "https://www.centralreform.live/" }, { siddurUrl: "https://siddur.centralreform.org:8443/" }, { siddurUrl: ["https://user", "siddur.centralreform.org/"].join("@") },
      { siddurUrl: `${siddur}#top` }, { siddurUrl: "https://SIDDUR.centralreform.org/" }, { siddurUrl: `${siddur}a b` }, { siddurUrl: "javascript:alert(1)" },
      { siddurUrl: `${siddur}${"p".repeat(513 - siddur.length)}` }, { musicUrl: "https://centralreform.live/\"x" },
      { rosterSheetId: "a".repeat(24) }, { rosterSheetId: "a".repeat(101) }, { rosterSheetId: "has space in it and is long enough" },
      { consentNotice: "c".repeat(601) }, { consentNotice: "<script>" }, { consentNotice: "tab\there" }, { consentNotice: "\nleading" }, { consentNotice: `line${ch(0x2028)}sep` },
    ];
    for (const body of accepted) { expect(validateSettings(body).ok, JSON.stringify(body).slice(0, 100)).toBe(true); expect(await sql(body), JSON.stringify(body).slice(0, 100)).toBe(true); }
    for (const body of rejected) { expect(validateSettings(body).ok, JSON.stringify(body)?.slice(0, 100)).toBe(false); expect(await sql(body), JSON.stringify(body)?.slice(0, 100)).toBe(false); }
    // A lone surrogate never reaches the database: jsonb cannot hold it, so the service refuses it as invalid rather than failing there.
    for (const body of [{ rabbiDisplayName: `Rabbi ${ch(0xd800)}` }, { preferredSources: [ch(0xdc00)] }, { consentNotice: `x${ch(0xd800)}` }, { services: { morning: { label: ch(0xd800) } } }]) {
      expect(validateSettings(body).ok).toBe(false);
      await expect(sql(body)).rejects.toBeDefined();
    }
    // Where the parser normalises a link (dot segments), only the service is strict; the database is the looser side, never the stricter.
    expect(validateSettings({ siddurUrl: `${siddur}a/../b` }).ok).toBe(false);
    expect(await sql({ siddurUrl: `${siddur}a/../b` })).toBe(true);
  } finally { await client.close(); }
});

test("tenant_settings is tenant-isolated, admin-or-owner-only, insert-only for the runtime, and the owner's first version carries no actor", async () => {
  const f = await accessFixture();
  try {
    const actor = { actorUserId: f.identities.admin.id, actorMembershipId: f.adminMember.id, roleGrantId: f.adminGrant.id, role: "admin" as const, mode: "admin" as const, channel: "web", requestDigest: "a".repeat(64) };
    const row = { tenantId: "crc", version: 1, baseVersion: 0, previousVersion: null, body: { rabbiDisplayName: "Rabbi Daniel" }, ...actor };
    await f.owner(async () => { await f.db.insert(s.tenantSettings).values({ ...row, mutationId: randomUUID() }); });
    const next = { ...row, version: 2, baseVersion: 1, previousVersion: 1 };
    const tutor = { actorUserId: f.identities.multi.id, actorMembershipId: f.multiMember.id, roleGrantId: f.tutorGrant.id, role: "tutor" as const, mode: "tutor" as const };
    const none = { actorUserId: null, actorMembershipId: null, roleGrantId: null, role: null, mode: null };
    for (const bad of [
      { ...row }, { ...next, previousVersion: null }, { ...next, version: 3, baseVersion: 2, previousVersion: 2 }, { ...next, ...tutor }, { ...next, actorMembershipId: f.multiMember.id },
      { ...next, channel: "mcp" }, { ...next, body: { rabbiDisplayName: "<b>" } }, { ...next, body: { other: 1 } }, { ...next, requestDigest: "nope" },
      // The owner's actorless row is only ever the empty first version.
      { ...next, channel: "operator", ...none }, { ...row, tenantId: "other", channel: "operator", ...none, body: { rabbiDisplayName: "Rabbi" } },
      { ...row, tenantId: "other", channel: "web", ...none, body: {} }, { ...row, tenantId: "other", channel: "operator", body: {} },
    ]) await expect(f.owner(async () => { await f.db.insert(s.tenantSettings).values({ ...bad, mutationId: randomUUID() } as never); }), JSON.stringify(Object.keys(bad))).rejects.toBeDefined();
    await f.owner(async () => { await f.db.insert(s.tenantSettings).values({ ...row, tenantId: "other", channel: "operator", ...none, body: {}, mutationId: randomUUID() }); });
    await f.owner(async () => { await f.db.insert(s.tenant).values({ id: "third", name: "Synthetic third", productName: "Synthetic" }); });
    // Triggers refuse even the owner; the runtime role has no UPDATE or DELETE at all.
    await expect(f.owner(() => f.client.exec("update tenant_settings set body='{}'::jsonb"))).rejects.toBeDefined();
    await expect(f.owner(() => f.client.exec("delete from tenant_settings"))).rejects.toBeDefined();
    await f.client.exec("select set_config('app.tenant_id','crc',false)");
    await expect(f.client.exec("update tenant_settings set body='{}'::jsonb")).rejects.toThrow(/permission denied/);
    await expect(f.client.exec("delete from tenant_settings")).rejects.toThrow(/permission denied/);
    expect((await f.client.query("select tenant_id, version from tenant_settings")).rows).toEqual([{ tenant_id: "crc", version: 1 }]);
    // The runtime may never write the owner's actorless first version, even for its own congregation...
    await f.client.exec("select set_config('app.tenant_id','third',false)");
    await expect(f.client.query("insert into tenant_settings(tenant_id,version,base_version,previous_version,body,channel,mutation_id,request_digest) values('third',1,0,null,'{}'::jsonb,'operator',$1,$2)", [randomUUID(), "a".repeat(64)])).rejects.toThrow(/row-level security/);
    // ...nor a well-formed admin version into another congregation's stream.
    const admin = `insert into tenant_settings(tenant_id,version,base_version,previous_version,body,actor_user_id,actor_membership_id,role_grant_id,role,mode,channel,mutation_id,request_digest)
      values('crc',2,1,1,'{}'::jsonb,$1,$2,$3,'admin','admin','web',$4,$5)`, values = () => [actor.actorUserId, actor.actorMembershipId, actor.roleGrantId, randomUUID(), "a".repeat(64)];
    await f.client.exec("select set_config('app.tenant_id','other',false)");
    await expect(f.client.query(admin, values())).rejects.toThrow(/row-level security/);
    expect((await f.client.query("select tenant_id, version, channel from tenant_settings")).rows).toEqual([{ tenant_id: "other", version: 1, channel: "operator" }]);
    // The same row inside its own congregation is accepted, so the refusals above are the policy's.
    await f.client.exec("select set_config('app.tenant_id','crc',false)");
    await f.client.query(admin, values());
    expect((await f.client.query("select version from tenant_settings order by version")).rows).toEqual([{ version: 1 }, { version: 2 }]);
    await f.client.exec("select set_config('app.tenant_id','',false)");
    expect((await f.client.query("select count(*)::int n from tenant_settings")).rows).toEqual([{ n: 0 }]);
    const rights = await f.client.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; rls: boolean; force: boolean }>(
      `select has_table_privilege('portal_runtime','tenant_settings','SELECT') sel, has_table_privilege('portal_runtime','tenant_settings','INSERT') ins,
        has_table_privilege('portal_runtime','tenant_settings','UPDATE') upd, has_table_privilege('portal_runtime','tenant_settings','DELETE') del,
        relrowsecurity rls, relforcerowsecurity force from pg_class where relname='tenant_settings'`);
    expect(rights.rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false, rls: true, force: true });
    // The runtime still cannot write the tenant directory itself.
    const directory = await f.client.query<{ t: boolean; h: boolean }>("select has_table_privilege('portal_runtime','tenant','INSERT') t, has_table_privilege('portal_runtime','tenant_host','INSERT') h");
    expect(directory.rows[0]).toEqual({ t: false, h: false });
    const policies = await f.client.query<{ n: number }>("select count(*)::int n from pg_policies where tablename='tenant_settings' and policyname='tenant_isolation'");
    expect(policies.rows[0].n).toBe(1);
  } finally { await f.client.close(); }
});
