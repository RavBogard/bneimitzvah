"use client";
import { useEffect, useState } from "react";
import { useIdentity } from "../site/identity-context";
import { parseShermetLibrary, SHERMET_SERVICE_ITEMS, type ShermetLibraryItem } from "../../lib/reference-audio/shermet-library";
import { ShermetLibraryPlayer } from "./library";
export function LessonRecording({ lesson, morning = true, showAvailability = false }: { lesson: string; morning?: boolean; showAvailability?: boolean }) {
  const identity = useIdentity(), [item, setItem] = useState<ShermetLibraryItem | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<"checking" | "missing" | "failed">("checking");
  const key = !morning && ["barchu", "chatzi-kaddish"].includes(lesson) ? `${lesson}-evening` : lesson;
  useEffect(() => {
    const abort = new AbortController(); setItem(null); setSelected(null); setStatus("checking");
    if (!identity.cantorRecordings || !SHERMET_SERVICE_ITEMS[key] || ["vahavta", "mi-chamochah"].includes(lesson) && !morning) { setStatus("missing"); return; }
    void fetch(`/api/shermet-library?${new URLSearchParams({ lesson: key })}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]), credentials: "omit", redirect: "error", cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error("Recording metadata unavailable"); return response.json(); }).then(value => {
        const items = parseShermetLibrary({ version: 1, items: value?.items });
        if (!abort.signal.aborted) { setItem(items.find(item => item.id === SHERMET_SERVICE_ITEMS[key]) ?? null); setStatus("missing"); }
      }).catch(() => { if (!abort.signal.aborted) setStatus("failed"); });
    return () => abort.abort();
  }, [lesson, key, identity.cantorRecordings, morning]);
  if (!item) return showAvailability ? <p>{status === "checking" ? "Checking recordings…" : status === "failed"
    ? "Recording availability couldn’t be checked." : "No practice recording is available for this part."}</p> : null;
  return <section aria-label="Prayer recording">{showAvailability ? <h5>Course recording</h5> : <h2>Listen</h2>}<p>{item.label}</p><p><a href={item.pageUrl} target="_blank" rel="noreferrer">Cantor Wendy Shermet · Temple Israel, Omaha</a></p>
    {item.status === "available" && item.recordings.length ? item.recordings.map((recording, i) => <button type="button" key={recording.sha256} onClick={() => setSelected(recording.sha256)}>{item.recordings.length > 1 ? `Listen to recording ${i + 1}` : "Listen"}</button>) : <p>This source recording is not available yet.</p>}
    {selected && <ShermetLibraryPlayer item={item} sha256={selected} />}
  </section>;
}
