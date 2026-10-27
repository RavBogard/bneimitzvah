import { StudentWorkspace } from "../../../components/portal/workspace/students";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Your assigned students") };

export default function TutorPage() { return <StudentWorkspace mode="tutor" />; }
