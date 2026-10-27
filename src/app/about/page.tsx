import type { Metadata } from "next";
import { SiteBar } from "../../components/site/site-bar";
import { PracticeDisclosure } from "../../components/portal/practice-visibility/disclosure";
import { studyEditions } from "../../components/portal/workspace/study/credits";
import { PLAN } from "../../lib/offline/copy";
import { REFERENCE_ATTRIBUTION } from "../../lib/reference-audio/contract";
import { FALLBACK_PRODUCT_NAME, pageTitle } from "../../lib/site/product-name";
import { publicRobots } from "../../lib/site/indexing";
import { publicMetadataBase } from "../../lib/site/origin";
import { readPublicProductName } from "../../server/public-site/names";
import styles from "./about.module.css";

export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "About"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: publicRobots() };
}

const CONGREGATION = "https://www.centralreform.org/";
const external = { target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" } as const;
/** Every credit here is one the repository already records: the study credits, the reference-recording attribution, the Learn credits and public/fonts/PROVENANCE.md. */
const fonts = [
  { name: "Taamey Frank CLM", notice: "© 2009–2010 Yoram Gnat", license: "GNU General Public License version 2 with the font exception", href: "/fonts/taamey-frank-clm/LICENSE.txt" },
  { name: "Stam Ashkenaz CLM", notice: "© 2007–2010 Yoram Gnat", license: "GNU General Public License version 2 with the font exception", href: "/fonts/stam-ashkenaz-clm/LICENSE.txt" },
  { name: "Noto Serif Hebrew", notice: "© 2022 The Noto Project Authors", license: "SIL Open Font License 1.1", href: "/fonts/noto-serif-hebrew/OFL.txt" },
  { name: "Bricolage Grotesque", notice: "© 2022 The Bricolage Grotesque Project Authors", license: "SIL Open Font License 1.1", href: "/fonts/bricolage-grotesque/OFL.txt" },
] as const;

export default function AboutPage() {
  const editions = [studyEditions.mam, studyEditions.jps2023];
  return <div className={`portal-shell ${styles.shell}`}>
    <a className="skip-link" href="#about-main">Skip to main content</a>
    <SiteBar />
    <main id="about-main" className={styles.main}>
      <h1 className={styles.title}>About</h1>
      <section aria-labelledby="about-what">
        <h2 id="about-what">What {FALLBACK_PRODUCT_NAME} is</h2>
        <p>{FALLBACK_PRODUCT_NAME} is a home for anyone who wants to lein or learn the week's Torah and haftarah. It is made by Central Reform Congregation. It is also the place where CRC's Beit Mitzvah students, families and tutors prepare.</p>
      </section>
      <section aria-labelledby="about-who">
        <h2 id="about-who">Who it is for</h2>
        <ul className={styles.doors}>
          <li><a href="/read">This week's reading</a><span>Open to everyone, no sign-in needed.</span></li>
          <li><a href="/learn">Learn to lein</a><span>Hear the phrases, then lein a verse of this week's reading.</span></li>
          <li><a href="/sign-in">Beit Mitzvah</a><span>For students, families and tutors preparing a Beit Mitzvah.</span></li>
        </ul>
      </section>
      <section aria-labelledby="about-texts">
        <h2 id="about-texts">Where the texts come from</h2>
        <p>The CRC Torah mark is Siona Benjamin's floor at Central Reform Congregation, used with the congregation's permission.</p>
        <p>Hebrew: Miqra according to the Masorah. English: JPS 2023. No other edition is substituted.</p>
        <p>Text is provided through Sefaria. These editions retain their own terms; the application’s code license does not replace them.</p>
        <ul className={styles.credits}>{editions.map(edition => <li key={edition.key}>
          <strong>{edition.versionTitle}</strong>
          <span>{edition.creator}</span>
          <span><a href={edition.sourceUrl} {...external}>Edition source</a> · <a href={edition.licenseUrl} {...external}>{edition.license}</a></span>
          <span>{edition.changes}</span>
        </li>)}</ul>
        <h3>Recordings</h3>
        <p><a href="https://archive.org/details/PockettorahAudioFiles" {...external}>{REFERENCE_ATTRIBUTION.title}</a> · {REFERENCE_ATTRIBUTION.creator} · <a href={REFERENCE_ATTRIBUTION.licenseUrl} {...external}>{REFERENCE_ATTRIBUTION.license}</a> · {REFERENCE_ATTRIBUTION.changes}</p>
        <p>The melodies are the Standard Reform cantillation of Binder and Avery.</p>
        <h3>Fonts</h3>
        <ul className={styles.credits}>{fonts.map(font => <li key={font.name}><strong>{font.name}</strong><span>{font.notice}, <a href={font.href}>{font.license}</a>.</span></li>)}</ul>
      </section>
      <section aria-labelledby="about-records">
        <h2 id="about-records">What the site records about you</h2>
        <p>Your account stays private.</p>
        <PracticeDisclosure place="account" />
      </section>
      <section aria-labelledby="about-install">
        <h2 id="about-install">Installing it on a phone</h2>
        <p>{PLAN.installHint(FALLBACK_PRODUCT_NAME)}</p>
        <ul className={styles.credits}>
          <li><strong>iPhone</strong><span>{PLAN.iphoneSteps}</span></li>
          <li><strong>iPad</strong><span>{PLAN.ipadSteps}</span></li>
          <li><strong>Android</strong><span>{PLAN.androidMenu}</span></li>
        </ul>
      </section>
      <section aria-labelledby="about-congregation">
        <h2 id="about-congregation">Central Reform Congregation</h2>
        <p><a href={CONGREGATION} {...external}>Central Reform Congregation</a></p>
      </section>
    </main>
  </div>;
}
