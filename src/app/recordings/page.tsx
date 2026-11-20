import { notFound } from "next/navigation";
import { resolveIdentity } from "../../lib/site/identity";
import { SiteBar } from "../../components/site/site-bar";
import { ShermetLibrary } from "../../components/shermet-library/library";
import { SHERMET_CATEGORIES } from "../../lib/reference-audio/shermet-library";
import styles from "../about/about.module.css";
export const metadata = { title: "Recordings | CRC Torah", referrer: "no-referrer" as const };
export default async function RecordingsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  if (!resolveIdentity().crc) notFound();
  const params = await searchParams, category = params.category && Object.hasOwn(SHERMET_CATEGORIES, params.category) ? params.category : "";
  return <div className={`portal-shell ${styles.shell}`}><a className="skip-link" href="#recordings-main">Skip to recordings</a><SiteBar /><main id="recordings-main" className={styles.main}>
    <h1 className={styles.title}>Recordings</h1><p>Cantor Wendy Shermet’s recordings from Temple Israel, Omaha. Browse blessings, trope lessons, holiday readings and other source material.</p>
    <p><a href="/trope-chart">Trope chart</a> · <a href="/learn/service">Service course</a></p>
    <ShermetLibrary initialCategory={category} />
  </main></div>;
}
