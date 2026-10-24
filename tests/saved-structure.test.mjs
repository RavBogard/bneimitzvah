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
const sources = await Promise.all([...await files("src"), ...await files("scripts")].map(async path => ({ path, text: (await readFile(join(root, path), "utf8")).replace(/\r\n/g, "\n") })));
// A Windows checkout (core.autocrlf) has CRLF line ends; the shape checks below read LF.
assert.ok(sources.some(file => file.path.startsWith("scripts/")), "the scripts are scanned");
const importsOf = text => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);

test("only src/server/saved/access.ts and the 0036 migration name app.saved_owner", () => {
  const naming = sources.filter(file => file.text.includes("app.saved_owner")).map(file => file.path).sort();
  assert.deepEqual(naming, ["src/server/db/migrations/0036_saved_layer.sql", "src/server/saved/access.ts"]);
  const access = sources.find(file => file.path === "src/server/saved/access.ts").text;
  assert.equal(access.match(/set_config\('app\.saved_owner'/g)?.length, 1, "the owner is set in exactly one statement");
  // The one statement lives in a private bindOwner, after the tenant and eligibility checks; both entrances call it with a verified membership.
  const bind = access.match(/\nasync function bindOwner[\s\S]*?\n\}\n/)?.[0];
  assert.ok(bind, "bindOwner is a module-private function");
  assert.doesNotMatch(access, /export[^\n]*bindOwner|export\s*\{[^}]*bindOwner/, "bindOwner is never exported");
  assert.match(bind, /current_setting\('app\.tenant_id', true\)[\s\S]*scope\.tenant !== owner\.tenantId[\s\S]*savedEligibility\(tx, owner\.tenantId, owner\.membershipId\)[\s\S]*set_config\('app\.saved_owner', \$\{owner\.membershipId\}, true\)/,
    "the owner is set transaction-locally, after the tenant and eligibility checks");
  const calls = [...access.matchAll(/await bindOwner\(tx, \{ tenantId: ([\w.]+), membershipId: ([\w.]+) \}\)/g)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(calls, ["identity.tenantId identity.membership.id", "live.tenantId live.membershipId"], "the cookie session's own membership, then the MCP connection's own");
  assert.equal(access.match(/bindOwner[<(]/g)?.length, 3, "declared once and called only by the two entrances");
  // The MCP entrance refuses a scheduled routine and any role but admin or tutor before binding, from the re-locked connection.
  const mcp = access.slice(access.indexOf("export async function withConnectionOwner"));
  assert.match(mcp, /if \(actor\.unattended\) throw new AccessDenied\(403\);[\s\S]*mcp\.withLive\(actor, intent, async \(tx, live, alive\) => \{\s*if \(live\.unattended[\s\S]*live\.role !== "admin" && live\.role !== "tutor"\) throw new AccessDenied\(403\);\s*await bindOwner/);
});

test("the MCP reaches saved readings only through src/server/saved/mcp, imported only by src/server/mcp/saved-tools.ts", () => {
  const importers = sources.filter(file => importsOf(file.text).some(spec => /(^|\/)saved\/mcp$/.test(spec))).map(file => file.path);
  assert.deepEqual(importers, ["src/server/mcp/saved-tools.ts"]);
  const narrow = sources.find(file => file.path === "src/server/saved/mcp.ts").text;
  // It reads readings and nothing a member writes on a verse: no work, mark or star query, and no cookie-session entrance.
  // An allowlist, not a blocklist: the data module only as `* as data`, never destructured, and only the reading queries.
  assert.deepEqual(importsOf(narrow).filter(spec => /data\/saved$/.test(spec)), ["../data/saved"]);
  assert.match(narrow, /import \* as data from "\.\.\/data\/saved";/);
  assert.doesNotMatch(narrow, /import\s*(type\s*)?\{[^}]*\}\s*from\s*"\.\.\/data\/saved"|=\s*data\s*;|=\s*data\b(?!\.)/, "data is never destructured or aliased");
  const used = new Set([...narrow.matchAll(/\bdata\.(\w+)/g)].map(m => m[1]));
  const allowed = new Set(["lockOwnerWrites", "reading", "listReadings", "countReadings", "insertReading", "updateReading", "SavedReadingRow"]);
  for (const name of used) assert.ok(allowed.has(name), `saved/mcp.ts uses data.${name}`);
  // withConnectionOwner binds from a connection id alone (withLive re-derives the person), so only this module may call it.
  const binders = sources.filter(file => file.path !== "src/server/saved/access.ts" && /\bwithConnectionOwner\b/.test(file.text)).map(file => file.path);
  assert.deepEqual(binders, ["src/server/saved/mcp.ts"]);
  const accessImporters = sources.filter(file => importsOf(file.text).some(spec => /(^|\/)saved\/access$|^\.\/access$/.test(spec) && (file.path.startsWith("src/server/saved/") || /saved\/access$/.test(spec)))).map(file => file.path).sort();
  assert.deepEqual(accessImporters, ["src/server/data/saved.ts", "src/server/saved/mcp.ts", "src/server/saved/service.ts"]);
  assert.doesNotMatch(narrow, /createSavedAccess|createSavedService|withSavedOwner|set_config/);
  assert.equal(narrow.match(/withConnectionOwner<Q, T>\(mcp, actor, "(read|data-write)", signal/g)?.length, 2, "every call is bound to the connection's own owner");
  // No tool input names an owner: the schemas take no member, owner, user, student or tenant.
  const tools = sources.find(file => file.path === "src/server/mcp/saved-tools.ts").text;
  assert.doesNotMatch(tools, /\b(membershipId|memberId|ownerId|userId|studentId|tenantId|owner|member)\s*:/);
  assert.equal(tools.match(/attendedOnly: true/g)?.length, 1, "the four tools share one attended-only base");
});

test("the saved data module is imported only from src/server/saved/*", () => {
  const importers = sources.filter(file => file.path !== "src/server/data/saved.ts" && importsOf(file.text).some(spec => /(^|\/)data\/saved$/.test(spec))).map(file => file.path);
  assert.ok(importers.length > 0);
  for (const path of importers) assert.match(path, /^src\/server\/saved\//, `${path} must not import data/saved`);
});

test("no code outside the saved layer names the saved tables, and the MCP imports no saved module but saved/mcp in saved-tools.ts", () => {
  const allowed = new Set(["src/server/db/saved-schema.ts", "src/server/data/saved.ts", "src/server/db/migrations/0036_saved_layer.sql", "src/server/db/migrations/meta/0036_snapshot.json",
    // 0040 lets the owner revise their own reading's ranges (release 1.7 "Change verses"); its own test pins it to that one grant.
    "src/server/db/migrations/0040_saved_reading_ranges.sql"]);
  for (const file of sources) {
    if (allowed.has(file.path) || /^src\/server\/db\/migrations\/meta\/\d{4}_snapshot\.json$/.test(file.path) && Number(file.path.match(/(\d{4})_snapshot/)[1]) > 36) continue;
    assert.doesNotMatch(file.text, /\b(savedReading|savedVerseWork|savedVerseMark|starredComment)\b|\b(saved_reading|saved_verse_work|saved_verse_mark|starred_comment)\b/, `${file.path} names a saved table`);
  }
  // Release 1.7 M4: the one exception is saved-tools.ts importing ../saved/mcp, and tools.ts registering saved-tools.ts.
  const allowedImports = new Map([["src/server/mcp/saved-tools.ts", ["../saved/mcp"]], ["src/server/mcp/tools.ts", ["./saved-tools"]]]);
  for (const file of sources.filter(file => file.path.startsWith("src/server/mcp/"))) {
    for (const spec of importsOf(file.text)) if (!(allowedImports.get(file.path) ?? []).includes(spec)) assert.doesNotMatch(spec, /saved/, `${file.path} imports ${spec}`);
    // MCP handlers receive the runtime's services; none may reach the saved service through it.
    assert.doesNotMatch(file.text, /\.saved\b|runtime\.saved|\bsaved\s*:/, `${file.path} reaches the saved service`);
  }
  // Staff-facing services that run without a member's own request never reach the saved service either.
  for (const file of sources.filter(file => /^src\/server\/(mcp|notifications|roster-sheet|relationships|students|study-guides|connections|settings|invitations)\//.test(file.path)))
    for (const spec of importsOf(file.text)) if (!(allowedImports.get(file.path) ?? []).includes(spec)) assert.doesNotMatch(spec, /(^|\/)saved(\/|$)/, `${file.path} imports ${spec}`);
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
