import type { Metadata } from "next";
import { BookletPage } from "../../../../components/portal/print/booklet";
import { ProductNameScope } from "../../../../components/portal/public-reading/product-name";
import { pageTitle } from "../../../../lib/site/product-name";
import { NOINDEX_META } from "../../../../lib/site/indexing";
import { readPublicProductName } from "../../../../server/public-site/names";
import { publicMetadataBase } from "../../../../lib/site/origin";

// A student's study booklet (replacing the study-guide booklet, Track B). A static shell: the browser opens it through
// /api/students/{id}/booklet with the viewer's own session and renders it to print; nothing is stored. Never for search engines.
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "Study booklet"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}

export default async function StudyBookletPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <ProductNameScope name={await readPublicProductName()}><BookletPage studentId={studentId} /></ProductNameScope>;
}
