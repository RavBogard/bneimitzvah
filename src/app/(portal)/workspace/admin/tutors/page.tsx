import { AdminAccessWorkspace } from "../../../../../components/portal/workspace/relationships/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Tutors") };
export default function TutorsPage() { return <AdminAccessWorkspace />; }
