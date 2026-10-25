"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useWorkspaceModal } from "../provider";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
import type { AssignmentEnding } from "../../../../lib/hebrew/study-annotations";
import { useReadingPrefs, useSetReadingPrefs } from "../reading-prefs";
import type { StudyVerse } from "./api";
import { Apparatus, phraseGroups, PhraseLegend, StudyHebrew, useVerseColors } from "./annotations";
import { ReadingPlayer, type ReadingPlayerHandle } from "./reading-player";
import type { createReadingAudioCoordinator } from "./reading-audio-coordinator";
import type { ReferenceShortResolution } from "../../../../lib/reference-audio/short-resolution";

const icon = (d: string) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const icons = {
  close: icon("M6 6l12 12M18 6L6 18"),
  up: icon("M6 15l6-6 6 6"),
  down: icon("M6 9l6 6 6-6"),
  colors: icon("M4 7h7M4 12h11M4 17h6M15 7h5M18 12h2M13 17h7"),
  translate: icon("M4 6h9M8.5 4v2c0 4-2 7-4.5 8.5M6 10c1.5 2 3.5 3.5 6 4.5M13 20l4-9 4 9M14.5 17h5"),
  size: icon("M3 19l5-13 5 13M4.8 14h6.4M15 19l3-8 3 8M15.9 16.5h4.2"),
  hear: icon("M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"),
  scroll: icon("M6 3v18M18 3v18M6 6h12M6 18h12M9.5 10h5M9.5 14h5"),
  print: icon("M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"),
  works: icon("M3 5.5c2.5-1 5.5-.8 9 1.2 3.5-2 6.5-2.2 9-1.2v13c-2.5-1-5.5-.8-9 1.2-3.5-2-6.5-2.2-9-1.2zM12 6.7v13.2"),
};

/**
 * The lifted line: one verse at poster scale, its current phrase printed in
 * full ink and the rest receding. Next steps phrase by phrase, then verse by
 * verse. Each new phrase arrives with one squeegee wipe; reduced motion snaps.
 */
