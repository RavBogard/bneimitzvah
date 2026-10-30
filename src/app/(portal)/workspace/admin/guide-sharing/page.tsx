import { GuideSharingWorkspace } from "../../../../../components/portal/workspace/guide-share/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Share guides") };
export default function GuideSharingPage() { return <GuideSharingWorkspace />; }
