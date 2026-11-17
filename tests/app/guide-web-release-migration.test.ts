import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

// Release and hold on the web Guides page, migration 0058 (Daniel 2026-11-17): additive. One nullable column on study_guide; a web row is
// an import, as before, or an exact copy of the version just before it that releases or holds it; the import index covers imports only.
// Rows written the old way (no column) are checked exactly as before, so the code running in production keeps working once it is applied.
const TAG = "0058_guide_web_release";
const BODY = JSON.stringify({ overview: "An invented overview.", themes: [] });
const OTHER = JSON.stringify({ overview: "A different invented overview.", themes: [] });
const DIGEST = "a".repeat(64);

test("0058 adds only the copy column, lets the web channel copy a version exactly and nothing else, keeps rows and old writes, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(own).toBeGreaterThan(0);
    expect(journal.entries[own].idx).toBe(own);
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID(), grant = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('release-admin','Synthetic admin',$1,true)", [["release-admin", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','release-admin')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin')", [grant, member]);
    type Row = { key: string; version: number; channel?: string; origin?: string; reviewed?: boolean; hold?: boolean; body?: string; credit?: string | null; importKey?: string | null };
    const columns = "tenant_id,kind,reading_key,version,base_version,previous_version,origin,reviewed,hold,body,actor_user_id,actor_membership_id,role_grant_id,role,mode,channel,mutation_id,request_digest,import_credit,import_key";
    const params = (r: Row) => [r.key, r.version, r.version - 1, r.version === 1 ? null : r.version - 1, r.origin ?? "claude", r.reviewed ?? false, r.hold ?? false, r.body ?? BODY, member, grant,
      r.channel ?? "mcp", randomUUID(), DIGEST, r.credit ?? null, r.importKey ?? null];
    const values = "'crc','torah',$1,$2,$3,$4,$5,$6,$7,$8,'release-admin',$9,$10,'admin','admin',$11,$12,$13,$14,$15";
    // The insert the deployed code makes: no copy column at all.
    const old = (r: Row) => client.query(`insert into public.study_guide(${columns}) values(${values})`, params(r));
    const copy = (r: Row & { copyOf: number | null }) => client.query(`insert into public.study_guide(${columns},copy_of_version) values(${values},$16)`, [...params(r), r.copyOf]);

    // Before 0058: a released guide, a held draft over it, and an import.
    await old({ key: "pekudei", version: 1, reviewed: true });
    await old({ key: "pekudei", version: 2, hold: true, body: OTHER });
    await old({ key: "vayera", version: 1, channel: "web", hold: true, origin: "rabbi", credit: "Rabbi Synthetic", importKey: "b".repeat(64) });
    const capture = async () => (await client.query("select * from study_guide order by id")).rows as object[];
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(await capture()).toEqual(before.map(row => ({ ...row, copy_of_version: null })));

    // The deployed code's writes are unchanged: a Claude save, a publish, an import, and an import of the same content refused as before.
    await old({ key: "pekudei", version: 3, body: OTHER });
    await old({ key: "noach", version: 1, channel: "web", hold: true, credit: "Rabbi Synthetic", importKey: "c".repeat(64) });
    await expect(old({ key: "vayera", version: 2, channel: "web", hold: true, credit: "Rabbi Synthetic", importKey: "b".repeat(64) })).rejects.toThrow();
    await expect(old({ key: "toldot", version: 1, channel: "web", hold: false, credit: "Rabbi Synthetic", importKey: "d".repeat(64) })).rejects.toThrow();
    await expect(old({ key: "toldot", version: 1, channel: "web" })).rejects.toThrow();

    // A web hold of the released version 3, then a web release of that hold: exact copies of the version before.
    await copy({ key: "pekudei", version: 4, channel: "web", hold: true, body: OTHER, copyOf: 3 });
    await copy({ key: "pekudei", version: 5, channel: "web", hold: false, body: OTHER, copyOf: 4 });
    // Releasing an import from the web carries its credit and key forward; the import index covers imports only.
    await copy({ key: "vayera", version: 2, channel: "web", hold: false, origin: "rabbi", credit: "Rabbi Synthetic", importKey: "b".repeat(64), copyOf: 1 });

    // Everything else a web row might try is refused.
    const refused: [string, Row & { copyOf: number | null }][] = [
      ["new text", { key: "pekudei", version: 6, channel: "web", hold: true, body: BODY, copyOf: 5 }],
      ["marked reviewed", { key: "pekudei", version: 6, channel: "web", hold: true, body: OTHER, reviewed: true, copyOf: 5 }],
      ["relabeled", { key: "pekudei", version: 6, channel: "web", hold: true, body: OTHER, origin: "rabbi", copyOf: 5 }],
      ["neither release nor hold", { key: "pekudei", version: 6, channel: "web", hold: false, body: OTHER, copyOf: 5 }],
      ["a copy of an older version", { key: "pekudei", version: 6, channel: "web", hold: true, body: OTHER, copyOf: 3 }],
      ["provenance added", { key: "pekudei", version: 6, channel: "web", hold: true, body: OTHER, credit: "Rabbi Synthetic", importKey: "e".repeat(64), copyOf: 5 }],
      ["provenance dropped", { key: "vayera", version: 3, channel: "web", hold: true, origin: "rabbi", copyOf: 2 }],
      ["a web save with no copy", { key: "pekudei", version: 6, channel: "web", hold: false, body: BODY, copyOf: null }],
      ["a copy on the MCP channel", { key: "pekudei", version: 6, channel: "mcp", hold: true, body: OTHER, copyOf: 5 }],
      ["a copy on the operator channel", { key: "pekudei", version: 6, channel: "operator", hold: true, body: OTHER, copyOf: 5 }],
      ["a copy of nothing", { key: "toldot", version: 1, channel: "web", hold: true, copyOf: 0 }],
    ];
    for (const [label, row] of refused) await expect(copy(row), label).rejects.toThrow();
    // A version-one web row naming a copy has no version before it: the check refuses it on its own, with the trigger switched off.
    await client.query("begin"); await client.query("alter table study_guide disable trigger study_guide_copy");
    await expect(copy({ key: "toldot", version: 1, channel: "web", hold: true, copyOf: 1 }), "a version one copy").rejects.toThrow();
    await client.query("rollback");
    // A temporary table called study_guide cannot stand in for the real one: the trigger reads public.study_guide only.
    await client.query("create temp table study_guide as select * from public.study_guide where false");
    await client.query("insert into pg_temp.study_guide (tenant_id,kind,reading_key,version,body,origin,reviewed,hold) values ('crc','torah','pekudei',5,$1,'rabbi',true,false)", [BODY]);
    await expect(copy({ key: "pekudei", version: 6, channel: "web", hold: true, body: BODY, origin: "rabbi", reviewed: true, copyOf: 5 }), "a shadowed source").rejects.toThrow();
    await client.query("drop table pg_temp.study_guide");
    expect((await client.query("select count(*)::int as n from study_guide")).rows).toEqual([{ n: 8 }]);
    // The trigger function is the migration owner's, executable by no one else.
    const acl = (await client.query("select proacl::text as acl from pg_proc where proname = 'portal_study_guide_copy'")).rows as { acl: string | null }[];
    expect(acl).toHaveLength(1);
    expect(acl[0].acl ?? "").not.toMatch(/(^|[{,])=X/);

    // The snapshot changes study_guide and nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0058_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0058_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected["public.study_guide"] = current.tables["public.study_guide"];
    expect(current.tables).toEqual(expected);
    const table = current.tables["public.study_guide"], was = previous.tables["public.study_guide"];
    expect(Object.keys(table.columns).filter(c => !(c in was.columns))).toEqual(["copy_of_version"]);
    expect(table.columns.copy_of_version.notNull).toBe(false);
    expect(Object.keys(table.checkConstraints).sort()).toEqual([...Object.keys(was.checkConstraints).filter(c => c !== "study_guide_web_import"), "study_guide_copy", "study_guide_web_channel"].sort());
  } finally { await client.close(); await isolation.cleanup(); }
}, 90_000);
