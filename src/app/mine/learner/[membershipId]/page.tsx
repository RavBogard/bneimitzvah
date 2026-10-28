import type { Metadata } from "next";
import { LearnerShelf } from "../../../../components/portal/mine/learner-shelf";
import { signedInTitle } from "../../../../lib/site/signed-in-title";

/** A learner's shelf as the tutor who claims them, or the rabbi, sees it (plan D7). The tab title never carries the learner's name. */
export const metadata: Metadata = { title: signedInTitle("A learner’s readings") };

export default async function LearnerShelfPage({ params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = await params;
  return <LearnerShelf membershipId={membershipId} />;
}
