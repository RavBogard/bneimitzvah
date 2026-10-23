"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useStudyLens } from "../workspace/study-lens";
import { fetchPublicRefReading, refSource } from "../public-reading/api";
import { readAddress } from "../public-reading/urls";
import { displayRange, go, Hero, longDate, PassageReading, replaceAddress, Shell, useChooser, useStarter, type LabelledSource } from "../public-reading/view";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { conflictMark, fetchSavedPage, parseSavedReading, removeSavedReading, setSavedMark, updateSavedReading, type SavedMark, type SavedPage, type SavedReading, type SavedWork, type WorkStream } from "./api";
import { OwnLayerScope } from "../workspace/study/own-layer";
import { useSavedOwnLayer, type VerseWork } from "./yours";
import styles from "./saved.module.css";

const kindName = (kind: SavedReading["kind"]) => kind === "torah" ? "Torah" : "Haftarah";
const workOf = (row: Extract<SavedPage, { state: "ready" }>["verses"][number]): VerseWork => ({ translation: row.translation, note: row.note });
const PAGE = 10;
type Header = Readonly<{ status: "loading" } | { status: "ready"; reading: SavedReading } | { status: "signed-out" | "not-eligible" | "missing" | "failed" }>;
type Text = Readonly<{ key: string; sources?: readonly LabelledSource[]; error?: boolean }>;

/** What the member's own reading says above the passage: the state that keeps it from showing, if any. */
export function SavedReadingState({ status, onRetry }: { status: "signed-out" | "not-eligible" | "missing" | "failed"; onRetry: () => void }) {
  return <div className="workspace-state" role="status">
    {status === "signed-out" ? <><h2>Sign in to open this reading</h2><p>Saved readings belong to the account that saved them.</p><a className="button-secondary" href="/sign-in">Sign in</a></>
      : status === "not-eligible" ? <><h2>This account doesn’t keep saved readings</h2><p>An account can save readings and keep its own marks on them.</p><a className="button-secondary" href="/account">Ask for an account</a></>
        : status === "missing" ? <><h2>This reading isn’t in your saved readings</h2><p>It may have been removed. Everything else on this page is open to anyone.</p><a className="button-secondary" href="/read">Go to this week</a></>
          : <><h2>Your reading didn’t load</h2><p>Check your connection and try again.</p><button type="button" className="button-secondary" onClick={onRetry}>Try again</button></>}
  </div>;
}

export type EditStep = "closed" | "open" | "saving" | "confirm" | "removing";
/** The Edit disclosure: rename, re-date, or remove with an inline confirmation. Never a dialog. */
export function SavedReadingEdit({ step, panelId, name, date, notice, onName, onDate, onSave, onCancel, onAskRemove, onRemove, onKeep }: {
  step: EditStep; panelId: string; name: string; date: string; notice: string;
  onName(value: string): void; onDate(value: string): void; onSave(): void; onCancel(): void; onAskRemove(): void; onRemove(): void; onKeep(): void;
}) {
  if (step === "closed") return notice ? <p className={styles.editNotice} role="status">{notice}</p> : null;
  const busy = step === "saving" || step === "removing";
  return <div id={panelId} className={styles.panel} data-edit-step={step}>
    <form className={styles.editForm} aria-label="Edit this reading" onSubmit={event => { event.preventDefault(); onSave(); }}>
      <div><label htmlFor={`${panelId}-name`}>Name</label>
        <input id={`${panelId}-name`} name="name" value={name} maxLength={80} required autoComplete="off" disabled={busy} onChange={event => onName(event.target.value)} /></div>
      <div><label htmlFor={`${panelId}-date`}>Date <span className={styles.optional}>(optional)</span></label>
        <input id={`${panelId}-date`} name="date" type="date" value={date} disabled={busy} onChange={event => onDate(event.target.value)} /></div>
      {notice && <p className="request-error" role="alert">{notice}</p>}
      <div className={styles.actions}>
        <button type="submit" className="button-primary" disabled={busy}>Save changes</button>
        <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
    <div className={styles.remove}>
      {step === "confirm" || step === "removing" ? <>
        <p className={styles.confirmLine}>Removes this reading with its marks, notes and translation. This can’t be undone.</p>
        <div className={styles.actions}>
          <button type="button" className={`button-secondary ${styles.danger}`} disabled={step === "removing"} onClick={onRemove}>Remove</button>
          <button type="button" className="button-secondary" disabled={step === "removing"} onClick={onKeep}>Keep it</button>
        </div>
      </> : <button type="button" className={`button-secondary ${styles.danger}`} disabled={busy} onClick={onAskRemove}>Remove reading</button>}
    </div>
  </div>;
}

