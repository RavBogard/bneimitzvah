import { AccountPage } from "../../components/portal/account-page";
import type { Metadata } from "next";
import { signedInTitle } from "../../lib/site/signed-in-title";

export const metadata: Metadata = { title: signedInTitle("Account") };

// Account is a list page, the home of roles, and keeps the app's Install entry for anyone who can use it (2026-10-23 popup ruling).
// Signed out it is the sign-in form, and signing in by email code comes back here (N20), as Google sign-in from here already does.
export default function AccountRoute() { return <AccountPage />; }
