import type { Metadata } from "next";
import { LearnAppBar } from "../../../components/learn/home";
import styles from "../../../components/learn/learn.module.css";
import { pageTitle } from "../../../lib/site/product-name";
import { NOINDEX_META } from "../../../lib/site/indexing";
import { readPublicProductName } from "../../../server/public-site/names";
import { publicMetadataBase } from "../../../lib/site/origin";
import { resolveIdentity } from "../../../lib/site/identity";

export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "About", "Learn to lein"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
// COPY.md, About.
export default function AboutPage() {
  return <div className={`portal-shell ${styles.shell}`}>
    <LearnAppBar />
    <main className={styles.main}><div className={styles.about}>
      <h1 className={styles.title}>About</h1>
      {resolveIdentity().crc && <p>Where source-specific word timing is available, Learn to lein prefers <a href="https://www.templeisraelomaha.com/cantors-classroom" target="_blank" rel="noopener noreferrer">Cantor Wendy Shermet, Temple Israel, Omaha</a>, in the Binder/Schleifer tradition. Other phrases use PocketTorah. The playing recording is credited on screen; the PocketTorah license applies only to PocketTorah recordings.</p>}
      <p>Learn to lein uses human recordings from <a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noopener noreferrer">PocketTorah</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a>), cut by word, and the text of Miqra according to the Masorah via Sefaria (<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a>). The melodies are the Standard Reform cantillation of Binder and Avery. Your cantor's or tutor's version of a phrase wins over the recording's.</p>
      <p><a href="/learn">Back to the path</a></p>
    </div></main>
  </div>;
}
