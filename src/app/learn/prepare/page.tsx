import type { Metadata } from "next";
import { PassagePreparation } from "../../../components/learn/passage-preparation";
import { preparationTarget } from "../../../lib/learn/passage-preparation";
import { pageTitle } from "../../../lib/site/product-name";
import { publicRobots } from "../../../lib/site/indexing";
import { readPublicProductName } from "../../../server/public-site/names";
import { publicMetadataBase } from "../../../lib/site/origin";

export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "Prepare a passage"), description: "Prepare the parts, connect the verses and try a reading without the recording.", metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: publicRobots() };
}

export default async function PreparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PassagePreparation target={preparationTarget(await searchParams)} />;
}
