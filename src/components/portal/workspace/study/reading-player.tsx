"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SHORT_SOURCE_ATTRIBUTION } from "../../../../lib/reference-audio/short-source";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import type { ReferenceShortResolution } from "../../../../lib/reference-audio/short-resolution";
import type { ReadingPlaybackState, ReadingSelection } from "./main-playback";
import { createPreferredReadingPlayback } from "./preferred-reading-playback";
import { getShermetRecordingRefs, useShermetRecordings } from "./use-shermet-recordings";
import { createShermetTimedAudio } from "../../../../lib/reference-audio/shermet-timed-audio";
import type { StudyVerse } from "./api";
import { createReadingPlayerIntent, readingAudioCurrent, readingPlayerPreview, createReadingPlayerTarget } from "./reading-player-intent";
import type { ReadingAudioSlot, createReadingAudioCoordinator } from "./reading-audio-coordinator";
import styles from "./reading-player.module.css";
import { useIdentity } from "../../../site/identity-context";
import { humanTracksForVerses } from "../../../../lib/reference-audio/human-tracks";
import { ReadingCollectionPlayback } from "../../../shermet-library/reading-collection";
const recordingPreferences = new WeakMap<ReturnType<typeof createReadingAudioCoordinator>, "pockettorah" | "shermet">();
const speedPreferences = new WeakMap<ReturnType<typeof createReadingAudioCoordinator>, { shermet: number; pockettorah: number }>();
export type ReadingPlayerHandle = { select(index: number, selection?: ReadingSelection): void; pause(): void; suspend(): void };
/** Main-text activation chooses the verse; grammar retains the tapped word.
 * Explicit Practice/WordTools drills continue to use numeric selections. */
