"use client";
import { useState } from "react";
import type { Melody } from "../../lib/learn/course";
import styles from "./passage-preparation.module.css";

/** Optional task suggestions, held only while this page is open. No placement or stored profile. */
export function LearningStart() {
  const [kind, setKind] = useState<Melody>("torah");
  const prepare = kind === "torah" ? "/learn/prepare" : "/learn/prepare?kind=haftarah";
  return <section className={styles.start} aria-labelledby="learning-start"><h2 id="learning-start">Start where you are</h2>
    <p>This course assumes you can sound out pointed Hebrew.</p><p><a href="/learn/prepare">Prepare a passage</a></p>
    <details><summary>Choose a starting point</summary><div className={styles.form}><label>Choose a melody <select value={kind} onChange={event => setKind(event.target.value as Melody)}><option value="torah">Torah</option><option value="haftarah">Haftarah</option></select></label></div>
    <ul className={styles.starts}>
      <li><a href={`/learn/${kind}-sof-pasuk`}>New to chanting: hear the first phrase</a><p>Listen, echo and try without the model. Basic Hebrew decoding is enough to begin.</p></li>
      <li><a href={prepare}>Learned some by ear: prepare a short passage</a><p>Work from its models, connect the verses and choose useful repairs.</p></li>
      <li><a href="/trope-chart">Rusty signs: find a sound to refresh</a><p>Keep the chart available while preparing your reading.</p></li>
      <li><a href={prepare}>Ready for a reading: start with a passage</a><p>Choose a section or open a public reference. Go straight to an independent attempt if useful.</p></li>
    </ul><p>You can change your starting point whenever you like. These suggestions do not set a level.</p></details>
  </section>;
}
