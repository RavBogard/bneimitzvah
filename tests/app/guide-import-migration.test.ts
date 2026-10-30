import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

// Guide sharing, migration 0055 (plan ruling 11): additive. Two nullable provenance columns on study_guide, one more channel value ("web")
// that may only carry a held, unreviewed version one with its credit and content key, one audit action. Existing rows are unchanged.
const TAG = "0055_guide_import_provenance";
const BODY = JSON.stringify({ overview: "An invented overview.", themes: [] });
const DIGEST = "a".repeat(64);

test("0055 adds only the import provenance, lets the web channel carry nothing but a held, unreviewed import, keeps rows, and replays", async () => {
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
    await client.query("insert into \"user\"(id,name,email,email_verified) values('import-admin','Synthetic admin',$1,true)", [["import-admin", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','import-admin')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin')", [grant, member]);
    type Extra = { version?: number; reviewed?: boolean; hold?: boolean; origin?: string; credit?: string | null; importKey?: string | null };
    const base = (key: string, channel: string, extra: Extra) => {
      const version = extra.version ?? 1;
      return ["insert into study_guide(tenant_id,kind,reading_key,version,base_version,previous_version,origin,reviewed,hold,body,actor_user_id,actor_membership_id,role_grant_id,role,mode,channel,mutation_id,request_digest",
        "%COLS%) values('crc','torah',$1,$2,$3,$4,$5,$6,$7,$8,'import-admin',$9,$10,'admin','admin',$11,$12,$13%VALS%)",
        [key, version, version - 1, version === 1 ? null : version - 1, extra.origin ?? "rabbi", extra.reviewed ?? false, extra.hold ?? true, BODY, member, grant, channel, randomUUID(), DIGEST]] as const;
    };
    // Before 0055 (the plain insert) and after (with provenance).
    const plain = (key: string, channel: string, extra: Extra = {}) => { const [a, b, params] = base(key, channel, extra); return client.query((a + b).replace("%COLS%", "").replace("%VALS%", ""), [...params]); };
    const guide = (key: string, channel: string, extra: Extra = {}) => {
      const [a, b, params] = base(key, channel, extra);
      return client.query((a + b).replace("%COLS%", ",import_credit,import_key").replace("%VALS%", ",$14,$15"),
        [...params, extra.credit === undefined ? "Rabbi Synthetic" : extra.credit, extra.importKey === undefined ? "b".repeat(64) : extra.importKey]);
    };
    // A guide written the usual way, before the migration.
    await plain("vayera", "mcp", { reviewed: true, hold: false });
    const capture = async () => (await client.query("select * from study_guide order by id")).rows as object[];
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(await capture()).toEqual(before.map(row => ({ ...row, import_credit: null, import_key: null })));

    // The web channel carries an import and nothing else.
    await guide("pekudei", "web");
    await expect(guide("pekudei-a", "web", { hold: false })).rejects.toThrow();
    await expect(guide("pekudei-b", "web", { reviewed: true })).rejects.toThrow();
    await expect(guide("pekudei-c", "web", { credit: null, importKey: null })).rejects.toThrow();
    await expect(plain("pekudei-d", "web")).rejects.toThrow();
    await expect(guide("pekudei-e", "web", { version: 2 })).rejects.toThrow();
    // The same content is not imported into the same reading twice; another reading may hold it.
    await expect(guide("pekudei", "web", { version: 1 })).rejects.toThrow();
    await guide("vayeshev", "web");
    // Provenance is whole and well formed, and no address or markup rides in the credit.
    await expect(guide("x1", "web", { credit: "Rabbi X", importKey: null })).rejects.toThrow();
    await expect(guide("x2", "mcp", { credit: null })).rejects.toThrow();
    await expect(guide("x3", "web", { importKey: "not-a-key" })).rejects.toThrow();
    await expect(guide("x4", "web", { credit: ["rabbi", "example.test"].join("@") })).rejects.toThrow();
    await expect(guide("x5", "web", { credit: "<b>Rabbi</b>" })).rejects.toThrow();
    // The operator channel is as strict as before: Claude drafts only. An unknown channel is refused.
    await expect(plain("op1", "operator", { origin: "rabbi" })).rejects.toThrow();
    await expect(plain("op2", "operator", { origin: "claude", reviewed: true, hold: false })).rejects.toThrow();
    await plain("op3", "operator", { origin: "claude" });
    await expect(plain("ch1", "bogus")).rejects.toThrow();
    // A published import (the usual channel, version two) keeps its provenance.
    await guide("pekudei", "mcp", { version: 2, hold: false, importKey: "b".repeat(64) });
    const audit = (action: string) => client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,role_grant_id,action,target_type,target_id,request_id) values('crc','import-admin',$1,'admin',$2,$3,'study_guide_import',$4,$5)", [member, grant, action, randomUUID(), randomUUID()]);
    await audit("study-guide.import");
    await expect(audit("study-guide.unknown")).rejects.toThrow();

    // The snapshot changes the guide table and the audit action list, and nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0055_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0055_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected["public.study_guide"] = current.tables["public.study_guide"];
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.tables).toEqual(expected);
    expect(Object.keys(current.tables["public.study_guide"].columns)).toEqual(expect.arrayContaining(["import_credit", "import_key"]));
    expect(current.tables["public.audit_event"].checkConstraints.audit_action_known.value).toContain("'study-guide.import'");
  } finally { await client.close(); await isolation.cleanup(); }
});
