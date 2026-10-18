"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { REFERENCE_ATTRIBUTION } from "../../../../lib/reference-audio/contract";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import type { ReferenceResolution } from "../../../../lib/reference-audio/source";
import { createReadingPlayback, type ReadingPlaybackState, type ReadingSelection } from "./main-playback";
import type { StudyVerse } from "./api";
import styles from "./reading-player.module.css";
export type ReadingPlayerHandle = { select(index: number, selection?: ReadingSelection): void; pause(): void };
export function ReadingPlayer({ scopeKey, verses, active, load, register, onActiveWord }: {
  scopeKey: string; verses: readonly StudyVerse[]; active: boolean;
  load(index: number, signal: AbortSignal): Promise<ReferenceResolution>;
  register(value: ReadingPlayerHandle | null): void;
  onActiveWord(value: { verse: number; index: number } | null): void;
}) {
  const id = useId(), owner = useRef<ReturnType<typeof createReadingPlayback> | null>(null);
  const callbacks = useRef({ load, onActiveWord, active }); callbacks.current = { load, onActiveWord, active };
  const [state, setState] = useState<ReadingPlaybackState | null>(null);
  const pending = useRef<{ index: number; selection: ReadingSelection } | null>(null), pendingFrame = useRef<number | null>(null);
  useLayoutEffect(() => {
    let current = true;
    const playback = createReadingPlayback({ verses: verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); return { ref: verse.ref, readingText: verse.hebrew.readingText, wordCount: projection.status === "ready" ? projection.projection.words.length : 0 }; }),
      load: (index, signal) => callbacks.current.load(index, signal),
      onState: value => { if (current) setState(value); }, onActiveWord: value => { if (current) callbacks.current.onActiveWord(value); },
    }); owner.current = playback; setState(playback.state);
    const playPending = () => { const request = pending.current; pending.current = null; if (current && callbacks.current.active && document.visibilityState === "visible" && request) void playback.select(request.index, request.selection); };
    register({ select(index, selection = "verse") {
      if (!current || document.visibilityState !== "visible") return;
      if (callbacks.current.active) { pending.current = null; void playback.select(index, selection); }
      else { // Parent Start activates the tab in this same interaction, never on a later return.
        pending.current = { index, selection }; if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
        pendingFrame.current = requestAnimationFrame(() => { pendingFrame.current = null; playPending(); });
      }
    }, pause() { if (current) { pending.current = null; playback.pause(); } } });
    const background = () => { if (document.visibilityState !== "visible") { pending.current = null; playback.suspend(); } };
    const leave = () => { pending.current = null; playback.suspend(); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { current = false; pending.current = null; if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current); pendingFrame.current = null;
      register(null); playback.dispose(); if (owner.current === playback) owner.current = null; callbacks.current.onActiveWord(null);
      document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave);
    };
  }, [scopeKey, verses, register]);
  useLayoutEffect(() => { if (!active) { pending.current = null; owner.current?.suspend(); } }, [active]);
  const selected = state?.verse === null || state?.verse === undefined ? null : verses[state.verse], playback = state?.playback;
  const ready = playback?.status === "ready" || playback?.status === "playing", loading = playback?.status === "loading";
  const held = Boolean(state?.timingHeld), words = selected ? projectStudyVerse(selected.ref, selected.hebrew) : null;
  const message = !selected ? "Click a word to hear it, or use a verse number to hear the verse."
    : held ? "Word timing isn’t available for this recording. Choose Whole verse to listen."
      : loading ? "Loading recording…" : playback?.status === "unavailable" ? "A reviewed recording isn’t available for this verse."
        : playback?.status === "error" ? "The recording couldn’t be loaded. Try again." : playback?.retryPlay ? "Your browser needs another tap. Press Play to hear your selection."
          : state?.suspended ? "Playback paused. Choose a word or press Play when you’re ready." : "Click another word to hear it. Repeat keeps your selected word or verse.";
  return <section className={styles.player} aria-label="Reading playback">
    <div className={styles.top}><p className={styles.selection}>{selected ? <><bdi>{selected.ref}</bdi> · {state?.selection === "verse" ? "Whole verse" : `Word ${(state?.selection as number) + 1}`}</> : "Listen to your reading"}</p>
      <div className={styles.controls}><button type="button" disabled={!selected || loading || held} onClick={() => playback?.status === "playing" ? owner.current?.pause() : void owner.current?.play()}>{playback?.status === "playing" ? "Pause" : playback?.status === "error" ? "Try again" : "Play"}</button>
        <button type="button" disabled={!ready || held} aria-pressed={playback?.repeat ?? false} onClick={() => owner.current?.setRepeat(!playback?.repeat)}>Repeat</button></div></div>
    <div className={styles.options}><div className={styles.field}><label htmlFor={`${id}-selection`}>Practice</label><select id={`${id}-selection`} disabled={!selected} value={String(state?.selection ?? "verse")} onChange={event => { if (state?.verse !== null && state?.verse !== undefined) void owner.current?.select(state.verse, event.target.value === "verse" ? "verse" : Number(event.target.value)); }}>
      <option value="verse">Whole verse</option>{words?.status === "ready" && words.projection.words.map(word => <option key={word.index} value={word.index}>Word {word.index + 1}: {word.text}</option>)}
    </select></div><div className={styles.field}><label htmlFor={`${id}-speed`}>Speed</label><select id={`${id}-speed`} disabled={!ready || !playback?.speedSupported} value={playback?.speed ?? 1} onChange={event => owner.current?.setSpeed(Number(event.target.value))}>{[0.5,0.75,1,1.25].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></div></div>
    <p role="status" className={styles.message}>{message}</p>
    {ready && !playback?.speedSupported && <p className={styles.message}>Pitch-preserving speed control isn’t available in this browser.</p>}
    <details className={styles.credit}><summary>Recording credit</summary><p><a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noreferrer">{REFERENCE_ATTRIBUTION.title}</a> · {REFERENCE_ATTRIBUTION.creator} · <a href={REFERENCE_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">{REFERENCE_ATTRIBUTION.license}</a> · {REFERENCE_ATTRIBUTION.changes}</p></details>
  </section>;
}
