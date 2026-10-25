import { PracticeWorkspace } from "../../../../components/portal/workspace/students";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Child practice") };

export default async function PracticePage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <PracticeWorkspace studentId={studentId} />;
}
