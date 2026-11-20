"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gatedFetch } from "../session-gate";
import type { createReadingAudioCoordinator, ReadingAudioRegistration, ReadingAudioIntent } from "./reading-audio-coordinator";
import styles from "./tutor-spoken.module.css";

export type TutorSpokenProps = Readonly<{ studentId: string; mode: "student" | "parent" | "tutor" | "admin"; assignmentId: string; assignmentRevision: number; startVerse: string; allowManagement?: boolean; audio?: ReturnType<typeof createReadingAudioCoordinator> }>;
type Metadata = { available: boolean; canShare: boolean; expectedClipRevision: number; expectedClipId: string | null;
  clip: null | { id: string; revision: number; mediaType: string; canManage: boolean; startVerse: string; endVerse: string } };
const MAX_BYTES = 3 * 1024 * 1024;
function parseMetadata(value: unknown): Metadata {
  if (!value || typeof value !== "object") throw 0;
  const row = value as Record<string, unknown>;
  if (row.ok !== true || typeof row.available !== "boolean" || typeof row.canShare !== "boolean" || !Number.isSafeInteger(row.expectedClipRevision) || (row.expectedClipRevision as number) < 0
    || row.expectedClipId !== null && (typeof row.expectedClipId !== "string" || !/^[a-f0-9-]{36}$/.test(row.expectedClipId))) throw 0;
  if (row.clip !== null) {
    if (!row.clip || typeof row.clip !== "object") throw 0;
    const clip = row.clip as Record<string, unknown>;
    if (typeof clip.id !== "string" || !/^[a-f0-9-]{36}$/.test(clip.id) || !Number.isSafeInteger(clip.revision) || typeof clip.canManage !== "boolean" || !["startVerse", "endVerse", "mediaType"].every(key => typeof clip[key] === "string")) throw 0;
  }
  return row as unknown as Metadata;
}