const check = <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const markLabels = { working: "Still working", "got-it": "Got it" } as const;
/** A verse's own mark in Lein: Still working or Got it, pressed again to clear, with the progress marks' look. */
export function SavedVerseMarks({ verseRef, mark, pending, notice, onChoose, onShow }: { verseRef: string; mark: SavedMark | null | undefined; pending: boolean; notice: string;
  onChoose(state: "working" | "got-it"): void; onShow?(ref: string): void }) {
  // The verse's mark loads with its page of ten when the verse is first chosen.
  useEffect(() => { onShow?.(verseRef); }, [onShow, verseRef]);
  return <div className={styles.marksRow}>
    <div className={styles.marks} role="group" aria-label={`How ${verseRef} is going`}>
      {(["working", "got-it"] as const).map(state => <button key={state} type="button" className={styles.mark} data-state={state} aria-pressed={mark?.state === state}
        aria-disabled={pending || mark === undefined || undefined} onClick={() => { if (!pending && mark !== undefined) onChoose(state); }}>{state === "got-it" && check}{markLabels[state]}</button>)}
    </div>
    <p className={styles.markNote} role="status">{notice}</p>
  </div>;
}

/**
 * /read?saved=<id>: a member's own saved reading. The passage comes from the account (never the address), so the
 * same text, recordings and tools open on it; above it the reading's name and date with Edit, and in Lein each
 * selected verse carries its Still working / Got it mark. In Study each verse has its closed Yours row and each inline comment its
 * star (PR 3), and the translate drill reveals the member's own translation. A tab coming back revalidates quietly and stays mounted.
 */
