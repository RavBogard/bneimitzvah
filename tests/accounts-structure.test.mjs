import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guards for release 1.4 accounts (plan section 7; threats 3, 6 and 8).
const root = fileURLToPath(new URL("../", import.meta.url));
async function files(dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else if (/\.(ts|tsx|mts|mjs|cjs|js)$/.test(entry.name)) out.push(path.split(sep).join("/"));
  }
  return out;
}
const sources = await Promise.all([...await files("src"), ...await files("scripts")].map(async path => ({ path, text: await readFile(join(root, path), "utf8") })));
const importsOf = text => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);
const accounts = sources.filter(file => file.path.startsWith("src/server/accounts/"));

test("the accounts code never writes a role grant, never imports a grant writer, and never reads a saved table", () => {
  assert.ok(accounts.length >= 3);
  for (const file of accounts) {
    assert.doesNotMatch(file.text, /(insert|update|delete)\(s\.roleGrant\)/, `${file.path} writes role_grant`);
    assert.doesNotMatch(file.text, /\binsertGrant\b|\brevokeRoleGrant\b/, `${file.path} uses a grant writer`);
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /(^|\/)(data\/invitations|relationships|data\/saved)(\/|$)/, `${file.path} imports ${spec}`);
    assert.doesNotMatch(file.text, /\b(savedReading|savedVerseWork|savedVerseMark|starredComment)\b/, `${file.path} names a saved table`);
  }
});

test("an approver is never a workspace mode, and only the accounts service writes the account tables", () => {
  const types = sources.find(file => file.path === "src/server/access/types.ts").text;
  assert.match(types, /export type ActiveMode = "student" \| "parent" \| "tutor" \| "admin";/);
  const writers = sources.filter(file => /(insert|update|delete)\(s\.(accountRequest|tenantMember|accountApprover)\)/.test(file.text)).map(file => file.path);
  assert.deepEqual(writers, ["src/server/accounts/data.ts"]);
  for (const file of sources.filter(file => file.path.startsWith("src/server/mcp/")))
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /accounts/, `${file.path} imports ${spec}`);
});

test("account email goes only through the fixed-text transport, enabled only in production, and nothing logs a recipient", () => {
  const senders = sources.filter(file => file.text.includes("createAccountMailTransport(")).map(file => file.path).sort();
  assert.deepEqual(senders, ["src/server/mail/transport.ts", "src/server/runtime/composition.ts"]);
  const composition = sources.find(file => file.path === "src/server/runtime/composition.ts").text;
  assert.match(composition, /createAccountMailTransport\(\{ \.\.\.config\.mail, origin: config\.origin, fetch, enabled: config\.deployment\.environment === "production" \}\)/);
  for (const file of accounts) assert.doesNotMatch(file.text, /console\.|\.emit\(/, `${file.path} logs`);
  const routes = sources.find(file => file.path === "src/server/http/accounts.ts").text;
  for (const path of [...routes.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1])) assert.match(path, /^\/api\/accounts?\//);
  assert.doesNotMatch(routes, /cache-control|s-maxage|public,/i);
});
