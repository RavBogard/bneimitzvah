/**
 * Where sign-in may send a person back to (release 1.9 N20): a same-origin relative address on one of a few
 * pages, checked the same way in the browser and on the server. The address is carried in /sign-in's
 * `return` query, in the sealed sign-in code binding and in the auth SDK's stored Google state; every hop
 * checks it again, and anything this refuses means the default landing.
 *
 * Refused: anything but printable ASCII (so no spaces, control characters or Unicode a browser could fold
 * into a slash or a host), a scheme or host of any kind (`//`, `https:`, `javascript:`), a backslash, a
 * fragment, any percent-encoding in the path (so no encoded slash, backslash, dot or host), an encoded
 * control character or a stray `%` in the query, any query character URLSearchParams would not write, a path off
 * the list, a query on a page that takes none, and anything the URL parser would rewrite (dot segments).
 */
export const RETURN_ADDRESS_MAX = 1024;
/** The pages sign-in may return to; the reader keeps its query (the reading, the lens, the verse, a selection) and so does /readings (its search and add flag); /mine takes none. */
const PAGES = new Set(["/", "/account", "/read", "/mine", "/readings"]);
const KEEPS_QUERY = new Set(["/read", "/readings"]);
const BASE = "https://return-address.invalid";

export function returnAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > RETURN_ADDRESS_MAX) return null;
  if (!/^[\x21-\x7e]+$/.test(value)) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("#")) return null;
  const mark = value.indexOf("?"), path = mark === -1 ? value : value.slice(0, mark), search = mark === -1 ? "" : value.slice(mark);
  if (path.includes("%") || !PAGES.has(path)) return null;
  if (search && (!KEEPS_QUERY.has(path) || search === "?")) return null;
  // The query as URLSearchParams writes it: letters, digits, `*-._~`, `+` for a space, `%` escapes, `=` and `&`.
  if (search && !/^\?[A-Za-z0-9*\-._~%+=&]+$/.test(search)) return null;
  if (/%(?:[01][0-9a-f]|7f)/i.test(search) || /%(?![0-9a-f]{2})/i.test(search)) return null;
  let url: URL;
  try { url = new URL(value, BASE); } catch { return null; }
  if (url.origin !== BASE || url.username || url.password || url.hash || url.pathname + url.search !== value) return null;
  return value;
}

/** /sign-in, carrying a return address when there is a valid one. */
export function signInAddress(back: string | null | undefined): string {
  const checked = returnAddress(back);
  return checked && checked !== "/" ? `/sign-in?${new URLSearchParams([["return", checked]]).toString()}` : "/sign-in";
}

/** The page the browser is on now, as a return address, or null when it is not one sign-in returns to. */
export function currentReturnAddress(): string | null {
  try { return returnAddress(window.location.pathname + window.location.search); } catch { return null; }
}
