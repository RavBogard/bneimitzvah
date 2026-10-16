import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { dirname, basename, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const TTL = 600_000, MAX_BYTES = 16 * 1024, MAX_HISTORY = 64;
const checkout = fileURLToPath(new URL("../", import.meta.url));
const stamp = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;
export class OwnerAdminError extends Error {
  constructor(code = "denied") { super("Owner admin operation failed"); this.name = "OwnerAdminError"; this.code = code; }
}
const fail = (code = "denied") => { throw new OwnerAdminError(code); };
function category(error) { try { if (error instanceof OwnerAdminError && ["invalid", "stale"].includes(error.code)) return error.code; } catch {} return "denied"; }
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], "value"))) fail("invalid");
  return value;
}
function id(value, uuid = false) {
  if (typeof value !== "string" || !(uuid ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ : /^[A-Za-z0-9_-]{1,128}$/).test(value)) fail("invalid");
  return value;
}
function integer(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) fail("invalid"); return value; }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value.slice(0, 23) + "Z") fail("invalid");
  return value;
}
function clock(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - TTL) fail("invalid"); return value; }
function person(value) {
  const row = object(value, ["id", "verified", "updatedAt"]);
  if (typeof row.verified !== "boolean") fail("invalid");
  return { id: id(row.id), verified: row.verified, updatedAt: timestamp(row.updatedAt) };
}
function member(value) {
  if (value === null) return null;
  const row = object(value, ["id", "authorityRevision", "disabledAt"]);
  return { id: id(row.id, true), authorityRevision: integer(row.authorityRevision), disabledAt: row.disabledAt === null ? null : timestamp(row.disabledAt) };
}
function grant(value) {
  const row = object(value, ["id", "revision", "createdAt", "revokedAt"]);
  return { id: id(row.id, true), revision: integer(row.revision), createdAt: timestamp(row.createdAt), revokedAt: row.revokedAt === null ? null : timestamp(row.revokedAt) };
}
function selection(value) {
  const row = object(value, ["operation", "tenantId", "bootstrapId", "ownerUserId", "targetUserId", "targetGrantId"]);
  if (!["grant", "revoke"].includes(row.operation) || row.tenantId !== "crc") fail("invalid");
  const result = { operation: row.operation, tenantId: "crc", bootstrapId: id(row.bootstrapId, true), ownerUserId: id(row.ownerUserId),
    targetUserId: id(row.targetUserId), targetGrantId: row.targetGrantId === null ? null : id(row.targetGrantId, true) };
  if (result.ownerUserId === result.targetUserId || (result.operation === "grant") !== (result.targetGrantId === null)) fail("invalid");
  return result;
}
function snapshot(value) {
  const row = object(value, ["owner", "target"]), owner = object(row.owner, ["user", "membership", "grant"]), target = object(row.target, ["user", "membership", "grants"]);
  if (!Array.isArray(target.grants) || target.grants.length > MAX_HISTORY || Reflect.ownKeys(target.grants).length !== target.grants.length + 1) fail("invalid");
  const grants = target.grants.map(grant);
  if (grants.some((value, i) => i > 0 && value.id <= grants[i - 1].id)) fail("invalid");
  return { owner: { user: person(owner.user), membership: member(owner.membership), grant: grant(owner.grant) },
    target: { user: person(target.user), membership: member(target.membership), grants } };
}
function descriptor(value) {
  const row = object(value, ["version", "selection", "snapshot", "preparedAt", "expiresAt"]);
  if (row.version !== 1) fail("invalid");
  const result = { version: 1, selection: selection(row.selection), snapshot: snapshot(row.snapshot), preparedAt: clock(row.preparedAt), expiresAt: clock(row.expiresAt) };
  if (result.expiresAt !== result.preparedAt + TTL || result.snapshot.owner.user.id !== result.selection.ownerUserId
    || result.snapshot.target.user.id !== result.selection.targetUserId || !result.snapshot.owner.membership) fail("invalid");
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) fail("invalid");
  return result;
}
export function ownerAdminDigest(review) {
  try { return createHash("sha256").update(JSON.stringify(descriptor(review))).digest("hex"); }
  catch { throw new OwnerAdminError("invalid"); }
}
async function transaction(client, action) {
  let started = false;
  try {
    const check = await client.query(`SELECT current_user = session_user AS direct,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN ('tenant','user','membership','role_grant','practice_context','audit_event')
       AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned`);
    if (check.rows[0]?.direct !== true || check.rows[0].owned !== 6) fail();
    await client.query("BEGIN"); started = true;
    await client.query("SET LOCAL ROLE portal_runtime");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT set_config('app.tenant_id', 'crc', true)");
    const tenant = await client.query("SELECT id FROM tenant WHERE id='crc' AND enabled=true FOR UPDATE");
    if (tenant.rows.length !== 1) fail();
    const result = await action();
    await client.query("COMMIT"); started = false;
    return result;
  } catch (error) {
    if (started) {
      await client.query("ROLLBACK").catch(() => {});
      await client.query("RESET ROLE").catch(() => {});
    }
    throw new OwnerAdminError(category(error));
  }
}
async function capture(client, input) {
  const bindings = await client.query(`SELECT id,actor_user_id,actor_membership_id,role_grant_id,mode,action,target_id,acting_student_id,guardian_id
    FROM audit_event WHERE tenant_id='crc' AND target_type='owner-bootstrap' LIMIT 2`);
  if (bindings.rows.length !== 1) fail();
  const binding = bindings.rows[0];
  if (binding.id !== input.bootstrapId || binding.actor_user_id !== input.ownerUserId || binding.mode !== "admin"
    || binding.action !== "grant.issue" || binding.target_id !== binding.role_grant_id || binding.acting_student_id !== null || binding.guardian_id !== null) fail();
  const users = await client.query(`SELECT id,email_verified,to_char(updated_at,'${stamp}') AS updated_at
    FROM "user" WHERE id IN ($1,$2) ORDER BY id FOR UPDATE`, [input.ownerUserId, input.targetUserId]);
  if (users.rows.length !== 2) fail();
  const user = userId => { const row = users.rows.find(value => value.id === userId); if (!row) fail(); return { id: row.id, verified: row.email_verified, updatedAt: row.updated_at }; };
  const memberships = await client.query(`SELECT id,user_id,authority_revision,to_char(disabled_at AT TIME ZONE 'UTC','${stamp}') AS disabled_at
    FROM membership WHERE tenant_id='crc' AND user_id IN ($1,$2) ORDER BY id FOR UPDATE`, [input.ownerUserId, input.targetUserId]);
  if (memberships.rows.length > 2) fail();
  const membership = userId => { const row = memberships.rows.find(value => value.user_id === userId); return row ? { id: row.id, authorityRevision: row.authority_revision, disabledAt: row.disabled_at } : null; };
  const ownerMember = membership(input.ownerUserId), targetMember = membership(input.targetUserId);
  if (!ownerMember || ownerMember.id !== binding.actor_membership_id || ownerMember.disabledAt !== null || !user(input.ownerUserId).verified) fail();
  const rows = await client.query(`SELECT id,membership_id,revision,to_char(created_at AT TIME ZONE 'UTC','${stamp}') AS created_at,
      to_char(revoked_at AT TIME ZONE 'UTC','${stamp}') AS revoked_at FROM role_grant
    WHERE tenant_id='crc' AND role='admin' AND membership_id IN ($1,$2) ORDER BY id LIMIT 66 FOR UPDATE`, [ownerMember.id, targetMember?.id ?? ownerMember.id]);
  const ownerGrants = rows.rows.filter(row => row.membership_id === ownerMember.id), targetGrants = targetMember ? rows.rows.filter(row => row.membership_id === targetMember.id) : [];
  if (ownerGrants.length !== 1 || ownerGrants[0].id !== binding.role_grant_id || ownerGrants[0].revoked_at !== null || targetGrants.length > MAX_HISTORY) fail();
  const mapGrant = row => ({ id: row.id, revision: row.revision, createdAt: row.created_at, revokedAt: row.revoked_at });
  const result = snapshot({ owner: { user: user(input.ownerUserId), membership: ownerMember, grant: mapGrant(ownerGrants[0]) },
    target: { user: user(input.targetUserId), membership: targetMember, grants: targetGrants.map(mapGrant) } });
  return result;
}
async function assertTarget(client, input, result) {
  if (input.operation === "grant") {
    if (!result.target.user.verified || result.target.membership?.disabledAt || result.target.grants.some(row => row.revokedAt === null)) fail();
  } else {
    const target = result.target.grants.find(row => row.id === input.targetGrantId);
    if (!result.target.membership || !target || target.revokedAt !== null || target.id === result.owner.grant.id) fail();
    const remaining = await client.query(`SELECT g.id FROM role_grant g JOIN membership m ON m.tenant_id=g.tenant_id AND m.id=g.membership_id
      JOIN "user" u ON u.id=m.user_id WHERE g.tenant_id='crc' AND g.role='admin' AND g.revoked_at IS NULL
      AND m.disabled_at IS NULL AND u.email_verified=true AND g.id <> $1 LIMIT 1`, [target.id]);
    if (remaining.rows.length !== 1) fail();
  }
}
export async function prepareOwnerAdmin(client, input, options = {}) {
  try {
    const chosen = selection(input);
    return await transaction(client, async () => {
      const state = await capture(client, chosen);
      await assertTarget(client, chosen, state);
      const now = clock((options.now ?? Date.now)());
      const review = descriptor({ version: 1, selection: chosen, snapshot: state, preparedAt: now, expiresAt: now + TTL });
      return { review, digest: ownerAdminDigest(review) };
    });
  } catch (error) { throw new OwnerAdminError(category(error)); }
}
export async function applyOwnerAdmin(client, value, digest, options = {}) {
  try {
    const review = descriptor(value);
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) || ownerAdminDigest(review) !== digest) fail("invalid");
    const fresh = () => { const now = clock((options.now ?? Date.now)()); if (review.preparedAt > now || review.expiresAt <= now) fail("stale"); return now; };
    fresh();
    return await transaction(client, async () => {
      const state = await capture(client, review.selection);
      if (JSON.stringify(state) !== JSON.stringify(review.snapshot)) fail("stale");
      await assertTarget(client, review.selection, state);
      const now = fresh(), input = review.selection;
      let targetGrantId = input.targetGrantId;
      if (input.operation === "grant") {
        const membershipId = state.target.membership?.id ?? randomUUID();
        if (!state.target.membership) await client.query("INSERT INTO membership(id,tenant_id,user_id) VALUES($1,'crc',$2)", [membershipId, input.targetUserId]);
        targetGrantId = randomUUID();
        await client.query("INSERT INTO role_grant(id,tenant_id,membership_id,role) VALUES($1,'crc',$2,'admin')", [targetGrantId, membershipId]);
      } else {
        const target = state.target.grants.find(row => row.id === targetGrantId);
        const updated = await client.query(`UPDATE role_grant SET revoked_at=$1,revision=revision+1
          WHERE tenant_id='crc' AND id=$2 AND role='admin' AND revoked_at IS NULL AND revision=$3 RETURNING id`, [new Date(now), targetGrantId, target.revision]);
        if (updated.rows.length !== 1) fail("stale");
        await client.query("UPDATE practice_context SET revoked_at=$1 WHERE tenant_id='crc' AND role_grant_id=$2 AND revoked_at IS NULL", [new Date(now), targetGrantId]);
      }
      await client.query(`INSERT INTO audit_event(tenant_id,actor_user_id,actor_membership_id,role_grant_id,mode,action,target_type,target_id,request_id)
        VALUES('crc',$1,$2,$3,'admin',$4,'owner-admin',$5,$6)`, [state.owner.user.id, state.owner.membership.id, state.owner.grant.id,
        input.operation === "grant" ? "grant.issue" : "grant.revoke", targetGrantId, randomUUID()]);
      return { status: input.operation === "grant" ? "granted" : "revoked" };
    });
  } catch (error) { throw new OwnerAdminError(category(error)); }
}

