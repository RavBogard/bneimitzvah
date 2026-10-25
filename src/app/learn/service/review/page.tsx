import type { Metadata } from "next";
import { ReviewScreen } from "../../../../components/learn/service/practice";
import { COPY } from "../../../../lib/service-course/copy";
import { pageTitle } from "../../../../lib/site/product-name";
import { NOINDEX_META } from "../../../../lib/site/indexing";
import { readPublicProductName } from "../../../../server/public-site/names";
import { publicMetadataBase } from "../../../../lib/site/origin";

// The review of the course's cards (2.0 SC3): public and signed out, from this browser's progress.
export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), COPY.review.title, COPY.home.title), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
export default function ServiceReviewPage() { return <ReviewScreen />; }
