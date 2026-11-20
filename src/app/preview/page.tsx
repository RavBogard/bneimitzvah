import type { Metadata } from "next";
import { RolePreview } from "../../components/portal/role-preview/preview";
import { signedInTitle } from "../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Preview mode"), robots: { index: false, follow: false } };

export default function PreviewPage() {
  return <RolePreview />;
}
