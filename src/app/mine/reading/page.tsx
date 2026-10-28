import type { Metadata } from "next";
import { StudentWorkspace } from "../../../components/portal/workspace/students";
import { signedInTitle } from "../../../lib/site/signed-in-title";

/** The signed-in student's pinned reading (Readings for everyone E2); it replaces /workspace/student?tab=reading. */
export const metadata: Metadata = { title: signedInTitle("Your reading") };

export default function MineReadingPage() { return <StudentWorkspace mode="student" />; }
