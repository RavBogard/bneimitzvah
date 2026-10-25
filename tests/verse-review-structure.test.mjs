import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for 1.9 N19, a student's own verse cards and the Run-through, on Learn progress's model
// (tests/course-progress-structure.test.mjs). RLS is the enforcement; these keep the code shaped so that only the student's
// own request ever sets the owner, no tutor, parent, admin, MCP or Sheet path reaches the table, and the Run-through and the
// verse cards can reach no audio at all (the G3 gate).
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
const source = path => { const file = sources.find(row => row.path === path); assert.ok(file, path); return file.text; };
const MIGRATION = "src/server/db/migrations/0048_verse_review.sql";

test("only src/server/verse-review/access.ts and migration 0048 name app.verse_review_owner, set once, after the student check", () => {
  const naming = sources.filter(file => file.text.includes("app.verse_review_owner")).map(file => file.path).sort();
  assert.deepEqual(naming, [MIGRATION, "src/server/verse-review/access.ts"]);
  const access = source("src/server/verse-review/access.ts");
  assert.equal(access.match(/set_config\('app\.verse_review_owner'/g)?.length, 1, "the owner is set in exactly one statement");
  assert.match(access, /verseReviewEligibility\(tx, identity\.tenantId, identity\.membership\.id\)[\s\S]*set_config\('app\.verse_review_owner', \$\{identity\.membership\.id\}, true\)/,
    "the owner is the verified membership, set transaction-locally, after the live student grant check");
  assert.match(source("src/server/data/verse-review.ts"), /eq\(s\.roleGrant\.role, "student"\), isNull\(s\.roleGrant\.revokedAt\)\)/, "only a live student grant keeps verse cards");
});

test("the verse-review data module is imported only from src/server/verse-review/*, and no code outside the layer names the table", () => {
  const importers = sources.filter(file => file.path !== "src/server/data/verse-review.ts" && importsOf(file.text).some(spec => /(^|\/)data\/verse-review$/.test(spec))).map(file => file.path);
  assert.ok(importers.length > 0);
  for (const path of importers) assert.match(path, /^src\/server\/verse-review\//, `${path} must not import data/verse-review`);
  const allowed = new Set(["src/server/db/verse-review-schema.ts", "src/server/data/verse-review.ts", MIGRATION]);
  for (const file of sources) {
    if (allowed.has(file.path) || /^src\/server\/db\/migrations\/meta\/\d{4}_snapshot\.json$/.test(file.path)) continue;
    assert.doesNotMatch(file.text, /\bverseReviewTable\b|\bverse_review\b/, `${file.path} names the verse-review table`);
  }
});

test("no tutor, parent, admin, MCP, Sheet or notification path reaches the verse cards: decision 7 does not cover run-throughs", () => {
  for (const file of sources.filter(file => /^src\/server\//.test(file.path) && !/^src\/server\/(verse-review|data\/verse-review|http\/verse-review|runtime\/composition|http\/dispatch|db\/)/.test(file.path))) {
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /verse-review/, `${file.path} imports ${spec}`);
    assert.doesNotMatch(file.text, /\.verseReview\b/, `${file.path} reaches the verse-review service`);
  }
  const composition = source("src/server/runtime/composition.ts");
  assert.equal(composition.match(/createVerseReviewService\(/g)?.length, 1);
  // The service has no reader but the owner: get and put, both through the owner access.
  const service = source("src/server/verse-review/service.ts");
  assert.deepEqual([...service.matchAll(/^\s{4}async (\w+)\(/gm)].map(m => m[1]), ["get", "put"]);
  assert.equal(service.match(/withOwner\(/g)?.length, 2);
  // In the browser, the cards are asked for only by Learn's own modules.
  const callers = sources.filter(file => file.text.includes("/api/learn/verses")).map(file => file.path).sort();
  assert.deepEqual(callers, ["src/components/learn/verse-review-sync.ts", "src/server/http/verse-review.ts"]);
});

test("verse-review writes record no audit rows, and its routes are never public or cacheable", () => {
  for (const file of sources.filter(file => file.path === "src/server/data/verse-review.ts" || file.path.startsWith("src/server/verse-review/")))
    assert.doesNotMatch(file.text, /auditEvent|audit_event/, `${file.path} must not write audit rows`);
  const routes = source("src/server/http/verse-review.ts");
  assert.deepEqual([...new Set([...routes.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1]))], ["/api/learn/verses", "/api/learn/verses/put"]);
  assert.doesNotMatch(routes, /cache-control|s-maxage|public,/i, "responses keep privateJson's private, no-store headers");
  const dispatch = source("src/server/http/dispatch.ts");
  assert.equal(dispatch.match(/verseReviewRouteMethods\(url\.pathname\)/g)?.length, 1);
  assert.equal(dispatch.match(/handleVerseReviewRequest\(request, runtime\)/g)?.length, 1);
  assert.doesNotMatch(source(MIGRATION), /GRANT[^;]*(DELETE|TRUNCATE|ALL)[^;]*ON verse_review|GRANT[^;(]*UPDATE ON/i);
});

test("the Run-through and the verse cards play nothing: no player, no phrase audio, no recording, no audio element (G3)", () => {
  for (const path of ["src/components/learn/run-through.tsx", "src/components/learn/verse-run.tsx", "src/app/learn/run-through/page.tsx", "src/lib/learn/verse-review.ts"]) {
    const text = source(path);
    for (const spec of importsOf(text)) assert.doesNotMatch(spec, /player|phrase-audio|reference-audio|recording|\/bits$|audio/i, `${path} imports ${spec}`);
    assert.doesNotMatch(text, /LearnServices|useLearnServices|usePlayerState|new Audio|<audio|\.play\(|PlayTile|AudioContext|speechSynthesis/, `${path} reaches audio`);
  }
  // Their text comes through the text-only loader, which asks for no recording metadata.
  const api = source("src/components/learn/verses-api.ts");
  const textOnly = api.slice(api.indexOf("export async function passageText"), api.indexOf("/** One per page"));
  assert.ok(textOnly.length > 100);
  assert.doesNotMatch(textOnly, /shortPage|publicShortPath|reference/i);
});
