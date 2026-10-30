import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { authFixture } from "./auth-stack-helper";
import { addCongregationHost, hostRow, setSummaryCredit, summaryCredit } from "../../scripts/add-congregation-host.mjs";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof authFixture>>[] = [];
async function fixture() {
  const f = await authFixture(); fixtures.push(f);
  return { ...f, db: drizzle(f.client, { schema: s }) };
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.client.close())); });
const ORIGIN = "https://torah.fork-congregation.example";
const CREDIT = "Rabbi Synthetic Example";

describe("congregation host operator script", () => {
  it("adds one production host row for the configured origin to tenant crc and is idempotent", async () => {
    const f = await fixture();
    const before = (await f.db.select().from(s.tenantHost)).length;
    expect((await addCongregationHost(f.client, { origin: ORIGIN, summaryCredit: CREDIT, confirm: true })).status).toBe("configured");
    expect((await addCongregationHost(f.client, { origin: ORIGIN, summaryCredit: CREDIT, confirm: true })).status).toBe("already-configured");
    const rows = await f.db.select().from(s.tenantHost);
    expect(rows.length).toBe(before + 1);
    expect(rows.find((r) => r.host === "torah.fork-congregation.example")).toMatchObject({ tenantId: "crc", environment: "production", deployment: "production", origin: ORIGIN });
    const credit = await f.client.query<{ summary_credit: string }>("select summary_credit from tenant where id='crc'");
    expect(credit.rows[0].summary_credit).toBe(CREDIT);
    const role = await f.client.query<{ role: string }>("select current_user as role");
    expect(role.rows[0].role).toBe("postgres");
  });

  it("requires a plain-name credit, and sets only the credit on its own path", async () => {
    const f = await fixture();
    for (const bad of ["", " padded ", ["a", "b"].join("@"), "<b>x</b>", "x".repeat(241), undefined]) {
      expect(() => summaryCredit(bad as string)).toThrow();
      await expect(addCongregationHost(f.client, { origin: ORIGIN, summaryCredit: bad as string, confirm: true })).rejects.toThrow("Congregation host failed");
      await expect(setSummaryCredit(f.client, { summaryCredit: bad as string, confirm: true })).rejects.toThrow("Congregation host failed");
    }
    await expect(setSummaryCredit(f.client, { summaryCredit: CREDIT, confirm: false })).rejects.toThrow("Congregation host failed");
    const hosts = (await f.db.select().from(s.tenantHost)).length;
    expect((await setSummaryCredit(f.client, { summaryCredit: CREDIT, confirm: true })).status).toBe("configured");
    expect((await f.db.select().from(s.tenantHost)).length).toBe(hosts);
    expect((await f.client.query<{ summary_credit: string }>("select summary_credit from tenant where id='crc'")).rows[0].summary_credit).toBe(CREDIT);
  });

  it("refuses a missing confirmation and anything that is not an exact https origin on a real name", async () => {
    const f = await fixture();
    const before = (await f.db.select().from(s.tenantHost)).length;
    await expect(addCongregationHost(f.client, { origin: ORIGIN, summaryCredit: CREDIT, confirm: false })).rejects.toThrow("Congregation host failed");
    for (const bad of [`${ORIGIN}/`, "http://torah.fork-congregation.example", "https://torah.fork-congregation.example:8443", "https://localhost", "https://10.0.0.1",
      ["https://user", "torah.fork-congregation.example"].join("@"), "torah.fork-congregation.example", "", undefined]) {
      expect(() => hostRow(bad as string)).toThrow();
      await expect(addCongregationHost(f.client, { origin: bad as string, summaryCredit: CREDIT, confirm: true })).rejects.toThrow("Congregation host failed");
    }
    expect((await f.db.select().from(s.tenantHost)).length).toBe(before);
  });

  it("never touches CRC's own hosts and refuses a host row that already means something else", async () => {
    const f = await fixture();
    await expect(addCongregationHost(f.client, { origin: "https://torah.centralreform.org", summaryCredit: CREDIT, confirm: true })).rejects.toThrow("Congregation host failed");
    await f.client.exec("INSERT INTO tenant_host (host, tenant_id, environment, deployment, origin) VALUES ('other.fork-congregation.example', 'crc', 'preview', 'production', 'https://other.fork-congregation.example')");
    await expect(addCongregationHost(f.client, { origin: "https://other.fork-congregation.example", summaryCredit: CREDIT, confirm: true })).rejects.toThrow("Congregation host failed");
  });

  it("refuses a normal runtime client", async () => {
    const f = await fixture();
    await f.client.exec("CREATE ROLE host_runtime LOGIN; GRANT portal_runtime TO host_runtime; SET SESSION AUTHORIZATION host_runtime; SET ROLE portal_runtime");
    await expect(addCongregationHost(f.client, { origin: ORIGIN, summaryCredit: CREDIT, confirm: true })).rejects.toThrow("Congregation host failed");
    await expect(setSummaryCredit(f.client, { summaryCredit: CREDIT, confirm: true })).rejects.toThrow("Congregation host failed");
  });

  it("prints fixed CLI errors without the origin and inherits no real credentials", async () => {
    const isolated = await isolatedEnv({ CANONICAL_ORIGIN: ORIGIN });
    try {
      const result = spawnSync(process.execPath, ["scripts/add-congregation-host.mjs", "--confirm"], { env: isolated.env, encoding: "utf8" });
      expect(result.status === 1 && result.stdout === "" && !result.stderr.includes("fork-congregation") && result.stderr.includes("Congregation host failed")).toBe(true);
    } finally { await isolated.cleanup(); }
  });
});
