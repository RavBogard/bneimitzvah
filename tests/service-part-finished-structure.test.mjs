import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Release 2.0 SC5: structural guards for the per-part finished mark (A4 9). Row security is the enforcement; these keep the code
// shaped so that only the finished module names the reader, only its data module touches the table, no other service, MCP tool,
// export, Sheet or notification reaches either, and the one route stays staff-only and private.
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
const importsOf = text => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);
const text = path => { const file = sources.find(item => item.path === path); assert.ok(file, path); return file.text; };
const MIGRATION = "src/server/db/migrations/0048_service_part_finished.sql", SCHEMA = "src/server/db/service-part-finished-schema.ts";
const SERVICE = "src/server/service-course/finished.ts", DATA = "src/server/data/service-part-finished.ts", HTTP = "src/server/http/service-part-finished.ts";

test("only the data module sets app.service_part_reader, the finished module alone calls it, and nothing sets the child-practice context yet", () => {
  const naming = sources.filter(file => file.text.includes("app.service_part_reader")).map(file => file.path).sort();
  assert.deepEqual(naming, [DATA, MIGRATION, SCHEMA, SERVICE].sort());
  assert.deepEqual(sources.filter(file => /set_config\(\s*'app\.service_part/.test(file.text)).map(file => file.path), [DATA]);
  const data = text(DATA);
  assert.equal(data.match(/set_config\('app\.service_part_reader'/g)?.length, 2, "one statement names the reader, one clears it");
  assert.match(data, /set_config\('app\.service_part_reader', '', true\)/);
  assert.match(data, /set_config\('app\.service_part_reader', \$\{roleGrantId\}, true\)/, "transaction-local, a grant id only");
  // app.service_part_context is read by 0048's policy only; no code sets it until a reviewed child-practice reader exists.
  assert.deepEqual(sources.filter(file => file.text.includes("app.service_part_context")).map(file => file.path).sort(), [MIGRATION, SCHEMA, SERVICE].sort());
  const service = text(SERVICE);
  // The writer names the reader only after the student grant, the student and the link are share-locked, and the staff read only inside withStudentCapability.
  assert.match(service, /lockRoleGrant\(sp, owner\.tenantId, owner\.membershipId, "student", "read"\)[\s\S]*lockStudent\(sp[\s\S]*lockStudentRelationship\(sp[\s\S]*data\.setReader\(sp, grant\.id\)/);
  assert.match(service, /withStudentCapability\(request, \{ mode: selection\.mode, studentId: selection\.studentId, capability: "read" \}[\s\S]*data\.setReader\(tx, actor\.roleGrantId\)/);
  assert.match(service, /if \(selection\.mode !== "tutor" && selection\.mode !== "admin"\) throw new AccessDenied\(403\)/);
});

test("the data module is imported only by the finished module, and the finished module only by progress-service, the composition and the route's runtime", () => {
  const dataImporters = sources.filter(file => file.path !== DATA && importsOf(file.text).some(spec => /(^|\/)data\/service-part-finished$/.test(spec))).map(file => file.path);
  assert.deepEqual(dataImporters, [SERVICE]);
  const serviceImporters = sources.filter(file => file.path !== SERVICE && importsOf(file.text).some(spec => /service-course\/finished$|^\.\/finished$/.test(spec) && !file.path.startsWith("src/components/"))).map(file => file.path).sort();
  assert.deepEqual(serviceImporters, ["src/server/runtime/composition.ts", "src/server/service-course/progress-service.ts"]);
});

test("no code outside the layer names the table, and no MCP, export, Sheet, notification or other staff service reaches it", () => {
  const allowed = new Set([SCHEMA, DATA, MIGRATION, "src/server/db/index.ts"]);
  for (const file of sources) {
    if (allowed.has(file.path) || /^src\/server\/db\/migrations\/meta\/\d{4}_snapshot\.json$/.test(file.path)) continue;
    assert.doesNotMatch(file.text, /\bs\.servicePartFinished\b|import[^;]*\bservicePartFinished\b[^;]*db|\bservice_part_finished\b/, `${file.path} names the finished table`);
  }
  // The runtime carries the service under one name, used only by the composition and the route.
  const runtimeUsers = sources.filter(file => /(?<!\bs)\.servicePartFinished\b/.test(file.text)).map(file => file.path);
  assert.deepEqual(runtimeUsers, [HTTP]);
  for (const file of sources.filter(file => /^src\/server\/(mcp|notifications|roster-sheet|relationships|students|study-guides|connections|settings|invitations|saved|course-progress|service-learning|portal|offline|accounts|practice-calendar|lesson-log|verse-review|public-site|public-reading)\//.test(file.path))) {
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /service-course\/finished|service-part-finished/, `${file.path} imports ${spec}`);
  }
});

test("its one route is staff-only, private and never public, and the migration grants nothing that would let a mark change", () => {
  const routes = text(HTTP);
  assert.deepEqual([...new Set([...routes.matchAll(/\\\/api\\\/students\\\/\(\[\^\/\]\+\)\\\/([a-z-]+)\$/g)].map(m => m[1]))], ["service-finished"]);
  assert.match(routes, /if \(mode !== "tutor" && mode !== "admin"\) throw new HttpBoundaryError\(\)/);
  assert.match(routes, /X-Practice-Context/);
  assert.doesNotMatch(routes, /cache-control|s-maxage|public,/i, "responses keep privateJson's private, no-store headers");
  const dispatch = text("src/server/http/dispatch.ts");
  assert.equal(dispatch.match(/servicePartFinishedRouteMethods\(url\.pathname\)/g)?.length, 1);
  assert.equal(dispatch.match(/handleServicePartFinishedRequest\(request, runtime\)/g)?.length, 1);
  const publicFiles = sources.filter(file => /^src\/server\/(http\/public-reading|runtime\/public-composition)\.ts$/.test(file.path));
  assert.equal(publicFiles.length, 2);
  for (const file of publicFiles) assert.doesNotMatch(file.text, /service-part-finished|service-course\/finished|servicePartFinished/, file.path);
  const migration = text(MIGRATION);
  assert.doesNotMatch(migration, /GRANT[^;]*(UPDATE|DELETE|TRUNCATE|ALL)[^;]*ON service_part_finished/i);
  assert.match(migration, /GRANT INSERT \(tenant_id, student_id, lesson_id\) ON service_part_finished TO portal_runtime;/);
  assert.match(migration, /CREATE POLICY tenant_isolation ON service_part_finished AS RESTRICTIVE/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON service_part_finished FOR EACH ROW EXECUTE FUNCTION portal_immutable_audit\(\)/);
});

test("the staff view and the student's line use A7's tu.* strings verbatim, and name parts by course lesson title only", () => {
  const copy = text("src/lib/service-course/copy.ts");
  for (const [id, value] of [["tu.heading", "Learn the service"], ["tu.line", "Parts {firstName} has finished. Nothing else is shared."], ["tu.col.part", "Part"], ["tu.col.status", "Status"],
    ["tu.finished", "Finished"], ["tu.finished.on", "Finished {date}"], ["tu.notyet", "Not yet"], ["tu.empty", "No service parts are assigned yet."], ["tu.error", "The list couldn’t be loaded."],
    ["tu.loading", "Loading the parts…"], ["tu.student.line", "Your tutor can see which of your parts you’ve finished."]])
    assert.ok(copy.includes(`"${value}", // ${id}`), id);
  const view = text("src/components/portal/workspace/service-learning/finished.tsx");
  assert.match(view, /lessonById\(part\.lesson\)/);
  assert.doesNotMatch(view, /\.name\b|caption/);
});
