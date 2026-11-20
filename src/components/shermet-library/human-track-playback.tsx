"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HUMAN_VOICES, humanTrackCoverage, humanTrackPath, karaiteTrackSource, offlineHumanTrackAvailable, offlineHumanTrackPath, type HumanTrack, type HumanTrackCut } from "../../lib/reference-audio/human-tracks";
import { HUMAN_TRACK_SAVE_CHANGE, hasSavedHumanTrack, removeSavedHumanTrack, saveHumanTrack, supportsHumanTrackSave } from "../../lib/reference-audio/human-track-offline";
import { readingAudioCurrent, watchReadingAudioDeadline } from "../portal/workspace/study/reading-player-intent";
import type { ReadingAudioIntent, ReadingAudioRegistration, createReadingAudioCoordinator } from "../portal/workspace/study/reading-audio-coordinator";
import styles from "./human-tracks.module.css";

export function HumanTrackCredit({ track }: { track: HumanTrack }) {
  const voice = HUMAN_VOICES[track.voice];
  const credit = track.voice === "josh-finkel" ? voice.name + "’s teaching collection" : voice.name;
  return <p>{track.sourceUrl ? <a href={track.sourceUrl} target="_blank" rel="noreferrer">{credit}</a> : credit} · {voice.tradition}</p>;
}

export function HumanTrackCoverage({ track }: { track: HumanTrack }) {
  const coverage = humanTrackCoverage(track);
  return <p>{coverage ?? (track.kind === "torah" && track.portions?.length ? "Whole portion recording" : "Verse coverage unindexed")}</p>;
}

export function HumanTrackSave({ track }: { track: HumanTrack }) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"ready" | "saved" | "working" | "failed">("ready");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    let current = true;
    const discover = () => {
      setSupported(supportsHumanTrackSave());
      void hasSavedHumanTrack(track).then(saved => { if (current) setState(saved ? "saved" : "ready"); }).catch(() => {});
    };
    discover();
    navigator.serviceWorker?.addEventListener("controllerchange", discover);
    return () => {
      current = false;
      request.current?.abort();
      navigator.serviceWorker?.removeEventListener("controllerchange", discover);
    };
  }, [track]);
  if (!supported || !offlineHumanTrackAvailable(track)) return null;
  const change = () => {
    const attempt = new AbortController();
    request.current?.abort();
    request.current = attempt;
    setState("working");
    const work = state === "saved" ? removeSavedHumanTrack(track).then(() => "ready" as const) : saveHumanTrack(track, attempt.signal).then(() => "saved" as const);
    void work.then(next => { if (!attempt.signal.aborted) setState(next); }).catch(() => { if (!attempt.signal.aborted) setState("failed"); });
  };
  return <div className={styles.actions}>
    <button type="button" disabled={state === "working"} onClick={change}>{state === "saved" ? "Remove offline recording" : "Save recording offline"}</button>
    <span role="status">{state === "working" ? "Saving recording…" : state === "saved" ? "Saved for 14 days" : state === "failed" ? "Couldn’t change the offline copy. Try again." : Math.ceil(track.bytes / 1024 ** 2) + " MB"}</span>
  </div>;
}

type Clip = HumanTrackCut & { ref: string };

