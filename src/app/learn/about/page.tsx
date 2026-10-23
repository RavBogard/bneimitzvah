import type { Metadata } from "next";
import { LearnAppBar } from "../../../components/learn/home";
import styles from "../../../components/learn/learn.module.css";

export const metadata: Metadata = {
  title: "About | Learn to lein", referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
// COPY.md, About.
export default function AboutPage() {
  return <div className={`portal-shell ${styles.shell}`}>
    <LearnAppBar />
    <main className={styles.main}><div className={styles.about}>
      <h1 className={styles.title}>About</h1>
      <p>Learn to lein uses human recordings from <a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noopener noreferrer">PocketTorah</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a>), cut by word, and the text of Miqra according to the Masorah via Sefaria (<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a>). The melodies are the Standard Reform cantillation of Binder and Avery. Your cantor's or tutor's version of a phrase wins over the recording's.</p>
      <p><a href="/learn">Back to the path</a></p>
    </div></main>
  </div>;
}
