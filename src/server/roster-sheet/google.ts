import "server-only";
import { createPrivateKey, createSign } from "node:crypto";

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
    if (typeof raw !== "string" || raw.length > 8192) throw 0;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw 0;
    const { type, client_email: email, private_key: key } = value as Record<string, unknown>;
    if (type !== "service_account" || typeof email !== "string" || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email) || typeof key !== "string") throw 0;
    createPrivateKey(key); // Refuse a malformed key at startup, not at the first sync.
    return Object.freeze({ clientEmail: email, privateKey: key });
  } catch { throw new SheetUnavailable("config"); }
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
async function bounded(fetcher: typeof fetch, url: string, init: RequestInit, code: "auth" | "write"): Promise<Record<string, unknown>> {
  let response: Response, text: string;
  // A network failure or timeout is reported like a refusal: Google was not reached.
  try { response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) }); text = await response.text(); }
  catch { throw new SheetUnavailable(code); }
  if (!response.ok || text.length > 1_000_000) throw new SheetUnavailable(code);
  try { const value: unknown = text ? JSON.parse(text) : {}; return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
  catch { throw new SheetUnavailable(code); }
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
/**
 * Replace the roster tab's contents with `rows` (header first, at most ten columns). The roster tab
 * is the Sheet's original tab (sheet id 0) wherever staff have moved or renamed it, else the first.
 * The new rows are written first and only the old rows below them are cleared after, so a failed
 * write never leaves staff a blank Sheet; columns past J (staff notes) are never touched.
 */
export async function replaceSheet(sheetId: string, rows: readonly (readonly string[])[], token: string, fetcher: typeof fetch): Promise<void> {
  if (!SHEET_ID.test(sheetId) || rows.length < 1 || rows.length > 1999 || rows.some(row => row.length > 10)) throw new SheetUnavailable("config");
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const meta = await bounded(fetcher, `${root}?fields=${encodeURIComponent("sheets.properties(sheetId,title)")}`, { method: "GET", headers: { authorization: headers.authorization } }, "write");
  const tabs = (Array.isArray(meta.sheets) ? meta.sheets : []).map(tab => (tab as { properties?: { sheetId?: unknown; title?: unknown } }).properties ?? {});
  const tab = tabs.find(p => p.sheetId === 0) ?? tabs[0];
  if (typeof tab?.title !== "string" || !tab.title) throw new SheetUnavailable("write");
  const quoted = `'${tab.title.replaceAll("'", "''")}'`;
  const range = (a1: string) => `${root}/values/${encodeURIComponent(`${quoted}!${a1}`)}`;
  const width = Math.max(...rows.map(row => row.length));
  const padded = rows.map(row => [...row, ...Array(width - row.length).fill("")]);
  await bounded(fetcher, `${range("A1")}?valueInputOption=RAW`, { method: "PUT", headers, body: JSON.stringify({ range: `${quoted}!A1`, majorDimension: "ROWS", values: padded }) }, "write");
  await bounded(fetcher, `${range(`A${rows.length + 1}:${ROSTER_COLUMNS}2000`)}:clear`, { method: "POST", headers, body: "{}" }, "write");
}
