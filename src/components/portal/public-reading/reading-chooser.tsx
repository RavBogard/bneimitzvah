"use client";
import { useId, useMemo, useState } from "react";
import { NAMED_READINGS, type NamedReading } from "../../../lib/readings/named-readings";
import { canonicalReadingRef, joinReadingRef } from "../../../lib/readings/reading-ref";
import { parseRange } from "../../../lib/readings/leyning.mjs";
import { TORAH_BOOKS } from "../../../lib/readings/ranges";
import { ReadingPassageSelect } from "../workspace/reading-passage-select";
import type { StudyKind } from "../workspace/study/api";
import { readAddress } from "./urls";
import styles from "./public-reading.module.css";

const OCCASIONS: readonly { group: NamedReading["group"]; label: string }[] = [
  { group: "special", label: "Special Shabbatot" }, { group: "festival", label: "Festivals" }, { group: "fast", label: "Fast days" }];
/** The parashiyot under their Torah book, in Torah order. */
export function parashotByBook(): readonly { book: string; readings: readonly NamedReading[] }[] {
  return TORAH_BOOKS.map(book => ({ book, readings: NAMED_READINGS.filter(reading => reading.group === "parashah" && parseRange(reading.passages[0].ref)?.book === book) }));
}
/** A custom passage from the pickers (one line per passage) → its canonical ref, or null. */
export function customRef(lines: string, kind: StudyKind): string | null {
  const segments = lines.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!segments.length) return null;
  return canonicalReadingRef(joinReadingRef(segments), kind)?.ref ?? null;
}

/**
 * "Choose a reading": an in-place panel under the hero, never a modal. A parashah, a holiday or special
 * Shabbat from the catalog, or any passage of the Torah or the Prophets. Choosing opens its address.
 */
export function ReadingChooser({ id, study, onOpen }: { id: string; study: boolean; onOpen(address: string): void }) {
  const field = useId(), books = useMemo(parashotByBook, []);
  const [parashah, setParashah] = useState(""), [occasion, setOccasion] = useState("");
  const [corpus, setCorpus] = useState<StudyKind>("torah"), [custom, setCustom] = useState("");
  const ref = customRef(custom, corpus), chosen = custom.trim() !== "";
  const open = (target: Parameters<typeof readAddress>[0]) => onOpen(readAddress(target, { study }));
  return <section id={id} className={styles.chooser} aria-labelledby={`${field}-title`}>
    <h2 id={`${field}-title`}>Choose a reading</h2>
    <form className={styles.choice} onSubmit={event => { event.preventDefault(); if (parashah) open({ mode: "named", slug: parashah, passage: 1 }); }}>
      <label htmlFor={`${field}-parashah`}>Parashah</label>
      <div className={styles.choiceRow}>
        <select id={`${field}-parashah`} value={parashah} onChange={event => setParashah(event.target.value)}>
          <option value="" disabled>Choose a parashah</option>
          {books.map(row => <optgroup key={row.book} label={row.book}>{row.readings.map(reading => <option key={reading.slug} value={reading.slug}>{reading.name}</option>)}</optgroup>)}
        </select>
        <button type="submit" className="button-secondary" disabled={!parashah}>Open</button>
      </div>
    </form>
    <form className={styles.choice} onSubmit={event => { event.preventDefault(); if (occasion) open({ mode: "named", slug: occasion, passage: 1 }); }}>
      <label htmlFor={`${field}-occasion`}>Holidays and special Shabbatot</label>
      <div className={styles.choiceRow}>
        <select id={`${field}-occasion`} value={occasion} onChange={event => setOccasion(event.target.value)}>
          <option value="" disabled>Choose a day</option>
          {OCCASIONS.map(row => <optgroup key={row.group} label={row.label}>{NAMED_READINGS.filter(reading => reading.group === row.group).map(reading => <option key={reading.slug} value={reading.slug}>{reading.name}</option>)}</optgroup>)}
        </select>
        <button type="submit" className="button-secondary" disabled={!occasion}>Open</button>
      </div>
    </form>
    <form className={styles.choice} onSubmit={event => { event.preventDefault(); if (ref) open({ mode: "ref", ref, kind: corpus }); }}>
      <div className={styles.custom}>
        <h3 id={`${field}-custom-title`}>Custom passage</h3>
        <div className="study-kind-choice" role="group" aria-labelledby={`${field}-custom-title`}>
          {(["torah", "haftarah"] as const).map(kind => <button key={kind} type="button" className="button-secondary" aria-pressed={corpus === kind}
            onClick={() => { if (kind !== corpus) { setCorpus(kind); setCustom(""); } }}>{kind === "torah" ? "Torah" : "Prophets"}</button>)}
        </div>
        <ReadingPassageSelect key={corpus} custom={custom} kind={corpus} neviim={corpus === "haftarah"} idPrefix={`${field}-custom`} legend="Verses" disabled={false} onChange={setCustom} />
        {chosen && !ref && <p className="field-help" role="status">{corpus === "torah" ? "These verses can’t be opened together. Keep Torah passages in one book, in order, and under 1,000 verses." : "These verses can’t be opened together. Keep them under 1,000 verses, with no verse twice."}</p>}
        <button type="submit" className="button-secondary" disabled={!ref}>Open</button>
      </div>
    </form>
    <p className={styles.credit}>Reading list from <a href="https://www.hebcal.com/" target="_blank" rel="noreferrer">Hebcal</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.</p>
  </section>;
}
