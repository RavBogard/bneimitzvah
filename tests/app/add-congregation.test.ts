import { afterEach, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { addCongregation, congregation, CongregationError, parseArgs, type CongregationInput } from "../../scripts/add-congregation.mjs";

const clients: PGlite[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); });
async function database() {
  const client = new PGlite(); clients.push(client);
  await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
  return client;
}
const input: CongregationInput = { id: "synthetic-shul", name: "Synthetic Congregation", productName: "Synthetic B'nei Mitzvah", host: "portal.synthetic.example",
  origin: "https://portal.synthetic.example", environment: "production", deployment: "production", calendar: "diaspora" };
const counts = async (client: PGlite) => (await client.query<{ t: number; h: number; s: number; a: number; m: number; i: number }>(`select
  (select count(*)::int from tenant) t, (select count(*)::int from tenant_host) h, (select count(*)::int from tenant_settings) s,
  (select count(*)::int from audit_event) a, (select count(*)::int from membership) m, (select count(*)::int from invite) i`)).rows[0];
const code = async (action: () => Promise<unknown>) => { try { await action(); return null; } catch (error) { return error instanceof CongregationError && error.message === "Congregation onboarding refused" ? error.code : "other"; } };

test("a dry run checks everything and writes nothing; apply writes exactly one tenant, one host row and one empty settings version", async () => {
  const client = await database(), before = await counts(client);
  const dry = await addCongregation(client, input);
  expect(dry).toEqual({ outcome: "dry-run", tenant: "synthetic-shul", host: "portal.synthetic.example", environment: "production", rows: { tenant: 1, tenantHost: 1, tenantSettings: 1 }, settingsVersion: 1 });
  expect(await counts(client)).toEqual(before);
  const applied = await addCongregation(client, input, { apply: true });
  expect(applied).toEqual({ ...dry, outcome: "applied" });
  expect(await counts(client)).toEqual({ ...before, t: before.t + 1, h: before.h + 1, s: before.s + 1 });
  expect((await client.query("select id, name, product_name, enabled, customs from tenant where id='synthetic-shul'")).rows)
    .toEqual([{ id: "synthetic-shul", name: "Synthetic Congregation", product_name: "Synthetic B'nei Mitzvah", enabled: true, customs: { calendar: { diaspora: true } } }]);
  expect((await client.query("select host, tenant_id, environment, deployment, origin from tenant_host where tenant_id='synthetic-shul'")).rows)
    .toEqual([{ host: "portal.synthetic.example", tenant_id: "synthetic-shul", environment: "production", deployment: "production", origin: "https://portal.synthetic.example" }]);
  expect((await client.query("select version, base_version, previous_version, body, channel, actor_user_id, role from tenant_settings where tenant_id='synthetic-shul'")).rows)
    .toEqual([{ version: 1, base_version: 0, previous_version: null, body: {}, channel: "operator", actor_user_id: null, role: null }]);
  // The report is counts and ids; no member, invitation or mail exists for the new congregation.
  expect(JSON.stringify(applied)).not.toMatch(/@|postgres|token/i);
  expect(await code(() => addCongregation(client, input, { apply: true }))).toBe("tenant-exists");
  expect(await code(() => addCongregation(client, { ...input, id: "another-shul" }, { apply: true }))).toBe("host-exists");
  expect(await code(() => addCongregation(client, { ...input, id: "crc", host: "crc.synthetic.example", origin: "https://crc.synthetic.example" }))).toBe("tenant-exists");
  expect(await counts(client)).toEqual({ ...before, t: before.t + 1, h: before.h + 1, s: before.s + 1 });
});

test("the script refuses the runtime role and any connection that does not own the tenant tables", async () => {
  const client = await database(), before = await counts(client);
  await client.exec("CREATE ROLE onboarding_runtime LOGIN; GRANT portal_runtime TO onboarding_runtime; SET SESSION AUTHORIZATION onboarding_runtime; SET ROLE portal_runtime");
  expect(await code(() => addCongregation(client, input, { apply: true }))).toBe("owner-required");
  await client.exec("RESET ROLE");
  expect(await code(() => addCongregation(client, input, { apply: true }))).toBe("owner-required");
  await client.exec("SET SESSION AUTHORIZATION postgres");
  expect(await counts(client)).toEqual(before);
});

test("input is closed: a slug id, plain names, one exact host and origin per environment", () => {
  expect(congregation(input)).toEqual(input);
  expect(congregation({ ...input, host: "localhost:3200", origin: "http://localhost:3200", environment: "local" }).origin).toBe("http://localhost:3200");
  for (const bad of [
    { ...input, id: "Synthetic" }, { ...input, id: "" }, { ...input, name: " padded" }, { ...input, name: "<b>" }, { ...input, productName: "x".repeat(121) },
    { ...input, host: "Portal.synthetic.example", origin: "https://Portal.synthetic.example" }, { ...input, origin: "http://portal.synthetic.example" },
    { ...input, origin: "https://other.example" }, { ...input, host: "portal.synthetic.example:8443", origin: "https://portal.synthetic.example:8443" },
    { ...input, host: "localhost:3200", origin: "http://localhost:3200" }, { ...input, environment: "staging" }, { ...input, deployment: "Prod" }, { ...input, calendar: "both" },
    { ...input, host: "bad..example", origin: "https://bad..example" }, { ...input, host: "a_b.example", origin: "https://a_b.example" },
  ]) expect(() => congregation(bad), JSON.stringify(bad)).toThrow(CongregationError);
  const argv = ["--id", input.id, "--name", input.name, "--product-name", input.productName, "--host", input.host, "--origin", input.origin, "--environment", "production", "--deployment", "production"];
  expect(parseArgs(argv)).toEqual({ ...input, apply: false });
  expect(parseArgs([...argv, "--apply", "--calendar", "israel"])).toEqual({ ...input, calendar: "israel", apply: true });
  for (const bad of [[], [...argv, "--apply", "--apply"], [...argv, "--id", "again"], [...argv, "--invite", "x"], argv.slice(0, -2)]) expect(() => parseArgs(bad), JSON.stringify(bad)).toThrow(/usage/);
});
