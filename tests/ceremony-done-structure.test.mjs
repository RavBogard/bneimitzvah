import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Release 1.9 N21, "Ceremony done": structural guards. Row security (0049) is the enforcement; these keep the code shaped so that
// only the ceremony-done service names the writer and calls the writes, the one route is admin-only, and every active list
// (admin and tutor lists, tutor relationships, the staff Sheet) filters on the state.
const root = fileURLToPath(new URL("../", import.meta.url));
async function files(dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else if (/\.(ts|tsx|mts|mjs|cjs|js|sql|json|py|sh|ps1)$/.test(entry.name)) out.push(path.split(sep).join("/"));
  }
  return out;
}
const sources = await Promise.all([...await files("src"), ...await files("scripts")].map(async path => ({ path, text: await readFile(join(root, path), "utf8") })));
const text = path => { const file = sources.find(item => item.path === path); assert.ok(file, path); return file.text; };
const MIGRATION = "src/server/db/migrations/0049_ceremony_done.sql", SCHEMA = "src/server/db/ceremony-done-schema.ts";
const SERVICE = "src/server/students/ceremony-done.ts", DATA = "src/server/data/ceremony-done.ts";

test("only the data module sets app.ceremony_done_actor, and only the ceremony-done service calls the writes", () => {
  assert.deepEqual(sources.filter(file => file.text.includes("app.ceremony_done_actor")).map(file => file.path).sort(), [DATA, MIGRATION, SCHEMA, SERVICE].sort());
  assert.deepEqual(sources.filter(file => /set_config\(\s*'app\.ceremony_done/.test(file.text)).map(file => file.path), [DATA]);
  for (const write of ["setActor", "clearActor", "insertLive", "reverseLive", "endTutorRows", "liveRow"])
    assert.deepEqual(sources.filter(file => file.path !== DATA && new RegExp(`\\b${write}\\b`).test(file.text)).map(file => file.path), [SERVICE], write);
  // The table is named only by its data module and the service (a comment), besides its schema, migration and snapshot.
  assert.deepEqual(sources.filter(file => file.text.includes("student_ceremony_done") && !file.path.startsWith("src/server/db/")).map(file => file.path).sort(), [DATA, SERVICE].sort());
});

test("the service is admin-only, inside withAdminCapability, on a same-origin POST, and setting ends the tutor rows before the insert", () => {
  const service = text(SERVICE);
  assert.match(service, /if \(selection\.mode !== "admin"\) throw new AccessDenied\(403\)/);
  assert.match(service, /withAdminCapability\(request, \{ mode: "admin", capability: "manage-students" \}[\s\S]*if \(actor\.mode !== "admin"\) throw new AccessDenied\(403\);\s*requireCookieMutation\(request, actor\.origin\)/);
  assert.match(service, /data\.endTutorRows\([\s\S]*data\.setActor\(tx, actor\.roleGrantId\);\s*const row = await data\.insertLive\([\s\S]*data\.clearActor\(tx\)/);
  // A reversal touches no tutor row.
  const reverse = service.slice(service.indexOf("async function reverse"));
  assert.doesNotMatch(reverse, /tutor|insertTutor|writeTutorAssignment/i);
  const route = text("src/server/http/portal.ts");
  assert.match(route, /case "ceremony-done": case "ceremony-reverse": \{[\s\S]*?mode: "admin" as const[\s\S]*?runtime\.ceremonyDone\.set\(request, selection\)[\s\S]*?runtime\.ceremonyDone\.reverse\(request, selection\)/);
});

test("every active list and the tutor relationship filter on the state", () => {
  assert.match(text("src/server/data/students.ts"), /actor\.mode === "admin" \|\| actor\.mode === "tutor" \? notCeremonyDone\(s\.student\.tenantId, s\.student\.id\)/);
  assert.match(text("src/server/data/authority.ts"), /isNull\(s\.tutorStudent\.revokedAt\),[\s\S]{0,400}notCeremonyDone\(s\.tutorStudent\.tenantId, s\.tutorStudent\.studentId\)/);
  assert.match(text("src/server/roster-sheet/rows.ts"), /isNull\(s\.student\.disabledAt\), notCeremonyDone\(s\.student\.tenantId, s\.student\.id\)/);
  assert.match(text("src/server/relationships/service.ts"), /if \(await isCeremonyDone\(tx, actor\.tenantId, studentId\)\) return conflict\(\);\s*if \(await data\.activeTutorLink/);
});
