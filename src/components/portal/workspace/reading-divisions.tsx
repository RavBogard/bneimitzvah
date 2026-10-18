import { useRef } from "react";
import { addedDivision, divisionChoices } from "./reading-selection";
import styles from "./reading-selection.module.css";

/**
 * Optional Torah aliyah divisions chosen from the selected verses. It edits the
 * same draft starts as the typed field under Advanced, so the two never disagree.
 */
export function ReadingDivisions({ verses, starts, edited, issue, disabled, onChange }: { verses: string[]; starts: string[] | null; edited: boolean; issue: boolean; disabled: boolean; onChange(next: string[]): void }) {
  const panel = useRef<HTMLDetailsElement>(null);
  if (verses.length < 2) return null;
  const list = issue ? null : starts ?? [];
  const next = list ? addedDivision(verses, list) : null;
  const state = issue ? "These divisions don't fit the chosen verses." : starts === null ? "Not divided yet." : starts.length === 0 ? (edited ? "Recorded as one aliyah." : "One aliyah.") : `${starts.length + 1} aliyot.`;
  // A mismatch stays visible outside the disclosure; starting again opens the division controls.
  return <>{issue && <div className={styles.attention}>
      <p className="request-error" role="status">The aliyah divisions start at verses outside this passage. Start the divisions again for these verses, or change them under Advanced references and aliyah boundaries.</p>
      <button type="button" className="button-text" disabled={disabled} onClick={() => { onChange([]); if (panel.current) panel.current.open = true; }}>Start divisions again</button>
    </div>}
  <details ref={panel} className={styles.disclosure}>
    <summary>Divide into aliyot (optional) · {state}</summary>
    <p className="field-help">Family honors use these divisions to know who reads which verses. You can leave this for later.</p>
    {list && <ol className={styles.divisions}>
      <li><span>Aliyah 1 starts at <bdi dir="ltr">{verses[0]}</bdi></span></li>
      {list.map((start, index) => <li key={index}>
        <label htmlFor={`reading-division-${index + 2}`}>{`Aliyah ${index + 2} starts at`}</label>
        <select id={`reading-division-${index + 2}`} value={start} disabled={disabled} onChange={event => onChange(list.map((value, at) => at === index ? event.target.value : value))}>
          {divisionChoices(verses, list, index).map(ref => <option key={ref} value={ref}>{ref}</option>)}
        </select>
        <button type="button" className="button-text" disabled={disabled} onClick={() => onChange(list.filter((_, at) => at !== index))}>{`Remove aliyah ${index + 2}`}</button>
      </li>)}
    </ol>}
    {list && <div className={styles.actions}>
      {next && <button type="button" className="button-text" disabled={disabled} onClick={() => onChange([...list, next])}>Add an aliyah division</button>}
      {list.length > 0 && <button type="button" className="button-text" disabled={disabled} onClick={() => onChange([])}>Keep as one aliyah</button>}
    </div>}
  </details></>;
}
