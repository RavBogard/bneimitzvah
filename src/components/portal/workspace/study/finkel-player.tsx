"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { finkelBookKind, finkelCredit, finkelModeLabel, finkelOrdinal, finkelRangeLabel, finkelVerse, type FinkelClip } from "../../../../lib/reference-audio/finkel";
import { fetchFinkelAudio, fetchFinkelClips, type FinkelRequestMode } from "./finkel-api";
import type { ReadingAudioSlot, createReadingAudioCoordinator } from "./reading-audio-coordinator";
import styles from "./finkel-player.module.css";

type Status = "idle" | "loading" | "playing" | "paused" | "ended" | "retry" | "error";
const SPEEDS = [0.5, 0.75, 1, 1.25] as const;
const clock = (seconds: number) => { const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** [from, to] per book for the refs on screen; a page normally spans one book. */
export function finkelRanges(refs: readonly string[]): { from: string; to: string }[] {
  const books = new Map<string, { from: string; to: string; low: number; high: number }>();
  for (const ref of refs) {
    const parsed = finkelVerse(ref); if (!parsed || !finkelBookKind(parsed.book)) continue;
    const ordinal = finkelOrdinal(parsed), row = books.get(parsed.book);
    if (!row) books.set(parsed.book, { from: ref, to: ref, low: ordinal, high: ordinal });
    else { if (ordinal < row.low) { row.low = ordinal; row.from = ref; } if (ordinal > row.high) { row.high = ordinal; row.to = ref; } }
  }
  return [...books.values()].map(({ from, to }) => ({ from, to }));
}
/** Clips sharing a verse with this page: the chosen take first, chant before words, then reading order. */
export function finkelPageClips(clips: readonly FinkelClip[], refs: readonly string[]): FinkelClip[] {
  const shown = new Set(refs), order = (clip: FinkelClip) => refs.findIndex(ref => clip.verses.includes(ref));
  return clips.filter(clip => clip.verses.some(ref => shown.has(ref)))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || order(a) - order(b) || (a.mode === b.mode ? 0 : a.mode === "chant" ? -1 : 1));
}

/** Whole-passage playback of Cantor Finkel's recordings beside the PocketTorah
 * verse player. No timings exist, so nothing is cut or word-highlighted: the
 * passage's verses are marked while it plays. Loop and pitch-preserving speed
 * match the verse player. The shared coordinator keeps one voice at a time. */
