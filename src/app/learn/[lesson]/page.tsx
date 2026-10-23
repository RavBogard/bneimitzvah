import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COURSE, lessonById } from "../../../lib/learn/course";
import { LessonScreen } from "../../../components/learn/lesson";
import { pageTitle } from "../../../lib/site/product-name";
import { NOINDEX_META } from "../../../lib/site/indexing";
import { readPublicProductName } from "../../../server/public-site/names";
import { publicMetadataBase } from "../../../lib/site/origin";

type Props = { params: Promise<{ lesson: string }> };
// Every lesson is a static page; an unknown id is a plain 404.
export const dynamicParams = false;
export const revalidate = 3600;
export function generateStaticParams() { return COURSE.lessons.map(lesson => ({ lesson: lesson.id })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = lessonById((await params).lesson);
  const productName = await readPublicProductName();
  return { title: lesson ? pageTitle(productName, lesson.title, "Learn to lein") : pageTitle(productName, "Learn to lein"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
export default async function LessonPage({ params }: Props) {
  const id = (await params).lesson;
  if (!lessonById(id)) notFound();
  return <LessonScreen id={id} />;
}
