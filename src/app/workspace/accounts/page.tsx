import { AccountsWorkspace } from "../../../components/portal/workspace/accounts/workspace";
import type { Metadata } from "next";
import { signedInTitle } from "../../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Members") };

export default function AccountsPage() { return <AccountsWorkspace />; }
