import type { Metadata } from "next";
import { QuickTenScreen } from "../../../../../components/learn/service/practice";
import { COPY } from "../../../../../lib/service-course/copy";
import { pageTitle } from "../../../../../lib/site/product-name";
import { NOINDEX_META } from "../../../../../lib/site/indexing";
import { readPublicProductName } from "../../../../../server/public-site/names";
import { publicMetadataBase } from "../../../../../lib/site/origin";

// Quick ten for the course (2.0 SC3): reading only, opened by the course's own progress.
export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), COPY.quickTen.title, COPY.home.title), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
export default function ServiceQuickTenPage() { return <QuickTenScreen />; }
