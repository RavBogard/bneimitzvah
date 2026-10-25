import { UnsubscribePage } from "../../components/portal/unsubscribe";
import { signedInTitle } from "../../lib/site/signed-in-title";

// The capability travels only in the fragment; the page itself is static and keeps no referrer.
export const metadata = { title: signedInTitle("Unsubscribe"), referrer: "no-referrer" as const, robots: { index: false, follow: false } };
export default function Unsubscribe() { return <UnsubscribePage />; }
