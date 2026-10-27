"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import type { StudyWordAids } from "../../../../lib/hebrew/word-aids";
import { carriesQamatsQatan, QAMATS_QATAN_NOTE } from "../../../../lib/hebrew/word-sentence";
import { WORD_DETAILS_ATTRIBUTION, type StudyWordDetails, type WordElsewhere, type WordGrammar, type WordPlace } from "../../../../lib/hebrew/word-details";
import { createWordToolsSelection, type WordToolsState } from "./word-tools-selection";
import type { StudyVerse } from "./api";
import { useOfflineWording } from "../../offline/status";
import { PLAN as OFFLINE } from "../../../../lib/offline/copy";
import styles from "./word-tools.module.css";
/** `reveal`: a tap on a word with nothing else to do opens the card and brings it into view, so the tap visibly does something. */
export type WordToolsHandle = Pick<ReturnType<typeof createWordToolsSelection>, "select" | "selectVerse"> & { reveal(): void };
const idle: WordToolsState = Object.freeze({ open: false, selection: null, aids: Object.freeze({ status: "idle" }), details: Object.freeze({ status: "idle" }) });
function Grammar({ value }: { value: WordGrammar }) {
  if (value.status !== "ready") return <p>Grammar isn’t available for this word.</p>;
  return <ul className={styles.grammar}>{value.morphemes.map((part, index) => <li key={index}>{[part.partOfSpeech, part.stem, part.form?.replaceAll("-", " "), part.person && `person ${part.person}`, part.gender, part.number, part.state, part.definite === true ? "definite" : part.definite === false ? "indefinite" : null].filter(Boolean).join(" · ")}</li>)}</ul>;
}
const PLACES_SHOWN = 3;
function Place({ value, onPlace }: { value: WordPlace; onPlace?(ref: string, wordIndex: number): void }) {
  const body = <><bdi dir="ltr" className={styles.placeRef}>{value.ref}</bdi><span lang="he" dir="rtl" className={styles.snippet}>{value.words.map((word, index) => <span key={index}>{index > 0 && " "}{index === value.mark ? <mark>{word}</mark> : word}</span>)}</span></>;
  return <li>{onPlace ? <button type="button" className={styles.place} aria-label={`Go to ${value.ref}, word ${value.wordIndex + 1}`} onClick={() => onPlace(value.ref, value.wordIndex)}>{body}</button> : <span className={styles.place}>{body}</span>}</li>;
}
/** Other places in the student's own reading, from the STEP lexical id. */
export function WordElsewhereList({ value, onPlace }: { value: WordElsewhere; onPlace?(ref: string, wordIndex: number): void }) {
  if (value.status !== "ready") return <p>Other places for this word aren’t available.</p>;
  // A long reading is searched only part way; the count and places then cover that part, and say so.
  const scope = value.partial ? "in the part of this reading searched" : "in your reading";
  if (value.total === 0) return <p>{`No other places found ${scope}.`}</p>;
  const first = value.places.slice(0, PLACES_SHOWN), rest = value.places.slice(PLACES_SHOWN);
  return <>
    <p>{value.total === 1 ? `It appears 1 more time ${scope}.` : `It appears ${value.total} more times ${scope}.`}</p>
    <ul className={styles.places}>{first.map(place => <Place key={`${place.ref}#${place.wordIndex}`} value={place} onPlace={onPlace} />)}</ul>
    {rest.length > 0 && <details className={styles.more}><summary>More places</summary><ul className={styles.places}>{rest.map(place => <Place key={`${place.ref}#${place.wordIndex}`} value={place} onPlace={onPlace} />)}</ul>
      {value.total > value.places.length && <p className={styles.note}>Showing the first {value.places.length}.</p>}</details>}
  </>;
}
export function WordTools({ scopeKey, verses, register, readAids, readDetails, onHear, onPlace, takePlace }: {
  scopeKey: string; verses: readonly StudyVerse[]; register(value: WordToolsHandle | null): void;
  readAids(verse: number, signal: AbortSignal): Promise<StudyWordAids>; readDetails(verse: number, index: number, signal: AbortSignal): Promise<StudyWordDetails>;
  onHear?(verse: number, index: number): void;
  /** Go to another place of this word in the reading; the owner decides how. */
  onPlace?(ref: string, wordIndex: number): void;
  /** A place chosen on another text page; returns it once, then forgets it. */
  takePlace?(): Readonly<{ ref: string; wordIndex: number }> | null;
}) {
  const id = useId(), callbacks = useRef({ readAids, readDetails, takePlace }); callbacks.current = { readAids, readDetails, takePlace };
  const owner = useRef<ReturnType<typeof createWordToolsSelection> | null>(null), [state, setState] = useState<WordToolsState>(idle);
  // Taken once per mounted instance; a StrictMode effect replay reuses this instance's copy.
  const initialPlace = useRef<Readonly<{ ref: string; wordIndex: number }> | null | undefined>(undefined);
  const [reveal, setReveal] = useState(0), section = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null), focusWord = useRef<Readonly<{ ref: string; wordIndex: number }> | null>(null);
  useLayoutEffect(() => {
    let current = true;
    const tools = createWordToolsSelection({ verses, readAids: (verse, signal) => callbacks.current.readAids(verse, signal), readDetails: (verse, index, signal) => callbacks.current.readDetails(verse, index, signal), onState: value => { if (current) setState(value); } });
    owner.current = tools; setState(tools.state); register({ select: tools.select, selectVerse: tools.selectVerse, reveal: () => { tools.open(); setReveal(count => count + 1); } });
    if (initialPlace.current === undefined) initialPlace.current = callbacks.current.takePlace?.() ?? null;
    const place = initialPlace.current, verse = place ? verses.findIndex(row => row.ref === place.ref) : -1;
    const count = verse >= 0 ? projectStudyVerse(verses[verse].ref, verses[verse].hebrew) : null;
    if (place && count?.status === "ready" && Number.isSafeInteger(place.wordIndex) && place.wordIndex >= 0 && place.wordIndex < count.projection.words.length) { tools.select(verse, place.wordIndex); focusWord.current = place; tools.open(); }
    return () => { current = false; register(null); tools.dispose(); if (owner.current === tools) owner.current = null; };
  }, [scopeKey, verses, register]);
  // Focus follows only the place just chosen; any other selection change drops the intent.
  useEffect(() => {
    const target = focusWord.current, selection = state.selection; if (!target || !selection) return; focusWord.current = null;
    if (verses[selection.verse]?.ref === target.ref && selection.index === target.wordIndex) heading.current?.focus();
  }, [state.selection, verses]);
  // The card sits after the whole passage: after a tap, scroll the page no further than it takes to show the card.
  useEffect(() => { if (reveal > 0 && state.open) section.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [reveal, state.open]);
  const go = onPlace ? (ref: string, wordIndex: number) => { focusWord.current = Object.freeze({ ref, wordIndex }); onPlace(ref, wordIndex); } : undefined;
  const selected = state.selection, verse = selected ? verses[selected.verse] : null, projection = verse ? projectStudyVerse(verse.ref, verse.hebrew) : null;
  const words = projection?.status === "ready" ? projection.projection.words : [];
  const previous = selected && (selected.index > 0 || verses.slice(0, selected.verse).some(row => projectStudyVerse(row.ref, row.hebrew).status === "ready"));
  const next = selected && (selected.index + 1 < words.length || verses.slice(selected.verse + 1).some(row => projectStudyVerse(row.ref, row.hebrew).status === "ready"));
  return <section ref={section} className={styles.tools} aria-label="Word tools">
    <button type="button" className={styles.disclosure} aria-expanded={state.open} aria-controls={`${id}-panel`} onClick={() => state.open ? owner.current?.close() : owner.current?.open()}>Word tools</button>
    {state.open && <WordCard id={`${id}-panel`} state={state} verse={verse} headingRef={heading} onRetry={() => owner.current?.retry()} onPlace={go}
      actions={selected && <><button type="button" disabled={!previous} onClick={() => owner.current?.navigate(-1)}>Previous word</button><button type="button" disabled={!next} onClick={() => owner.current?.navigate(1)}>Next word</button>{onHear && <button type="button" onClick={() => onHear(selected.verse, selected.index)}>Hear this word</button>}</>} />}
  </section>;
}

