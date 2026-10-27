import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Students held for a tutor invitation (migration 0053): structural guards. Row security is the enforcement; these keep the code
// shaped so that only the holds data module names the table and only the invitation service calls it, and acceptance turns holds
// into tutor links through the portal's one tutor write.
const root = fileURLToPath(new URL("../", import.meta.url));
async function files(dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else if (/\.(ts|tsx|mts|mjs|cjs|js|sql)$/.test(entry.name)) out.push(path.split(sep).join("/"));
  }
  return out;
}
const sources = await Promise.all([...await files("src"), ...await files("scripts")].map(async path => ({ path, text: await readFile(join(root, path), "utf8") })));
const DATA = "src/server/data/tutor-invite-holds.ts", SERVICE = "src/server/invitations/service.ts";

test("only the holds data module names the table, and only the invitation service calls it", () => {
  assert.deepEqual(sources.filter(file => file.text.includes("tutor_invite_hold") && !file.path.startsWith("src/server/db/")).map(file => file.path), [DATA]);
  assert.deepEqual(sources.filter(file => file.path !== DATA && /data\/tutor-invite-holds"/.test(file.text) && /import \* as holds/.test(file.text)).map(file => file.path), [SERVICE]);
  for (const write of ["insertHolds", "heldStudents"])
    assert.deepEqual(sources.filter(file => file.path !== DATA && new RegExp(`\\b${write}\\b`).test(file.text)).map(file => file.path), [SERVICE], write);
});

test("only the holds data module sets app.tutor_hold_actor", () => {
  assert.deepEqual(sources.filter(file => /set_config\('app\.tutor_hold_actor'/.test(file.text)).map(file => file.path), [DATA]);
  assert.deepEqual(sources.filter(file => file.text.includes("app.tutor_hold_actor")).map(file => file.path).sort(), [DATA, "src/server/db/migrations/0053_tutor_invite_hold.sql"].sort());
});

test("acceptance links held students only through writeTutorAssignment, only for a tutor invitation, before the invitation is consumed", () => {
  const service = sources.find(file => file.path === SERVICE).text;
  const accept = service.slice(service.indexOf("async function acceptCore"));
  assert.match(accept, /if \(invitation\.role === "tutor"\) for \(const studentId of await holds\.heldStudents\([\s\S]*?await writeTutorAssignment\(tx, actor, studentId, grantId\);[\s\S]*?data\.consumeInvitation\(/);
  assert.doesNotMatch(accept, /insertTutor|insertHolds/);
});
