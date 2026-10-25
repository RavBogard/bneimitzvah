import { PortalEntry } from "../../components/portal/entry";
import { InstallHint } from "../../components/portal/offline/install-hint";
import type { Metadata } from "next";
import { signedInTitle } from "../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Account") };

// Account keeps the app's Install entry, for anyone, signed in or not (2026-10-23 popup ruling).
export default function AccountPage() { return <PortalEntry autoEnterStudent={false} after={<InstallHint place="account" />} />; }