/**
 * The word card: one selected word's meaning, syllables and stress, grammar, other places and dictionary senses.
 * Word tools on /read and the Learn word sheet both show it, from one createWordToolsSelection state.
 */
export function WordCard({ id, state, verse, heading, headingId, headingRef, actions, showElsewhere = true, compact = false, bare = false, className, onRetry, onPlace }: {
  id?: string; state: WordToolsState; verse: StudyVerse | null;
  /** The word panel in Study shows the word, its place and its actions itself and folds this card's details under its sentence. */ bare?: boolean;
  /** The heading's Hebrew, when the owner shows more than the selected word (a whole maqaf unit). */ heading?: ReactNode;
  headingId?: string; headingRef?: Ref<HTMLHeadingElement>; actions?: ReactNode;
  /** Other places only mean something across a passage; a one-verse owner leaves them out. */ showElsewhere?: boolean;
  /** One column of sections, for a narrow panel. */ compact?: boolean;
  className?: string; onRetry(): void; onPlace?(ref: string, wordIndex: number): void;
}) {
  const offline = useOfflineWording();
  const key = useId(), selected = state.selection, projection = verse ? projectStudyVerse(verse.ref, verse.hebrew) : null;
  const words = projection?.status === "ready" ? projection.projection.words : [], word = selected ? words[selected.index] : null;
  const aid = state.aids.status === "ready" && state.aids.value.status === "ready" && selected ? state.aids.value.words[selected.index] : null;
  const details = state.details.status === "ready" && state.details.value.status === "ready" ? state.details.value : null;
  return <div id={id} className={[styles.panel, compact ? styles.compact : "", className ?? ""].filter(Boolean).join(" ")}>
    {!word || !verse || !selected ? <p>Word tools aren’t available for this passage.</p> : <>
      {!bare && <div className={styles.heading}><h4 id={headingId} className={styles.word} lang="he" dir="rtl" ref={headingRef} tabIndex={-1}>{heading ?? word.text}</h4><p data-testid="word-tools-place" data-word-ref={verse.ref} data-word-position={selected.index + 1} data-word-count={words.length}><bdi>{verse.ref}</bdi> · Word {selected.index + 1} of {words.length}</p></div>}
      {!bare && carriesQamatsQatan(word.text) && <p className={styles.vowelNote}>{QAMATS_QATAN_NOTE}</p>}
      {!bare && actions && <div className={styles.actions}>{actions}</div>}
      <div className={styles.sections}>
        <section aria-label="Meaning in this verse" data-testid="word-meaning"><h5>Meaning in this verse</h5>{state.details.status === "loading" ? <p role="status">Loading word details…</p> : <p>{details?.occurrence.gloss || "An occurrence meaning isn’t available for this word."}</p>}</section>
        <section aria-label="Syllables and stress" data-testid="word-syllables" data-syllables={state.aids.status === "loading" ? "loading" : aid?.status === "ready" ? "ready" : "unavailable"}><h5>Syllables and stress</h5>{state.aids.status === "loading" ? <p role="status">Loading word guide…</p> : aid?.status === "ready" ? <><div className={styles.syllables} lang="he" dir="rtl" role="group" aria-label="Hebrew syllables">{aid.syllables.map(part => <span key={part.start} data-stress={part.stress ?? "none"} role="group" aria-describedby={part.stress ? `${key}-${part.stress}` : undefined}>{word.text.slice(part.start, part.end)}</span>)}</div><p className={styles.note}><span id={`${key}-tonic`}>Solid underline: primary stress.</span> <span id={`${key}-secondary`}>Dotted underline: secondary stress.</span></p></> : <p>Syllables and stress aren’t available for this word.</p>}</section>
        <section aria-label="Grammar"><h5>Grammar</h5>{state.details.status === "loading" ? null : details ? <Grammar value={details.occurrence.grammar} /> : <p>Grammar isn’t available for this word.</p>}</section>
      </div>
      {showElsewhere && details?.elsewhere && <section className={styles.elsewhere} aria-label="This word elsewhere"><h5>This word elsewhere</h5><WordElsewhereList value={details.elsewhere} onPlace={onPlace} /></section>}
      {details && details.dictionary.length > 0 && <section className={styles.dictionary} aria-label="Dictionary senses"><h5>Dictionary senses</h5><p className={styles.note}>Dictionary senses may differ from this word’s meaning in the verse.</p><ul>{details.dictionary.map(entry => <li key={entry.lemma}>{entry.status === "ready" ? <><bdi lang="he" dir="rtl">{entry.headword}</bdi><span>{entry.dictionaryGloss}</span></> : <span>A dictionary sense isn’t available for this entry.</span>}</li>)}</ul><p className={styles.credit}>{WORD_DETAILS_ATTRIBUTION.name} · <a href={WORD_DETAILS_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">{WORD_DETAILS_ATTRIBUTION.license}</a>. Normalized into selected-word facts.</p></section>}
      {(state.aids.status === "error" || state.details.status === "error") && (offline ? <p className={styles.note}>{OFFLINE.needsConnection}</p> : <p className={styles.note}>Some word tools couldn’t be loaded. <button type="button" className={styles.retry} onClick={onRetry}>Try word tools again</button></p>)}
    </>}
  </div>;
}
