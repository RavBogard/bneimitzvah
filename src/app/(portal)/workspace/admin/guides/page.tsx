import { GuideAdminWorkspace } from "../../../../../components/portal/workspace/guide-admin/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Guides") };
export default function GuideAdminPage() { return <GuideAdminWorkspace />; }
