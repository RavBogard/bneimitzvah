import { ClaudeConnectionsWorkspace } from "../../../../components/portal/workspace/connections/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Claude connections") };

export default function ClaudeConnectionsPage() { return <ClaudeConnectionsWorkspace />; }
