import { EmailSettingsWorkspace } from "../../../components/portal/workspace/email/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Email settings") };

export default function EmailSettingsPage() { return <EmailSettingsWorkspace />; }
