"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { sharePassagePath } from "../public-reading/urls";
import { displayRange, longDate } from "../public-reading/view";
import type { SavedKind } from "./api";
import styles from "./saved.module.css";

export function SharePassage({ id, kind, ranges, date }: { id: string; kind: SavedKind; ranges: string; date: string | null }) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [includeDate, setIncludeDate] = useState(false);
  const path = sharePassagePath(ranges, kind, includeDate ? date ?? undefined : undefined);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  if (!path) return null;
  return <section id={id} className={`${styles.panel} ${styles.share}`} aria-labelledby={headingId}>
    <h2 id={headingId} ref={heading} tabIndex={-1}>Share passage</h2>
    <p>{kind === "torah" ? "Torah" : "Haftarah"} <bdi dir="ltr">{displayRange([ranges])}</bdi></p>
    {date && <label className={styles.shareDate}>
      <input type="checkbox" checked={includeDate} onChange={event => setIncludeDate(event.target.checked)} />
      <span>Include preparation date (<time dateTime={date}>{longDate(date)}</time>)</span>
    </label>}
    <p>The link keeps this passage even if you edit or remove the saved reading.</p>
    <CopyPassageLink key={path} path={path} />
  </section>;
}

function CopyPassageLink({ path }: { path: string }) {
  const [result, setResult] = useState<"copied" | "fallback" | null>(null);
  const [url, setUrl] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { if (result === "fallback") { field.current?.focus(); field.current?.select(); } }, [result]);
  async function copy() {
    const link = new URL(path, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(link);
      setResult("copied");
    } catch {
      setUrl(link);
      setResult("fallback");
    }
  }
  return <>
    <div className={styles.actions}><button type="button" className="button-primary" onClick={() => void copy()}>Copy link</button></div>
    {result === "copied" && <p role="status">Link copied.</p>}
    {result === "fallback" && <label className={styles.shareFallback}>Copy this link
      <input type="url" ref={field} readOnly value={url} onFocus={event => event.currentTarget.select()} />
    </label>}
  </>;
}
