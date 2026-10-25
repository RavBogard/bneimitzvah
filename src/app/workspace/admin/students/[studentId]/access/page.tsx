import { AdminAccessWorkspace } from "../../../../../../components/portal/workspace/relationships/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("People and access") };
export default async function StudentAccessPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <AdminAccessWorkspace studentId={studentId} />;
}
