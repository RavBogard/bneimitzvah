import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Release 2.0 SC4: structural guards for the service course's signed-in progress and path, on Learn to lein's
// (tests/course-progress-structure.test.mjs). RLS is the enforcement; these keep the code shaped so that only the owner's own
// request ever sets the owner, no staff path reaches the table, and the path route never carries licensed feed text.
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
assert.ok(sources.some(file => file.path.startsWith("scripts/")), "the scripts are scanned");
const importsOf = text => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);
const text = path => { const file = sources.find(item => item.path === path); assert.ok(file, path); return file.text; };
const MIGRATION = "src/server/db/migrations/0046_service_course_progress.sql";
const ACCESS = "src/server/service-course/progress-access.ts", DATA = "src/server/data/service-course-progress.ts";

test("only progress-access.ts and the 0046 migration name app.service_course_owner, and it is set once, after eligibility", () => {
  const naming = sources.filter(file => file.text.includes("app.service_course_owner")).map(file => file.path).sort();
  assert.deepEqual(naming, [MIGRATION, ACCESS]);
  const access = text(ACCESS);
  assert.equal(access.match(/set_config\('app\.service_course_owner'/g)?.length, 1, "the owner is set in exactly one statement");
  assert.match(access, /serviceCourseEligibility\(tx, identity\.tenantId, identity\.membership\.id\)[\s\S]*set_config\('app\.service_course_owner', \$\{identity\.membership\.id\}, true\)/,
    "the owner is the verified membership, set transaction-locally, after the eligibility check");
  // Learn to lein's owner setting stays where it was: the two courses never share an owner.
  assert.doesNotMatch(access, /app\.course_owner/);
});

test("the service-course progress data module is imported only from src/server/service-course/progress-*", () => {
  const importers = sources.filter(file => file.path !== DATA && importsOf(file.text).some(spec => /(^|\/)data\/service-course-progress$/.test(spec))).map(file => file.path);
  assert.ok(importers.length > 0);
  for (const path of importers) assert.match(path, /^src\/server\/service-course\/progress-[a-z]+\.ts$/, `${path} must not import data/service-course-progress`);
});

test("no code outside the layer names the table, and no staff-facing service reaches it or the path", () => {
  const allowed = new Set(["src/server/db/service-course-progress-schema.ts", DATA, MIGRATION]);
  for (const file of sources) {
    if (allowed.has(file.path) || /^src\/server\/db\/migrations\/meta\/\d{4}_snapshot\.json$/.test(file.path)) continue;
    assert.doesNotMatch(file.text, /\bserviceCourseProgressTable\b|\bservice_course_progress\b/, `${file.path} names the service-course progress table`);
  }
  for (const file of sources.filter(file => /^src\/server\/(mcp|notifications|roster-sheet|relationships|students|study-guides|connections|settings|invitations|saved|course-progress|service-learning|portal|offline|accounts)\//.test(file.path))) {
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /service-course\/(progress|path)|service-course-progress/, `${file.path} imports ${spec}`);
    assert.doesNotMatch(file.text, /\.serviceCourseProgress\b|\.serviceCoursePath\b/, `${file.path} reaches the service-course progress or path`);
  }
});

test("its writes record no audit rows, and its routes are never public or cacheable", () => {
  for (const path of [DATA, ACCESS, "src/server/service-course/progress-service.ts", "src/server/service-course/progress-validation.ts", "src/server/service-course/path.ts"])
    assert.doesNotMatch(text(path), /auditEvent|audit_event/, `${path} must not write audit rows`);
  const routes = text("src/server/http/service-course-progress.ts");
  const paths = [...routes.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(paths)], ["/api/learn/service/progress", "/api/learn/service/progress/put", "/api/learn/service/progress/merge", "/api/learn/service/path"]);
  assert.doesNotMatch(routes, /cache-control|s-maxage|public,/i, "responses keep privateJson's private, no-store headers");
  const dispatch = text("src/server/http/dispatch.ts");
  assert.equal(dispatch.match(/serviceCourseRouteMethods\(url\.pathname\)/g)?.length, 1);
  assert.equal(dispatch.match(/handleServiceCourseRequest\(request, runtime\)/g)?.length, 1);
  // The public runtime (no auth) never routes them.
  const publicFiles = sources.filter(file => /^src\/server\/(http\/public-reading|runtime\/public-composition)\.ts$/.test(file.path));
  assert.equal(publicFiles.length, 2);
  for (const file of publicFiles) assert.doesNotMatch(file.text, /service-course-progress|service-course\/path|serviceCourse(Progress|Path)/, file.path);
  const migration = text(MIGRATION);
  assert.doesNotMatch(migration, /GRANT[^;]*(DELETE|TRUNCATE|ALL)[^;]*ON service_course_progress|GRANT[^;(]*UPDATE ON/i);
});

test("the path never carries a unit's name or caption: it copies lesson ids and pages by name, through the student-mode reads only", () => {
  const path = text("src/server/service-course/path.ts"), lib = text("src/lib/service-course/path.ts"), http = text("src/server/http/service-course-progress.ts");
  for (const [where, value] of [["path.ts", path], ["lib path.ts", lib]]) assert.doesNotMatch(value, /\.name\b|\.caption\b/, `${where} reads a unit's name or caption`);
  assert.match(path, /listStudents\(request, \{ mode: "student", limit: 2 \}\)/, "the student is the signed-in account's own, in student mode");
  assert.match(path, /mode: "student" as const/, "the plan is read in student mode");
  assert.doesNotMatch(path, /mode: "(admin|tutor|parent|child-practice)"/);
  // It is handed the metadata read; it imports nothing of the licensed catalog's side itself.
  for (const spec of importsOf(path)) assert.doesNotMatch(spec, /service-learning|service-ecosystem|siddur\/|booklet/, `path.ts imports ${spec}`);
  assert.match(text("src/server/runtime/composition.ts"), /createServiceCoursePath\(\{ access, serviceLearning \}\)/);
  // The wire shape is copied field by field.
  assert.match(http, /function pathJson\(path: Path\): JsonValue/);
  assert.doesNotMatch(http, /privateJson\(await runtime\.serviceCoursePath\.read/);
});