export function playMainVerseForWord(player: Pick<ReadingPlayerHandle, "select"> | null, tools: { select(verse: number, word: number): void } | null, verse: number, word: number) {
  if (!Number.isSafeInteger(verse) || verse < 0 || !Number.isSafeInteger(word) || word < 0) return;
  player?.select(verse, "verse"); tools?.select(verse, word);
}
export function ReadingPlayer({ scopeKey, verses, active, enabled = true, expiresAt, audio, wordTools = true, target, load, register, onActiveWord, idleLabel = "Listen to your reading" }: {
  scopeKey: string; verses: readonly StudyVerse[]; active: boolean; enabled?: boolean; expiresAt?: number; wordTools?: boolean;
  /** What the player says before anything is chosen; staff pages say "Listen to the reading" (project review 2026-11-16). */
  idleLabel?: string;
  /** Missing composition renders inert controls; it never creates a local fallback. */
  /** Controlled modal target; changes are inert until explicit selection. */
  target?: { index: number; generation: number };
  audio?: { coordinator: ReturnType<typeof createReadingAudioCoordinator>; slot: ReadingAudioSlot };
  load(index: number, signal: AbortSignal): Promise<ReferenceShortResolution>;
  register(value: ReadingPlayerHandle | null): void;
  onActiveWord(value: { verse: number; index: number } | null): void;
}) {
  const id = useId(), owner = useRef<ReturnType<typeof createPreferredReadingPlayback> | null>(null);
  const [recording, setRecording] = useState<"pockettorah" | "shermet">(() => audio ? recordingPreferences.get(audio.coordinator) ?? "shermet" : "shermet");
  const [sourcePreview, setSourcePreview] = useState<number | null>(null);
  const verseRefs = useMemo(() => verses.map(verse => verse.ref), [verses]);
  const shermetRefs = useShermetRecordings(verseRefs);
  const crc = useIdentity().crc;
  const collectionTracks = useMemo(() => crc && audio?.slot !== "lifted" ? humanTracksForVerses(verseRefs) : [], [crc, audio?.slot, verseRefs]);
  const timed = useMemo(() => createShermetTimedAudio(), [scopeKey, verses]);
  useEffect(() => {
    setRecording(audio ? recordingPreferences.get(audio.coordinator) ?? "shermet" : "shermet");
  }, [scopeKey, verses]);
  const callbacks = useRef({ load, onActiveWord, active, enabled, expiresAt, target, shermetRefs }); callbacks.current = { load, onActiveWord, active, enabled, expiresAt, target, shermetRefs };
  const targetOwner = useRef<ReturnType<typeof createReadingPlayerTarget> | null>(null);
  if (!targetOwner.current) targetOwner.current = createReadingPlayerTarget();
  const targetCurrent = () => targetOwner.current!.current(callbacks.current.target);
  const [state, setState] = useState<ReadingPlaybackState | null>(null);
  const intent = useRef<ReturnType<typeof createReadingPlayerIntent> | null>(null);
  useLayoutEffect(() => {
    if (!audio) return; // No uncoordinated playback path.
    let current = true;
    let owned: ReturnType<typeof createReadingPlayerIntent> | undefined;
    const common = {
      canContinue: () => current && callbacks.current.active && callbacks.current.enabled && readingAudioCurrent(callbacks.current.expiresAt) && Boolean(owned?.isCurrent()) && targetCurrent(),
      onState: (value: ReadingPlaybackState) => { if (current) setState(value); }, onActiveWord: (value: { verse: number; index: number } | null) => { if (current && (value === null || owned?.isCurrent() && targetCurrent())) callbacks.current.onActiveWord(value); },
    };
    const playback = createPreferredReadingPlayback({ ...common, preference: recording, available: () => callbacks.current.shermetRefs,
      speeds: speedPreferences.get(audio.coordinator),
      resolveAvailability: getShermetRecordingRefs,
      timed: { timing: (index, signal) => timed.timing(verses[index].ref, verses[index].hebrew, signal), clip: (index, word, signal) => timed.clip(verses[index].ref, verses[index].hebrew, word, word, signal) },
      verses: verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); return { ref: verse.ref, readingText: verse.hebrew.readingText, wordCount: projection.status === "ready" ? projection.projection.words.length : 0 }; }),
      load: async (index, signal) => { if (!owned?.isCurrent()) throw new Error("Reading intent replaced"); const result = await callbacks.current.load(index, signal); if (!owned?.isCurrent()) throw new Error("Reading intent replaced"); return result; },
    });
    owned = createReadingPlayerIntent({ coordinator: audio.coordinator, slot: audio.slot, playback,
      enabled: () => current && callbacks.current.enabled && readingAudioCurrent(callbacks.current.expiresAt), active: () => callbacks.current.active,
      visible: () => document.visibilityState === "visible", frame: callback => requestAnimationFrame(callback), cancelFrame: cancelAnimationFrame });
    const selectedIntent = owned; owner.current = playback; intent.current = selectedIntent; setState(playback.state);
    register({ select: (index, selection) => { setSourcePreview(null); targetOwner.current!.select(callbacks.current.target); selectedIntent.select(index, selection); }, pause: selectedIntent.pause, suspend: () => { targetOwner.current!.clear(); selectedIntent.suspend(); } });
    const background = () => { if (document.visibilityState !== "visible") selectedIntent.suspend(); };
    const leave = () => selectedIntent.suspend();
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { current = false; register(null); selectedIntent.dispose(); playback.dispose();
      if (owner.current === playback) owner.current = null; if (intent.current === selectedIntent) intent.current = null; callbacks.current.onActiveWord(null);
      document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave);
    };
  }, [scopeKey, verses, register, audio?.coordinator, audio?.slot, recording]);
  useLayoutEffect(() => { if (!active || !enabled) intent.current?.suspend(); }, [active, enabled]);
  useLayoutEffect(() => { if (target) intent.current?.suspend(); }, [target?.index, target?.generation]);
  const preview = readingPlayerPreview(state, target?.index ?? sourcePreview ?? undefined, targetCurrent());
  const selected = preview.index === null ? null : verses[preview.index], playback = preview.current ? state?.playback : undefined;
  const choose = (index: number, selection: ReadingSelection = "verse") => { setSourcePreview(null); targetOwner.current!.select(callbacks.current.target); intent.current?.select(index, selection); };
  const play = () => { if (preview.index === null) return; if (!preview.current) choose(preview.index); else intent.current?.play(); };
  const ready = playback?.status === "ready" || playback?.status === "playing", loading = playback?.status === "loading";
  const deadlineCurrent = readingAudioCurrent(expiresAt), actionable = enabled && deadlineCurrent;
  const held = preview.current && Boolean(state?.timingHeld), words = selected ? projectStudyVerse(selected.ref, selected.hebrew) : null;
  const message = !deadlineCurrent ? "Refresh the reading to listen again." : !selected ? "Tap a word or verse number to hear the whole verse. Choose a word in Practice for a word drill."
    : held ? "Word timing isn’t available for this recording. Choose Whole verse to listen."
      : loading ? "Loading recording…" : playback?.status === "unavailable" ? "A recording isn’t available for this selection."
        : playback?.status === "error" ? "The recording couldn’t be loaded. Try again." : playback?.retryPlay ? "Your browser needs another tap. Press Play to hear your selection."
          : state?.suspended ? "Playback paused. Tap the reading or press Play when you’re ready." : state?.source === "shermet" ? playback?.wordsReady ? "Cantor Wendy Shermet’s recording follows the words. Repeat keeps the current selection." : "Cantor Wendy Shermet’s recording plays a whole verse. Repeat keeps the current verse. Word timing isn’t available for this recording." : `Tapping the reading plays a whole verse. ${wordTools ? "Practice and Word tools offer" : "Practice offers"} word drills. Repeat keeps the current selection.`;
  // The transport (what is chosen, Play or Pause, Repeat) stays in reach while the reader scrolls the passage; the rest of the player keeps its place after the text.
  return <section className={styles.player} aria-label="Reading playback">
    <div className={styles.top} data-player-transport=""><p className={styles.selection} data-testid="player-selection" data-selected-ref={selected?.ref} data-selected-part={selected ? String(preview.selection) : undefined}>{selected ? <><bdi>{selected.ref}</bdi> · {preview.selection === "verse" ? "Whole verse" : `Word ${(preview.selection as number) + 1}`}</> : idleLabel}</p>
      <div className={styles.controls}><button type="button" disabled={!audio || !actionable || !selected || loading || held} onClick={() => playback?.status === "playing" ? intent.current?.pause() : play()}>{playback?.status === "playing" ? "Pause" : playback?.status === "error" ? "Try again" : "Play"}</button>
        <button type="button" disabled={!audio || !actionable || !ready || held} aria-pressed={playback?.repeat ?? false} onClick={() => intent.current?.setRepeat(!playback?.repeat)}>Repeat</button></div></div>
    <div className={styles.panel}><div className={styles.options}>{shermetRefs.size > 0 && <div className={styles.field}><label htmlFor={`${id}-recording`}>Recording</label><select id={`${id}-recording`} value={recording} onChange={event => { intent.current?.suspend(); setSourcePreview(preview.index); const preference = event.target.value === "shermet" ? "shermet" : "pockettorah"; if (audio) recordingPreferences.set(audio.coordinator, preference); setRecording(preference); }}><option value="pockettorah">PocketTorah</option><option value="shermet">Cantor Wendy Shermet first</option></select></div>}<div className={styles.field}><label htmlFor={`${id}-selection`}>Practice</label><select id={`${id}-selection`} disabled={!audio || !actionable || !selected} value={String(preview.selection)} onChange={event => { if (preview.index !== null) choose(preview.index, event.target.value === "verse" ? "verse" : Number(event.target.value)); }}>
      <option value="verse">Whole verse</option>{words?.status === "ready" && words.projection.words.map(word => <option key={word.index} value={word.index}>Word {word.index + 1}: {word.text}</option>)}
    </select></div><div className={styles.field}><label htmlFor={`${id}-speed`}>Speed</label><select id={`${id}-speed`} disabled={!audio || !actionable || !ready || !playback?.speedSupported} value={playback?.speed ?? 1} onChange={event => { const speed = Number(event.target.value); if (audio && state?.source) { const preferred = speedPreferences.get(audio.coordinator) ?? { shermet: 1, pockettorah: 1 }; speedPreferences.set(audio.coordinator, { ...preferred, [state.source]: speed }); } intent.current?.setSpeed(speed); }}>{[0.5,0.75,1,1.25].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></div></div>
    {state?.fallback && <p className={styles.message}>{`PocketTorah supplies this selection${state.fallback === "timing" ? " because Shermet word timing is unavailable" : state.fallback === "failed" ? " because the Shermet recording could not load" : " because no Shermet recording is available"}.`}</p>}
    <p role="status" className={styles.message}>{message}</p>
    {ready && !playback?.speedSupported && <p className={styles.message}>Pitch-preserving speed control isn’t available in this browser.{state?.source === "shermet" && " Playing at the original recorded tempo."}</p>}
    <details className={styles.credit}><summary>Recording credit</summary>{state?.source === "shermet" ? <p><a href="https://www.templeisraelomaha.com/cantors-classroom" target="_blank" rel="noreferrer">Cantor Wendy Shermet · Temple Israel, Omaha</a> · Human recording</p> : <p><a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noreferrer">{SHORT_SOURCE_ATTRIBUTION.title}</a> · {SHORT_SOURCE_ATTRIBUTION.creator} · <a href={SHORT_SOURCE_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">{SHORT_SOURCE_ATTRIBUTION.license}</a> · {SHORT_SOURCE_ATTRIBUTION.changes}</p>}</details></div>
    {audio && <ReadingCollectionPlayback tracks={collectionTracks} verseRef={selected?.ref} coordinator={audio.coordinator} enabled={active && enabled} expiresAt={expiresAt} />}
  </section>;
}
