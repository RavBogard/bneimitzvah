import { AdminReadingWorkspace } from "../../../../../../components/portal/workspace/admin-reading";

export default async function AdminReadingPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <AdminReadingWorkspace studentId={studentId} />;
}
