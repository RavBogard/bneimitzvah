import { PracticeWorkspace } from "../../../../components/portal/workspace/students";

export default async function PracticePage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <PracticeWorkspace studentId={studentId} />;
}
