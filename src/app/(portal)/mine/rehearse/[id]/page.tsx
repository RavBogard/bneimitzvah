import type { Metadata } from "next";
import { SavedRehearsalPage } from "../../../../../components/portal/saved/rehearsal";
import { NOINDEX_META } from "../../../../../lib/site/indexing";

export const metadata: Metadata = { title: "Run-through · My Readings", robots: NOINDEX_META, referrer: "no-referrer" };
export default async function SavedReadingRunThrough({ params }: { params: Promise<{ id: string }> }) {
  return <SavedRehearsalPage id={(await params).id} />;
}
