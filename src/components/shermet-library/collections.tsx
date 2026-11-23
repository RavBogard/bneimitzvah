"use client";
import { useId, useState } from "react";
import { useIdentity } from "../site/identity-context";
import { availableHumanTracks, HUMAN_TRACK_KINDS, HUMAN_VOICES, humanTrackCoverage, humanTrackPlayable, type HumanTrack, type HumanTrackKind, type HumanVoice } from "../../lib/reference-audio/human-tracks";
import { ShermetLibrary } from "./library";
import { HumanTrackCoverage, HumanTrackCredit, HumanTrackPlayback, HumanTrackSave } from "./human-track-playback";
import styles from "./library.module.css";

export function RecordingCollections({ initialCategory }: { initialCategory: string }) {
  const [voice, setVoice] = useState<"shermet" | HumanVoice>("shermet");
  const id = useId(), tracks = availableHumanTracks(useIdentity());
  return <>
    <div className={styles.filters}><label htmlFor={id}>Collection<select id={id} value={voice}
      onChange={event => setVoice(event.target.value as typeof voice)}>
      <option value="shermet">Cantor Wendy Shermet · Temple Israel, Omaha</option>
      {Object.entries(HUMAN_VOICES).map(([key, value]) => tracks.some(track => track.voice === key) &&
        <option key={key} value={key}>{value.name} · {value.tradition}</option>)}
    </select></label></div>
    {voice === "shermet" ? <ShermetLibrary initialCategory={initialCategory} /> : <OtherRecordingLibrary key={voice} voice={voice} />}
  </>;
}
function OtherRecordingLibrary({ voice }: { voice: HumanVoice }) {
  const [query, setQuery] = useState(""), [category, setCategory] = useState<HumanTrackKind | "">(""),
    [choice, setChoice] = useState<HumanTrack | null>(null), [visible, setVisible] = useState(40);
  const library = availableHumanTracks(useIdentity()).filter(track => track.voice === voice);
  const matches = library.filter(track => (!category || category === track.kind)
    && [track.title, humanTrackCoverage(track), ...(track.portions ?? [])].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const kinds = Object.entries(HUMAN_TRACK_KINDS).filter(([kind]) => library.some(track => track.kind === kind));
  return <>
    <div className={styles.filters}>
      <label>Search recordings<input type="search" value={query} onChange={event => { setVisible(40); setQuery(event.target.value); }} /></label>
      <label>Category<select value={category} onChange={event => { setVisible(40); setCategory(event.target.value as typeof category); }}>
        <option value="">All categories</option>{kinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </div>
    <p role="status">{matches.length ? "Choose a recording to listen." : "No recordings match this search."}</p>
    <section aria-label="Recording library" className={styles.results}><h2>{HUMAN_VOICES[voice].name}</h2><ul>{matches.slice(0, visible).map(track => <li key={track.id} data-recording-item={track.id}>
      <h3>{track.title}</h3>
      <HumanTrackCoverage track={track} />
      {track.notes && <p>{track.notes}</p>}
      <HumanTrackCredit track={track} />
      {humanTrackPlayable(track)
        ? choice?.id === track.id
          ? <section aria-label="Selected recording"><HumanTrackPlayback key={track.id} track={track} autoPlay /><HumanTrackSave track={track} /></section>
          : <div className={styles.actions}><button type="button" aria-label={"Listen to " + track.title} onClick={() => setChoice(track)}>Listen</button></div>
        : <p>The source recording is unavailable.</p>}
    </li>)}</ul></section>
    {matches.length > visible && <div className={styles.pagination}><button type="button" onClick={() => setVisible(value => value + 40)}>More recordings</button></div>}
  </>;
}
