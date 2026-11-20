import { pageTitle } from "../../lib/site/product-name";
import { readPublicProductName } from "../../server/public-site/names";
import { notFound } from "next/navigation";
import { resolveIdentity } from "../../lib/site/identity";
import { SiteBar } from "../../components/site/site-bar";
import { RecordingCollections } from "../../components/shermet-library/collections";
import { SHERMET_CATEGORIES } from "../../lib/reference-audio/shermet-library";
import styles from "../about/about.module.css";
export async function generateMetadata() {
  return { title: pageTitle(await readPublicProductName(), "Recordings"), referrer: "no-referrer" as const };
}
export default async function RecordingsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  if (!resolveIdentity().crc) notFound();
  const params = await searchParams, category = params.category && Object.hasOwn(SHERMET_CATEGORIES, params.category) ? params.category : "";
  return <div className={`portal-shell ${styles.shell}`}><a className="skip-link" href="#recordings-main">Skip to recordings</a><SiteBar /><main id="recordings-main" className={styles.main}>
    <h1 className={styles.title}>Recordings</h1><p>Browse Torah, haftarah, blessings, trope lessons and holiday recordings by collection.</p>
    <p><a href="/trope-chart">Trope chart</a> · <a href="/learn/service">Service course</a></p>
    <RecordingCollections initialCategory={category} />
  </main></div>;
}
