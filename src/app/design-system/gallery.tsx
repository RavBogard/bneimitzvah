"use client";
import { useRef, useState } from "react";
import { Button, ButtonLink, Chip, EmptyState, List, ListRow, PageHeader, Segmented, Sheet } from "../../components/ui";
import styles from "./gallery.module.css";

// Fixture words only (this page is never served outside the browser tests).
const CHOICES = [{ value: "one", label: "First" }, { value: "two", label: "Second" }, { value: "three", label: "Third" }] as const;

export function Gallery() {
  const [choice, setChoice] = useState<(typeof CHOICES)[number]["value"]>("one");
  const [pressed, setPressed] = useState(0), [confirmed, setConfirmed] = useState(0);
  const [sheet, setSheet] = useState(false), [word, setWord] = useState(false);
  const target = useRef<HTMLSpanElement>(null);
  // The third item settles slowly, so the browser tests can see the sheet refuse to close while the action is running.
  const remove = (title: string, confirmLabel: string, cancelLabel: string, description?: string, slow = false) =>
    ({ title, description, confirmLabel, cancelLabel, onConfirm: async () => { if (slow) await new Promise(done => setTimeout(done, 700)); setConfirmed(count => count + 1); } });
  return <main className={styles.page} id="main">
    <PageHeader title="Component page" description="Every component, with fixture words." actions={<Button variant="primary" onClick={() => setPressed(count => count + 1)}>Header action</Button>} />
    <section className={styles.section} aria-labelledby="g-buttons">
      <h2 id="g-buttons">Buttons</h2>
      <div className={styles.row}>
        <Button variant="primary">Primary action</Button>
        <Button variant="secondary">Secondary action</Button>
        <Button variant="quiet">Quiet action</Button>
        <Button variant="primary" disabled>Disabled primary</Button>
        <ButtonLink href="/design-system" variant="secondary">Link as button</ButtonLink>
      </div>
      <div className={styles.row}>
        <Button variant="primary" destructive confirm={remove("Remove this item?", "Remove item", "Keep item", "This is fixture text for the confirm sheet.")}>Remove primary</Button>
        <Button variant="secondary" destructive confirm={remove("Remove the second item?", "Remove second", "Keep second")}>Remove secondary</Button>
        <Button variant="quiet" destructive confirm={remove("Remove the third item?", "Remove third", "Keep third", undefined, true)}>Remove quiet</Button>
      </div>
      <p role="status" id="confirmed">Confirmed {confirmed}. Header action pressed {pressed}.</p>
    </section>
    <section className={styles.section} aria-labelledby="g-sheet">
      <h2 id="g-sheet">Sheet</h2>
      <div className={styles.row}>
        <Button id="open-sheet" variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
        <span ref={target} id="word-target" tabIndex={0} role="button" className={styles.word} onClick={() => setWord(true)}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setWord(true); } }}>Word target</span>
      </div>
    </section>
    <section className={styles.section} aria-labelledby="g-rows">
      <h2 id="g-rows">List rows</h2>
      <List label="Fixture rows">
        <ListRow title="Link row" meta="A second line" trailing={<Chip tone="info">Open</Chip>} href="/design-system" />
        <ListRow title="Button row" meta="Presses the header action" trailing={<Chip tone="attention">Needs you</Chip>} onClick={() => setPressed(count => count + 1)} />
        <ListRow title="Plain row" meta="Not a control" trailing={<Chip tone="done">Done</Chip>} />
        <ListRow title="A long row title that has to wrap on a narrow screen without losing its trailing word at the end" trailing={<Chip tone="danger">Overdue</Chip>} />
      </List>
    </section>
    <section className={styles.section} aria-labelledby="g-seg">
      <h2 id="g-seg">Segmented</h2>
      <Segmented label="Fixture choice" options={CHOICES} value={choice} onChange={setChoice} />
      <p id="choice">Chosen {choice}.</p>
    </section>
    <section className={styles.section} aria-labelledby="g-chips">
      <h2 id="g-chips">Chips</h2>
      <div className={styles.row}>
        <Chip>Neutral</Chip><Chip tone="attention">Attention</Chip><Chip tone="done">Done</Chip><Chip tone="info">Info</Chip><Chip tone="danger">Danger</Chip>
      </div>
    </section>
    <section className={styles.section} aria-labelledby="g-empty">
      <h2 id="g-empty">Empty state</h2>
      <EmptyState level={3} title="Nothing here yet" description="Fixture sentence saying what is missing and what to do." action={<Button variant="primary">Empty action</Button>} />
    </section>
    <Sheet open={sheet} onClose={() => setSheet(false)} title="Fixture sheet" closeLabel="Close fixture sheet"
      footer={<><Button variant="secondary" onClick={() => setSheet(false)}>Cancel sheet</Button><Button variant="primary" onClick={() => setSheet(false)}>Save sheet</Button></>}>
      <p>Fixture body that is long enough to be a paragraph in a sheet.</p>
      <label htmlFor="sheet-field">Fixture field</label>
      <input id="sheet-field" type="text" autoComplete="off" />
      <p><a href="/design-system">Fixture link</a></p>
    </Sheet>
    <Sheet open={word} onClose={() => setWord(false)} title="Word sheet" closeLabel="Close word sheet" returnFocusTo={() => target.current}
      footer={<Button variant="primary" onClick={() => setWord(false)}>Done with word</Button>}>
      <p>Fixture body for a sheet that opened from a text target.</p>
    </Sheet>
  </main>;
}