export function LiftedLine({ verses, assignment, index, total, offset, onIndex, onClose, learner = false, controls, reference }: {
  learner?: boolean; controls?(verseRef: string): ReactNode; verses: StudyVerse[]; assignment: AssignmentEnding; index: number; total: number; offset: number; onIndex(index: number): void; onClose(): void;
  reference?: { scopeKey: string; audio: ReturnType<typeof createReadingAudioCoordinator>; active: boolean; expiresAt?: number; navigation: number; load(index: number, signal: AbortSignal): Promise<ReferenceShortResolution> };
}) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId(), prefs = useReadingPrefs(), setReadingPrefs = useSetReadingPrefs();
  const verse = verses[index], result = useVerseColors(verse, assignment, prefs.colors);
  const colors = result?.status === "ready" ? result : null, phrases = colors ? phraseGroups(colors) : [];
  const [phrase, setPhrase] = useState(0);
  const [playingWord, setPlayingWord] = useState<{ ref: string; index: number } | null>(null);
  const playback = useRef<ReadingPlayerHandle | null>(null);
  const registerPlayback = useCallback((value: ReadingPlayerHandle | null) => { playback.current = value; }, []);
  const onActiveWord = useCallback((value: { verse: number; index: number } | null) => setPlayingWord(value === null ? null : { ref: verses[value.verse].ref, index: value.index }), [verses]);
  const activeWord = playingWord?.ref === verse.ref ? playingWord.index : null;
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setPhrase(0); }, [index, prefs.colors]);
  // Runs before the modal opens (the hook below is a layout effect too) so focus returns to the opener.
  useLayoutEffect(() => {
    const node = dialog.current, origin = document.activeElement as HTMLElement | null;
    return () => { if (node?.open) node.close(); origin?.focus?.(); };
  }, []);
  useWorkspaceModal(dialog, true);
  const playingPhrase = activeWord === null ? -1 : phrases.findIndex(row => row.phrase === colors?.words[activeWord]?.phrase);
  const currentPhrase = playingPhrase >= 0 ? playingPhrase : phrase;
  const active = phrases[currentPhrase]?.phrase ?? null;
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = stage.current; if (!node) return;
    const target = active === null ? null : node.querySelector<HTMLElement>(`[data-phrase="${active}"]`);
    if (target) target.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); else node.scrollTo({ top: 0 });
  }, [active, index]);
  // A long verse on a small phone is set a little smaller, step by step, until all of it shows on the stage; below the floor it scrolls inside the stage.
  useLayoutEffect(() => {
    const node = stage.current; if (!node) return;
    const hebrew = () => node.querySelector<HTMLElement>(".lift-hebrew");
    // The verse itself, not the notes under it, must end inside the stage.
    const shows = () => { const row = hebrew(); return !row || row.getBoundingClientRect().bottom - node.getBoundingClientRect().top + node.scrollTop <= node.clientHeight - 8; };
    const fit = () => {
      let scale = 1; node.style.setProperty("--lift-fit", "1");
      while (!shows() && scale > 0.55) { scale = Math.round((scale - 0.05) * 100) / 100; node.style.setProperty("--lift-fit", String(scale)); }
    };
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [verse.ref, prefs, phrases.length]);
  const atStart = index === 0 && currentPhrase === 0, atEnd = index === verses.length - 1 && (phrases.length === 0 || currentPhrase === phrases.length - 1);
  function next() {
    playback.current?.suspend(); setPlayingWord(null);
    if (phrases.length && currentPhrase < phrases.length - 1) setPhrase(currentPhrase + 1);
    else if (index < verses.length - 1) onIndex(index + 1);
  }
  function previous() {
    playback.current?.suspend(); setPlayingWord(null);
    if (phrases.length && currentPhrase > 0) setPhrase(currentPhrase - 1);
    else if (index > 0) onIndex(index - 1);
  }
  function key(event: React.KeyboardEvent) {
    if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, [contenteditable]")) return;
    if (event.target instanceof HTMLElement && event.target.closest("button, [popover]") && (event.key === " " || event.key === "Enter")) return;
    if (["ArrowDown", "PageDown", " "].includes(event.key)) { event.preventDefault(); next(); }
    else if (["ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); previous(); }
  }
  function down(event: ReactPointerEvent) { if (event.pointerType !== "mouse") pointer.current = { x: event.clientX, y: event.clientY }; }
  function up(event: ReactPointerEvent) {
    const start = pointer.current; pointer.current = null; if (!start) return;
    const dy = event.clientY - start.y, dx = event.clientX - start.x;
    if (Math.abs(dy) < 48 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    // A long verse scrolls first; the swipe steps only from the scroll edge.
    const node = stage.current, scrollable = node && node.scrollHeight > node.clientHeight + 4;
    if (scrollable && (dy < 0 ? node.scrollTop + node.clientHeight < node.scrollHeight - 4 : node.scrollTop > 4)) return;
    if (dy < 0) next(); else previous();
  }
  const number = offset + index + 1;
  return <dialog ref={dialog} className="lift" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={key}>
    <div className="lift-bar">
      <button type="button" className="lift-icon" onClick={onClose} aria-label="Close practice view">{icons.close}</button>
      <p className="lift-count" aria-live="polite">Verse {number} of {total}{phrases.length > 1 && <span className="lift-count-phrase"> · phrase {currentPhrase + 1} of {phrases.length}</span>}</p>
      <button type="button" className="lift-icon" aria-pressed={prefs.colors} aria-label="Phrase colors" onClick={() => setReadingPrefs({ colors: !prefs.colors })}>{icons.colors}</button>
    </div>
    <ol className="lift-rail" aria-hidden="true">{verses.map((row, position) => <li key={row.ref} data-state={position < index ? "past" : position === index ? "current" : undefined} />)}</ol>
    <div ref={stage} className="lift-stage" onPointerDown={down} onPointerUp={up} onPointerCancel={() => { pointer.current = null; }}>
      <h2 id={`${id}-title`} className="lift-ref"><bdi dir="ltr">{verse.ref}</bdi></h2>
      <StudyHebrew key={verse.ref} verse={verse} colors={colors} id={`${id}-v`} activeWord={activeWord} onWordSelect={reference || colors ? word => {
        if (reference) playback.current?.select(index, "verse");
        const selectedPhrase = colors?.words[word]?.phrase, position = phrases.findIndex(row => row.phrase === selectedPhrase); if (position >= 0) setPhrase(position);
      } : undefined} wordAction={reference ? "verse" : "phrase"} toolsAvailable={false} className={`lift-hebrew${active !== null ? " lift-phrasing" : ""}`} />
      {active !== null && <style>{`.lift-phrasing [data-phrase="${active}"]{opacity:1;animation:ink-pull 560ms var(--ease-settle) both;animation-delay:calc((var(--w) - ${phrases[currentPhrase].first - 1}) * 70ms)}`}</style>}
      {prefs.translation && <p className="lift-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p>}
      <Apparatus verse={verse} learner={learner} />
      {prefs.colors && <PhraseLegend colors={result} id={`${id}-v`} verseRef={verse.ref} />}
    </div>
    {reference && <ReadingPlayer scopeKey={reference.scopeKey} verses={verses} active={reference.active} enabled={reference.active}
      expiresAt={reference.expiresAt} audio={{ coordinator: reference.audio, slot: "lifted" }} wordTools={false}
      target={{ index, generation: reference.navigation }} load={reference.load} onActiveWord={onActiveWord} register={registerPlayback} />}

    {controls?.(verse.ref)}
    <div className="lift-nav">
      <button type="button" className="lift-step" onClick={previous} disabled={atStart}>{icons.up}<span>Back</span></button>
      <button type="button" className="lift-step lift-step-next" onClick={next} disabled={atEnd} autoFocus>{icons.down}<span>{phrases.length && currentPhrase < phrases.length - 1 ? "Next phrase" : "Next verse"}</span></button>
    </div>
  </dialog>;
}
