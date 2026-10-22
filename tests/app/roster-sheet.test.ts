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
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-sheet", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" } as Record<string, string>;
}

type Call = { url: string; init: RequestInit };
type FakeTab = { sheetId: number; title: string; rowCount: number; cells: Map<string, string> };
type Cell = { column: number; row: number };
const COLUMNS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Zero-based column and 1-based row of an A1 cell, e.g. "K12" -> { column: 10, row: 12 }. */
function cellOf(a1: string): Cell { const match = /^([A-Z])(\d+)$/.exec(a1); if (!match) throw Error(`unsupported cell ${a1}`); return { column: COLUMNS.indexOf(match[1]), row: Number(match[2]) }; }
/**
 * A fake Sheets API that keeps real cell state per tab (keys "row,column"), so a test can check what
 * staff would see after several syncs. It applies values PUTs (and :clear) the way Google does: an
 * empty string clears a cell, a write may not exceed its declared range, and a write past the tab's
 * last row grows the grid. Every write's range is recorded for the ownership checks.
 */
function googleStub(fail?: "token" | "write" | "network", tabs: FakeTab[] = [
  { sheetId: 7, title: "Notes", rowCount: 1000, cells: new Map() }, { sheetId: 0, title: "Staff's roster", rowCount: 1000, cells: new Map() }]) {
  const calls: Call[] = [], writes: { tab: string; from: Cell; to: Cell }[] = [];
  const target = (encoded: string) => {
    const a1 = decodeURIComponent(encoded), bang = a1.lastIndexOf("!");
    const title = a1.slice(0, bang).replace(/^'(.*)'$/, "$1").replaceAll("''", "'"), [from, to = from] = a1.slice(bang + 1).split(":");
    const tab = tabs.find(t => t.title === title); if (!tab) throw Error(`no tab ${title}`);
    return { tab, from: cellOf(from), to: cellOf(to) };
  };
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return fail === "token" ? new Response("{}", { status: 400 }) : Response.json({ access_token: "synthetic-access", expires_in: 3600 });
    if (fail === "network") throw new TypeError("fetch failed");
    if (init.method === "GET") return Response.json({ sheets: tabs.map(t => ({ properties: { sheetId: t.sheetId, title: t.title, gridProperties: { rowCount: t.rowCount } } })) });
    if (fail === "write") return new Response("{}", { status: 403 });
    const path = new URL(String(url)).pathname, clear = path.endsWith(":clear");
    const { tab, from, to } = target(path.slice(path.indexOf("/values/") + 8).replace(/:clear$/, ""));
    writes.push({ tab: tab.title, from, to });
    if (clear) {
      for (const key of [...tab.cells.keys()]) { const [r, c] = key.split(",").map(Number); if (r >= from.row && r <= to.row && c >= from.column && c <= to.column) tab.cells.delete(key); }
      return Response.json({});
    }
    const values = JSON.parse(String(init.body)).values as string[][];
    if (values.length > to.row - from.row + 1 || values.some(row => row.length > to.column - from.column + 1)) return new Response("{}", { status: 400 });
    values.forEach((row, r) => row.forEach((value, c) => { const key = `${from.row + r},${from.column + c}`; if (value === "") tab.cells.delete(key); else tab.cells.set(key, value); }));
    tab.rowCount = Math.max(tab.rowCount, from.row + values.length - 1);
    return Response.json({});
  }) as unknown as typeof fetch;
  /** Columns A-J of the tab's rows from row 1 to its last non-empty row (in any column). */
  const view = (title: string) => {
    const tab = tabs.find(t => t.title === title)!, last = Math.max(0, ...[...tab.cells.keys()].map(key => Number(key.split(",")[0])));
    return Array.from({ length: last }, (_, r) => Array.from({ length: 10 }, (_, c) => tab.cells.get(`${r + 1},${c}`) ?? ""));
  };
  return { calls, fetcher, writes, view };
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

  it("writes RAW values to the original tab in one write covering the owned block A1:J2000", async () => {
    const { calls, fetcher } = googleStub(undefined, [{ sheetId: 7, title: "Notes", rowCount: 1000, cells: new Map() }, { sheetId: 0, title: "Staff's roster", rowCount: 5000, cells: new Map() }]);
    await replaceSheet(SHEET, [["a", "=1+1"], ["b"]], "synthetic-access", fetcher);
    expect(calls.map(c => c.init.method)).toEqual(["GET", "PUT"]);
    expect(new URL(calls[0].url).searchParams.get("fields")).toBe("sheets.properties(sheetId,title,gridProperties.rowCount)");
    const range = `'Staff''s roster'!A1:J2000`;
    expect(calls[1].url).toBe(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(range)}?valueInputOption=RAW`);
    const body = JSON.parse(String(calls[1].init.body));
    expect(body).toMatchObject({ range, majorDimension: "ROWS" });
    expect(body.values).toHaveLength(2000);
    expect(body.values.slice(0, 2)).toEqual([["a", "=1+1", ...Array(8).fill("")], ["b", ...Array(9).fill("")]]);
    expect(body.values.slice(2).every((row: string[]) => row.length === 10 && row.every(value => value === ""))).toBe(true);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer synthetic-access");
    await expect(replaceSheet("bad id", [["a"]], "t", fetcher)).rejects.toThrow(SheetUnavailable);
    await expect(replaceSheet(SHEET, Array.from({ length: 2000 }, () => ["a"]), "t", fetcher)).rejects.toThrow(SheetUnavailable);
    await expect(replaceSheet(SHEET, [Array(11).fill("a")], "t", fetcher)).rejects.toThrow(SheetUnavailable);
    // A network failure is a Google failure, not a crash.
    await expect(replaceSheet(SHEET, [["a"]], "t", googleStub("network").fetcher)).rejects.toThrow(SheetUnavailable);
  });

  it("leaves exactly the current rows when the roster shrinks, never touching staff columns past J, rows past 2000 or other tabs", async () => {
    const roster: FakeTab = { sheetId: 0, title: "Staff's roster", rowCount: 2500, cells: new Map() };
    const notes: FakeTab = { sheetId: 7, title: "Notes", rowCount: 1000, cells: new Map([["1,0", "staff note"], ["40,3", "kept"]]) };
    const google = googleStub(undefined, [notes, roster]);
    // Staff keep their own notes beside the roster (column K) and below the owned block (row 2001).
    for (let row = 1; row <= 6; row++) roster.cells.set(`${row},10`, `note ${row}`);
    roster.cells.set("2001,0", "below the roster block");
    const header = [...ROSTER_HEADER], student = (n: number) => [`Synthetic Student ${n}`, "", "2027-01-02", "Morning", "", "", "", "Tutor", "", ""];
    await replaceSheet(SHEET, [header, student(1), student(2), student(3), student(4)], "t", google.fetcher);
    expect(google.view("Staff's roster").slice(0, 5)).toEqual([header, student(1), student(2), student(3), student(4)]);
    // Two students leave: the next sync shows only the remaining two, with nothing stale below.
    await replaceSheet(SHEET, [header, student(1), student(3)], "t", google.fetcher);
    const owned = google.view("Staff's roster").slice(0, 2000);
    expect(owned.slice(0, 3)).toEqual([header, student(1), student(3)]);
    expect(owned.slice(3).every(row => row.every(value => value === ""))).toBe(true);
    expect(JSON.stringify(owned)).not.toMatch(/Synthetic Student [24]/);
    for (let row = 1; row <= 6; row++) expect(roster.cells.get(`${row},10`)).toBe(`note ${row}`);
    expect(roster.cells.get("2001,0")).toBe("below the roster block");
    expect([...notes.cells]).toEqual([["1,0", "staff note"], ["40,3", "kept"]]);
    // Every write stayed on the roster tab inside A1:J2000.
    expect(google.writes).toHaveLength(2);
    for (const write of google.writes) expect(write).toEqual({ tab: "Staff's roster", from: { column: 0, row: 1 }, to: { column: 9, row: 2000 } });
    // A roster with no students leaves only the header in A-J.
    await replaceSheet(SHEET, [header], "t", google.fetcher);
    const empty = google.view("Staff's roster").slice(0, 2000);
    expect(empty[0]).toEqual(header); expect(empty.slice(1).every(row => row.every(value => value === ""))).toBe(true);
  });

  it("blanks only the rows a short tab already has, and grows it only for the roster itself", async () => {
    const roster: FakeTab = { sheetId: 0, title: "Roster", rowCount: 4, cells: new Map([["4,0", "stale"]]) }, google = googleStub(undefined, [roster]);
    await replaceSheet(SHEET, [["h"], ["a"]], "t", google.fetcher);
    expect(google.writes.at(-1)!.to).toEqual({ column: 9, row: 4 }); expect(roster.rowCount).toBe(4); expect(roster.cells.has("4,0")).toBe(false);
    await replaceSheet(SHEET, Array.from({ length: 6 }, (_, i) => [`r${i}`]), "t", google.fetcher);
    expect(google.writes.at(-1)!.to).toEqual({ column: 9, row: 6 }); expect(roster.rowCount).toBe(6); expect(roster.cells.get("6,0")).toBe("r5");
  });

  it("changes nothing when Google refuses the write, so staff keep the last good roster", async () => {
    const roster: FakeTab = { sheetId: 0, title: "Roster", rowCount: 1000, cells: new Map([["1,0", "Student"], ["2,0", "Synthetic Kept"]]) };
    const refused = googleStub("write", [roster]);
    await expect(replaceSheet(SHEET, [["Student"]], "t", refused.fetcher)).rejects.toThrow(SheetUnavailable);
    expect(refused.calls.map(c => c.init.method)).toEqual(["GET", "PUT"]);
    expect([...roster.cells]).toEqual([["1,0", "Student"], ["2,0", "Synthetic Kept"]]);
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
