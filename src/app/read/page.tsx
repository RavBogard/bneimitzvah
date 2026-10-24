import type { Metadata } from "next";
import { PublicReading } from "../../components/portal/public-reading/view";
import { ProductNameScope } from "../../components/portal/public-reading/product-name";
import { pageTitle } from "../../lib/site/product-name";
import { publicRobots } from "../../lib/site/indexing";
import { readPublicProductName } from "../../server/public-site/names";
import { publicMetadataBase } from "../../lib/site/origin";

// Open to anyone (Daniel, 2026-10-22). Search engines only once PUBLIC_INDEXING is on (Daniel decides when).
// A static shell: the browser picks the Shabbat, so the CDN serves this page itself. It regenerates hourly so the product name stays current.
export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: pageTitle(await readPublicProductName(), "This week’s reading"),
    description: "This Shabbat’s Torah portion and haftarah with trope, translation and recordings.",
    metadataBase: publicMetadataBase(), referrer: "no-referrer",
    robots: publicRobots(),
  };
}

export default async function ReadPage() {
  return <ProductNameScope name={await readPublicProductName()}><PublicReading /></ProductNameScope>;
}
