"use client";
import { useId, useState } from "react";
import { HUMAN_VOICES, humanTrackCoverage, humanTrackCut, type HumanTrack } from "../../lib/reference-audio/human-tracks";
import type { CollectionAudioSlot, createReadingAudioCoordinator } from "../portal/workspace/study/reading-audio-coordinator";
import { HumanTrackCoverage, HumanTrackCredit, HumanTrackPlayback, HumanTrackSave } from "./human-track-playback";
import styles from "./human-tracks.module.css";

export function ReadingCollectionPlayback({ tracks, verseRef, coordinator, slot, enabled, expiresAt }: {
  tracks: readonly HumanTrack[]; verseRef?: string; coordinator: ReturnType<typeof createReadingAudioCoordinator>; slot: CollectionAudioSlot; enabled: boolean; expiresAt?: number;
}) {
  const select = useId();
  const [choice, setChoice] = useState("");
  const [open, setOpen] = useState(false);
  if (!tracks.length) return null;
  const track = tracks.find(item => item.id === choice);
  const cut = track && verseRef ? humanTrackCut(track, verseRef) : null;
  return <details className={styles.details} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Other recorded readings</summary>
    <div className={styles.field}>
      <label htmlFor={select}>Full reading recording</label>
      <select id={select} value={track?.id ?? ""} onChange={event => setChoice(event.target.value)}>
        <option value="">Choose a recording</option>
        {Object.entries(HUMAN_VOICES).map(([voice, credit]) => tracks.some(item => item.voice === voice) && <optgroup key={voice} label={credit.name}>
          {tracks.filter(item => item.voice === voice).map(item => <option key={item.id} value={item.id}>{item.title}{humanTrackCoverage(item) ? " · " + humanTrackCoverage(item) : ""}</option>)}
        </optgroup>)}
      </select>
    </div>
    {track && <>
      <HumanTrackCoverage track={track} />
      <HumanTrackCredit track={track} />
      <p>Play the full source recording below. Taps in the Hebrew still use the verse player.</p>
      <HumanTrackPlayback key={track.id} track={track} clip={cut && verseRef ? { ...cut, ref: verseRef } : null} audio={{ coordinator, slot }} enabled={enabled && open} expiresAt={expiresAt} />
      <HumanTrackSave key={track.id} track={track} />
    </>}
    <p><a href="/recordings">Browse all recordings</a></p>
  </details>;
}
