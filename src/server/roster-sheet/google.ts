import "server-only";
import { createPrivateKey, createSign } from "node:crypto";
import { causedBy, Unavailable } from "../logging/failure";

// The owned roster Sheet (PLAN-REVIEW ruling 43; Daniel 2026-10-21: a free service account). The
// key lives only in the encrypted GOOGLE_SHEETS_SERVICE_ACCOUNT variable Daniel set himself; it is
// parsed here, used to sign one short-lived token request, and never logged, returned or stored.
export type ServiceAccount = Readonly<{ clientEmail: string; privateKey: string }>;
export class SheetUnavailable extends Error {
  constructor(readonly code: "config" | "auth" | "write") { super("Roster sheet unavailable"); this.name = "SheetUnavailable"; }
}
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const SHEET_ID = /^[A-Za-z0-9_-]{25,100}$/;

export function parseServiceAccount(raw: unknown): ServiceAccount {
  try {
    if (typeof raw !== "string" || raw.length > 8192) throw new Unavailable("roster-sheet/key-size");
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Unavailable("roster-sheet/key-shape");
    const { type, client_email: email, private_key: key } = value as Record<string, unknown>;
    if (type !== "service_account" || typeof email !== "string" || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email) || typeof key !== "string") throw new Unavailable("roster-sheet/key-fields");
    createPrivateKey(key); // Refuse a malformed key at startup, not at the first sync.
    return Object.freeze({ clientEmail: email, privateKey: key });
    // A JSON SyntaxError's message can quote key material: the failure log never writes a SyntaxError's message.
  } catch (error) { throw causedBy(new SheetUnavailable("config"), error); }
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
async function bounded(fetcher: typeof fetch, url: string, init: RequestInit, code: "auth" | "write"): Promise<Record<string, unknown>> {
  let response: Response, text: string;
  // A network failure or timeout is reported like a refusal: Google was not reached.
  try { response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) }); text = await response.text(); }
  catch (error) { throw causedBy(new SheetUnavailable(code), error); }
  if (!response.ok || text.length > 1_000_000) {
    const reason = response.ok ? new Unavailable("roster-sheet/google-answer-size") : response.status >= 500 ? new Unavailable("roster-sheet/google-5xx") : new Unavailable("roster-sheet/google-refused");
    throw causedBy(new SheetUnavailable(code), reason);
  }
  try { const value: unknown = text ? JSON.parse(text) : {}; return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
  catch (error) { throw causedBy(new SheetUnavailable(code), error); }
}

/** A one-hour access token for the Sheets scope (RFC 7523 JWT bearer grant). */
export async function accessToken(account: ServiceAccount, fetcher: typeof fetch, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify({ iss: account.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.privateKey);
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64(signature)}` });
  const result = await bounded(fetcher, TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, "auth");
  if (typeof result.access_token !== "string" || !result.access_token) throw new SheetUnavailable("auth");
  return result.access_token;
}

export const ROSTER_COLUMNS = "J";
/** The block the portal owns on the roster tab: columns A-J, rows 1-2000. Nothing outside it is written. */
export const ROSTER_WIDTH = 10, ROSTER_MAX_ROWS = 2000;
/**
 * Replace the roster tab's contents with `rows` (header first, at most ten columns). The roster tab
 * is the Sheet's original tab (sheet id 0) wherever staff have moved or renamed it, else the first.
 * One values write covers the whole owned block that exists on the tab (A1:J2000, or fewer rows on
 * a shorter tab): the current rows, then blank cells for every owned cell below and beside them,
 * so a student removed since the last, longer write is gone. A single request either applies whole
 * or not at all, so a failed write never leaves staff a blank or half-cleared Sheet; columns past J
 * (staff notes), rows past 2000 and every other tab are never touched.
 */
export async function replaceSheet(sheetId: string, rows: readonly (readonly string[])[], token: string, fetcher: typeof fetch): Promise<void> {
  if (!SHEET_ID.test(sheetId) || rows.length < 1 || rows.length > ROSTER_MAX_ROWS - 1 || rows.some(row => row.length > ROSTER_WIDTH)) throw new SheetUnavailable("config");
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const meta = await bounded(fetcher, `${root}?fields=${encodeURIComponent("sheets.properties")}`, { method: "GET", headers: { authorization: headers.authorization } }, "write");
  const tabs = (Array.isArray(meta.sheets) ? meta.sheets : []).map(tab => (tab as { properties?: { sheetId?: unknown; title?: unknown; gridProperties?: { rowCount?: unknown } } } | null)?.properties ?? {});
  const tab = tabs.find(p => p.sheetId === 0) ?? tabs[0];
  if (typeof tab?.title !== "string" || !tab.title) throw new SheetUnavailable("write");
  // Blank only the owned rows the tab already has; writing the roster itself may grow a short tab.
  const gridRows = tab.gridProperties?.rowCount;
  const existing = typeof gridRows === "number" && Number.isSafeInteger(gridRows) && gridRows > 0 ? Math.min(gridRows, ROSTER_MAX_ROWS) : ROSTER_MAX_ROWS;
  const height = Math.max(rows.length, existing);
  const values = Array.from({ length: height }, (_, index) => { const row = rows[index] ?? []; return [...row, ...Array<string>(ROSTER_WIDTH - row.length).fill("")]; });
  const a1 = `'${tab.title.replaceAll("'", "''")}'!A1:${ROSTER_COLUMNS}${height}`;
  // RAW: nothing is read as a formula; an empty string clears its cell.
  await bounded(fetcher, `${root}/values/${encodeURIComponent(a1)}?valueInputOption=RAW`, { method: "PUT", headers, body: JSON.stringify({ range: a1, majorDimension: "ROWS", values }) }, "write");
}
