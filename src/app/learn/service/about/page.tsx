import type { Metadata } from "next";
import { ServiceAppBar } from "../../../../components/learn/service/bits";
import learn from "../../../../components/learn/learn.module.css";
import { COPY } from "../../../../lib/service-course/copy";
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
      <p>{COPY.aboutPage.p2}</p>
      <p>{COPY.aboutPage.p3}</p>
      <p><a href="/learn/service">{COPY.frame.close}</a></p>
    </div></main>
  </div>;
}
