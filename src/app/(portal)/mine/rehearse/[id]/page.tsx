import type { Metadata } from "next";
import { SavedRehearsalPage } from "../../../../../components/portal/saved/rehearsal";
import { NOINDEX_META } from "../../../../../lib/site/indexing";
import { signedInTitle } from "../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Run-through"), robots: NOINDEX_META, referrer: "no-referrer" };
export default async function SavedReadingRunThrough({ params }: { params: Promise<{ id: string }> }) {
  return <SavedRehearsalPage id={(await params).id} />;
}
