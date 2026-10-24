import { PortalEntry } from "../../components/portal/entry";
import { InstallHint } from "../../components/portal/offline/install-hint";

// Account keeps the app's Install entry, for anyone, signed in or not (2026-10-23 popup ruling).
export default function AccountPage() { return <PortalEntry autoEnterStudent={false} after={<InstallHint place="account" />} />; }
