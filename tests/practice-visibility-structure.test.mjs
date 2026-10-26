import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// 1.9 N23 (decision 7): structural guards for practice visibility. Row security and the views are the enforcement; these keep the
// code shaped so that only the data module names the reader, only the service calls it, only the one route reaches the service,
// and no MCP tool, cron, roster Sheet, export, notification or public route reaches any of it.
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
const MIGRATION = "src/server/db/migrations/0052_practice_visibility.sql", SERVICE = "src/server/practice-visibility/service.ts";
const DATA = "src/server/data/practice-visibility.ts", HTTP = "src/server/http/practice-visibility.ts";

test("only the data module sets app.practice_reader, and the service names it only inside withStudentCapability as the tutor", () => {
  assert.deepEqual(sources.filter(file => file.text.includes("app.practice_reader")).map(file => file.path).sort(), [DATA, MIGRATION, SERVICE].sort());
  assert.deepEqual(sources.filter(file => /set_config\(\s*'app\.practice_reader/.test(file.text)).map(file => file.path), [DATA]);
  const data = text(DATA);
  assert.equal(data.match(/set_config\('app\.practice_reader'/g)?.length, 2, "one statement names the reader, one clears it");
  assert.match(data, /set_config\('app\.practice_reader', \$\{roleGrantId\}, true\)/, "transaction-local, a grant id only");
  assert.match(data, /set_config\('app\.practice_reader', '', true\)/);
  const service = text(SERVICE);
  assert.equal(service.match(/data\.setReader\(/g)?.length, 1);
  assert.match(service, /if \(!from\) throw new AccessDenied\(404\);\s*if \(selection\.mode !== "tutor"\) throw new AccessDenied\(403\);\s*return input\.access\.withStudentCapability\(request, \{ mode: "tutor", studentId: selection\.studentId, capability: "read" \}[\s\S]*if \(actor\.mode !== "tutor"\) throw new AccessDenied\(403\);[\s\S]*data\.setReader\(tx, actor\.roleGrantId\)[\s\S]*data\.clearReader\(tx\)/);
  assert.match(service, /if \(!gate\(\)\) throw new AccessDenied\(404\);\s*if \(selection\.mode !== "parent"\) throw new AccessDenied\(403\);/);
});

test("the views are named only by the migration and the data module; the data module only by the service; the service only by the composition", () => {
  for (const view of ["practice_visibility_opened", "practice_visibility_marks", "practice_visibility_learn", "portal_practice_reader_sees"]) {
    assert.deepEqual(sources.filter(file => file.text.includes(view)).map(file => file.path).sort(), (view === "portal_practice_reader_sees" ? [MIGRATION] : [DATA, MIGRATION]).sort(), view);
  }
  assert.deepEqual(sources.filter(file => file.path !== DATA && importsOf(file.text).some(spec => /data\/practice-visibility$/.test(spec))).map(file => file.path), [SERVICE]);
  assert.deepEqual(sources.filter(file => file.path !== SERVICE && importsOf(file.text).some(spec => /practice-visibility\/service$/.test(spec))).map(file => file.path), ["src/server/runtime/composition.ts"]);
  // The runtime carries the service under one name, used only by the route.
  assert.deepEqual(sources.filter(file => /\.practiceVisibility\b/.test(file.text)).map(file => file.path), [HTTP]);
});

test("no MCP, cron, Sheet, export, notification, public or other staff module reaches practice visibility", () => {
  for (const file of sources.filter(file => /^src\/server\/(mcp|notifications|roster-sheet|relationships|students|study-guides|connections|settings|invitations|saved|course-progress|service-learning|service-course|portal|offline|accounts|practice-calendar|lesson-log|verse-review|public-site|public-reading|staff)\//.test(file.path) || /^scripts\//.test(file.path))) {
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /practice-visibility/, `${file.path} imports ${spec}`);
    assert.doesNotMatch(file.text, /practiceVisibility|practice_visibility|practice-visibility/, file.path);
  }
  for (const path of ["src/server/http/public-reading.ts", "src/server/runtime/public-composition.ts"]) assert.doesNotMatch(text(path), /practice-visibility|practiceVisibility/, path);
  // The route is GET only, tutor or parent mode only, refuses a practice context and keeps privateJson's private, no-store headers.
  const route = text(HTTP);
  assert.match(route, /if \(mode !== "tutor" && mode !== "parent"\) throw new HttpBoundaryError\(\)/);
  assert.match(route, /X-Practice-Context/);
  assert.doesNotMatch(route, /cache-control|s-maxage|public,/i);
  const dispatch = text("src/server/http/dispatch.ts");
  assert.equal(dispatch.match(/practiceVisibilityRouteMethods\(url\.pathname\)/g)?.length, 1);
  assert.equal(dispatch.match(/handlePracticeVisibilityRequest\(request, runtime\)/g)?.length, 1);
});

test("no duration, time of day, action or play count is selectable through the read path", () => {
  // Comments may say what is left out; the code may not select it.
  const data = text(DATA).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(data, /received_?at|receivedAt|\baction\b|'play'|marked_at|markedAt|count\(\*\)/i);
  // practisedDays counts practice_day rows (dates staff already see under ruling 45); nothing else is counted.
  assert.equal(data.match(/count\(\)/g)?.length, 1);
  const migration = text(MIGRATION);
  const views = migration.split("--> statement-breakpoint").filter(part => /CREATE VIEW practice_visibility_/.test(part));
  assert.equal(views.length, 3);
  for (const view of views) {
    const select = view.slice(view.indexOf("SELECT"), view.indexOf("FROM"));
    assert.doesNotMatch(select, /received_at|e\.action|count\(|marked_at\b(?! AT TIME ZONE)|due|done/i, select);
  }
  // The Learn view gives lesson ids and boxes only: never the done instants or the due dates.
  assert.match(migration, /jsonb_object_keys\(c\.progress->'lessons'\)/);
  assert.match(migration, /card\.value->'box'/);
});

test("only migration and schema files name a mark's instant, and nothing selects or returns a whole verse_self_check row", () => {
  // The instant of a mark is a time of day; it leaves the database only as 0052's marks view's date.
  const naming = sources.filter(file => /marked_at|markedAt/.test(file.text)).map(file => file.path);
  assert.ok(naming.length > 0);
  for (const path of naming) assert.match(path, /^src\/server\/db\/(migrations\/(\d{4}_[a-z0-9_]+\.sql|meta\/\d{4}_snapshot\.json)|[a-z-]+-schema\.ts)$/, `${path} names a mark's instant`);
  for (const file of sources.filter(file => /verseSelfCheck|verse_self_check/.test(file.text) && !/^src\/server\/db\/migrations\//.test(file.path))) {
    assert.doesNotMatch(file.text, /\.select\(\s*\)\s*\.from\(\s*(s\.)?verseSelfCheck\b/, `${file.path} selects a whole mark row`);
    assert.doesNotMatch(file.text, /select\s+(\*|\w+\.\*|to_jsonb\(\s*\w+\s*\))[^;]*?\bfrom\s+"?(public"?\."?)?verse_self_check\b/i, `${file.path} selects a whole mark row`);
    if (/\bverseSelfCheck\b/.test(file.text)) assert.doesNotMatch(file.text, /\.returning\(\s*\)/, `${file.path} returns a whole mark row`);
  }
});