export function FinkelPassagePlayer({ scopeKey, refs, mode, active, audio, onPlaying }: {
  scopeKey: string; refs: readonly string[]; mode: FinkelRequestMode | null; active: boolean;
  audio?: { coordinator: ReturnType<typeof createReadingAudioCoordinator>; slot: ReadingAudioSlot };
  onPlaying?(verses: ReadonlySet<string> | null): void;
}) {
  const id = useId();
  const [clips, setClips] = useState<{ scope: string; list: FinkelClip[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [repeat, setRepeat] = useState(false), [speed, setSpeed] = useState(1), [time, setTime] = useState({ at: 0, length: 0 });
  const media = useRef<HTMLAudioElement | null>(null), loaded = useRef<{ sha256: string; url: string } | null>(null);
  const pending = useRef<AbortController | null>(null), registration = useRef<ReturnType<ReturnType<typeof createReadingAudioCoordinator>["register"]> | null>(null);
  const ticket = useRef<ReturnType<NonNullable<typeof registration.current>["claim"]>>(null);
  const callbacks = useRef({ onPlaying, repeat, speed, active }); callbacks.current = { onPlaying, repeat, speed, active };
  const refsKey = JSON.stringify(refs);

  // One list request per scope (page) while listening is allowed.
  useEffect(() => {
    if (!mode || !active) return;
    const controller = new AbortController(), ranges = finkelRanges(refs);
    if (!ranges.length) { setClips({ scope: scopeKey, list: [] }); return; }
    void Promise.all(ranges.map(range => fetchFinkelClips({ mode, ...range }, controller.signal)))
      .then(results => { if (!controller.signal.aborted) setClips({ scope: scopeKey, list: finkelPageClips(results.flatMap(result => result.clips), refs) }); })
      .catch(() => { if (!controller.signal.aborted) setClips({ scope: scopeKey, list: [] }); });
    return () => controller.abort();
  }, [scopeKey, refsKey, mode, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Media and coordinator ownership; suspension drops media, never merely pauses it.
  useLayoutEffect(() => {
    let element: HTMLAudioElement | null = null;
    try { element = new Audio(); } catch { element = null; }
    media.current = element;
    const drop = () => {
      pending.current?.abort(); pending.current = null;
      if (element) { element.pause(); element.removeAttribute("src"); element.load(); }
      if (loaded.current) { URL.revokeObjectURL(loaded.current.url); loaded.current = null; }
      callbacks.current.onPlaying?.(null);
    };
    const suspend = () => { ticket.current = null; drop(); setStatus(value => value === "idle" ? value : "idle"); setTime({ at: 0, length: 0 }); };
    registration.current = audio ? audio.coordinator.register(audio.slot, suspend) : null;
    if (element) {
      element.preload = "auto";
      const playing = () => { setStatus("playing"); },
        paused = () => { setStatus(value => value === "playing" ? "paused" : value); callbacks.current.onPlaying?.(null); },
        ended = () => { setStatus("ended"); callbacks.current.onPlaying?.(null); },
        tick = () => setTime({ at: element!.currentTime, length: Number.isFinite(element!.duration) ? element!.duration : 0 }),
        failed = () => { if (loaded.current) { setStatus("error"); callbacks.current.onPlaying?.(null); } };
      element.addEventListener("playing", playing); element.addEventListener("pause", paused); element.addEventListener("ended", ended);
      element.addEventListener("timeupdate", tick); element.addEventListener("loadedmetadata", tick); element.addEventListener("error", failed);
    }
    const background = () => { if (document.visibilityState !== "visible") suspend(); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", suspend);
    return () => {
      document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", suspend);
      registration.current?.dispose(); registration.current = null; ticket.current = null; drop(); media.current = null;
    };
  }, [scopeKey, audio?.coordinator, audio?.slot]);
  useLayoutEffect(() => { if (!active && ticket.current) registration.current?.release(ticket.current); }, [active]);

  const list = clips?.scope === scopeKey ? clips.list : null;
  const clip = list?.find(row => row.asset === selected) ?? list?.[0] ?? null;
  const owner = () => registration.current !== null && ticket.current !== null && registration.current.isCurrent(ticket.current);
  const apply = (element: HTMLAudioElement) => {
    element.loop = callbacks.current.repeat;
    (element as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    element.playbackRate = callbacks.current.speed;
  };
  const start = (element: HTMLAudioElement, target: FinkelClip) => {
    apply(element);
    void element.play().then(() => { if (owner()) callbacks.current.onPlaying?.(new Set(target.verses)); },
      () => { if (owner()) setStatus("retry"); });
  };
  async function play(target: FinkelClip) {
    const element = media.current; if (!element || !mode || !registration.current || !callbacks.current.active) return;
    if (!owner()) { const claimed = registration.current.claim(); if (!claimed) return; ticket.current = claimed; }
    const mine = ticket.current;
    if (loaded.current?.sha256 === target.sha256 && element.src === loaded.current.url) {
      if (status === "ended") element.currentTime = 0; start(element, target); return;
    }
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    element.pause(); setStatus("loading"); setTime({ at: 0, length: target.durationSeconds }); callbacks.current.onPlaying?.(null);
    try {
      const blob = await fetchFinkelAudio(target, mode, controller.signal);
      if (controller.signal.aborted || ticket.current !== mine || !owner() || media.current !== element) return;
      if (loaded.current) URL.revokeObjectURL(loaded.current.url);
      const url = URL.createObjectURL(blob); loaded.current = { sha256: target.sha256, url };
      element.src = url; element.load(); start(element, target);
    } catch { if (!controller.signal.aborted && ticket.current === mine) setStatus("error"); }
    finally { if (pending.current === controller) pending.current = null; }
  }
  const pause = () => { media.current?.pause(); callbacks.current.onPlaying?.(null); };
  const choose = (asset: string) => {
    if (asset === clip?.asset) return;
    if (ticket.current) registration.current?.release(ticket.current);
    setSelected(asset); setStatus("idle");
  };

  if (!mode || !list?.length || !clip) return null;
  const busy = status === "loading", playing = status === "playing";
  const speedSupported = typeof HTMLMediaElement !== "undefined" && "preservesPitch" in HTMLMediaElement.prototype;
  const message = status === "loading" ? "Loading the recording…" : status === "error" ? "The recording couldn’t be loaded. Try again."
    : status === "retry" ? "Your browser needs another tap. Press Play to listen." : "Plays the whole passage, and its verses are marked in the reading while it plays. Tapping a verse plays that verse alone.";
  return <section className={styles.player} aria-label="Cantor Finkel’s recordings">
    <div className={styles.top}>
      <p className={styles.title}>Cantor Finkel</p>
      <div className={styles.controls}>
        <button type="button" disabled={busy || !audio || !active} onClick={() => playing ? pause() : void play(clip)}>{playing ? "Pause" : status === "error" ? "Try again" : "Play"}</button>
        <button type="button" disabled={!audio} aria-pressed={repeat} onClick={() => { const next = !repeat; setRepeat(next); if (media.current) media.current.loop = next; }}>Repeat</button>
      </div>
    </div>
    {list.length > 1 ? <div className={styles.choices} role="radiogroup" aria-label="Choose a recording">{list.map(row =>
      <button key={row.asset} type="button" role="radio" aria-checked={row.asset === clip.asset} onClick={() => choose(row.asset)}>
        {finkelModeLabel(row.mode)} · <bdi dir="ltr">{finkelRangeLabel(row.verses)}</bdi>{!row.preferred && " · other take"}</button>)}</div>
      : <p className={styles.passage}>{finkelModeLabel(clip.mode)} · <bdi dir="ltr">{finkelRangeLabel(clip.verses)}</bdi></p>}
    <div className={styles.options}>
      <div className={styles.field}><label htmlFor={`${id}-position`}>Position</label>
        <input id={`${id}-position`} type="range" min={0} max={Math.max(1, Math.round(time.length || clip.durationSeconds))} step={1} value={Math.round(time.at)} disabled={!loaded.current || loaded.current.sha256 !== clip.sha256}
          aria-valuetext={`${clock(time.at)} of ${clock(time.length || clip.durationSeconds)}`} onChange={event => { if (media.current) media.current.currentTime = Number(event.target.value); }} />
        <span className={styles.clock} aria-hidden="true">{clock(time.at)} / {clock(time.length || clip.durationSeconds)}</span></div>
      <div className={styles.field}><label htmlFor={`${id}-speed`}>Speed</label>
        <select id={`${id}-speed`} disabled={!speedSupported} value={speed} onChange={event => { const next = Number(event.target.value); setSpeed(next); if (media.current) media.current.playbackRate = next; }}>
          {SPEEDS.map(value => <option key={value} value={value}>{value}×</option>)}</select></div>
    </div>
    <p role="status" className={styles.message}>{message}</p>
    <p className={styles.credit}>{finkelCredit(clip.mode)}</p>
  </section>;
}