/** Human spoken Hebrew belongs to this assigned aliyah, separately from the reference chant player. */
export function TutorSpoken(props: TutorSpokenProps) {
  const binding = new URLSearchParams({ mode: props.mode, assignmentId: props.assignmentId, assignmentRevision: String(props.assignmentRevision), startVerse: props.startVerse });
  const endpoint = `/api/students/${encodeURIComponent(props.studentId)}/tutor-spoken`, url = `${endpoint}?${binding}`;
  const [metadata, setMetadata] = useState<Metadata | null>(null), [round, setRound] = useState(0), [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<Blob | null>(null), [preview, setPreview] = useState<string | null>(null), [recording, setRecording] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const retainedPlayer = useRef<HTMLAudioElement | null>(null);
  const player = useRef<HTMLAudioElement | null>(null), localPlayer = useRef<HTMLAudioElement | null>(null), registration = useRef<ReadingAudioRegistration | null>(null), ticket = useRef<ReadingAudioIntent | null>(null), micGate = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), gate = useRef(false), generation = useRef(0);
  useLayoutEffect(() => {
    const stop = () => { ticket.current = null; const element = player.current ?? retainedPlayer.current; if (element) { element.pause(); element.removeAttribute("src"); element.load(); } localPlayer.current?.pause(); };
    registration.current = props.audio?.register("spoken", stop) ?? null;
    return () => { registration.current?.dispose(); registration.current = null; stop(); };
  }, [props.audio, url]);
  const claimAudio = (element: HTMLAudioElement) => {
    if (element !== player.current) player.current?.pause();
    if (element !== localPlayer.current) localPlayer.current?.pause();
    if (props.audio) {
      const owner = registration.current;
      if (!owner) { element.pause(); return false; }
      if (!ticket.current || !owner.isCurrent(ticket.current)) ticket.current = owner.claim();
      if (!ticket.current) { element.pause(); return false; }
    }
    element.playbackRate = 1; element.defaultPlaybackRate = 1;
    return true;
  };
  useEffect(() => {
    const controller = new AbortController(); generation.current++; setMetadata(null); setDraft(null); setNotice(null);
    gatedFetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal }).then(async response => {
      if (!response.ok) throw 0;
      const row = parseMetadata(await response.json()); if (!controller.signal.aborted) setMetadata(row);
    }).catch(() => { if (!controller.signal.aborted) setMetadata(null); });
    return () => { controller.abort(); generation.current++; if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); };
  }, [url, round]);
  useEffect(() => { if (!draft) { setPreview(null); return; } const next = URL.createObjectURL(draft); setPreview(next); return () => URL.revokeObjectURL(next); }, [draft]);
  const choose = (blob: Blob) => { if (blob.size < 16 || blob.size > MAX_BYTES) { setNotice("Choose an audio recording smaller than 3 MB."); return; } setNotice(null); setDraft(blob); };
  const record = async () => {
    if (recording) { if (recorder.current?.state !== "inactive") recorder.current?.stop(); return; }
    if (micGate.current || pending) return;
    micGate.current = true; props.audio?.stopAll();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setNotice("Recording is unavailable here. Choose an audio file instead."); micGate.current = false; return; }
    const current = generation.current;
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current) { captured.getTracks().forEach(track => track.stop()); return; }
      stream.current = captured;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(value => MediaRecorder.isTypeSupported(value));
      if (!type) { captured.getTracks().forEach(track => track.stop()); throw 0; }
      const next = new MediaRecorder(captured, { mimeType: type }), chunks: Blob[] = []; let size = 0, overflow = false;
      recorder.current = next;
      next.ondataavailable = event => { size += event.data.size; if (size > MAX_BYTES) { overflow = true; if (next.state !== "inactive") next.stop(); } else chunks.push(event.data); };
      next.onstop = () => { captured.getTracks().forEach(track => track.stop()); if (current !== generation.current) return; setRecording(false); recorder.current = null; if (overflow) setNotice("The recording reached 3 MB. Record a shorter example."); else choose(new Blob(chunks, { type })); };
      next.onerror = () => { captured.getTracks().forEach(track => track.stop()); setRecording(false); setNotice("The recording stopped. Try again or choose an audio file."); };
      setNotice(null); setRecording(true); next.start(1000);
    } catch { stream.current?.getTracks().forEach(track => track.stop()); setNotice("The microphone is unavailable. Choose an audio file or allow microphone access and try again."); }
    finally { micGate.current = false; }
  };
  const mutate = async (withdraw: boolean) => {
    if (!metadata || gate.current || !withdraw && !draft) return;
    gate.current = true; setPending(true); setNotice(null); const current = generation.current;
    const query = new URLSearchParams(binding); query.set("expectedClipRevision", String(metadata.expectedClipRevision)); if (metadata.expectedClipId) query.set("expectedClipId", metadata.expectedClipId);
    try {
      const response = await gatedFetch(`${endpoint}${withdraw ? "/withdraw" : ""}?${query}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        ...(withdraw ? { headers: { "content-type": "application/json" }, body: JSON.stringify({}) } : { headers: { "content-type": draft!.type || "application/octet-stream" }, body: draft }) });
      if (!response.ok || (await response.json()).ok !== true) throw 0;
      if (current === generation.current) { setDraft(null); setRound(value => value + 1); }
    } catch { if (current === generation.current) setNotice("The recording wasn't saved. Refresh this aliyah and try again."); }
    finally { gate.current = false; setPending(false); }
  };
  const management = props.allowManagement !== false && (props.mode === "tutor" || props.mode === "admin");
  if (!metadata?.available || !metadata.clip && !management) return null;
  const audio = metadata.clip ? `${endpoint}/audio?${binding}&clipId=${encodeURIComponent(metadata.clip.id)}` : null;
  return <section className={styles.section} aria-label="Tutor's spoken Hebrew" data-testid="tutor-spoken">
    <h3>Tutor's spoken Hebrew</h3>
    {audio && <><button type="button" className="button-secondary" onClick={() => { const element = player.current; if (!element || !claimAudio(element)) return; element.src = audio; void element.play().catch(() => setNotice("The recording couldn't play. Try again.")); }}>Hear it read</button><audio ref={node => { player.current = node; if (node) retainedPlayer.current = node; }} onPlay={event => claimAudio(event.currentTarget)} onRateChange={event => { if (event.currentTarget.playbackRate !== 1) event.currentTarget.playbackRate = 1; }} key={`${metadata.clip!.id}:${metadata.clip!.revision}`} controls preload="none" src={audio} aria-label="Tutor's spoken Hebrew for this aliyah" /></>}
    {management && metadata.canShare && <div className={styles.controls}>
      <button type="button" className="button-secondary" disabled={pending} onClick={() => void record()}>{recording ? "Stop recording" : "Record spoken Hebrew"}</button>
      <label className={styles.upload}>Choose audio<input type="file" accept="audio/webm,audio/mp4,audio/mpeg,audio/ogg,audio/wav" disabled={pending || recording} onChange={event => { const file = event.target.files?.[0]; if (file) choose(file); event.target.value = ""; }} /></label>
      {preview && <div className={styles.preview}><p>Preview before sharing</p><audio ref={localPlayer} onPlay={event => claimAudio(event.currentTarget)} onRateChange={event => { if (event.currentTarget.playbackRate !== 1) event.currentTarget.playbackRate = 1; }} controls preload="metadata" src={preview} aria-label="Your recording preview" /><button type="button" className="button-primary" disabled={pending || recording} onClick={() => void mutate(false)}>Share privately</button><button type="button" className="button-secondary" disabled={pending} onClick={() => setDraft(null)}>Discard</button></div>}
    </div>}
    {management && metadata.clip?.canManage && <button type="button" className="button-secondary" disabled={pending || recording} onClick={() => void mutate(true)}>Withdraw recording</button>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