function inside(root, path) { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)); }
async function privatePath(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) fail("invalid");
  const path = resolve(value), root = await realpath(checkout), parent = dirname(path);
  if (inside(resolve(checkout), path) || inside(root, path)) fail("invalid");
  let cursor = parent;
  while (true) {
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("invalid");
    const next = dirname(cursor); if (next === cursor) break; cursor = next;
  }
  const canonicalParent = await realpath(parent), info = await lstat(parent);
  if (inside(root, resolve(canonicalParent, basename(path)))) fail("invalid");
  return { path, parent, canonicalParent, info };
}
async function unchanged(path) {
  const info = await lstat(path.parent);
  if (info.isSymbolicLink() || info.dev !== path.info.dev || info.ino !== path.info.ino || await realpath(path.parent) !== path.canonicalParent) fail("invalid");
}
export async function writeOwnerAdminReview(pathname, prepared) {
  let handle, path, created = false;
  try {
    object(prepared, ["review", "digest"]);
    const review = descriptor(prepared.review), digest = ownerAdminDigest(review);
    if (prepared.digest !== digest) fail("invalid");
    const bytes = Buffer.from(JSON.stringify({ review, digest }) + "\n");
    if (bytes.length > MAX_BYTES) fail("invalid");
    path = await privatePath(pathname);
    handle = await open(path.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); created = true;
    await unchanged(path);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) fail("invalid");
    await handle.writeFile(bytes); await handle.sync(); await unchanged(path);
  } catch {
    if (created && handle && path) {
      try { await unchanged(path); const current = await lstat(path.path), opened = await handle.stat(); if (current.dev === opened.dev && current.ino === opened.ino) await unlink(path.path); } catch { /* Never delete a replacement. */ }
    }
    throw new OwnerAdminError("invalid");
  } finally { await handle?.close().catch(() => {}); }
}
export async function readOwnerAdminFile(pathname) {
  let handle;
  try {
    const path = await privatePath(pathname);
    const initial = await lstat(path.path);
    if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.size > MAX_BYTES) fail("invalid");
    handle = await open(path.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES || info.dev !== initial.dev || info.ino !== initial.ino) fail("invalid");
    const bytes = Buffer.alloc(MAX_BYTES + 1); let count = 0;
    while (count < bytes.length) { const next = await handle.read(bytes, count, bytes.length - count, null); count += next.bytesRead; if (!next.bytesRead) break; }
    if (count > MAX_BYTES) fail("invalid");
    await unchanged(path);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count)));
  } catch { throw new OwnerAdminError("invalid"); }
  finally { await handle?.close().catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let client;
  try {
    const args = process.argv.slice(2), operation = args[0], expected = operation === "prepare" ? ["--input", "--review"] : ["--review", "--confirm-digest"];
    if (!["prepare", "apply"].includes(operation) || args.length !== 5 || args[1] !== expected[0] || args[3] !== expected[1]) fail("invalid");
    const input = await readOwnerAdminFile(args[2]);
    if (operation === "prepare") await privatePath(args[4]);
    const value = process.env.DATABASE_MIGRATION_URL;
    if (!value || value.length > 4096) fail();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.includes("-pooler")) fail();
    client = new pg.Client({ connectionString: value, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    await client.connect();
    if (operation === "prepare") await writeOwnerAdminReview(args[4], await prepareOwnerAdmin(client, input));
    else { object(input, ["review", "digest"]); if (input.digest !== args[4]) fail("invalid"); await applyOwnerAdmin(client, input.review, args[4]); }
    console.log(operation === "prepare" ? "Owner admin review prepared" : "Owner admin operation completed");
  } catch { console.error("Owner admin operation failed; verify private operator configuration and review"); process.exitCode = 1; }
  finally { await client?.end().catch(() => {}); }
}