export function HumanTrackPlayback({ track, clip, coordinator, enabled = true, expiresAt, autoPlay = false }: {
  track: HumanTrack; clip?: Clip | null; coordinator?: ReturnType<typeof createReadingAudioCoordinator>; enabled?: boolean; expiresAt?: number; autoPlay?: boolean;
}) {
  const media = useRef<HTMLAudioElement | null>(null);
  const registration = useRef<ReadingAudioRegistration | null>(null);
  const ticket = useRef<ReadingAudioIntent | null>(null);
  const writing = useRef(0);
  const mode = useRef<Clip | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(false);
  const [bounded, setBounded] = useState(false);
  const [error, setError] = useState(false);
  const saved = useRef(false);
  useEffect(() => {
    let current = true;
    saved.current = false;
    const update = () => void hasSavedHumanTrack(track).then(value => { if (current) saved.current = value; }).catch(() => {});
    update();
    window.addEventListener(HUMAN_TRACK_SAVE_CHANGE, update);
    return () => { current = false; window.removeEventListener(HUMAN_TRACK_SAVE_CHANGE, update); };
  }, [track]);
  const allowed = () => enabled && readingAudioCurrent(expiresAt) && document.visibilityState === "visible";
  const current = () => allowed() && (!coordinator || !!ticket.current && !!registration.current?.isCurrent(ticket.current));
  const stop = () => {
    writing.current++;
    ticket.current = null;
    mode.current = null;
    const node = media.current;
    if (node?.hasAttribute("src")) { node.pause(); node.removeAttribute("src"); node.load(); }
    setPlaying(false); setSelected(false); setBounded(false);
  };
  useLayoutEffect(() => {
    const owned = coordinator?.register("collection", stop);
    registration.current = owned ?? null;
    const hide = () => { if (document.visibilityState !== "visible") stop(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      if (owned) owned.dispose(); else stop();
      if (registration.current === owned) registration.current = null;
    };
  }, [coordinator, track.id]);
  useLayoutEffect(() => { if (!enabled) stop(); }, [enabled]);
  useEffect(() => expiresAt === undefined ? undefined : watchReadingAudioDeadline(expiresAt, () => true, stop), [expiresAt]);

  const begin = (part: Clip | null) => {
    const node = media.current;
    if (!node || !allowed()) return;
    if (coordinator) { ticket.current = registration.current?.claim() ?? null; if (!ticket.current) return; }
    const turn = ++writing.current;
    node.pause();
    mode.current = part;
    setError(false); setSelected(true); setBounded(!!part);
    const direct = track.voice === "rotem-cohen" ? karaiteTrackSource(track.streamUrl) : null;
    const verified = offlineHumanTrackAvailable(track);
    const path = verified && (saved.current || !direct || !navigator.onLine) ? offlineHumanTrackPath(track) : direct ?? humanTrackPath(track);
    const url = path + (part ? "#t=" + part.startSec + "," + part.endSec : "");
    node.src = url;
    void node.play().catch(() => { if (turn === writing.current && current()) setError(true); });
  };
  useEffect(() => { if (autoPlay) begin(null); }, [autoPlay, track.id]);
  function checkTime(node: HTMLAudioElement) {
    if (!current()) { node.pause(); return; }
    const part = mode.current;
    if (part && node.currentTime >= part.endSec) { node.pause(); node.currentTime = part.startSec; }
  }
  return <div className={styles.transport}>
    <div className={styles.actions}>
      <button type="button" disabled={!enabled || !readingAudioCurrent(expiresAt)} onClick={() => {
        if (playing) media.current?.pause();
        else if (selected && !error && current() && media.current) void media.current.play().catch(() => setError(true));
        else begin(mode.current);
      }}>{playing ? "Pause collection recording" : selected && !error ? "Resume collection recording" : mode.current ? "Retry verse excerpt" : "Play full recording"}</button>
      {bounded && <button type="button" onClick={() => begin(null)}>Play full recording</button>}
      {clip && <button type="button" disabled={!enabled || !readingAudioCurrent(expiresAt)} onClick={() => begin(clip)}>Play {clip.ref} excerpt</button>}
    </div>
    <audio hidden={!selected || bounded} controls={selected && !bounded} preload="none" ref={media} aria-label={track.title}
      onLoadedMetadata={event => { if (mode.current && current()) event.currentTarget.currentTime = mode.current.startSec; }}
      onTimeUpdate={event => checkTime(event.currentTarget)}
      onPlay={event => { if (current()) setPlaying(true); else event.currentTarget.pause(); }}
      onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => { if (media.current?.hasAttribute("src") && current()) setError(true); }} />
    {error && <p role="status">The recording couldn’t be loaded. Try again or use an offline copy.</p>}
  </div>;
}
