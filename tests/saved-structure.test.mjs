import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for the 1.4 saved layer (accounts plan §2a, §7; threats 2, 3 and 9). RLS is the
// enforcement; these keep the code shaped so that only the owner's own request ever sets the owner.
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
// The application and the operator scripts: an operator tool must not set the owner or read saved tables either.
const sources = await Promise.all([...await files("src"), ...await files("scripts")].map(async path => ({ path, text: await readFile(join(root, path), "utf8") })));
assert.ok(sources.some(file => file.path.startsWith("scripts/")), "the scripts are scanned");
const importsOf = text => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);

test("only src/server/saved/access.ts and the 0036 migration name app.saved_owner", () => {
  const naming = sources.filter(file => file.text.includes("app.saved_owner")).map(file => file.path).sort();
  assert.deepEqual(naming, ["src/server/db/migrations/0036_saved_layer.sql", "src/server/saved/access.ts"]);
  const access = sources.find(file => file.path === "src/server/saved/access.ts").text;
  assert.equal(access.match(/set_config\('app\.saved_owner'/g)?.length, 1, "the owner is set in exactly one statement");
  assert.match(access, /savedEligibility\(tx, identity\.tenantId, identity\.membership\.id\)[\s\S]*set_config\('app\.saved_owner', \$\{identity\.membership\.id\}, true\)/,
    "the owner is the verified membership, set transaction-locally, after the eligibility check");
});

test("the saved data module is imported only from src/server/saved/*", () => {
  const importers = sources.filter(file => file.path !== "src/server/data/saved.ts" && importsOf(file.text).some(spec => /(^|\/)data\/saved$/.test(spec))).map(file => file.path);
  assert.ok(importers.length > 0);
  for (const path of importers) assert.match(path, /^src\/server\/saved\//, `${path} must not import data/saved`);
});

test("no code outside the saved layer names the saved tables, and the MCP never imports a saved module", () => {
  const allowed = new Set(["src/server/db/saved-schema.ts", "src/server/data/saved.ts", "src/server/db/migrations/0036_saved_layer.sql", "src/server/db/migrations/meta/0036_snapshot.json",
    // 0040 lets the owner revise their own reading's ranges (release 1.7 "Change verses"); its own test pins it to that one grant.
    "src/server/db/migrations/0040_saved_reading_ranges.sql"]);
  for (const file of sources) {
    if (allowed.has(file.path) || /^src\/server\/db\/migrations\/meta\/\d{4}_snapshot\.json$/.test(file.path) && Number(file.path.match(/(\d{4})_snapshot/)[1]) > 36) continue;
    assert.doesNotMatch(file.text, /\b(savedReading|savedVerseWork|savedVerseMark|starredComment)\b|\b(saved_reading|saved_verse_work|saved_verse_mark|starred_comment)\b/, `${file.path} names a saved table`);
  }
  for (const file of sources.filter(file => file.path.startsWith("src/server/mcp/"))) {
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /saved/, `${file.path} imports ${spec}`);
    // MCP handlers receive the runtime's services; none may reach the saved service through it.
    assert.doesNotMatch(file.text, /\.saved\b|runtime\.saved|\bsaved\s*:/, `${file.path} reaches the saved service`);
  }
  // Staff-facing services that run without a member's own request never reach the saved service either.
  for (const file of sources.filter(file => /^src\/server\/(mcp|notifications|roster-sheet|relationships|students|study-guides|connections|settings|invitations)\//.test(file.path)))
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /(^|\/)saved(\/|$)/, `${file.path} imports ${spec}`);
});

test("saved-layer writes record no audit rows, and its routes are never public or cacheable", () => {
  for (const file of sources.filter(file => file.path === "src/server/data/saved.ts" || file.path.startsWith("src/server/saved/")))
    assert.doesNotMatch(file.text, /auditEvent|audit_event/, `${file.path} must not write audit rows`);
  const routes = sources.find(file => file.path === "src/server/http/saved.ts").text;
  const paths = [...routes.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(paths.length >= 9);
  for (const path of paths) { assert.match(path, /^\/api\/saved\//); assert.doesNotMatch(path, /^\/api\/public\//); }
  assert.doesNotMatch(routes, /cache-control|s-maxage|public,/i, "saved responses keep privateJson's private, no-store headers");
  const dispatch = sources.find(file => file.path === "src/server/http/dispatch.ts").text;
  assert.equal(dispatch.match(/savedRouteMethods\(url\.pathname\)/g)?.length, 1);
  assert.equal(dispatch.match(/handleSavedRequest\(request, runtime\)/g)?.length, 1);
});
