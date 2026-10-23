import type { Metadata } from "next";
import { CourseHome } from "../../components/learn/home";
import { pageTitle } from "../../lib/site/product-name";
import { publicRobots } from "../../lib/site/indexing";
import { readPublicProductName } from "../../server/public-site/names";
import { publicMetadataBase } from "../../lib/site/origin";

// Open to anyone and signed out first, like /read; search engines only once PUBLIC_INDEXING is on (v1.5.0).
export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: pageTitle(await readPublicProductName(), "Learn to lein"),
    description: "Hear the phrases, then lein a verse of this week's reading.",
    metadataBase: publicMetadataBase(), referrer: "no-referrer",
    robots: publicRobots(),
  };
}
export default function LearnPage() { return <CourseHome />; }
