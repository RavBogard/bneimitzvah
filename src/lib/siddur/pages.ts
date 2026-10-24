/** Where things sit in the CRC siddur's printed book. Plain numbers and a book name, never siddur text. */
import { siddurPageLink } from "./link";

/** The siddur reader's book slug for the printed book CRC prepares from. */
export const SIDDUR_BOOK = "legacy-beit-mitzvah";
/** The Torah blessings are on printed page 22. */
export const TORAH_BLESSINGS_PAGE = 22;
/** The haftarah blessings run over printed pages 23 and 24, and the link lands on the first. */
export const HAFTARAH_BLESSINGS_PAGES = Object.freeze({ first: 23, last: 24 });

/** A link to one printed page of the CRC book, or null when `siddurUrl` is not the recognised reader or the page is missing or unusable. */
export function crcSiddurPageLink(siddurUrl: string, page: number | undefined, service?: string): string | null {
  return page === undefined ? null : siddurPageLink(siddurUrl, SIDDUR_BOOK, page, service);
}

/** The blessings links for the public reading: each is null unless `siddurUrl` is the recognised reader. */
export function blessingsLinks(siddurUrl: string): { torah: string | null; haftarah: string | null } {
  return { torah: crcSiddurPageLink(siddurUrl, TORAH_BLESSINGS_PAGE), haftarah: crcSiddurPageLink(siddurUrl, HAFTARAH_BLESSINGS_PAGES.first) };
}
