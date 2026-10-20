"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import type { StudyWordAids } from "../../../../lib/hebrew/word-aids";
import { WORD_DETAILS_ATTRIBUTION, type StudyWordDetails, type WordGrammar } from "../../../../lib/hebrew/word-details";
import { createWordToolsSelection, type WordToolsState } from "./word-tools-selection";
import type { StudyVerse } from "./api";
import styles from "./word-tools.module.css";
export type WordToolsHandle = Pick<ReturnType<typeof createWordToolsSelection>, "select" | "selectVerse">;
const idle: WordToolsState = Object.freeze({ open: false, selection: null, aids: Object.freeze({ status: "idle" }), details: Object.freeze({ status: "idle" }) });
function Grammar({ value }: { value: WordGrammar }) {
  if (value.status !== "ready") return <p>Grammar isn’t available for this word.</p>;
  return <ul className={styles.grammar}>{value.morphemes.map((part, index) => <li key={index}>{[part.partOfSpeech, part.stem, part.form?.replaceAll("-", " "), part.person && `person ${part.person}`, part.gender, part.number, part.state, part.definite === true ? "definite" : part.definite === false ? "indefinite" : null].filter(Boolean).join(" · ")}</li>)}</ul>;
}
export function WordTools({ scopeKey, verses, register, readAids, readDetails, onHear }: {
  scopeKey: string; verses: readonly StudyVerse[]; register(value: WordToolsHandle | null): void;
  readAids(verse: number, signal: AbortSignal): Promise<StudyWordAids>; readDetails(verse: number, index: number, signal: AbortSignal): Promise<StudyWordDetails>;
  onHear?(verse: number, index: number): void;
}) {
  const id = useId(), callbacks = useRef({ readAids, readDetails }); callbacks.current = { readAids, readDetails };
  const owner = useRef<ReturnType<typeof createWordToolsSelection> | null>(null), [state, setState] = useState<WordToolsState>(idle);
  useLayoutEffect(() => {
    let current = true;
    const tools = createWordToolsSelection({ verses, readAids: (verse, signal) => callbacks.current.readAids(verse, signal), readDetails: (verse, index, signal) => callbacks.current.readDetails(verse, index, signal), onState: value => { if (current) setState(value); } });
    owner.current = tools; setState(tools.state); register({ select: tools.select, selectVerse: tools.selectVerse });
    return () => { current = false; register(null); tools.dispose(); if (owner.current === tools) owner.current = null; };
  }, [scopeKey, verses, register]);
  const selected = state.selection, verse = selected ? verses[selected.verse] : null, projection = verse ? projectStudyVerse(verse.ref, verse.hebrew) : null;
  const words = projection?.status === "ready" ? projection.projection.words : [], word = selected ? words[selected.index] : null;
  const aid = state.aids.status === "ready" && state.aids.value.status === "ready" && selected ? state.aids.value.words[selected.index] : null;
  const details = state.details.status === "ready" && state.details.value.status === "ready" ? state.details.value : null;
  const previous = selected && (selected.index > 0 || verses.slice(0, selected.verse).some(row => projectStudyVerse(row.ref, row.hebrew).status === "ready"));
  const next = selected && (selected.index + 1 < words.length || verses.slice(selected.verse + 1).some(row => projectStudyVerse(row.ref, row.hebrew).status === "ready"));
  return <section className={styles.tools} aria-label="Word tools">
    <button type="button" className={styles.disclosure} aria-expanded={state.open} aria-controls={`${id}-panel`} onClick={() => state.open ? owner.current?.close() : owner.current?.open()}>Word tools</button>
    {state.open && <div id={`${id}-panel`} className={styles.panel}>
      {!word || !verse || !selected ? <p>Word tools aren’t available for this passage.</p> : <>
        <div className={styles.heading}><h4 lang="he" dir="rtl">{word.text}</h4><p><bdi>{verse.ref}</bdi> · Word {selected.index + 1} of {words.length}</p></div>
        <div className={styles.actions}><button type="button" disabled={!previous} onClick={() => owner.current?.navigate(-1)}>Previous word</button><button type="button" disabled={!next} onClick={() => owner.current?.navigate(1)}>Next word</button>{onHear && <button type="button" onClick={() => onHear(selected.verse, selected.index)}>Hear this word</button>}</div>
        <div className={styles.sections}>
          <section aria-label="Syllables and stress"><h5>Syllables and stress</h5>{state.aids.status === "loading" ? <p role="status">Loading word guide…</p> : aid?.status === "ready" ? <><div className={styles.syllables} lang="he" dir="rtl" role="group" aria-label="Hebrew syllables">{aid.syllables.map(part => <span key={part.start} data-stress={part.stress ?? "none"} role="group" aria-describedby={part.stress ? `${id}-${part.stress}` : undefined}>{word.text.slice(part.start, part.end)}</span>)}</div><p className={styles.note}><span id={`${id}-tonic`}>Solid underline: primary stress.</span> <span id={`${id}-secondary`}>Dotted underline: secondary stress.</span></p></> : <p>Syllables and stress aren’t available for this word.</p>}</section>
          <section aria-label="Meaning and grammar"><h5>Meaning in this verse</h5>{state.details.status === "loading" ? <p role="status">Loading word details…</p> : <><p>{details?.occurrence.gloss || "An occurrence meaning isn’t available for this word."}</p><h5>Grammar</h5>{details ? <Grammar value={details.occurrence.grammar} /> : <p>Grammar isn’t available for this word.</p>}</>}</section>
        </div>
        {details && details.dictionary.length > 0 && <section className={styles.dictionary} aria-label="Dictionary senses"><h5>Dictionary senses</h5><p className={styles.note}>Dictionary senses may differ from this word’s meaning in the verse.</p><ul>{details.dictionary.map(entry => <li key={entry.lemma}>{entry.status === "ready" ? <><bdi lang="he" dir="rtl">{entry.headword}</bdi><span>{entry.dictionaryGloss}</span></> : <span>A dictionary sense isn’t available for this entry.</span>}</li>)}</ul><p className={styles.credit}>{WORD_DETAILS_ATTRIBUTION.name} · <a href={WORD_DETAILS_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">{WORD_DETAILS_ATTRIBUTION.license}</a>. Normalized into selected-word facts.</p></section>}
        {(state.aids.status === "error" || state.details.status === "error") && <p className={styles.note}>Some word tools couldn’t be loaded. <button type="button" className={styles.retry} onClick={() => owner.current?.retry()}>Try word tools again</button></p>}
      </>}
    </div>}
  </section>;
}
