import type { Metadata } from "next";
import { ServiceHome } from "../../../components/learn/service/home";
import { COPY } from "../../../lib/service-course/copy";
import { pageTitle } from "../../../lib/site/product-name";
import { NOINDEX_META } from "../../../lib/site/indexing";
import { readPublicProductName } from "../../../server/public-site/names";
import { publicMetadataBase } from "../../../lib/site/origin";

// Open to anyone and signed out first. Not in the site navigation or the front door yet (the release step links it once
// the prayer text lands), and noindex like the rest of the learning pages.
export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: pageTitle(await readPublicProductName(), COPY.home.title),
    description: COPY.home.intro,
    metadataBase: publicMetadataBase(), referrer: "no-referrer",
    robots: NOINDEX_META,
  };
}
export default function ServicePage() { return <ServiceHome />; }
