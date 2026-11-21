"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal, flushSync } from "react-dom";
import { SHERMET_CATEGORIES, parseShermetLibrary, shermetLibraryTitle, type ShermetLibraryItem } from "../../lib/reference-audio/shermet-library";
import { applyRecordingTempo, recordingPitchSupported, RELATIVE_RECORDING_SPEEDS } from "../../lib/reference-audio/recording-tempo";
import styles from "./library.module.css";
type Page = { items: readonly ShermetLibraryItem[]; nextOffset: number | null };
export function ShermetLibrary({ initialCategory = "" }: { initialCategory?: string }) {
  const [query, setQuery] = useState(""), [category, setCategory] = useState(initialCategory), [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null), [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<{ item: ShermetLibraryItem; sha256: string } | null>(null);
  const media = useRef<HTMLAudioElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const listenButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  useLayoutEffect(() => {
    if (!expanded) return;
    const firstControl = panel.current?.querySelector("button");
    firstControl?.focus({ preventScroll: true });
    firstControl?.scrollIntoView({ block: "center" });
  }, [expanded]);
  useEffect(() => {
    const abort = new AbortController(); setStatus("loading");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, category, offset: String(offset) });
      void fetch(`/api/shermet-library?${params}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]), credentials: "omit", redirect: "error", cache: "no-store" })
        .then(async response => {
          if (!response.ok) throw new Error("Library unavailable");
          const text = await response.text(); if (text.length > 256 * 1024) throw new Error("Library unavailable");
          const body = JSON.parse(text), items = parseShermetLibrary({ version: 1, items: body.items });
          if (!Array.isArray(body.items) || items.length !== body.items.length || body.nextOffset !== null && (!Number.isSafeInteger(body.nextOffset) || body.nextOffset <= offset)) throw new Error("Library unavailable");
          if (!abort.signal.aborted) { setPage({ items, nextOffset: body.nextOffset }); setStatus("ready"); }
        }).catch(() => { if (!abort.signal.aborted) setStatus("error"); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, category, offset]);
  function resetPlayer() {
    media.current?.pause();
    setExpanded(false);
    setSelected(null);
  }
  function listen(item: ShermetLibraryItem, sha256: string, button: HTMLButtonElement) {
    listenButton.current = button;
    flushSync(() => {
      setExpanded(false);
      setSelected({ item, sha256 });
    });
    // Keep the start in the Listen gesture for browsers that restrict autoplay.
    void media.current?.play().catch(() => {});
    playButton.current?.focus({ preventScroll: true });
  }
  function close() {
    flushSync(resetPlayer);
    listenButton.current?.focus({ preventScroll: true });
    listenButton.current?.scrollIntoView({ block: "nearest" });
  }
  function change(kind: "query" | "category", value: string) {
    resetPlayer();
    setOffset(0);
    kind === "query" ? setQuery(value) : setCategory(value);
  }
  function changePage(value: number) {
    resetPlayer();
    setOffset(value);
  }
  return <>
    <div className={styles.filters}><label>Search recordings<input type="search" value={query} onChange={event => change("query", event.target.value)} /></label>
      <label>Category<select value={category} onChange={event => change("category", event.target.value)}><option value="">All categories</option>{Object.entries(SHERMET_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <p role="status">{status === "loading" ? "Loading recordings…" : status === "error" ? "The recording library couldn’t be loaded. Try again later." : page?.items.length === 0 ? "No recordings match this search." : "Choose a recording to listen."}</p>
    {status === "ready" && page && <div aria-label="Recording library" className={styles.results} onFocus={event => {
      const bar = player.current;
      if (bar && event.target.getBoundingClientRect().bottom > bar.getBoundingClientRect().top) {
        event.target.scrollIntoView({ block: "center" });
      }
    }}>{Object.entries(SHERMET_CATEGORIES).map(([key, label]) => {
      const items = page.items.filter(item => item.category === key);
      return items.length ? <section key={key} aria-labelledby={`category-${key}`}><h2 id={`category-${key}`}>{label}</h2><ul>{items.map(item => <li key={item.id} data-recording-item={item.id}>
        <h3>{shermetLibraryTitle(item)}</h3><p>{item.title}</p>{item.category === "source-conflict" && <p>Omaha’s original label: {item.label}{!item.ref && " · The text identity is unconfirmed."}</p>}<p><a href={item.pageUrl} target="_blank" rel="noreferrer">Source at Temple Israel</a></p>
        {item.status === "available" && item.recordings.length > 0 ? <div className={styles.actions}>{item.recordings.map((recording, index) => <button key={recording.sha256} type="button" aria-label={`Listen to ${shermetLibraryTitle(item)}${item.recordings.length > 1 ? `, recording ${index + 1}` : ""}`} onClick={event => listen(item, recording.sha256, event.currentTarget)}>{item.recordings.length > 1 ? `Listen to recording ${index + 1}` : "Listen"}</button>)}</div> : <p>{item.status === "pending" ? "Recording not available yet." : "The source recording is unavailable."}</p>}
        {selected?.item.id === item.id && <div id={panelId} ref={panel} hidden={!expanded} />}
      </li>)}</ul></section> : null;
    })}</div>}
    <nav className={styles.pagination} aria-label="Recording pages"><button type="button" disabled={offset === 0 || status !== "ready"} onClick={() => changePage(Math.max(0, offset - 40))}>Previous recordings</button><button type="button" disabled={page?.nextOffset == null || status !== "ready"} onClick={() => changePage(page!.nextOffset!)}>More recordings</button></nav>
    {selected && <ShermetLibraryPlayer key={`${selected.item.id}:${selected.sha256}`} item={selected.item} sha256={selected.sha256} compact={{
      media, playButton, player, panel, panelId, expanded,
      toggleControls: () => setExpanded(value => !value), close,
    }} />}
  </>;
}
let preferredSpeed = 1;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
/** Shared by the library and the actual matching prayer lesson. Native controls
 * include a raw-rate menu in some browsers, so all controls use relative rates. */
const compactIcons = {
  play: "M8 5v14l11-7z",
  pause: "M9 5v14m6-14v14",
  controls: "M4 7h16M4 17h16M8 4v6m8 4v6",
  close: "m6 6 12 12m0-12L6 18",
};

function CompactActionLabel({ action, label }: { action: keyof typeof compactIcons; label: string }) {
  return <><span className={styles.actionLabel}>{label}</span>
    <svg className={styles.actionIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={compactIcons[action]} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg></>;
}

type CompactPlayer = {
  media: RefObject<HTMLAudioElement | null>;
  playButton: RefObject<HTMLButtonElement | null>;
  player: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLDivElement | null>;
  panelId: string;
  expanded: boolean;
  toggleControls: () => void;
  close: () => void;
};
export function ShermetLibraryPlayer({ item, sha256, compact }: { item: ShermetLibraryItem; sha256: string; compact?: CompactPlayer }) {
  const localMedia = useRef<HTMLAudioElement>(null);
  const media = compact?.media ?? localMedia;
  const [error, setError] = useState(false), [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(preferredSpeed), [repeat, setRepeat] = useState(false);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1), [muted, setMuted] = useState(false), [speedSupported, setSpeedSupported] = useState(true);
  useLayoutEffect(() => {
    const node = media.current;
    if (!node) return;
    applyRecordingTempo(node, "shermet", speed);
    node.volume = volume; node.muted = muted;
    setSpeedSupported(recordingPitchSupported(node));
  }, [item.id, sha256, media, speed, volume, muted]);
  useEffect(() => {
    setError(false); setPosition(0); setDuration(0); setPlaying(false);
    const selected = media.current;
    const stop = () => { if (document.visibilityState !== "visible") selected?.pause(); };
    document.addEventListener("visibilitychange", stop);
    return () => { selected?.pause(); document.removeEventListener("visibilitychange", stop); };
  }, [item.id, sha256, media]);
  const play = () => {
    const node = media.current;
    if (!node) return;
    if (!node.paused) { node.pause(); return; }
    setError(false); applyRecordingTempo(node, "shermet", speed);
    void node.play().catch(() => setError(true));
  };
  const audio = <audio key={`${item.id}:${sha256}`} ref={media} autoPlay={!compact} loop={repeat} preload="none" aria-label={shermetLibraryTitle(item)} src={`/api/shermet-library/media?${new URLSearchParams({ id: item.id, recording: sha256 })}`}
      onPlay={() => { if (media.current) applyRecordingTempo(media.current, "shermet", speed); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onRateChange={() => { if (media.current) applyRecordingTempo(media.current, "shermet", speed); }}
      onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onVolumeChange={event => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }} onError={() => setError(true)} />;
  const playLabel = playing ? "Pause" : "Play";
  const playControl = <button type="button" ref={compact?.playButton} onClick={play} aria-label={compact ? playLabel : undefined}>
    {compact ? <CompactActionLabel action={playing ? "pause" : "play"} label={playLabel} /> : playLabel}
  </button>;
  const controls = <>
    <div className={styles.controls}>
      {!compact && playControl}
      <button type="button" aria-pressed={repeat} onClick={() => setRepeat(value => !value)}>Repeat</button>
      <label>Speed<select disabled={!speedSupported} value={speed} onChange={event => { preferredSpeed = Number(event.target.value); setSpeed(preferredSpeed); }}>{RELATIVE_RECORDING_SPEEDS.map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
      <label className={styles.seek}>Recording position<input aria-label="Recording position" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration)} disabled={!duration} aria-valuetext={`${clock(position)} of ${clock(duration)}`} onChange={event => { const at = Number(event.target.value); if (media.current) media.current.currentTime = at; setPosition(at); }} /><span>{clock(position)} / {clock(duration)}</span></label>
      <button type="button" aria-pressed={muted} onClick={() => setMuted(value => !value)}>Mute</button>
      <label>Volume<input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => setVolume(Number(event.target.value))} /></label>
    </div>
    {!speedSupported && <p>This browser cannot preserve pitch at different speeds. Playing at the original recorded tempo.</p>}
  </>;
  const errorMessage = error && <p role="alert">This recording couldn’t be loaded. Choose another recording or try again.</p>;
  if (compact) return <section ref={compact.player} className={styles.compactPlayer} aria-label="Selected recording">
    <p className={styles.compactTitle}>{shermetLibraryTitle(item)}</p>
    <div className={styles.compactActions}>
      {playControl}
      <button type="button" aria-label="Controls" aria-expanded={compact.expanded} aria-controls={compact.panelId} onClick={event => {
        if (compact.expanded) event.currentTarget.focus();
        compact.toggleControls();
      }}><CompactActionLabel action="controls" label="Controls" /></button>
      <button type="button" aria-label="Close" onClick={compact.close}><CompactActionLabel action="close" label="Close" /></button>
    </div>
    {audio}
    {errorMessage}
    {compact.expanded && compact.panel.current && createPortal(
      <div className={styles.inlineControls} aria-label="Playback controls" role="group">{controls}</div>, compact.panel.current,
    )}
  </section>;
  return <section className={styles.player} aria-label="Selected recording">
    <h2>{shermetLibraryTitle(item)}</h2>
    {item.category === "source-conflict" && <p>Omaha’s original label: {item.label}{!item.ref && " · The text identity is unconfirmed."}</p>}
    <p>Cantor Wendy Shermet · Temple Israel, Omaha</p>
    {audio}
    {controls}
    {errorMessage}
  </section>;
}
