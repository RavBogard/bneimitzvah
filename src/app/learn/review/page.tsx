import type { Metadata } from "next";
import { ReviewScreen } from "../../../components/learn/review";

export const metadata: Metadata = {
  title: "Review | Learn to lein", referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export default function ReviewPage() { return <ReviewScreen />; }
