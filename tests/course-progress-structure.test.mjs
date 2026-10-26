import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for Learn to lein's signed-in progress (plan, slice 3), on the saved layer's model
// (tests/saved-structure.test.mjs). RLS is the enforcement; these keep the code shaped so that only the
// owner's own request ever sets the owner, and no staff path reaches the table.
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
const MIGRATION = "src/server/db/migrations/0037_course_progress.sql";

test("only src/server/course-progress/access.ts and the course-progress migration name app.course_owner", () => {
  const naming = sources.filter(file => file.text.includes("app.course_owner")).map(file => file.path).sort();
  assert.deepEqual(naming, ["src/server/course-progress/access.ts", MIGRATION]);
  const access = sources.find(file => file.path === "src/server/course-progress/access.ts").text;
  assert.equal(access.match(/set_config\('app\.course_owner'/g)?.length, 1, "the owner is set in exactly one statement");
  assert.match(access, /courseEligibility\(tx, identity\.tenantId, identity\.membership\.id\)[\s\S]*set_config\('app\.course_owner', \$\{identity\.membership\.id\}, true\)/,
    "the owner is the verified membership, set transaction-locally, after the eligibility check");
});

test("the course-progress data module is imported only from src/server/course-progress/*", () => {
  const importers = sources.filter(file => file.path !== "src/server/data/course-progress.ts" && importsOf(file.text).some(spec => /(^|\/)data\/course-progress$/.test(spec))).map(file => file.path);
  assert.ok(importers.length > 0);
  for (const path of importers) assert.match(path, /^src\/server\/course-progress\//, `${path} must not import data/course-progress`);
});

test("no code outside the layer names the table, and no staff-facing service reaches it", () => {
  // 1.9 N23: 0052 adds the one SELECT policy for the assigned tutor reader (tests/practice-visibility-structure.test.mjs guards its reader).
  const allowed = new Set(["src/server/db/course-progress-schema.ts", "src/server/data/course-progress.ts", MIGRATION, "src/server/db/migrations/0052_practice_visibility.sql"]);
  for (const file of sources) {
    if (allowed.has(file.path) || /^src\/server\/db\/migrations\/meta\/\d{4}_snapshot\.json$/.test(file.path)) continue;
    assert.doesNotMatch(file.text, /\bcourseProgressTable\b|\bcourse_progress\b/, `${file.path} names the course-progress table`);
  }
  for (const file of sources.filter(file => /^src\/server\/(mcp|notifications|roster-sheet|relationships|students|study-guides|connections|settings|invitations|saved)\//.test(file.path))) {
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /course-progress/, `${file.path} imports ${spec}`);
    assert.doesNotMatch(file.text, /runtime\.courseProgress|\.courseProgress\b/, `${file.path} reaches the course-progress service`);
  }
});

test("course-progress writes record no audit rows, and its routes are never public or cacheable", () => {
  for (const file of sources.filter(file => file.path === "src/server/data/course-progress.ts" || file.path.startsWith("src/server/course-progress/")))
    assert.doesNotMatch(file.text, /auditEvent|audit_event/, `${file.path} must not write audit rows`);
  const routes = sources.find(file => file.path === "src/server/http/course-progress.ts").text;
  const paths = [...routes.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(paths)], ["/api/learn/progress", "/api/learn/progress/put", "/api/learn/progress/merge"]);
  assert.doesNotMatch(routes, /cache-control|s-maxage|public,/i, "responses keep privateJson's private, no-store headers");
  const dispatch = sources.find(file => file.path === "src/server/http/dispatch.ts").text;
  assert.equal(dispatch.match(/courseProgressRouteMethods\(url\.pathname\)/g)?.length, 1);
  assert.equal(dispatch.match(/handleCourseProgressRequest\(request, runtime\)/g)?.length, 1);
  const migration = sources.find(file => file.path === MIGRATION).text;
  assert.doesNotMatch(migration, /GRANT[^;]*(DELETE|TRUNCATE|ALL)[^;]*ON course_progress|GRANT[^;(]*UPDATE ON/i);
});
