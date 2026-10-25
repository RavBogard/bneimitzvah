import { StudentWorkspace } from "../../../components/portal/workspace/students";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Your assigned reading") };

export default function StudentPage() { return <StudentWorkspace mode="student" />; }
