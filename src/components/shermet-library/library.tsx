"use client";
import { useEffect, useRef, useState } from "react";
import { SHERMET_CATEGORIES, parseShermetLibrary, type ShermetLibraryItem } from "../../lib/reference-audio/shermet-library";
import styles from "./library.module.css";
type Page = { items: readonly ShermetLibraryItem[]; nextOffset: number | null };
export function ShermetLibrary({ initialCategory = "" }: { initialCategory?: string }) {
  const [query, setQuery] = useState(""), [category, setCategory] = useState(initialCategory), [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null), [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<{ item: ShermetLibraryItem; sha256: string } | null>(null);
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
  const listen = (item: ShermetLibraryItem, sha256: string) => { setSelected({ item, sha256 }); };
  const change = (kind: "query" | "category", value: string) => { setOffset(0); kind === "query" ? setQuery(value) : setCategory(value); };
  return <>
    <div className={styles.filters}><label>Search recordings<input type="search" value={query} onChange={event => change("query", event.target.value)} /></label>
      <label>Category<select value={category} onChange={event => change("category", event.target.value)}><option value="">All categories</option>{Object.entries(SHERMET_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <p role="status">{status === "loading" ? "Loading recordings…" : status === "error" ? "The recording library couldn’t be loaded. Try again later." : page?.items.length === 0 ? "No recordings match this search." : "Choose a recording to listen."}</p>
    {status === "ready" && page && <div aria-label="Recording library" className={styles.results}>{Object.entries(SHERMET_CATEGORIES).map(([key, label]) => {
      const items = page.items.filter(item => item.category === key);
      return items.length ? <section key={key} aria-labelledby={`category-${key}`}><h2 id={`category-${key}`}>{label}</h2><ul>{items.map(item => <li key={item.id} data-recording-item={item.id}>
        <h3>{item.label}</h3><p>{item.title}</p><p><a href={item.pageUrl} target="_blank" rel="noreferrer">Source at Temple Israel</a></p>
        {item.status === "available" && item.recordings.length > 0 ? <div className={styles.actions}>{item.recordings.map((recording, index) => <button key={recording.sha256} type="button" aria-label={`Listen to ${item.label}${item.recordings.length > 1 ? `, recording ${index + 1}` : ""}`} onClick={() => listen(item, recording.sha256)}>{item.recordings.length > 1 ? `Listen to recording ${index + 1}` : "Listen"}</button>)}</div> : <p>{item.status === "pending" ? "Recording not available yet." : "The source recording is unavailable."}</p>}
      </li>)}</ul></section> : null;
    })}</div>}
    <nav className={styles.pagination} aria-label="Recording pages"><button type="button" disabled={offset === 0 || status !== "ready"} onClick={() => setOffset(Math.max(0, offset - 40))}>Previous recordings</button><button type="button" disabled={page?.nextOffset == null || status !== "ready"} onClick={() => setOffset(page!.nextOffset!)}>More recordings</button></nav>
    {selected && <ShermetLibraryPlayer item={selected.item} sha256={selected.sha256} />}
  </>;
}
/** Shared by the library and the actual matching prayer lesson. */
export function ShermetLibraryPlayer({ item, sha256 }: { item: ShermetLibraryItem; sha256: string }) {
  const [error, setError] = useState(false), media = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    setError(false);
    const selected = media.current;
    const stop = () => { if (document.visibilityState !== "visible") selected?.pause(); };
    document.addEventListener("visibilitychange", stop);
    return () => { selected?.pause(); document.removeEventListener("visibilitychange", stop); };
  }, [item.id, sha256]);
  return <section className={styles.player} aria-label="Selected recording"><h2>{item.label}</h2><p>Cantor Wendy Shermet · Temple Israel, Omaha</p>
    <audio key={`${item.id}:${sha256}`} ref={media} controls autoPlay preload="none" aria-label={item.label} src={`/api/shermet-library/media?${new URLSearchParams({ id: item.id, recording: sha256 })}`} onError={() => setError(true)} />
    {error && <p role="alert">This recording couldn’t be loaded. Choose another recording or try again.</p>}
  </section>;
}
