import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { changePassage, followingPassage, passageReference, passagesFromCustom, readingBooks, type Passage } from "./reading-selection";
import type { ReadingKind } from "./reading-proposal";
import styles from "./reading-selection.module.css";

/** Familiar book/chapter/verse pickers for one or more passages. Manual ranges that are not plain passages stay untouched. */
export function ReadingPassageSelect({ custom, kind, disabled, onChange }: { custom: string; kind: ReadingKind; disabled: boolean; onChange(ref: string): void }) {
  const parsed = passagesFromCustom(custom, kind), manual = custom.trim() !== "" && parsed === null;
  const passages: (Passage | null)[] = parsed && parsed.length ? parsed : [null];
  const write = (next: (Passage | null)[]) => onChange(next.filter((value): value is Passage => value !== null).map(passageReference).join("\n"));
  function update(index: number, field: keyof Passage, value: string) {
    const current = passages[index];
    write(passages.map((passage, at) => at !== index ? passage : changePassage(current ?? { book: value, startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }, field, value)));
  }
  const last = passages[passages.length - 1];
  return <div className={styles.passages}>
    {manual && <p className="field-help">These verses were entered as typed references, so they are kept exactly as written. Change them under Advanced references and aliyah boundaries below.</p>}
    {passages.map((passage, index) => <PassageFields key={index} index={index} count={passages.length} passage={passage} kind={kind} disabled={disabled || manual}
      onChange={(field, value) => update(index, field, value)} onRemove={() => write(passages.filter((_, at) => at !== index))} />)}
    {!manual && last && passages.length < 32 && <button type="button" className="button-text" disabled={disabled} onClick={() => write([...passages, followingPassage(last)])}>Add another passage</button>}
  </div>;
}

function PassageFields({ index, count, passage, kind, disabled, onChange, onRemove }: { index: number; count: number; passage: Passage | null; kind: ReadingKind; disabled: boolean; onChange(field: keyof Passage, value: string): void; onRemove(): void }) {
  const counts = passage ? TANAKH_VERSE_COUNTS[passage.book] : [], id = (name: string) => index === 0 ? `reading-${name}` : `reading-${name}-${index + 1}`;
  const numbers = (total: number, start = 1) => Array.from({ length: Math.max(0, total - start + 1) }, (_, at) => { const value = start + at; return <option key={value} value={value}>{value}</option>; });
  return <fieldset className={styles.passage} disabled={disabled}>
    <legend>{count > 1 ? `Passage ${index + 1}` : "Custom passage"}</legend>
    <div className={styles.book}><label htmlFor={id("book")}>Book</label><select id={id("book")} value={passage?.book ?? ""} required={index === 0} onChange={event => onChange("book", event.target.value)}>
      <option value="" disabled>Choose a book</option>{readingBooks(kind).map(book => <option key={book}>{book}</option>)}
    </select></div>
    <div className={styles.endpoints}>
      <div><label htmlFor={id("start-chapter")}>Start chapter</label><select id={id("start-chapter")} value={passage?.startChapter ?? ""} disabled={!passage} onChange={event => onChange("startChapter", event.target.value)}>{numbers(counts.length)}</select></div>
      <div><label htmlFor={id("start-verse")}>Start verse</label><select id={id("start-verse")} value={passage?.startVerse ?? ""} disabled={!passage} onChange={event => onChange("startVerse", event.target.value)}>{numbers(counts[(passage?.startChapter ?? 1) - 1] ?? 0)}</select></div>
      <div><label htmlFor={id("end-chapter")}>End chapter</label><select id={id("end-chapter")} value={passage?.endChapter ?? ""} disabled={!passage} onChange={event => onChange("endChapter", event.target.value)}>{numbers(counts.length, passage?.startChapter ?? 1)}</select></div>
      <div><label htmlFor={id("end-verse")}>End verse</label><select id={id("end-verse")} value={passage?.endVerse ?? ""} disabled={!passage} onChange={event => onChange("endVerse", event.target.value)}>{numbers(counts[(passage?.endChapter ?? 1) - 1] ?? 0, passage?.startChapter === passage?.endChapter ? passage?.startVerse ?? 1 : 1)}</select></div>
    </div>
    {count > 1 && <button type="button" className="button-text" onClick={onRemove}>{`Remove passage ${index + 1}`}</button>}
  </fieldset>;
}
