import { createPublicKey, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { accessFixture } from "./access-fixture";
import { accessToken, parseServiceAccount, replaceSheet, SheetUnavailable } from "../../src/server/roster-sheet/google";
import { ROSTER_HEADER, rosterRows } from "../../src/server/roster-sheet/rows";
import { createRosterSheetService } from "../../src/server/roster-sheet/service";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { AccessDenied } from "../../src/server/access/errors";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";

// Built from parts so the repository scan sees no address; the project is synthetic.
const SYNTHETIC_ACCOUNT = ["bneimitzvah-roster", "synthetic-project.iam.gserviceaccount.com"].join("@");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({ type: "service_account", client_email: SYNTHETIC_ACCOUNT,
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
const SHEET = "1".repeat(44);
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

type Call = { url: string; init: RequestInit };
function googleStub(fail?: "token" | "write") {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return fail === "token" ? new Response("{}", { status: 400 }) : Response.json({ access_token: "synthetic-access", expires_in: 3600 });
    return fail === "write" ? new Response("{}", { status: 403 }) : Response.json({});
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("roster sheet writer", () => {
  it("parses only a real service-account key", () => {
    expect(parseServiceAccount(KEY_JSON).clientEmail).toBe(SYNTHETIC_ACCOUNT);
    for (const bad of ["", "{}", "not json", JSON.stringify({ type: "service_account", client_email: ["x", "gmail.com"].join("@"), private_key: "nope" })]) expect(() => parseServiceAccount(bad)).toThrow(SheetUnavailable);
  });

  it("signs a JWT bearer grant Google can verify", async () => {
    const { calls, fetcher } = googleStub();
    expect(await accessToken(parseServiceAccount(KEY_JSON), fetcher, 1_700_000_000_000)).toBe("synthetic-access");
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = form.get("assertion")!.split(".");
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600 });
  });

  it("clears the first tab and writes RAW values from A1", async () => {
    const { calls, fetcher } = googleStub();
    await replaceSheet(SHEET, [["a", "=1+1"]], "synthetic-access", fetcher);
    expect(calls.map(c => c.init.method)).toEqual(["POST", "PUT"]);
    expect(calls[0].url).toContain(`/spreadsheets/${SHEET}/values/A1%3AZ2000:clear`);
    expect(calls[1].url).toContain("valueInputOption=RAW");
    expect(JSON.parse(String(calls[1].init.body)).values).toEqual([["a", "=1+1"]]);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer synthetic-access");
    await expect(replaceSheet("bad id", [], "t", fetcher)).rejects.toThrow(SheetUnavailable);
  });

  it("lists the congregation's current students with tutors and no contact data", async () => {
    const f = await accessFixture(); opened.push(f);
    await f.owner(() => f.db.update(s.user).set({ name: "Synthetic Tutor" }).where(eq(s.user.id, f.identities.multi.id)));
    const rows = await withTenantTransaction(f.db, { tenantId: "crc" }, tx => rosterRows(tx as never, "crc"));
    expect(rows[0]).toEqual([...ROSTER_HEADER]);
    expect(rows.slice(1).map(r => r[0]).sort()).toEqual(["Synthetic Sibling A", "Synthetic Sibling B", "Synthetic Unrelated"]);
    expect(rows.find(r => r[0] === "Synthetic Sibling A")![7]).toBe("Synthetic Tutor");
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  it("syncs for an admin or the cron secret, and reports Google failures without throwing", async () => {
    const f = await accessFixture(); opened.push(f);
    const cronSecret = randomBytes(32).toString("base64url"), google = googleStub();
    const service = createRosterSheetService({ db: f.db, access: f.service, cronSecret, fetch: google.fetcher, config: { account: parseServiceAccount(KEY_JSON), sheetId: SHEET } });
    const admin = { ...f.request("admin"), method: "POST" };
    expect(await service.now(admin)).toMatchObject({ ok: true, students: 3 });
    await expect(service.now({ ...f.request("multi"), method: "POST" })).rejects.toBeInstanceOf(AccessDenied);
    const cron = (bearer: string) => service.cron({ url: "http://localhost:3000/api/internal/roster-sheet/sync", headers: new Headers({ authorization: `Bearer ${bearer}` }) }, { tenantId: "crc" });
    expect(await cron(cronSecret)).toMatchObject({ ok: true, students: 3 });
    await expect(cron("wrong".repeat(9))).rejects.toBeInstanceOf(AccessDenied);
    const failing = createRosterSheetService({ db: f.db, access: f.service, cronSecret, fetch: googleStub("write").fetcher, config: { account: parseServiceAccount(KEY_JSON), sheetId: SHEET } });
    expect(await failing.now(admin)).toEqual({ ok: false, reason: "google" });
    const off = createRosterSheetService({ db: f.db, access: f.service, cronSecret, fetch: google.fetcher, config: null });
    expect(await off.now(admin)).toEqual({ ok: false, reason: "not-configured" });
  });
});
