import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COURSE, practiceById } from "../../../../lib/learn/course";
import { QuickTenScreen } from "../../../../components/learn/quick-ten";
import { pageTitle } from "../../../../lib/site/product-name";
import { readPublicProductName } from "../../../../server/public-site/names";

type Props = { params: Promise<{ id: string }> };
// Every practice run is a static page; an unknown id is a plain 404.
export const dynamicParams = false;
export const revalidate = 3600;
export function generateStaticParams() { return COURSE.practice.map(practice => ({ id: practice.id })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const practice = practiceById((await params).id);
  return { title: practice ? pageTitle(await readPublicProductName(), practice.title, "Learn to lein") : "Learn to lein", referrer: "no-referrer",
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } };
}
export default async function PracticePage({ params }: Props) {
  const id = (await params).id;
  if (!practiceById(id)) notFound();
  return <QuickTenScreen id={id} />;
}
