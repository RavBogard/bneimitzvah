import { PortalEntry } from "../../../components/portal/entry";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Join your congregation’s practice") };

export default function AcceptInvitationPage() { return <PortalEntry invitation />; }
