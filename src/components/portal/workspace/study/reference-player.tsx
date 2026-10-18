"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { REFERENCE_ATTRIBUTION } from "../../../../lib/reference-audio/contract";
import { createReferencePlayback, type ReferencePlayback, type ReferencePlaybackState } from "../../../../lib/reference-audio/playback";
import type { ReferenceResolution } from "../../../../lib/reference-audio/source";
import styles from "./reference-player.module.css";

export type ReferencePlayerProps = {
  scopeKey: string; verseRef: string; readingText: string; wordCount: number;
  load(signal: AbortSignal): Promise<ReferenceResolution>;
  onActiveWord(index: number | null): void;
  registerWordSelection?(select: ((index: number) => void) | null): void;
  registerPause?(pause: (() => void) | null): void;
  wordLabels?: readonly string[];
};
const initial: ReferencePlaybackState = { status: "idle", selection: "verse", repeat: false, speed: 1, speedSupported: false, wordsReady: false, wordCount: 0, retryPlay: false };

/** Explicit Load and Play preserve mobile gesture requirements. This isolated
 * surface does not fetch on mount, mark visits, or integrate with study scope. */
export function ReferencePlayer({ scopeKey, verseRef, readingText, wordCount, load, onActiveWord, registerWordSelection, registerPause, wordLabels }: ReferencePlayerProps) {
  const id = useId(), player = useRef<ReferencePlayback | null>(null), callbacks = useRef({ load, onActiveWord });
  callbacks.current = { load, onActiveWord };
  const [state, setState] = useState<ReferencePlaybackState>(initial);
  // Stop the old mount before paint/media callbacks can target a new verse.
  useLayoutEffect(() => {
    let current = true;
    const controller = createReferencePlayback({ ref: verseRef, readingText, wordCount,
      load: signal => callbacks.current.load(signal),
      onState: value => { if (current) setState(value); },
      onActiveWord: index => { if (current) callbacks.current.onActiveWord(index); },
    });
    player.current = controller; setState(controller.state); callbacks.current.onActiveWord(null);
    // Captures this controller only. An escaped old handle cannot seek a new scope.
    registerWordSelection?.(index => { if (current) controller.select(index); });
    registerPause?.(() => { if (current) controller.pause(); });
    return () => {
      controller.dispose(); current = false; registerWordSelection?.(null); registerPause?.(null);
      if (player.current === controller) player.current = null;
    };
  }, [scopeKey, verseRef, readingText, wordCount, registerWordSelection, registerPause]);
  useLayoutEffect(() => {
    const background = () => { if (document.visibilityState !== "visible") player.current?.pause(); };
    const leave = () => player.current?.pause();
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, []);
  const ready = state.status === "ready" || state.status === "playing";
  const message = state.status === "idle" ? "Load the reference recording when you’re ready to listen."
    : state.status === "loading" ? "Loading and checking the recording…"
      : state.status === "unavailable" ? "A reviewed reference recording isn’t available for this verse."
        : state.status === "error" ? "The recording couldn’t be loaded. Try loading it again."
          : state.retryPlay ? "Press Play again to start the recording."
            : !state.wordsReady ? "Verse playback is available. Word timing isn’t available for this text." : "Choose the verse or a word to practice.";
  return <section className={styles.player} aria-label={`Reference recording for ${verseRef}`}>
    <div className={styles.controls}>
      <button type="button" disabled={state.status === "loading"} onClick={() => { void player.current?.load(); }}>{ready ? "Reload recording" : "Load recording"}</button>
      <button type="button" disabled={!ready} onClick={() => { if (state.status === "playing") player.current?.pause(); else void player.current?.play(); }}>{state.status === "playing" ? "Pause" : "Play"}</button>
      <button type="button" disabled={!ready} aria-pressed={state.repeat} onClick={() => player.current?.setRepeat(!state.repeat)}>Repeat</button>
    </div>
    <div className={styles.options}>
      <div><label htmlFor={`${id}-selection`}>Practice</label>
        <select id={`${id}-selection`} disabled={!ready} value={String(state.selection)} onChange={event => player.current?.select(event.target.value === "verse" ? "verse" : Number(event.target.value))}>
          <option value="verse">Whole verse</option>
          {state.wordsReady && Array.from({ length: state.wordCount }, (_, index) => <option key={index} value={index}>Word {index + 1}{wordLabels?.length === wordCount ? `: ${wordLabels[index]}` : ""}</option>)}
        </select>
      </div>
      <div><label htmlFor={`${id}-speed`}>Speed</label>
        <select id={`${id}-speed`} disabled={!ready || !state.speedSupported} value={state.speed} onChange={event => player.current?.setSpeed(Number(event.target.value))}>
          {[0.5, 0.75, 1, 1.25].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
        </select>
      </div>
    </div>
    <p className="field-help" role="status">{message}</p>
    {ready && !state.speedSupported && <p className="field-help">Pitch-preserving speed control isn’t available in this browser.</p>}
    <details className={styles.credit}><summary>Recording credit</summary><p><a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noreferrer">{REFERENCE_ATTRIBUTION.title}</a> · {REFERENCE_ATTRIBUTION.creator} · <a href={REFERENCE_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">{REFERENCE_ATTRIBUTION.license}</a> · {REFERENCE_ATTRIBUTION.changes}</p></details>
  </section>;
}
