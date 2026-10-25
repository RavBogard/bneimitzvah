import { AdminReadingWorkspace } from "../../../../../../components/portal/workspace/admin-reading";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Student") };

export default async function AdminReadingPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <AdminReadingWorkspace studentId={studentId} />;
}
