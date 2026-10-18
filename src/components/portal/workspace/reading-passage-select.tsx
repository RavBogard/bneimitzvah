import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { changePassage, passageFromCustom, passageReference, readingBooks, type Passage } from "./reading-selection";
import type { ReadingKind } from "./reading-proposal";
import styles from "./reading-selection.module.css";

export function ReadingPassageSelect({ custom, kind, disabled, onChange }: { custom: string; kind: ReadingKind; disabled: boolean; onChange(ref: string): void }) {
  const passage = passageFromCustom(custom, kind), manual = custom.trim() !== "" && passage === null;
  const counts = passage ? TANAKH_VERSE_COUNTS[passage.book] : [];
  function update(field: keyof Passage, value: string) {
    const next = changePassage(passage ?? { book: value, startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }, field, value);
    onChange(passageReference(next));
  }
  const numbers = (count: number, start = 1) => Array.from({ length: Math.max(0, count - start + 1) }, (_, index) => { const value = start + index; return <option key={value} value={value}>{value}</option>; });
  return <fieldset className={styles.passage} disabled={disabled || manual}>
    <legend>Custom passage</legend>
    {manual && <p className="field-help">Your manual ranges are preserved. Edit them in Advanced references and aliyah boundaries below.</p>}
    <div className={styles.book}><label htmlFor="reading-book">Book</label><select id="reading-book" value={passage?.book ?? ""} required={!manual} onChange={event => update("book", event.target.value)}>
      <option value="" disabled>Choose a book</option>{readingBooks(kind).map(book => <option key={book}>{book}</option>)}
    </select></div>
    <div className={styles.endpoints}>
      <div><label htmlFor="reading-start-chapter">Start chapter</label><select id="reading-start-chapter" value={passage?.startChapter ?? ""} disabled={!passage} onChange={event => update("startChapter", event.target.value)}>{numbers(counts.length)}</select></div>
      <div><label htmlFor="reading-start-verse">Start verse</label><select id="reading-start-verse" value={passage?.startVerse ?? ""} disabled={!passage} onChange={event => update("startVerse", event.target.value)}>{numbers(counts[(passage?.startChapter ?? 1) - 1] ?? 0)}</select></div>
      <div><label htmlFor="reading-end-chapter">End chapter</label><select id="reading-end-chapter" value={passage?.endChapter ?? ""} disabled={!passage} onChange={event => update("endChapter", event.target.value)}>{numbers(counts.length, passage?.startChapter ?? 1)}</select></div>
      <div><label htmlFor="reading-end-verse">End verse</label><select id="reading-end-verse" value={passage?.endVerse ?? ""} disabled={!passage} onChange={event => update("endVerse", event.target.value)}>{numbers(counts[(passage?.endChapter ?? 1) - 1] ?? 0, passage?.startChapter === passage?.endChapter ? passage?.startVerse ?? 1 : 1)}</select></div>
    </div>
  </fieldset>;
}
