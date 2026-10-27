import { StudentWorkspace } from "../../../components/portal/workspace/students";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Your children’s readings") };

export default function ParentPage() { return <StudentWorkspace mode="parent" />; }
