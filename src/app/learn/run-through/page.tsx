import type { Metadata } from "next";
import { RunThroughScreen } from "../../../components/learn/run-through";
import { pageTitle } from "../../../lib/site/product-name";
import { NOINDEX_META } from "../../../lib/site/indexing";
import { readPublicProductName } from "../../../server/public-site/names";
import { publicMetadataBase } from "../../../lib/site/origin";

// 1.9 N19: a signed-in student's own Run-through. The page is the same for everyone; the reading is the student's own, read in the browser.
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "Run-through", "Learn to lein"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
export default async function RunThroughPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const kind = (await searchParams).kind;
  return <RunThroughScreen kind={kind === "haftarah" ? "haftarah" : kind === "torah" ? "torah" : null} />;
}
