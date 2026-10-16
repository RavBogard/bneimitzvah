import { AdminAccessWorkspace } from "../../../../../../components/portal/workspace/relationships/workspace";
export default async function StudentAccessPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <AdminAccessWorkspace studentId={studentId} />;
}
