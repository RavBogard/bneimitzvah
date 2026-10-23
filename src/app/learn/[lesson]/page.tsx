import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COURSE, lessonById } from "../../../lib/learn/course";
import { LessonScreen } from "../../../components/learn/lesson";

type Props = { params: Promise<{ lesson: string }> };
// Every lesson is a static page; an unknown id is a plain 404.
export const dynamicParams = false;
export function generateStaticParams() { return COURSE.lessons.map(lesson => ({ lesson: lesson.id })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = lessonById((await params).lesson);
  return { title: lesson ? `${lesson.title} | Learn to lein` : "Learn to lein", referrer: "no-referrer",
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } };
}
export default async function LessonPage({ params }: Props) {
  const id = (await params).lesson;
  if (!lessonById(id)) notFound();
  return <LessonScreen id={id} />;
}
