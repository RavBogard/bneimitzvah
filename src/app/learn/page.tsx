import type { Metadata } from "next";
import { CourseHome } from "../../components/learn/home";

// Open to anyone and signed out first, like /read; not for search engines until beta.
export const metadata: Metadata = {
  title: "Learn to lein | CRC Torah",
  description: "Hear the phrases, then lein a verse of this week's reading.",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export default function LearnPage() { return <CourseHome />; }
