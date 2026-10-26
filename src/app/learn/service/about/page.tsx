import type { Metadata } from "next";
import { ServiceAppBar } from "../../../../components/learn/service/bits";
import learn from "../../../../components/learn/learn.module.css";
import { COPY } from "../../../../lib/service-course/copy";
import { CRC_TENANT } from "../../../../lib/service-course/course";
import { pageTitle } from "../../../../lib/site/product-name";
import { NOINDEX_META } from "../../../../lib/site/indexing";
import { readPublicProductName } from "../../../../server/public-site/names";
import { publicMetadataBase } from "../../../../lib/site/origin";

export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), COPY.aboutPage.title, COPY.home.title), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: NOINDEX_META };
}
// A7, About page.
export default function ServiceAboutPage() {
  return <div className={`portal-shell ${learn.shell}`}>
    <ServiceAppBar />
    <main className={learn.main}><div className={learn.about}>
      <h1 className={learn.title}>{COPY.aboutPage.title}</h1>
      <p>{COPY.aboutPage.p1}</p>
      {/* ab.p2 says the Hebrew comes from Shirei Tfilah, which is not true of the evening lessons (the CRC siddur's own text, 2.0 SC7);
          it is hidden wherever the evening is on until Daniel approves new wording (a listed wording gap). */}
      {!CRC_TENANT.evening && <p>{COPY.aboutPage.p2}</p>}
      <p>{COPY.aboutPage.p3}</p>
      <p><a href="/learn/service">{COPY.frame.close}</a></p>
    </div></main>
  </div>;
}
