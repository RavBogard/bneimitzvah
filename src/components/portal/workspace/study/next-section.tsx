"use client";
import type { StudyVerse } from "./api";
import hebrewStyles from "../../../../styles/hebrew-font.module.css";
import styles from "./next-section.module.css";

/**
 * The end of a section (1.9 N3): "Next section", with the next section's first verse faint beneath it. The preview is the verse's own
 * text, hidden from assistive technology (it is a glimpse, not a second reading), and never a control.
 */
export function NextSection({ onNext, preview }: { onNext(): void; preview: StudyVerse | null | undefined }) {
  return <div className={styles.next} data-next-section="">
    <button type="button" className="button-secondary" onClick={onNext}>Next section</button>
    {preview && <p className={`${hebrewStyles.reading} ${styles.preview}`} lang="he" dir="rtl" aria-hidden="true">{preview.hebrew.text}</p>}
  </div>;
}
