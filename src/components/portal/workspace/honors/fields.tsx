import { useId } from "react";
import type { AliyahPerson, GenerationPerson, HonorPerson, HonorsContextView, HonorsForm } from "../../../../lib/honors/types";
import { newPerson, spanLabel } from "./draft";
import styles from "./honors.module.css";
type Person = HonorPerson | GenerationPerson | AliyahPerson;
type PeopleProps = { title: string; help?: string; people: readonly Person[]; kind?: "generation" | "aliyah"; disabled: boolean; onChange(people: readonly Person[]): void };
export function People({ title, help, people, kind, disabled, onChange }: PeopleProps) {
  const prefix = useId();
  const patch = (index: number, key: string, value: string) => onChange(people.map((p, i) => i === index ? { ...p, [key]: value } : p));
  const move = (i: number, direction: number) => { const next = [...people]; [next[i], next[i + direction]] = [next[i + direction], next[i]]; onChange(next); };
  const input = (p: Person, i: number, key: string, label: string, hebrew = false) => <label htmlFor={`${prefix}-${p.id}-${key}`}><span>{label}</span><input id={`${prefix}-${p.id}-${key}`} dir={hebrew ? "auto" : undefined} lang={hebrew ? "he" : undefined} autoComplete="off" spellCheck={false} value={(p as unknown as Record<string, string | null>)[key] ?? ""} maxLength={key === "relationship" ? 160 : 256} onChange={e => patch(i, key, e.target.value)} /></label>;
  return <section className={styles.group} aria-label={title}><h3>{title}</h3>{help && <p className={styles.help}>{help}</p>}
    <fieldset disabled={disabled}><legend className="sr-only">{title}</legend>
      <ol className={styles.people}>{people.map((p, i) => <li key={p.id} className={styles.person}>
        <div className={styles.nameFields}>{input(p, i, "englishName", "English name")}{kind === "aliyah" && input(p, i, "hebrewName", "Hebrew name (if known)", true)}{kind === "generation" && input(p, i, "relationship", "Relationship (optional)")}</div>
        {kind === "aliyah" && <details className={styles.more}><summary>Parents’ Hebrew names & relationship</summary><div className={styles.nameFields}>{input(p, i, "parent1HebrewName", "First parent’s Hebrew name (if known)", true)}{input(p, i, "parent2HebrewName", "Second parent’s Hebrew name (if known)", true)}{input(p, i, "relationship", "Relationship (optional)")}</div></details>}
        <div className={styles.rowActions}><span className={styles.position}>Person {i + 1}</span><button type="button" className="button-text" disabled={i === 0} aria-label={`Move person ${i + 1} up in ${title}`} onClick={() => move(i, -1)}>Move up</button><button type="button" className="button-text" disabled={i === people.length - 1} aria-label={`Move person ${i + 1} down in ${title}`} onClick={() => move(i, 1)}>Move down</button><button type="button" className="button-text" aria-label={`Remove person ${i + 1} from ${title}`} onClick={() => onChange(people.filter((_, n) => n !== i))}>Remove</button></div>
      </li>)}</ol>
      <button type="button" className="button-secondary" disabled={people.length >= 32} onClick={() => onChange([...people, { ...newPerson(), ...(kind ? { relationship: null } : {}), ...(kind === "aliyah" ? { hebrewName: null, parent1HebrewName: null, parent2HebrewName: null } : {}) }])}>Add person<span className="sr-only"> to {title}</span></button>
    </fieldset>
  </section>;
}
export function HonorsFields({ draft, context, disabled, onChange }: { draft: HonorsForm; context: HonorsContextView; disabled: boolean; onChange(value: HonorsForm): void }) {
  const ordinary = (key: "openingArk" | "generationToGeneration" | "undressingTorah" | "redressingTorah" | "closingArk", title: string, help: string) => <People title={title} help={help} kind={key === "generationToGeneration" ? "generation" : undefined} people={draft[key]} disabled={disabled} onChange={people => onChange({ ...draft, [key]: people })} />;
  const starts = new Set(draft.aliyot.map(g => g.startVerse));
  const spans = [...context.spans, ...draft.aliyot.filter(g => !context.spans.some(s => s.startVerse === g.startVerse)).map(g => ({ startVerse: g.startVerse, endVerse: g.startVerse }))];
  return <>
    {ordinary("openingArk", "Opening the ark", "Add everyone who will open the ark. More than two people is fine.")}
    {ordinary("generationToGeneration", "Generation to generation", "List people in the order they will participate, with their relationship if useful.")}
    {ordinary("undressingTorah", "Undressing the Torah", "Usually one or two people; add more if needed.")}
    <section className={styles.aliyot} aria-label="Torah aliyot"><h3>Torah aliyot</h3><p className={styles.help}>The groups below follow the actual reading. Add everyone called together. Ask the rabbis for help with unknown Hebrew names.</p>
      {context.status !== "assigned" && <p className={styles.contextNotice}>{context.status === "unassigned" ? "No Torah reading is assigned yet." : "The tutor has not confirmed the aliyah divisions yet."} You can save the other ceremony roles now.</p>}
      {spans.map((span, i) => <People key={span.startVerse} title={`Aliyah ${i + 1} · ${spanLabel(span)}`} kind="aliyah" people={draft.aliyot.find(g => g.startVerse === span.startVerse)?.participants ?? []} disabled={disabled} onChange={people => {
        const groups = draft.aliyot.filter(g => g.startVerse !== span.startVerse); if (people.length) groups.push({ startVerse: span.startVerse, participants: people as AliyahPerson[] });
        groups.sort((a, b) => spans.findIndex(s => s.startVerse === a.startVerse) - spans.findIndex(s => s.startVerse === b.startVerse)); onChange({ ...draft, aliyot: groups });
      }} />)}
      {!spans.length && !starts.size && <p className={styles.help}>Aliyah names can be added when the reading and its divisions are confirmed.</p>}
    </section>
    {ordinary("redressingTorah", "Redressing the Torah", "Add the people who will dress the Torah.")}
    {ordinary("closingArk", "Closing the ark", "These may be the same people who opened the ark. Add their names again here.")}
    <section className={styles.group}><h3>Parental blessing</h3><p className={styles.help}>Only the service arrangements belong here. Keep the words of your blessing separately.</p><fieldset disabled={disabled}><legend>Will parents give a blessing?</legend><div className={styles.choices}>{[["", "Not decided"], ["yes", "Yes"], ["no", "No"]].map(([value, label]) => <label key={value}><input type="radio" name="honors-blessing" value={value} checked={(draft.parentalBlessing.participation ?? "") === value} onChange={() => onChange({ ...draft, parentalBlessing: { participation: (value || null) as "yes" | "no" | null, delivery: value === "yes" ? draft.parentalBlessing.delivery : null } })} />{label}</label>)}</div></fieldset>
      {draft.parentalBlessing.participation === "yes" && <fieldset disabled={disabled}><legend>How will the blessing be given?</legend><div className={styles.choices}>{[["", "Not decided"], ["together", "Together"], ["separately", "Separately"]].map(([value, label]) => <label key={value}><input type="radio" name="honors-delivery" checked={(draft.parentalBlessing.delivery ?? "") === value} onChange={() => onChange({ ...draft, parentalBlessing: { participation: "yes", delivery: (value || null) as "together" | "separately" | null } })} />{label}</label>)}</div></fieldset>}
    </section>
  </>;
}
