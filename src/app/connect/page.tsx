import { ConnectClaude } from "../../components/portal/connect";
import { signedInTitle } from "../../lib/site/signed-in-title";

export const metadata = { title: signedInTitle("Connect Claude"), referrer: "no-referrer", robots: { index: false, follow: false } };
export default function ConnectPage() { return <ConnectClaude />; }
