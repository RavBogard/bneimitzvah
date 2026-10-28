import type { Metadata } from "next";
import { StudentWorkspace } from "../../../../components/portal/workspace/students";
import { signedInTitle } from "../../../../lib/site/signed-in-title";

/** A parent's view of one child's assigned reading (E2); it replaces the card that opened in place on /workspace/parent. The tab title becomes "{child}'s reading" once the child is known. */
export const metadata: Metadata = { title: signedInTitle("Your child’s reading") };

export default async function MineChildPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentWorkspace mode="parent" studentId={studentId} />;
}
