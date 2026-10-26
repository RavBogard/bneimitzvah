import { AdminWorkspace } from "../../../../components/portal/workspace/roster";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("This week") };

export default function AdminStudentsPage() { return <AdminWorkspace />; }
