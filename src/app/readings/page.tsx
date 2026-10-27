import type { Metadata } from "next";
import { ReadingsIndex } from "../../components/portal/readings-index";
import { ProductNameScope } from "../../components/portal/public-reading/product-name";
import { pageTitle } from "../../lib/site/product-name";
import { publicRobots } from "../../lib/site/indexing";
import { readPublicProductName } from "../../server/public-site/names";
import { publicMetadataBase } from "../../lib/site/origin";

// Open to anyone, like /read. A static shell: the browser asks for the calendar, so the CDN serves this page itself and it regenerates hourly.
export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: pageTitle(await readPublicProductName(), "Readings"),
    description: "Every parashah, holiday and passage, with the Shabbat each is next read.",
    metadataBase: publicMetadataBase(), referrer: "no-referrer",
    robots: publicRobots(),
  };
}

export default async function ReadingsPage() {
  return <ProductNameScope name={await readPublicProductName()}><ReadingsIndex /></ProductNameScope>;
}
