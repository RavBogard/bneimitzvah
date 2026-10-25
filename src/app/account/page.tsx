import { PortalEntry } from "../../components/portal/entry";
import { InstallHint } from "../../components/portal/offline/install-hint";

// Account keeps the app's Install entry, for anyone, signed in or not (2026-10-23 popup ruling).
// Signing in here by email code comes back here (N20), as Google sign-in from here already does.
export default function AccountPage() { return <PortalEntry autoEnterStudent={false} returnTo="/account" after={<InstallHint place="account" />} />; }
