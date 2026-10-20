// Synthetic populated0023 upgrade fixture, shared by PGlite and selected native PG.
import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function adultUpgradePrefix(home) {
  const folder = join(home, "prior0023"), root = "src/server/db/migrations";
  const journal = JSON.parse(await readFile(join(root, "meta/_journal.json"), "utf8"));
  const entries = journal.entries.filter(entry => entry.idx <= 23);
  if (entries.length !== 24 || entries.at(-1).tag !== "0023_honoree_links") throw Error("Upgrade baseline refused");
  await mkdir(join(folder, "meta"), { recursive: true });
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }), { flag: "wx" });
  for (const entry of entries) await copyFile(join(root, entry.tag + ".sql"), join(folder, entry.tag + ".sql"));
  return folder;
}
export async function seedLegacyAdultUpgrade(client) {
  const run = (text, values = []) => client.query(text, values), first = async (text, values = []) => (await run(text, values)).rows[0];
  const sid = randomUUID(), aid = randomUUID(), actors = [];
  const ceremonyDate = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  await run("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email,service_slot) values($1,'crc','Synthetic','Upgrade',$2,'fixture@example.test','morning')", [sid, ceremonyDate]);
  for (const role of ["parent", "admin"]) {
    const user = "synthetic-upgrade-" + randomUUID();
    await run('insert into "user"(id,name,email) values($1,$2,$3)', [user, "Synthetic upgrade", user + "@example.test"]);
    const member = await first("insert into membership(tenant_id,user_id) values('crc',$1) returning id", [user]);
    const grant = await first("insert into role_grant(tenant_id,membership_id,role) values('crc',$1,$2) returning id", [member.id, role]);
    let guardian = null;
    if (role === "parent") guardian = (await first("insert into guardian(tenant_id,student_id,parent_grant_id,link_provenance) values('crc',$1,$2,'synthetic') returning id", [sid, grant.id])).id;
    actors.push({ user, member: member.id, grant: grant.id, guardian, role });
  }
  await run("insert into assignment(id,tenant_id,student_id,kind,basis,ref,status,set_by_membership_id) values($1,'crc',$2,'torah','custom','Genesis 1:1-3','confirmed',$3)", [aid, sid, actors[1].member]);
  await run("insert into assignment_verse(tenant_id,assignment_id,student_id,ordinal,verse_ref) select 'crc',$1,$2,n,'Genesis 1:'||n from generate_series(1,3)n", [aid, sid]);
  const context = { schemaVersion: 1, tenantId: "crc", studentId: sid, ceremonyDate, serviceSlot: "morning", torah: { id: aid, revision: 1, ref: "Genesis 1:1-3", basis: "custom", confirmation: { confirmationDate: ceremonyDate, serviceSlot: "morning", slotProvenance: 1, needsReview: false }, verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], cuts: ["Genesis 1:2"] } };
  const form = { schemaVersion: 1, openingArk: [], generationToGeneration: [], undressingTorah: [], redressingTorah: [], closingArk: [], aliyot: ["Genesis 1:1", "Genesis 1:2"].map(startVerse => ({ startVerse, participants: [{ id: randomUUID(), englishName: "Synthetic participant", relationship: null, hebrewName: null, parent1HebrewName: null, parent2HebrewName: null }] })), parentalBlessing: { participation: null, delivery: null } };
  for (let i = 0; i < 2; i++) {
    const a = actors[i];
    await run("insert into honors_version(tenant_id,student_id,assignment_id,version,base_version,previous_version,form,reviewed_context,context_hash,actor_user_id,actor_membership_id,role_grant_id,guardian_id,role,mode,mutation_id,request_digest) values('crc',$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13::text::portal_role,$13::text::context_mode,$14,$15)", [sid, aid, i + 1, i, i || null, JSON.stringify(form), JSON.stringify(context), hash(context), a.user, a.member, a.grant, a.guardian, a.role, randomUUID(), hash(["synthetic", i])]);
  }
  let catalog = await first("select c.id,c.identity from service_catalog c join service_catalog_lifecycle l on l.tenant_id=c.tenant_id and l.catalog_id=c.id where c.tenant_id='crc' and l.state='active'");
  if (!catalog) { catalog = await first("insert into service_catalog(tenant_id,identity,feed_bytes,provenance_bytes,pins) values('crc',$1,$2,$3,$4::jsonb) returning id,identity", [hash(["synthetic-catalog", sid]), Buffer.from("synthetic feed"), Buffer.from("synthetic provenance"), JSON.stringify({ feedSha256: "0".repeat(64), provenanceSha256: "0".repeat(64), artifactRepo: "synthetic/repo", artifactCommit: "0".repeat(40), artifactRunId: "1", sourceGitSha: "0".repeat(40) })]);
  await run("insert into service_catalog_lifecycle(tenant_id,catalog_id,state) values('crc',$1,'active')", [catalog.id]);
   }
  let release = await first("select id from honoree_material_release where tenant_id='crc' and slot='morning' and state='active'");
  if (!release) release = await first("insert into honoree_material_release(tenant_id,catalog_id,catalog_identity,slot,before_id,after_id,material_version,projection_digest,approval_basis,notices,state) values('crc',$1,$2,'morning','torah.blessing-before-the-torah-reading@bm-shacharit','torah.blessing-following-the-torah-reading@bm-shacharit','synthetic-upgrade',$3,'Synthetic only',$4::jsonb,'active') returning id", [catalog.id, catalog.identity, hash("synthetic material"), JSON.stringify(["Synthetic upgrade"])]);
  for (let i = 0; i < 2; i++) {
    const a = actors[i], start = "Genesis 1:" + (i + 1), linkId = randomBytes(16).toString("base64url");
    await run("with instant as materialized(select clock_timestamp() value) insert into honoree_link(id,tenant_id,student_id,start_verse,reading_epoch,group_epoch,honors_version,context_hash,material_release_id,actor_user_id,actor_membership_id,role_grant_id,guardian_id,role,token_hash,key_id,issued_at,expires_at) select $1,'crc',$2,$3,r.epoch,g.epoch,2,$4,$5,$6,$7,$8,$9,$10,$11,'k1',instant.value,least(instant.value+interval '2160 hours',(($12::date+7)::timestamp at time zone 'America/Chicago')) from honoree_reading_epoch r,honoree_group_epoch g,instant where r.tenant_id='crc' and r.student_id=$2 and g.tenant_id='crc' and g.student_id=$2 and g.start_verse=$3", [linkId, sid, start, hash(context), release.id, a.user, a.member, a.grant, a.guardian, a.role, hash(randomUUID()), ceremonyDate]);
    await run("insert into honoree_operation(tenant_id,student_id,mutation_id,request_digest,operation,link_id,actor_user_id,actor_membership_id,role_grant_id,guardian_id,role) values('crc',$1,$2,$3,'issue',$4,$5,$6,$7,$8,$9)", [sid, randomUUID(), hash("operation" + i), linkId, a.user, a.member, a.grant, a.guardian, a.role]);
  }
  return { studentId: sid };
}
export async function legacyAdultUpgradeSnapshot(client) {
  const result = {};
  for (const table of ["honors_version", "honoree_link", "honoree_operation", "honoree_reading_epoch", "honoree_group_epoch", "student", "guardian", "role_grant"]) {
    result[table] = (await client.query(`select to_jsonb(t)-'student_identity_id' as row from ${table} t order by to_jsonb(t)::text`)).rows.map(r => r.row).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
}
