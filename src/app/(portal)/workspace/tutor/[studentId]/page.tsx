import { StudentWorkspace } from "../../../../../components/portal/workspace/students";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Student") };

export default async function TutorStudentPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentWorkspace mode="tutor" studentId={studentId} />;
}
