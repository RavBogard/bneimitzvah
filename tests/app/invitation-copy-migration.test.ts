import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

// Release 1.9 N22, migration 0051: Copy link gets its own delivery state (copied) and audit action (invite.copy). It only
// widens two check constraints, leaves every existing row unchanged, and replays.
const TAG = "0051_invitation_copy";

test("0051 widens only the audit action list and the invite delivery shape, keeps existing rows, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(own).toBeGreaterThan(0);
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries[own - 1].when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const member = randomUUID(), grant = randomUUID(), sent = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('copy-admin','Synthetic admin',$1,true)", [["copy-admin", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','copy-admin')", [member]);
    await client.query("insert into role_grant(id,tenant_id,membership_id,role) values($1,'crc',$2,'admin')", [grant, member]);
    const hash = () => randomUUID().replace(/-/g, "").repeat(2);
    const invite = (id: string | null, status: string, attempted: boolean) => client.query(
      `insert into invite(${id ? "id," : ""}tenant_id,token_hash,email,role,inviter_membership_id,expires_at,delivery_status,delivery_attempted_at)
       values(${id ? "$5," : ""}'crc',$1,'tutor-copy@example.test','tutor',$2,now() + interval '3 days',$3,$4)`, id ? [hash(), member, status, attempted ? new Date() : null, id] : [hash(), member, status, attempted ? new Date() : null]);
    const audit = (action: string) => client.query("insert into audit_event(tenant_id,actor_user_id,actor_membership_id,mode,role_grant_id,action,target_type,target_id,request_id) values('crc','copy-admin',$1,'admin',$2,$3,'invitation',$4,$5)",
      [member, grant, action, sent, randomUUID()]);
    await invite(sent, "sent", true); await audit("invite.issue");
    // Before 0051 neither the state nor the action exists.
    await expect(invite(null, "copied", true)).rejects.toThrow();
    await expect(audit("invite.copy")).rejects.toThrow();
    const capture = async () => JSON.stringify([(await client.query("select * from invite order by id")).rows, (await client.query("select * from audit_event order by id")).rows]);
    const before = await capture();
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(await capture()).toBe(before);
    await invite(null, "copied", true); await audit("invite.copy");
    await expect(invite(null, "copied", false)).rejects.toThrow();
    await expect(invite(null, "pending", true)).rejects.toThrow();
    await expect(invite(null, "unknown", true)).rejects.toThrow();
    await expect(audit("invite.unknown")).rejects.toThrow();

    // The generated snapshot changes the one action list and the one delivery shape, and nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0051_snapshot.json");
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0051_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const actions = (value: string) => value.match(/'[^']+'/g)!.map(v => v.slice(1, -1));
    expect(actions(current.tables["public.audit_event"].checkConstraints.audit_action_known.value)).toEqual([...actions(previous.tables["public.audit_event"].checkConstraints.audit_action_known.value), "invite.copy"]);
    const expected = structuredClone(previous.tables);
    expected["public.audit_event"].checkConstraints.audit_action_known = current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expected["public.invite"].checkConstraints.invite_delivery_shape = current.tables["public.invite"].checkConstraints.invite_delivery_shape;
    expect(current.tables).toEqual(expected);
    expect(current.tables["public.invite"].checkConstraints.invite_delivery_shape.value).toContain("'sent','failed','copied'");
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    // Exactly four statements: drop and re-add the two check constraints, nothing else.
    const statements = text.split("\n").filter(line => !line.startsWith("--")).join("\n").split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean);
    expect(statements.map(statement => statement.match(/^ALTER TABLE "(audit_event|invite)" (DROP|ADD) CONSTRAINT "(audit_action_known|invite_delivery_shape)"/)?.slice(1).join(" "))).toEqual([
      "audit_event DROP audit_action_known", "invite DROP invite_delivery_shape", "audit_event ADD audit_action_known", "invite ADD invite_delivery_shape"]);
  } finally { await client.close(); await isolation.cleanup(); }
});
