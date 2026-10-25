"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import type { StudyWordAids } from "../../../../lib/hebrew/word-aids";
import type { StudyWordDetails } from "../../../../lib/hebrew/word-details";
import { carriesQamatsQatan, QAMATS_QATAN_NOTE, wordSentence } from "../../../../lib/hebrew/word-sentence";
import { PLAN as OFFLINE } from "../../../../lib/offline/copy";
import { useOfflineWording } from "../../offline/status";
import type { StudyVerse } from "./api";
import { WordCard } from "./word-tools";
import { createWordToolsSelection, type WordToolsState } from "./word-tools-selection";
import { adjacentWord } from "./word-nav";
import styles from "./word-tools.module.css";

/**
 * Study's word card (release 1.7): tapping a word opens this beside its verse instead of playing audio. It reads
 * as a sentence first (what kind of word it is, in plain language), then the same Previous word, Next word and
 * Hear this word as the word tools, and folds the dictionary details underneath. The text page registers a host
 * (its verses and how to read word aids and details); the panel keeps no other source.
 */
export type WordPanelHost = Readonly<{
  /** Changes with the text page; a different one starts the card over. */
  scopeKey: string; verses: readonly StudyVerse[];
  readAids(verse: number, signal: AbortSignal): Promise<StudyWordAids>; readDetails(verse: number, index: number, signal: AbortSignal): Promise<StudyWordDetails>;
  /** Plays this one word; absent where there is no listening. */
  onHear?(verse: number, index: number): void;
  /** A reader opened or stepped to a word of this verse (the signed-in reading records the visit). */
  onVisit?(ref: string): void;
  /** Brings a verse of the reading to the reader, loading the text page that holds it first (a source in "Sources for this reading" opens at its verse). */
  reveal?(ref: string): void;
}>;

const idle: WordToolsState = Object.freeze({ open: false, selection: null, aids: Object.freeze({ status: "idle" }), details: Object.freeze({ status: "idle" }) });

/** The card's layout, with nothing fetched: the word and its place, the sentence, the actions, and the folded details. */
export function WordPanelView({ text, place, sentence, actions, details }: { text: string; place: string; sentence: ReactNode; actions: ReactNode; details: ReactNode }) {
  // A word with a qamats qatan says so (the text marks it; see word-sentence.ts).
  return <div className={styles.wordPanel} data-word-panel="">
    <p className={styles.wordText} lang="he" dir="rtl">{text}</p>
    <p className={styles.wordPlace}>{place}</p>
    <p className={styles.sentence} role="status">{sentence}</p>
    {carriesQamatsQatan(text) && <p className={styles.vowelNote}>{QAMATS_QATAN_NOTE}</p>}
    <div className={styles.actions}>{actions}</div>
    <details className={styles.fold}><summary>Dictionary details</summary>{details}</details>
  </div>;
}

export function WordPanelBody({ host, verse, word, onMove, onGone }: {
  host: WordPanelHost; verse: string; word: number; onMove(verse: string, word: number, from?: "previous" | "next"): void; onGone(): void;
}) {
  const latest = useRef(host); latest.current = host;
  const owner = useRef<ReturnType<typeof createWordToolsSelection> | null>(null), [state, setState] = useState<WordToolsState>(idle);
  const offline = useOfflineWording();
  const verseIndex = host.verses.findIndex(row => row.ref === verse), row = host.verses[verseIndex] ?? null;
  const counts = useMemo(() => host.verses.map(value => { const projected = projectStudyVerse(value.ref, value.hebrew); return projected.status === "ready" ? projected.projection.words.length : 0; }), [host.verses]);
  useEffect(() => { if (verseIndex < 0) onGone(); }, [verseIndex, onGone]);
  // One selection owner per text page. It keeps its own sequence counter and aborts the request it replaces, so a slow answer
  // for a word the reader has already left is dropped and never shown on the new one.
  useLayoutEffect(() => {
    let live = true;
    const tools = createWordToolsSelection({ verses: host.verses, readAids: (at, signal) => latest.current.readAids(at, signal),
      readDetails: (at, index, signal) => latest.current.readDetails(at, index, signal), onState: value => { if (live) setState(value); } });
    owner.current = tools; setState(tools.state);
    return () => { live = false; tools.dispose(); if (owner.current === tools) owner.current = null; };
  }, [host.scopeKey, host.verses]);
  useLayoutEffect(() => { if (verseIndex >= 0) { owner.current?.select(verseIndex, word); owner.current?.open(); } }, [verseIndex, word, host.scopeKey, host.verses]);
  if (!row) return null;
  const projection = projectStudyVerse(row.ref, row.hebrew), words = projection.status === "ready" ? projection.projection.words : [], shown = words[word];
  if (!shown) return <p>Word tools aren’t available for this passage.</p>;
  // Only an answer for this very word is shown; anything else is still on its way.
  const current = state.open && state.selection?.verse === verseIndex && state.selection.index === word;
  const loading = !current || state.details.status === "loading" || state.details.status === "idle";
  const details = current && state.details.status === "ready" && state.details.value.status === "ready" ? state.details.value : null;
  const sentence = loading ? "Loading word details…" : details ? wordSentence(details.occurrence.gloss, details.occurrence.grammar) ?? "Grammar isn’t available for this word." : "Grammar isn’t available for this word.";
  const previous = adjacentWord(counts, verseIndex, word, -1), next = adjacentWord(counts, verseIndex, word, 1);
  const go = (to: { verse: number; word: number } | null, from: "previous" | "next") => { if (to) onMove(host.verses[to.verse].ref, to.word, from); };
  const failed = current && (state.aids.status === "error" || state.details.status === "error");
  return <WordPanelView text={shown.text} place={`Word ${word + 1} of ${words.length}`}
    sentence={<>{sentence}{failed && <>{" "}{offline ? OFFLINE.needsConnection : <>Some word tools couldn’t be loaded. <button type="button" className={styles.retry} onClick={() => owner.current?.retry()}>Try word tools again</button></>}</>}</>}
    actions={<>
      <button type="button" data-word-step="previous" disabled={!previous} onClick={() => go(previous, "previous")}>Previous word</button>
      <button type="button" data-word-step="next" disabled={!next} onClick={() => go(next, "next")}>Next word</button>
      {host.onHear && <button type="button" onClick={() => host.onHear?.(verseIndex, word)}>Hear this word</button>}</>}
    details={current ? <WordCard bare compact showElsewhere={false} state={state} verse={row} onRetry={() => owner.current?.retry()} /> : <p role="status">Loading word details…</p>} />;
}
