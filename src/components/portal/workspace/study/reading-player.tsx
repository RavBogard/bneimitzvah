"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SHORT_SOURCE_ATTRIBUTION } from "../../../../lib/reference-audio/short-source";
import { DEFAULT_READING_RECORDING } from "../../../../lib/reference-audio/reading-coverage";
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
export type ReadingPlayerHandle = { select(index: number, selection?: ReadingSelection): void; selectForRun(index: number): void; pause(): void; suspend(): void };
/** Main-text activation chooses the verse; grammar retains the tapped word.
 * Explicit Practice/WordTools drills continue to use numeric selections. */
export function playMainVerseForWord(player: Pick<ReadingPlayerHandle, "select"> | null, tools: { select(verse: number, word: number): void } | null, verse: number, word: number) {
  if (!Number.isSafeInteger(verse) || verse < 0 || !Number.isSafeInteger(word) || word < 0) return;
  player?.select(verse, "verse"); tools?.select(verse, word);
}
export function ReadingPlayer({ scopeKey, verses, active, enabled = true, expiresAt, audio, wordTools = true, target, load, register, onActiveWord, passageRef, onManualSelect, onVerseEnded, onVerseFailed, runActive }: {
  scopeKey: string; verses: readonly StudyVerse[]; active: boolean; enabled?: boolean; expiresAt?: number; wordTools?: boolean;
  /** The flowing text rendered by this same reader. Lifted practice renders its transport in its own dialog. */
  passageRef?: RefObject<HTMLDivElement | null>;
  /** Missing composition renders inert controls; it never creates a local fallback. */
  /** Controlled modal target; changes are inert until explicit selection. */
  target?: { index: number; generation: number };
  audio?: { coordinator: ReturnType<typeof createReadingAudioCoordinator>; slot: ReadingAudioSlot };
  load(index: number, signal: AbortSignal): Promise<ReferenceShortResolution>;
  register(value: ReadingPlayerHandle | null): void;
  onManualSelect?(): void;
  onVerseEnded?(index: number): void;
  onVerseFailed?(index: number): void;
  runActive?(): boolean;
  onActiveWord(value: { verse: number; index: number } | null): void;
}) {
  const id = useId(), owner = useRef<ReturnType<typeof createPreferredReadingPlayback> | null>(null);
  const [recording, setRecording] = useState(() => (audio && recordingPreferences.get(audio.coordinator)) || DEFAULT_READING_RECORDING);
  const [sourcePreview, setSourcePreview] = useState<number | null>(null);
  const verseRefs = useMemo(() => verses.map(verse => verse.ref), [verses]);
  const shermetRefs = useShermetRecordings(verseRefs);
  const crc = useIdentity().crc;
  const collectionTracks = useMemo(() => crc && audio?.slot !== "lifted" ? humanTracksForVerses(verseRefs) : [], [crc, audio?.slot, verseRefs]);
  const timed = useMemo(() => createShermetTimedAudio(), [scopeKey, verses]);
  useEffect(() => {
    setRecording((audio && recordingPreferences.get(audio.coordinator)) || DEFAULT_READING_RECORDING);
  }, [scopeKey, verses]);
  const callbacks = useRef({ load, onActiveWord, active, enabled, expiresAt, target, shermetRefs, onManualSelect, onVerseEnded, onVerseFailed, runActive }); callbacks.current = { load, onActiveWord, active, enabled, expiresAt, target, shermetRefs, onManualSelect, onVerseEnded, onVerseFailed, runActive };
  const targetOwner = useRef<ReturnType<typeof createReadingPlayerTarget> | null>(null);
  if (!targetOwner.current) targetOwner.current = createReadingPlayerTarget();
  const targetCurrent = () => targetOwner.current!.current(callbacks.current.target);
  const [state, setState] = useState<ReadingPlaybackState | null>(null);
  const [request, setRequest] = useState<{ index: number; selection: ReadingSelection } | null>(null);
  const intent = useRef<ReturnType<typeof createReadingPlayerIntent> | null>(null);
  useLayoutEffect(() => {
    if (!audio) return; // No uncoordinated playback path.
    let current = true;
    let owned: ReturnType<typeof createReadingPlayerIntent> | undefined;
    const common = {
      repeatEnabled: () => !callbacks.current.runActive?.(),
      onEnded: (index: number, selection: ReadingSelection) => {
        if (current && selection === "verse" && owned?.isCurrent() && targetCurrent()) callbacks.current.onVerseEnded?.(index);
      },
      canContinue: () => current && callbacks.current.active && callbacks.current.enabled && readingAudioCurrent(callbacks.current.expiresAt) && Boolean(owned?.isCurrent()) && targetCurrent(),
      onState: (value: ReadingPlaybackState) => {
        if (!current) return;
        setState(value);
        if (value.verse !== null && value.selection === "verse" && owned?.isCurrent() && targetCurrent()
          && (value.playback.status === "unavailable" || value.playback.status === "error")) callbacks.current.onVerseFailed?.(value.verse);
      }, onActiveWord: (value: { verse: number; index: number } | null) => { if (current && (value === null || owned?.isCurrent() && targetCurrent())) callbacks.current.onActiveWord(value); },
    };
    let selectionTurn = 0;
    const playback = createPreferredReadingPlayback({ ...common, preference: recording, available: () => callbacks.current.shermetRefs,
      speeds: speedPreferences.get(audio.coordinator),
      resolveAvailability: getShermetRecordingRefs,
      timed: { timing: (index, signal) => timed.timing(verses[index].ref, verses[index].hebrew, signal), clip: (index, word, signal) => timed.clip(verses[index].ref, verses[index].hebrew, word, word, signal) },
      verses: verses.map(verse => { const projection = projectStudyVerse(verse.ref, verse.hebrew); return { ref: verse.ref, readingText: verse.hebrew.readingText, wordCount: projection.status === "ready" ? projection.projection.words.length : 0 }; }),
      load: async (index, signal) => { if (!owned?.isCurrent()) throw new Error("Reading intent replaced"); const result = await callbacks.current.load(index, signal); if (!owned?.isCurrent()) throw new Error("Reading intent replaced"); return result; },
    });
    owned = createReadingPlayerIntent({ coordinator: audio.coordinator, slot: audio.slot, playback: {
        ...playback,
        async select(index, selection) {
          const turn = ++selectionTurn;
          setRequest({ index, selection });
          try { await playback.select(index, selection); }
          finally { if (current && turn === selectionTurn) setRequest(null); }
        },
        suspend() { selectionTurn++; if (current) setRequest(null); playback.suspend(); },
      },
      enabled: () => current && callbacks.current.enabled && readingAudioCurrent(callbacks.current.expiresAt), active: () => callbacks.current.active,
      visible: () => document.visibilityState === "visible", frame: callback => requestAnimationFrame(callback), cancelFrame: cancelAnimationFrame });
    const selectedIntent = owned; owner.current = playback; intent.current = selectedIntent; setState(playback.state); setRequest(null);
    const select = (index: number, selection?: ReadingSelection) => {
      setSourcePreview(null); targetOwner.current!.select(callbacks.current.target); selectedIntent.select(index, selection);
    };
    register({ select(index, selection) { callbacks.current.onManualSelect?.(); select(index, selection); },
      selectForRun: index => select(index), pause: selectedIntent.pause, suspend: () => { targetOwner.current!.clear(); selectedIntent.suspend(); } });
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
  const preview = request ? { ...request, current: false } : readingPlayerPreview(state, target?.index ?? sourcePreview ?? undefined, targetCurrent());
  const selected = preview.index === null ? null : verses[preview.index], playback = preview.current ? state?.playback : undefined;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const selectedRef = selected?.ref;
  useLayoutEffect(() => {
    const slot = selectedRef && active ? passageRef?.current?.querySelector<HTMLElement>(`[data-verse-playback-slot="${CSS.escape(selectedRef)}"]`) : null;
    setAnchor(slot ?? null);
  }, [passageRef, selectedRef, active, scopeKey]);
  const choose = (index: number, selection: ReadingSelection = "verse") => { onManualSelect?.(); setSourcePreview(null); targetOwner.current!.select(callbacks.current.target); intent.current?.select(index, selection); };
  const play = () => { if (preview.index === null) return; if (!preview.current) choose(preview.index); else intent.current?.play(); };
  const ready = !state?.suspended && (playback?.status === "ready" || playback?.status === "playing");
  const loading = Boolean(request) || playback?.status === "loading";
  const deadlineCurrent = readingAudioCurrent(expiresAt), actionable = enabled && deadlineCurrent;
  const held = preview.current && Boolean(state?.timingHeld), words = selected ? projectStudyVerse(selected.ref, selected.hebrew) : null;
  const message = !deadlineCurrent ? "Refresh the reading to listen again." : !selected ? "Tap a word or verse number to hear the whole verse. Choose a word in Practice for a word drill."
    : held ? "Word timing isn’t available for this recording. Choose Whole verse to listen."
      : loading ? "Loading recording…" : playback?.status === "unavailable" ? "A recording isn’t available for this selection."
        : playback?.status === "error" ? "The recording couldn’t be loaded. Try again." : playback?.retryPlay ? "Your browser needs another tap. Press Play to hear your selection."
          : state?.suspended ? "Playback paused. Tap the reading or press Play when you’re ready." : state?.source === "shermet" ? playback?.wordsReady ? "Cantor Wendy Shermet’s recording follows the words. Repeat keeps the current selection." : "Cantor Wendy Shermet’s recording plays a whole verse. Repeat keeps the current verse. Word timing isn’t available for this recording." : `Tapping the reading plays a whole verse. ${wordTools ? "Practice and Word tools offer" : "Practice offers"} word drills. Repeat keeps the current selection.`;
  const running = runActive?.() === true;
  const transportStatus = !deadlineCurrent || loading || held || playback?.status === "unavailable" || playback?.status === "error" || playback?.retryPlay;
  const transport = selected && active && <span className={styles.top} data-player-transport="" role="group" aria-label="Verse playback" aria-describedby={id + "-verse"} dir="ltr" lang="en">
    <span className={styles.controls}>
      <button type="button" disabled={!audio || !actionable} aria-disabled={loading || held || undefined} onClick={() => {
        if (loading || held) return;
        if (playback?.status === "playing") intent.current?.pause(); else play();
      }}>{playback?.status === "playing" ? "Pause" : playback?.status === "error" ? "Try again" : "Play"}</button>
      <button type="button" disabled={!audio || !actionable || !ready || held || running} aria-pressed={!running && (playback?.repeat ?? false)} onClick={() => intent.current?.setRepeat(!playback?.repeat)}>Repeat</button>
    </span>
    {transportStatus && <span role="status" className={styles.transportStatus}>{message}</span>}
  </span>;
  return <section className={styles.player} aria-label="Reading playback">
    {passageRef ? anchor?.dataset.versePlaybackSlot === selectedRef && anchor && transport && createPortal(transport, anchor) : transport}
    {selected && <p id={id + "-verse"} className={styles.selection} data-testid="player-selection" data-selected-ref={selected.ref} data-selected-part={String(preview.selection)}>
      <bdi>{selected.ref}</bdi> · {preview.selection === "verse" ? "Whole verse" : `Word ${(preview.selection as number) + 1}`}
    </p>}
    <div className={styles.panel}><div className={styles.options}>{shermetRefs.size > 0 && <div className={styles.field}><label htmlFor={`${id}-recording`}>Recording</label><select id={`${id}-recording`} value={recording} onChange={event => { onManualSelect?.(); intent.current?.suspend(); setSourcePreview(preview.index); const preference = event.target.value === "shermet" ? "shermet" : "pockettorah"; if (audio) recordingPreferences.set(audio.coordinator, preference); setRecording(preference); }}><option value="pockettorah">PocketTorah</option><option value="shermet">Cantor Wendy Shermet first</option></select></div>}<div className={styles.field}><label htmlFor={`${id}-selection`}>Practice</label><select id={`${id}-selection`} disabled={!audio || !actionable || !selected} value={String(preview.selection)} onChange={event => { if (preview.index !== null) choose(preview.index, event.target.value === "verse" ? "verse" : Number(event.target.value)); }}>
      <option value="verse">Whole verse</option>{words?.status === "ready" && words.projection.words.map(word => <option key={word.index} value={word.index}>Word {word.index + 1}: {word.text}</option>)}
    </select></div><div className={styles.field}><label htmlFor={`${id}-speed`}>Speed</label><select id={`${id}-speed`} disabled={!audio || !actionable || !ready || !playback?.speedSupported} value={playback?.speed ?? 1} onChange={event => { const speed = Number(event.target.value); if (audio && state?.source) { const preferred = speedPreferences.get(audio.coordinator) ?? { shermet: 1, pockettorah: 1 }; speedPreferences.set(audio.coordinator, { ...preferred, [state.source]: speed }); } intent.current?.setSpeed(speed); }}>{[0.5,0.75,1,1.25].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></div></div>
    {state?.fallback && <p className={styles.message}>{`PocketTorah supplies this selection${state.fallback === "timing" ? " because Shermet word timing is unavailable" : state.fallback === "failed" ? " because the Shermet recording could not load" : " because no Shermet recording is available"}.`}</p>}
    <p role={transportStatus && transport ? undefined : "status"} className={styles.message}>{message}</p>
    {ready && !playback?.speedSupported && <p className={styles.message}>Pitch-preserving speed control isn’t available in this browser.{state?.source === "shermet" && " Playing at the original recorded tempo."}</p>}
    <details className={styles.credit}><summary>Recording credit</summary>{state?.source === "shermet" ? <p><a href="https://www.templeisraelomaha.com/cantors-classroom" target="_blank" rel="noreferrer">Cantor Wendy Shermet · Temple Israel, Omaha</a> · Human recording</p> : <p><a href="https://archive.org/details/PockettorahAudioFiles" target="_blank" rel="noreferrer">{SHORT_SOURCE_ATTRIBUTION.title}</a> · {SHORT_SOURCE_ATTRIBUTION.creator} · <a href={SHORT_SOURCE_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer">{SHORT_SOURCE_ATTRIBUTION.license}</a> · {SHORT_SOURCE_ATTRIBUTION.changes}</p>}</details></div>
    {audio && collectionTracks.length > 0 && <ReadingCollectionPlayback key={scopeKey} tracks={collectionTracks} verseRef={selected?.ref}
      coordinator={audio.coordinator} slot={audio.slot === "assigned" ? "assigned-collection" : "proposed-collection"} enabled={active && enabled} expiresAt={expiresAt} />}
  </section>;
}
