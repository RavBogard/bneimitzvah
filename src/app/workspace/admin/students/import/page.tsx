import { AdminImportWorkspace } from "../../../../../components/portal/workspace/csv-import/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Import students") };
export default function ImportPage() { return <AdminImportWorkspace />; }