export function SavedReadingPage({ id, verse }: { id: string; verse: number | null }) {
  const lens = useStudyLens(), chooser = useChooser(), starter = useStarter(), editId = useId();
  const [header, setHeader] = useState<Header>({ status: "loading" }), [retry, setRetry] = useState(0), [linked, setLinked] = useState(verse);
  const [text, setText] = useState<Text | null>(null), [textRetry, setTextRetry] = useState(0);
  const [edit, setEdit] = useState<EditStep>("closed"), [draft, setDraft] = useState({ name: "", date: "" }), [editNotice, setEditNotice] = useState("");
  const [marks, setMarks] = useState<ReadonlyMap<string, SavedMark | null>>(new Map()), [pending, setPending] = useState<string | null>(null), [markNotice, setMarkNotice] = useState<{ ref: string; text: string } | null>(null);
  const [work, setWork] = useState<ReadonlyMap<string, VerseWork>>(new Map());
  const loadedPages = useRef(new Set<number>()), live = useRef<AbortController | null>(null);
  const reading = header.status === "ready" ? header.reading : null;

  const loadHeader = useCallback(async (quiet: boolean, signal: AbortSignal) => {
    try {
      const page = await fetchSavedPage(id, 0, signal);
      if (signal.aborted) return;
      if (page.state !== "ready") { setHeader({ status: page.state }); return; }
      setHeader(current => current.status === "ready" && JSON.stringify(current.reading) === JSON.stringify(page.reading) ? current : { status: "ready", reading: page.reading });
      // The first page's marks come with it; later pages load when one of their verses is chosen.
      loadedPages.current = new Set([0]);
      setMarks(new Map(page.verses.map(row => [row.ref, row.mark])));
      setWork(new Map(page.verses.map(row => [row.ref, workOf(row)])));
    } catch { if (!signal.aborted && !quiet) setHeader({ status: "failed" }); }
  }, [id]);
  useEffect(() => { const controller = new AbortController(); setHeader({ status: "loading" }); void loadHeader(false, controller.signal); return () => controller.abort(); }, [loadHeader, retry]);
  // Back to the tab: check quietly that the reading is still this member's and unchanged; the page stays mounted.
  // Restored from the back-forward cache (say, after signing out on a shared device): hide everything first, then ask again.
  useEffect(() => {
    let controller: AbortController | null = null;
    const check = (quiet: boolean) => { controller?.abort(); controller = new AbortController(); if (!quiet) { setEdit("closed"); setHeader({ status: "loading" }); } void loadHeader(quiet, controller.signal); };
    const back = () => { if (document.visibilityState === "visible") check(true); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) check(false); };
    document.addEventListener("visibilitychange", back); window.addEventListener("pageshow", restored);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("pageshow", restored); controller?.abort(); };
  }, [loadHeader]);
  useEffect(() => { replaceAddress(readAddress({ mode: "saved", id }, { verse: linked, study: lens.lens === "study" })); }, [id, linked, lens.lens]);

  // The passage itself, by its canonical ref, from the same open routes as any reading.
  const textKey = reading ? JSON.stringify([reading.kind, reading.ranges]) : "";
  useEffect(() => {
    if (!reading) return;
    const controller = new AbortController(), key = JSON.stringify([reading.kind, reading.ranges]);
    setText(current => current?.key === key && current.sources ? current : { key });
    fetchPublicRefReading(reading.ranges, reading.kind, controller.signal).then(value => {
      if (!controller.signal.aborted) setText(current => current?.key === key && current.sources ? current : { key, sources: [Object.freeze({ label: kindName(reading.kind), source: refSource(value) })] });
    }, () => { if (!controller.signal.aborted) setText({ key, error: true }); });
    return () => controller.abort();
  }, [textKey, textRetry]); // eslint-disable-line react-hooks/exhaustive-deps
  const sources = text?.key === textKey ? text.sources : undefined;

  const verses = useMemo(() => { try { return reading ? expandReadingRanges(reading.ranges.split("; "), reading.kind, TANAKH_VERSE_COUNTS) : []; } catch { return []; } }, [reading?.ranges, reading?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const ensureMarks = useCallback((ref: string) => {
    const at = verses.indexOf(ref); if (at < 0) return;
    const offset = Math.floor(at / PAGE) * PAGE;
    if (loadedPages.current.has(offset)) return;
    loadedPages.current.add(offset);
    fetchSavedPage(id, offset).then(page => {
      if (page.state !== "ready") { loadedPages.current.delete(offset); return; }
      setMarks(current => { const next = new Map(current); for (const row of page.verses) next.set(row.ref, row.mark); return next; });
      setWork(current => { const next = new Map(current); for (const row of page.verses) next.set(row.ref, workOf(row)); return next; });
    }, () => { loadedPages.current.delete(offset); });
  }, [id, verses]);
  const choose = (ref: string, state: "working" | "got-it") => {
    if (!reading) return;
    const current = marks.get(ref) ?? null, next = current?.state === state ? "unmarked" : state;
    setPending(ref); setMarkNotice(null);
    setSavedMark({ readingId: reading.id, verseRef: ref, expectedVersion: current?.version ?? 0, state: next }).then(result => {
      setPending(null);
      if (result.ok) { setMarks(map => new Map(map).set(ref, result.value)); return; }
      if (result.code === "conflict") {
        const saved = conflictMark(result.current);
        if (saved !== undefined) { setMarks(map => new Map(map).set(ref, saved)); setMarkNotice({ ref, text: "This mark changed elsewhere. It shows what’s saved now." }); return; }
      }
      setMarkNotice({ ref, text: result.code === "limit" ? "This account has as many marks as it can keep." : "The mark didn’t save. Try again." });
      if (result.code === "signed-out" || result.code === "not-eligible" || result.code === "missing") setRetry(value => value + 1);
    });
  };
  const putWork = useCallback((ref: string, stream: WorkStream, value: SavedWork | null) => setWork(current => {
    const next = new Map(current), row = next.get(ref) ?? { translation: null, note: null };
    next.set(ref, stream === "translation" ? { ...row, translation: value } : { ...row, note: value }); return next;
  }), []);
  const own = useSavedOwnLayer({ readingId: id, active: header.status === "ready", work, putWork, ensure: ensureMarks, refused: () => setRetry(value => value + 1), openStudy: () => lens.setLens("study") });
  const verseExtra = (ref: string): ReactNode =>
    <SavedVerseMarks key={ref} onShow={ensureMarks} verseRef={ref} mark={marks.has(ref) ? marks.get(ref) : undefined} pending={pending === ref} notice={markNotice?.ref === ref ? markNotice.text : ""} onChoose={state => choose(ref, state)} />;

  const begin = () => { live.current?.abort(); const controller = new AbortController(); live.current = controller; return controller; };
  const openEdit = () => {
    if (!reading) return;
    if (edit !== "closed") { setEdit("closed"); setEditNotice(""); return; }
    setDraft({ name: reading.name, date: reading.date ?? "" }); setEditNotice(""); setEdit("open");
  };
  const conflictWith = (current: unknown) => {
    const saved = parseSavedReading(current);
    if (saved) { setHeader({ status: "ready", reading: saved }); setDraft({ name: saved.name, date: saved.date ?? "" }); }
    setEditNotice("This reading changed elsewhere. The form shows what’s saved now."); setEdit("open");
  };
  const save = () => {
    if (!reading) return;
    const name = draft.name.trim(), length = Array.from(name).length;
    if (length < 1 || length > 80 || (draft.date && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date))) { setEditNotice("Use a name of 1 to 80 characters and a real date, or leave the date empty."); return; }
    const controller = begin(); setEdit("saving"); setEditNotice("");
    updateSavedReading({ id: reading.id, revision: reading.revision, name, date: draft.date || null }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) { setHeader({ status: "ready", reading: result.value }); setEdit("closed"); setEditNotice("Saved."); return; }
      if (result.code === "conflict") { conflictWith(result.current); return; }
      if (result.code === "signed-out" || result.code === "not-eligible" || result.code === "missing") { setEdit("closed"); setHeader({ status: result.code }); return; }
      setEdit("open"); setEditNotice(result.code === "invalid" ? "Use a name of 1 to 80 characters and a real date, or leave the date empty." : "The change didn’t save. Try again.");
    });
  };
  const remove = () => {
    if (!reading) return;
    const controller = begin(); setEdit("removing");
    removeSavedReading({ id: reading.id, revision: reading.revision }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.ok) { go("/"); return; }
      if (result.code === "conflict") { conflictWith(result.current); return; }
      if (result.code === "signed-out" || result.code === "not-eligible" || result.code === "missing") { setEdit("closed"); setHeader({ status: result.code }); return; }
      setEdit("confirm"); setEditNotice("The reading wasn’t removed. Try again.");
    });
  };
  useEffect(() => () => live.current?.abort(), []);

  const editButton = reading && <button type="button" className="button-hero-secondary" aria-expanded={edit !== "closed"} aria-controls={edit !== "closed" ? editId : undefined} onClick={openEdit}>Edit</button>;
  // The private name stays on the page; the tab title (and so browser history) only ever says "My reading".
  return <Shell title="My reading" signedIn={header.status === "ready"}>
    <Hero eyebrow="My reading" title={reading ? reading.name : header.status === "loading" ? "Loading your reading" : "Reading unavailable"}
      meta={reading && <>{reading.date && <><time dateTime={reading.date}>{longDate(reading.date)}</time> · </>}{kindName(reading.kind)} <bdi dir="ltr">{displayRange([reading.ranges])}</bdi></>}
      nav={<><button type="button" className="button-hero-secondary" onClick={() => go(readAddress({ mode: "week", date: null, kind: null }, { study: lens.lens === "study" }))}>This week</button>{chooser.button}</>}
      actions={reading && starter.row(editButton)} />
    {chooser.panel}
    {reading && <SavedReadingEdit step={edit} panelId={editId} name={draft.name} date={draft.date} notice={editNotice}
      onName={value => setDraft(current => ({ ...current, name: value }))} onDate={value => setDraft(current => ({ ...current, date: value }))}
      onSave={save} onCancel={() => { live.current?.abort(); setEdit("closed"); setEditNotice(""); }} onAskRemove={() => { setEditNotice(""); setEdit("confirm"); }} onRemove={remove} onKeep={() => setEdit("open")} />}
    {header.status !== "loading" && header.status !== "ready" && <SavedReadingState status={header.status} onRetry={() => setRetry(value => value + 1)} />}
    {reading && text?.key === textKey && text.error && <div className="workspace-state" role="status"><h2>The text didn’t load</h2><p>Check your connection and try again.</p>
      <button type="button" className="button-secondary" onClick={() => setTextRetry(value => value + 1)}>Try again</button></div>}
    {reading && sources && <OwnLayerScope value={own}><PassageReading key={textKey} sources={sources} index={0} onIndex={() => {}} verse={linked} onVerseLeft={() => setLinked(null)}
      registerStart={starter.register} retry={textRetry} onRetry={() => setTextRetry(value => value + 1)} verseExtra={verseExtra} /></OwnLayerScope>}
  </Shell>;
}
