import { WorkspaceHomeRedirect } from "../../components/portal/workspace/home-redirect";
import type { Metadata } from "next";
import { signedInTitle } from "../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Your account") };

export default function WorkspacePage() { return <WorkspaceHomeRedirect />; }
