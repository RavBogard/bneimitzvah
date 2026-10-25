import { MoreWorkspace } from "../../../components/portal/shell/more";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("More") };

export default function MorePage() { return <MoreWorkspace />; }
