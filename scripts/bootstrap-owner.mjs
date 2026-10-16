import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

// Private operator path only. Nothing imports this script from the application.
// No request, email signup hook, public route or runtime credential can bootstrap.
export async function bootstrapOwner(client, input) {
  let started = false;
  try {
    if (input?.confirm !== true || typeof input.email !== "string") throw new Error();
    const email = input.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error();
    const privilege = await client.query(`SELECT current_user = session_user AS direct,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('tenant','role_grant','audit_event')
        AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned`);
    if (!privilege.rows[0]?.direct || privilege.rows[0].owned !== 3) throw new Error();
    await client.query("BEGIN"); started = true;
    // Fixed narrow privilege group + CRC context respects FORCE RLS. The private
    // operator session stays separate from the app's restricted connection.
    await client.query("SET LOCAL ROLE portal_runtime");
    await client.query("SELECT set_config('app.tenant_id', 'crc', true)");
    const tenant = await client.query("SELECT id FROM tenant WHERE id='crc' AND enabled=true FOR UPDATE");
    if (tenant.rows.length !== 1) throw new Error();
    const users = await client.query('SELECT id,email_verified FROM "user" WHERE lower(email)=$1 FOR UPDATE', [email]);
    if (users.rows.length !== 1 || users.rows[0].email_verified !== true) throw new Error();
    const userId = users.rows[0].id;
    const binding = await client.query("SELECT DISTINCT actor_user_id FROM audit_event WHERE tenant_id='crc' AND target_type='owner-bootstrap' AND action='grant.issue'");
    if (binding.rows.length > 1 || (binding.rows.length === 1 && binding.rows[0].actor_user_id !== userId)) throw new Error();
    const memberships = await client.query("SELECT id,disabled_at FROM membership WHERE tenant_id='crc' AND user_id=$1 FOR UPDATE", [userId]);
    if (memberships.rows.length > 1 || memberships.rows[0]?.disabled_at) throw new Error();
    let membershipId = memberships.rows[0]?.id;
    if (!membershipId) {
      membershipId = randomUUID();
      await client.query("INSERT INTO membership(id,tenant_id,user_id) VALUES($1,'crc',$2)", [membershipId, userId]);
    }
    const grants = await client.query("SELECT id,revoked_at FROM role_grant WHERE tenant_id='crc' AND membership_id=$1 AND role='admin' ORDER BY id FOR UPDATE", [membershipId]);
    if (grants.rows.some((grant) => grant.revoked_at === null)) {
      if (binding.rows.length !== 1) throw new Error(); // Never adopt an unbound preexisting admin.
      await client.query("COMMIT"); started = false;
      return { status: "already-configured" };
    }
    if (grants.rows.length) throw new Error(); // Explicitly revoked admin is not revived.
    const otherAdmins = await client.query("SELECT id FROM role_grant WHERE tenant_id='crc' AND role='admin' LIMIT 1");
    if (otherAdmins.rows.length) throw new Error(); // Neither active nor revoked unbound admin history can establish a new owner.
    const grantId = randomUUID();
    await client.query("INSERT INTO role_grant(id,tenant_id,membership_id,role) VALUES($1,'crc',$2,'admin')", [grantId, membershipId]);
    await client.query(`INSERT INTO audit_event(tenant_id,actor_user_id,actor_membership_id,role_grant_id,mode,action,target_type,target_id,request_id)
      VALUES('crc',$1,$2,$3,'admin','grant.issue','owner-bootstrap',$5,$4)`, [userId, membershipId, grantId, randomUUID(), grantId]);
    await client.query("COMMIT"); started = false;
    return { status: "configured" };
  } catch {
    if (started) await client.query("ROLLBACK").catch(() => {});
    // Never retain a driver error/cause, query, connection string or identity.
    throw new Error("Owner bootstrap failed");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let client;
  try {
    const value = process.env.DATABASE_MIGRATION_URL;
    const email = process.env.BOOTSTRAP_OWNER_EMAIL;
    if (!value || !email || !process.argv.includes("--confirm")) throw new Error();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.includes("-pooler")) throw new Error();
    client = new pg.Client({ connectionString: value });
    await client.connect();
    await bootstrapOwner(client, { email, confirm: true });
    console.log("Owner bootstrap completed; remove private bootstrap configuration");
  } catch {
    console.error("Owner bootstrap failed; verify private operator configuration");
    process.exitCode = 1;
  } finally { if (client) await client.end().catch(() => {}); }
}
