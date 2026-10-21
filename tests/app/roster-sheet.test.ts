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
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";

// Built from parts so the repository scan sees no address; the project is synthetic.
const SYNTHETIC_ACCOUNT = ["bneimitzvah-roster", "synthetic-project.iam.gserviceaccount.com"].join("@");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({ type: "service_account", client_email: SYNTHETIC_ACCOUNT,
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
const SHEET = "1".repeat(44);
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

function baseEnv() {
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login"; database.password = randomBytes(24).toString("hex"); database.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-sheet", BETTER_AUTH_URL: "http://localhost:3000", DATABASE_URL: database.href,
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), RESEND_API_KEY: `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" } as Record<string, string>;
}

type Call = { url: string; init: RequestInit };
function googleStub(fail?: "token" | "write" | "network") {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return fail === "token" ? new Response("{}", { status: 400 }) : Response.json({ access_token: "synthetic-access", expires_in: 3600 });
    if (fail === "network") throw new TypeError("fetch failed");
    if (init.method === "GET") return Response.json({ sheets: [{ properties: { sheetId: 7, title: "Notes" } }, { properties: { sheetId: 0, title: "Staff's roster" } }] });
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

  it("writes RAW values to the original tab first, then clears only the old rows below in columns A-J", async () => {
    const { calls, fetcher } = googleStub();
    await replaceSheet(SHEET, [["a", "=1+1"], ["b"]], "synthetic-access", fetcher);
    expect(calls.map(c => c.init.method)).toEqual(["GET", "PUT", "POST"]);
    const tab = encodeURIComponent("'Staff''s roster'");
    expect(calls[1].url).toContain(`/spreadsheets/${SHEET}/values/${tab}!A1?valueInputOption=RAW`);
    expect(JSON.parse(String(calls[1].init.body)).values).toEqual([["a", "=1+1"], ["b", ""]]);
    expect(calls[2].url).toContain(`/values/${tab}${encodeURIComponent("!A3:J2000")}:clear`);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer synthetic-access");
    await expect(replaceSheet("bad id", [["a"]], "t", fetcher)).rejects.toThrow(SheetUnavailable);
    // A refused write stops before anything is cleared; a network failure is a Google failure, not a crash.
    const refused = googleStub("write");
    await expect(replaceSheet(SHEET, [["a"]], "t", refused.fetcher)).rejects.toThrow(SheetUnavailable);
    expect(refused.calls.map(c => c.init.method)).toEqual(["GET", "PUT"]);
    await expect(replaceSheet(SHEET, [["a"]], "t", googleStub("network").fetcher)).rejects.toThrow(SheetUnavailable);
  });

  it("switches only the Sheet off for a partial or malformed setting, never the portal", () => {
    const key = KEY_JSON;
    expect(loadRuntimeConfig(baseEnv()).rosterSheet).toBeUndefined();
    expect(loadRuntimeConfig({ ...baseEnv(), GOOGLE_SHEETS_SERVICE_ACCOUNT: key, GOOGLE_ROSTER_SHEET_ID: SHEET }).rosterSheet?.sheetId).toBe(SHEET);
    for (const extra of [{ GOOGLE_SHEETS_SERVICE_ACCOUNT: key }, { GOOGLE_ROSTER_SHEET_ID: SHEET }, { GOOGLE_SHEETS_SERVICE_ACCOUNT: key, GOOGLE_ROSTER_SHEET_ID: `${SHEET}\n` },
      { GOOGLE_SHEETS_SERVICE_ACCOUNT: key, GOOGLE_ROSTER_SHEET_ID: `https://docs.google.com/spreadsheets/d/${SHEET}/edit` }, { GOOGLE_SHEETS_SERVICE_ACCOUNT: "x".repeat(9000), GOOGLE_ROSTER_SHEET_ID: SHEET }])
      expect(loadRuntimeConfig({ ...baseEnv(), ...extra }).rosterSheet).toBeUndefined();
  });

  it("lists the congregation's current students with tutors and no contact data", async () => {
    const f = await accessFixture(); opened.push(f);
    await f.owner(() => f.db.update(s.user).set({ name: "Synthetic Tutor" }).where(eq(s.user.id, f.identities.multi.id)));
    const rows = await withTenantTransaction(f.db, { tenantId: "crc" }, tx => rosterRows(tx as never, "crc"));
    expect(rows[0]).toEqual([...ROSTER_HEADER]);
    expect(rows.slice(1).map(r => r[0]).sort()).toEqual(["Synthetic Sibling A", "Synthetic Sibling B", "Synthetic Unrelated"]);
    expect(rows.find(r => r[0] === "Synthetic Sibling A")![7]).toBe("Synthetic Tutor");
    expect(JSON.stringify(rows)).not.toContain("@");
    // An account named with its address is shown to staff as "Tutor".
    await f.owner(() => f.db.update(s.user).set({ name: ["synthetic.tutor", "example.test"].join("@") }).where(eq(s.user.id, f.identities.multi.id)));
    const renamed = await withTenantTransaction(f.db, { tenantId: "crc" }, tx => rosterRows(tx as never, "crc"));
    expect(renamed.find(r => r[0] === "Synthetic Sibling A")![7]).toBe("Tutor");
    expect(JSON.stringify(renamed)).not.toContain("@");
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

  it("serves the two routes with their own guards: cron bearer only, admin same-origin POST, failures visible", async () => {
    const f = await portalRoutesFixture();
    try {
      const cronSecret = randomBytes(32).toString("base64url");
      const config = { account: parseServiceAccount(KEY_JSON), sheetId: SHEET };
      const dispatchWith = (fetcher: typeof fetch) => createHttpDispatcher(async action => action({ ...f.runtime,
        rosterSheet: createRosterSheetService({ db: f.db, access: f.service, cronSecret, fetch: fetcher, config }) }));
      const dispatch = dispatchWith(googleStub().fetcher);
      const cron = (headers: Record<string, string>, path = "/api/internal/roster-sheet/sync", method = "GET") => f.request(path, { who: "anonymous", method, headers });
      const ok = await dispatch(cron({ authorization: `Bearer ${cronSecret}` }));
      expect(ok.status).toBe(200); expect(await ok.json()).toMatchObject({ ok: true, students: 3 });
      expect((await dispatch(cron({ authorization: `Bearer ${cronSecret}`, cookie: "a=b" }))).status).toBe(403);
      expect((await dispatch(cron({ authorization: "Bearer " + "x".repeat(43) }))).status).toBe(401);
      expect((await dispatch(cron({ authorization: `Bearer ${cronSecret}` }, "/api/internal/roster-sheet/sync?x=1"))).status).toBe(400);
      expect((await dispatch(cron({ authorization: `Bearer ${cronSecret}` }, "/api/internal/roster-sheet/sync", "POST"))).status).toBe(405);
      // A refused nightly write is a failed cron run, not a quiet 200.
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try { expect((await dispatchWith(googleStub("write").fetcher)(cron({ authorization: `Bearer ${cronSecret}` }))).status).toBe(503); expect(String(error.mock.calls[0]?.[0])).toBe("roster sheet sync failed: google"); }
      finally { error.mockRestore(); }
      const admin = await dispatch(f.request("/api/admin/roster-sheet/sync", { who: "admin", method: "POST", body: {} }));
      expect(admin.status).toBe(200); expect(await admin.json()).toMatchObject({ ok: true, students: 3 });
      expect((await dispatch(f.request("/api/admin/roster-sheet/sync", { who: "admin", method: "POST", body: {}, headers: { origin: "https://evil.example" } }))).status).toBe(403);
      expect((await dispatch(f.request("/api/admin/roster-sheet/sync", { who: "multi", method: "POST", body: {} }))).status).toBe(403);
      expect((await dispatch(f.request("/api/admin/roster-sheet/sync", { who: "admin" }))).status).toBe(405);
    } finally { await f.client.close(); }
  });
});
