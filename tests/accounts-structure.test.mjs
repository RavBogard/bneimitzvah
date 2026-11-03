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
    for (const spec of importsOf(file.text)) assert.doesNotMatch(spec, /(^|\/)(data\/invitations|relationships|data\/saved|saved)(\/|$)/, `${file.path} imports ${spec}`);
    // Readings for everyone (plan D6, decision 4): approving a link request with a target links the account to a student record, which
    // does grant the student role, through the invitation layer's own writes in src/server/learners/link.ts; the service imports that
    // one module and nothing else of the learners code, and the link write is reached by the accounts service alone.
    assert.deepEqual(importsOf(file.text).filter(spec => /learners/.test(spec)), file.path === "src/server/accounts/service.ts" ? ["../learners/link"] : [], `${file.path} imports the learners code`);
    // People with access (docs/planning/2026-11-03-people-tutor/SPEC.md): an admin's Make tutor grants the tutor role, deliberately,
    // through src/server/people/tutor.ts, which uses the invitation layer's own grant write and grant.issue audit. The service imports
    // that one module; nothing else of the accounts code reaches it.
    assert.deepEqual(importsOf(file.text).filter(spec => /(^|\/)people\//.test(spec)), file.path === "src/server/accounts/service.ts" ? ["../people/tutor"] : [], `${file.path} imports the people code`);
    assert.doesNotMatch(file.text, /\b(savedReading|savedVerseWork|savedVerseMark|starredComment)\b/, `${file.path} names a saved table`);
    // The product name comes from the one shared reader (Daniel, E1), never a second query or a fixed "CRC Torah".
    assert.doesNotMatch(file.text, /\bs\.tenant\b|product_name|CRC Torah/, `${file.path} reads or fixes the product name itself`);
  }
  const linkers = sources.filter(file => file.path !== "src/server/learners/link.ts" && /\blinkRequestedStudent\b/.test(file.text)).map(file => file.path);
  assert.deepEqual(linkers, ["src/server/accounts/service.ts"]);
  // The places that may insert a role grant (2026-11-03 spec): the invitation layer's writers, used by invitation acceptance, the link
  // write above and Make tutor. Make tutor's conflict-safe writer is used by people/tutor.ts alone, which is called by the accounts service alone.
  assert.deepEqual(sources.filter(file => /insert\(s\.roleGrant\)/.test(file.text)).map(file => file.path), ["src/server/data/invitations.ts"]);
  assert.deepEqual(sources.filter(file => file.path !== "src/server/data/invitations.ts" && /\binsertGrantUnlessActive\b/.test(file.text)).map(file => file.path), ["src/server/people/tutor.ts"]);
  assert.deepEqual(sources.filter(file => file.path !== "src/server/people/tutor.ts" && /\bmakeTutor\b/.test(file.text) && /from\s+["'][^"']*people\/tutor["']/.test(file.text)).map(file => file.path), ["src/server/accounts/service.ts"]);
  const tutorWrite = sources.find(file => file.path === "src/server/people/tutor.ts").text;
  assert.match(tutorWrite, /if \(actor\.mode !== "admin"\) throw new AccessDenied\(403\)/);
  assert.match(tutorWrite, /writeInvitationAudit\(tx, actor, "grant\.issue", grantId\)/);
  // Remove tutor (docs/planning/2026-11-03-people-tutor/SPEC-2.md) deliberately revokes a tutor grant, its links, contexts and claims.
  // It reuses the Tutors page's own writes, never a second copy: the one grant-revocation write (writeGrantRevocation, also behind
  // "Remove as a tutor") and the one tutor-link revocation (writeTutorRevocation). Only people/tutor.ts reaches them from outside
  // the relationships code, removeTutor is called by the accounts service alone, and the accounts code still writes no grant itself.
  assert.equal((tutorWrite.match(/\bif \(actor\.mode !== "admin"\) throw new AccessDenied\(403\)/g) ?? []).length, 2, "both tutor writes are admin only");
  assert.deepEqual(importsOf(tutorWrite).filter(spec => /relationships/.test(spec)), ["../relationships/service"]);
  assert.deepEqual(sources.filter(file => !file.path.startsWith("src/server/relationships/") && /\bwriteGrantRevocation\b/.test(file.text)).map(file => file.path), ["src/server/people/tutor.ts"]);
  assert.match(sources.find(file => file.path === "src/server/relationships/service.ts").text, /async function revokeRoleGrant[\s\S]{0,1000}writeGrantRevocation\(tx, actor, grantId, expected, new Date\(\)\)/);
  assert.deepEqual(sources.filter(file => file.path !== "src/server/people/tutor.ts" && /\bremoveTutor\b/.test(file.text) && /from\s+["'][^"']*people\/tutor["']/.test(file.text)).map(file => file.path), ["src/server/accounts/service.ts"]);
  const reader = sources.find(file => file.path === "src/server/data/product-name.ts");
  assert.ok(reader && /export async function readProductName\b/.test(reader.text) && /export async function readTenantNames\b/.test(reader.text));
  // No server code but the reader selects the column itself: the notification emails take it from the reader too.
  const readers = sources.filter(file => file.path.startsWith("src/server/") && !file.path.startsWith("src/server/db/") && /\bs\.tenant\.productName\b/.test(file.text)).map(file => file.path);
  assert.deepEqual(readers, ["src/server/data/product-name.ts"]);
  assert.match(sources.find(file => file.path === "src/server/data/notifications.ts").text, /import \{ readProductName \} from "\.\/product-name";/);
  for (const path of ["src/components/portal/account-request.tsx", "src/components/portal/workspace/accounts/workspace.tsx", "src/server/mail/transport.ts"])
    // The sign-in and invitation subject on that one line still fixes the name; the sign-in code PR (#44) moves it to the reader.
    assert.doesNotMatch(sources.find(file => file.path === path).text.replace(/subject: kind === "invitation" \? "Your Beit Mitzvah invitation from CRC Torah" : "Sign in to CRC Torah",/, ""), /CRC Torah/, `${path} fixes the product name`);
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
