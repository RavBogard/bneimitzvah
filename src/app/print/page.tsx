import type { Metadata } from "next";
import { PrintSheetPage } from "../../components/portal/print/sheet";
import { ProductNameScope } from "../../components/portal/public-reading/product-name";
import { pageTitle } from "../../lib/site/product-name";
import { NOINDEX_META } from "../../lib/site/indexing";
import { readPublicProductName } from "../../server/public-site/names";
import { publicMetadataBase } from "../../lib/site/origin";

// The reader's print sheet (Daniel, 2026-10-23). Open to anyone, like /read: the browser picks the Shabbat and loads the
// text from the public routes, so this is a static shell. Never for search engines, whatever the indexing switch says.
export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "Print"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}

export default async function PrintPage() {
  return <ProductNameScope name={await readPublicProductName()}><PrintSheetPage /></ProductNameScope>;
}
