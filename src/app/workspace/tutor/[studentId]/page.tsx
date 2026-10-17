import { StudentWorkspace } from "../../../../components/portal/workspace/students";

export default async function TutorStudentPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentWorkspace mode="tutor" studentId={studentId} />;
}
