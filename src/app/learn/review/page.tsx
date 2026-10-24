import type { Metadata } from "next";
import { ReviewScreen } from "../../../components/learn/review";
import { pageTitle } from "../../../lib/site/product-name";
import { NOINDEX_META } from "../../../lib/site/indexing";
import { readPublicProductName } from "../../../server/public-site/names";
import { publicMetadataBase } from "../../../lib/site/origin";

export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "Review", "Learn to lein"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
export default function ReviewPage() { return <ReviewScreen />; }
