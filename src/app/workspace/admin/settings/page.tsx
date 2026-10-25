import { CongregationSettingsWorkspace } from "../../../../components/portal/workspace/settings/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Congregation settings") };
export default function CongregationSettingsPage() { return <CongregationSettingsWorkspace />; }
