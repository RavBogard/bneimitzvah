import { AdminInvitationsWorkspace } from "../../../../../components/portal/workspace/invitations/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Invitations") };

export default function AdminInvitationsPage() { return <AdminInvitationsWorkspace />; }
