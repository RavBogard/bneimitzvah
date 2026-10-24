/** The one reader that honours the `?book=<slug>&p=<printed page>` link format. */
import { DEFAULT_SIDDUR_URL } from "../../server/settings/validation";

const READER_ORIGIN = new URL(DEFAULT_SIDDUR_URL).origin;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VIEW = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * A link to a printed page of a book in the congregation's siddur, or null when it cannot be built honestly:
 * the siddur address is not the recognised reader (any other origin, http, credentials, a port), the page is not
 * a whole number from 1 to 9999, or the book is not a safe slug. `service` is the reader's optional service view.
 */
export function siddurPageLink(siddurUrl: string, book: string, page: number, service?: string): string | null {
  let origin: string;
  try {
    const url = new URL(siddurUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.origin !== READER_ORIGIN) return null;
    origin = url.origin;
  } catch { return null; }
  if (typeof book !== "string" || !SLUG.test(book) || !Number.isInteger(page) || page < 1 || page > 9999) return null;
  if (service !== undefined && (typeof service !== "string" || !VIEW.test(service))) return null;
  return `${origin}/?book=${book}&p=${page}${service === undefined ? "" : `&service=${encodeURIComponent(service)}`}`;
}
