import type { Metadata } from "next";
import { OfflineShelf } from "../../components/portal/offline/shelf";

// A static page: the installed app's shell keeps it, and shows it for any address that needs a connection.
export const metadata: Metadata = {
  title: "Saved on this device | CRC Torah",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export default function OfflinePage() { return <OfflineShelf />; }
