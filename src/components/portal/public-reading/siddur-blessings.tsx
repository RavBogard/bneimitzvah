import { SiddurLink } from "../siddur-link";
import { DEFAULT_SIDDUR_URL } from "../../../server/settings/validation";
import { blessingsLinks, HAFTARAH_BLESSINGS_PAGES, TORAH_BLESSINGS_PAGE } from "../../../lib/siddur/pages";

/**
 * Where the Torah and haftarah blessings are in the CRC siddur, shown on the public reading. The public pages are served
 * only for CRC's own host, so the siddur address is CRC's recognised reader; any other address builds no link and shows nothing.
 */
export function SiddurBlessings({ torah, haftarah, siddurUrl = DEFAULT_SIDDUR_URL }: { torah: boolean; haftarah: boolean; siddurUrl?: string }) {
  const links = blessingsLinks(siddurUrl), torahLink = torah ? links.torah : null, haftarahLink = haftarah ? links.haftarah : null;
  if (!torahLink && !haftarahLink) return null;
  return <p className="field-help siddur-blessings" data-siddur-blessings="">
    {torahLink && <SiddurLink href={torahLink}>Torah blessings: siddur page {TORAH_BLESSINGS_PAGE}</SiddurLink>}
    {haftarahLink && <SiddurLink href={haftarahLink}>Haftarah blessings: siddur page {HAFTARAH_BLESSINGS_PAGES.first}, after Mi Shebeirach</SiddurLink>}
  </p>;
}
