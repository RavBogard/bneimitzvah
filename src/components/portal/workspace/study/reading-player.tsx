"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { SHORT_SOURCE_ATTRIBUTION } from "../../../../lib/reference-audio/short-source";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import type { ReferenceShortResolution } from "../../../../lib/reference-audio/short-resolution";
import type { ReadingPlaybackState, ReadingSelection } from "./main-playback";
import { createShortReadingPlayback } from "./short-main-playback";
import type { StudyVerse } from "./api";
import { createReadingPlayerIntent, readingAudioCurrent, readingPlayerPreview, createReadingPlayerTarget } from "./reading-player-intent";
import type { ReadingAudioSlot, createReadingAudioCoordinator } from "./reading-audio-coordinator";
import styles from "./reading-player.module.css";
export type ReadingPlayerHandle = { select(index: number, selection?: ReadingSelection): void; pause(): void; suspend(): void };
/** Main-text activation chooses the verse; grammar retains the tapped word.
 * Explicit Practice/WordTools drills continue to use numeric selections. */
export function playMainVerseForWord(player: Pick<ReadingPlayerHandle, "select"> | null, tools: { select(verse: number, word: number): void } | null, verse: number, word: number) {
  if (!Number.isSafeInteger(verse) || verse < 0 || !Number.isSafeInteger(word) || word < 0) return;
  player?.select(verse, "verse"); tools?.select(verse, word);
}
export function ReadingPlayer({ scopeKey, verses, active, enabled = true, expiresAt, audio, wordTools = true, target, load, register, onActiveWord, onPlaybackState }: {
  scopeKey: string; verses: readonly StudyVerse[]; active: boolean; enabled?: boolean; expiresAt?: number; wordTools?: boolean;
  /** Missing composition renders inert controls; it never creates a local fallback. */
  /** Controlled modal target; changes are inert until explicit selection. */
  target?: { index: number; generation: number };
  audio?: { coordinator: ReturnType<typeof createReadingAudioCoordinator>; slot: ReadingAudioSlot };
  load(index: number, signal: AbortSignal): Promise<ReferenceShortResolution>;
  register(value: ReadingPlayerHandle | null): void;
  onActiveWord(value: { verse: number; index: number } | null): void;
  /** Observation only (the admin listening review times tap to sound); never changes playback. */
  onPlaybackState?(value: ReadingPlaybackState): void;
}) {
  const id = useId(), owner = useRef<ReturnType<typeof createShortReadingPlayback> | null>(null);
  const callbacks = useRef({ load, onActiveWord, onPlaybackState, active, enabled, expiresAt, target }); callbacks.current = { load, onActiveWord, onPlaybackState, active, enabled, expiresAt, target };
  const targetOwner = useRef<ReturnType<typeof createReadingPlayerTarget> | null>(null);
  if (!targetOwner.current) targetOwner.current = createReadingPlayerTarget();
  const targetCurrent = () => targetOwner.current!.current(callbacks.current.target);
  const [state, setState] = useState<ReadingPlaybackState | null>(null);
  const intent = useRef<ReturnType<typeof createReadingPlayerIntent> | null>(null);
  useLayoutEffect(() => {
    if (!audio) return; // No uncoordinated playback path.
    let current = true;
    let owned: ReturnType<typeof createReadingPlayerIntent> | undefined;
    const playback = createShortReadingPlayback({ verses: verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); return { ref: verse.ref, readingText: verse.hebrew.readingText, wordCount: projection.status === "ready" ? projection.projection.words.length : 0 }; }),
      canContinue: () => current && callbacks.current.active && callbacks.current.enabled && readingAudioCurrent(callbacks.current.expiresAt) && Boolean(owned?.isCurrent()) && targetCurrent(),
      load: async (index, signal) => { if (!owned?.isCurrent()) throw new Error("Reading intent replaced"); const result = await callbacks.current.load(index, signal); if (!owned?.isCurrent()) throw new Error("Reading intent replaced"); return result; },
      onState: value => { if (current) { setState(value); try { callbacks.current.onPlaybackState?.(value); } catch { /* Observers never affect playback. */ } } }, onActiveWord: value => { if (current && (value === null || owned?.isCurrent() && targetCurrent())) callbacks.current.onActiveWord(value); },
    });
    owned = createReadingPlayerIntent({ coordinator: audio.coordinator, slot: audio.slot, playback,
      enabled: () => current && callbacks.current.enabled && readingAudioCurrent(callbacks.current.expiresAt), active: () => callbacks.current.active,
      visible: () => document.visibilityState === "visible", frame: callback => requestAnimationFrame(callback), cancelFrame: cancelAnimationFrame });
    const selectedIntent = owned; owner.current = playback; intent.current = selectedIntent; setState(playback.state);
    register({ select: (index, selection) => { targetOwner.current!.select(callbacks.current.target); selectedIntent.select(index, selection); }, pause: selectedIntent.pause, suspend: () => { targetOwner.current!.clear(); selectedIntent.suspend(); } });
    const background = () => { if (document.visibilityState !== "visible") selectedIntent.suspend(); };
    const leave = () => selectedIntent.suspend();
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { current = false; register(null); selectedIntent.dispose(); playback.dispose();
      if (owner.current === playback) owner.current = null; if (intent.current === selectedIntent) intent.current = null; callbacks.current.onActiveWord(null);
      document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave);
    };
  }, [scopeKey, verses, register, audio?.coordinator, audio?.slot]);
  useLayoutEffect(() => { if (!active || !enabled) intent.current?.suspend(); }, [active, enabled]);
  useLayoutEffect(() => { if (target) intent.current?.suspend(); }, [target?.index, target?.generation]);
  const preview = readingPlayerPreview(state, target?.index, targetCurrent());
  const selected = preview.index === null ? null : verses[preview.index], playback = preview.current ? state?.playback : undefined;
  const choose = (index: number, selection: ReadingSelection = "verse") => { targetOwner.current!.select(callbacks.current.target); intent.current?.select(index, selection); };
  const play = () => { if (preview.index === null) return; if (!preview.current) choose(preview.index); else intent.current?.play(); };
  const ready = playback?.status === "ready" || playback?.status === "playing", loading = playback?.status === "loading";
  const deadlineCurrent = readingAudioCurrent(expiresAt), actionable = enabled && deadlineCurrent;
  const held = preview.current && Boolean(state?.timingHeld), words = selected ? projectStudyVerse(selected.ref, selected.hebrew) : null;
  const message = !deadlineCurrent ? "Refresh the reading to listen again." : !selected ? "Tap a word or verse number to hear the whole verse. Choose a word in Practice for a word drill."
    : held ? "Word timing isn’t available for this recording. Choose Whole verse to listen."
      : loading ? "Loading recording…" : playback?.status === "unavailable" ? "A reviewed recording isn’t available for this verse."
        : playback?.status === "error" ? "The recording couldn’t be loaded. Try again." : playback?.retryPlay ? "Your browser needs another tap. Press Play to hear your selection."
          : state?.suspended ? "Playback paused. Tap the reading or press Play when you’re ready." : `Tapping the reading plays a whole verse. ${wordTools ? "Practice and Word tools offer" : "Practice offers"} word drills. Repeat keeps the current selection.`;
  return <section className={styles.player} aria-label="Reading playback">
    <div className={styles.top}><p className={styles.selection}>{selected ? <><bdi>{selected.ref}</bdi> · {preview.selection === "verse" ? "Whole verse" : `Word ${(preview.selection as number) + 1}`}</> : "Listen to your reading"}</p>
      <div className={styles.controls}><button type="button" disabled={!audio || !actionable || !selected || loading || held} onClick={() => playback?.status === "playing" ? intent.current?.pause() : play()}>{playback?.status === "playing" ? "Pause" : playback?.status === "error" ? "Try again" : "Play"}</button>
        <button type="button" disabled={!audio || !actionable || !ready || held} aria-pressed={playback?.repeat ?? false} onClick={() => intent.current?.setRepeat(!playback?.repeat)}>Repeat</button></div></div>
    <div className={styles.options}><div className={styles.field}><label htmlFor={`${id}-selection`}>Practice</label><select id={`${id}-selection`} disabled={!audio || !actionable || !selected} value={String(preview.selection)} onChange={event => { if (preview.index !== null) choose(preview.index, event.target.value === "verse" ? "verse" : Number(event.target.value)); }}>
      <option value="verse">Whole verse</option>{words?.status === "ready" && words.projection.words.map(word => <option key={word.index} value={word.index}>Word {word.index + 1}: {word.text}</option>)}
    </select></div><div className={styles.field}><label htmlFor={`${id}-speed`}>Speed</label><select id={`${id}-speed`} disabled={!audio || !actionable || !ready || !playback?.speedSupported} value={playback?.speed ?? 1} onChange={event => intent.current?.setSpeed(Number(event.target.value))}>{[0.5,0.75,1,1.25].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></div></div>
    <p role="status" className={styles.message}>{message}</p>
    {ready && !playback?.speedSupported && <p className={styles.message}>Pitch-preserving speed control isn’t available in this browser.</p>}
    <details className={styles.credit}><summary>Recording credit</summary><p><a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noreferrer">{SHORT_SOURCE_ATTRIBUTION.title}</a> · {SHORT_SOURCE_ATTRIBUTION.creator} · <a href={SHORT_SOURCE_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">{SHORT_SOURCE_ATTRIBUTION.license}</a> · {SHORT_SOURCE_ATTRIBUTION.changes}</p></details>
  </section>;
}
