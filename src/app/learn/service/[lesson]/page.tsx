import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SERVICE_COURSE, lessonById, lessonOpen } from "../../../../lib/service-course/course";
import { COPY } from "../../../../lib/service-course/copy";
import { ServiceLesson } from "../../../../components/learn/service/lesson";
import { pageTitle } from "../../../../lib/site/product-name";
import { NOINDEX_META } from "../../../../lib/site/indexing";
import { readPublicProductName } from "../../../../server/public-site/names";
import { publicMetadataBase } from "../../../../lib/site/origin";

type Props = { params: Promise<{ lesson: string }> };
// Every open lesson is a static page; an unknown id, or a lesson of the strand that is not open yet, is a plain 404.
export const dynamicParams = false;
export const revalidate = 3600;
export function generateStaticParams() { return SERVICE_COURSE.lessons.filter(lesson => lessonOpen(lesson)).map(lesson => ({ lesson: lesson.id })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = lessonById((await params).lesson);
  const productName = await readPublicProductName();
  return { title: lesson ? pageTitle(productName, lesson.title, COPY.home.title) : pageTitle(productName, COPY.home.title), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
export default async function ServiceLessonPage({ params }: Props) {
  const id = (await params).lesson, lesson = lessonById(id);
  if (!lesson || !lessonOpen(lesson)) notFound();
  return <ServiceLesson id={id} />;
}
