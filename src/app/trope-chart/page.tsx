import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { PrintChart } from "../../components/portal/trope-chart/print";
import { accentLabel, accentSample, CHART_ACCENTS, ENDING_SAMPLE, LEGARMEH_SAMPLE, PHRASE_FAMILIES, type ChartAccent } from "../../lib/trope/chart-catalog";
import hebrew from "../../styles/hebrew-font.module.css";
import styles from "./chart.module.css";
import { pageTitle } from "../../lib/site/product-name";
import { publicRobots } from "../../lib/site/indexing";
import { readPublicProductName } from "../../server/public-site/names";
import { publicMetadataBase } from "../../lib/site/origin";

export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return { title: pageTitle(await readPublicProductName(), "Trope chart"), metadataBase: publicMetadataBase(), referrer: "no-referrer", robots: publicRobots() };
}
function Mark({ accent }: { accent: ChartAccent }) {
  return <li className={styles.mark} data-chart-accent={accent.codepoint}>
    <span className={`${styles.sample} ${hebrew.hebrew}`} lang="he" dir="rtl" aria-label={`${accentLabel(accent)} on a sample letter`}>{accentSample(accent)}</span>
    <span className={styles.markName}>{accentLabel(accent)}</span>
    <span className={styles.codepoint}>U+{accent.codepoint}</span>
  </li>;
}
export default function TropeChartPage() {
  return <div className={`portal-shell ${styles.shell}`} data-chart-page>
    <a className="skip-link" href="#trope-chart-main">Skip to chart</a>
    <header className={`portal-header ${styles.header}`}><Link className="portal-brand" href="/">CRC Torah</Link><Link className={styles.back} href="/workspace">Return to workspace</Link></header>
    <main id="trope-chart-main" className={styles.main}>
      <div className={styles.introduction}><h1 className={styles.title}>Trope chart</h1><p>Find the signs, their names and the phrase families used in your reading.</p><PrintChart /></div>
      <section aria-labelledby="phrase-families-heading"><h2 id="phrase-families-heading" className={styles.sectionHeading}>Phrase families</h2><p className={styles.explanation}>Color belongs to a whole phrase, ending at its closing sign. It does not give every sign its own permanent color or melody.</p>
        <ol className={styles.families}>{PHRASE_FAMILIES.map(family => <li className={styles.family} key={family.id} data-chart-family={family.id} style={{ "--family-color": family.color } as CSSProperties}>
          <h3>{family.label}</h3><ul className={styles.marks}>{CHART_ACCENTS.filter(accent => accent.family === family.id).map(accent => <Mark key={accent.codepoint} accent={accent} />)}
          {(family.id === "sof-pasuk" || family.id === "sof-haftarah") && <li className={styles.mark}><span className={`${styles.sample} ${hebrew.hebrew}`} lang="he" dir="rtl">{ENDING_SAMPLE}</span><span className={styles.markName}>{family.id === "sof-pasuk" ? "silluq / sof pasuq" : "same signs, final haftarah verse"}</span></li>}
          {family.id === "revia" && <li className={styles.mark}><span className={`${styles.sample} ${hebrew.hebrew}`} lang="he" dir="rtl">{LEGARMEH_SAMPLE}</span><span className={styles.markName}>munach + paseq (legarmeh)</span></li>}
          </ul></li>)}</ol>
      </section>
      <section aria-labelledby="other-signs-heading" className={styles.other}><h2 id="other-signs-heading" className={styles.sectionHeading}>Signs that follow phrase context</h2><p className={styles.explanation}>Tipcha, pashta, yetiv and zarka join the following phrase. Conjunctive signs take their phrase's color; ole and dehi belong to the additional poetic system. Both zarka forms are shown.</p>
        <ul className={styles.otherMarks}>{CHART_ACCENTS.filter(accent => !accent.family).map(accent => <Mark key={accent.codepoint} accent={accent} />)}</ul>
      </section>
      <footer className={styles.sources}><p>Samples use an invented letter and vowel, not a verse. The final-haftarah family is an ending context, not a separate accent.</p><p>Phrase families and colors: haftarah / portal trope catalog. Hebrew: Noto Serif Hebrew 2.004, © 2022 The Noto Project Authors, <a href="/fonts/noto-serif-hebrew/OFL.txt">SIL Open Font License 1.1</a>.</p></footer>
    </main>
  </div>;
}
