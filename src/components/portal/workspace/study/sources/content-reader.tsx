"use client";
import { useEffect, useRef } from "react";
import type { SourceCitation } from "./api";
import { eligibleSourceEdition } from "./content-api";
import type { SourceContentOwner, SourceContentState } from "./content-owner";
import styles from "./panel.module.css";
export function SourceContentReader({ owner, state, source, onClose }: { owner: SourceContentOwner; state: SourceContentState; source: SourceCitation; onClose(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (state.phase === "editions" || state.phase === "text") heading.current?.focus(); }, [state.phase, state.page?.editionOffset]);
  const message = state.error === "unsupported-source" ? "This source’s format isn’t available here yet. Choose another source."
    : state.error === "unsupported-edition" ? "This edition isn’t available here. Choose another edition."
    : state.error === "source-not-found" ? "This source is no longer in this list. Close it and review the sources."
    : state.phase === "stale" ? "The reading or sources changed. Close this source and refresh the reading before choosing again."
    : "This source couldn’t be loaded. Try again when you’re ready.";
  return <section className={styles.reader} aria-label={`Read source: ${source.ref}`} aria-busy={state.phase === "loading-editions" || state.phase === "loading-text"}>
    <div className={styles.readerHeading}><h5 ref={heading} tabIndex={-1}><bdi dir="auto">{source.labels.en ?? source.indexTitle}</bdi></h5><button type="button" className={styles.link} onClick={onClose}>Close source</button></div>
    <p className={styles.ref}><bdi dir="auto">{source.ref}</bdi></p>
    {(state.phase === "loading-editions" || state.phase === "loading-text") && <p role="status">{state.phase === "loading-editions" ? "Loading editions…" : "Loading source…"}</p>}
    {(state.phase === "held" || state.phase === "unavailable" || state.phase === "stale") && <div role="status"><p>{message}</p>{state.phase === "unavailable" && <button type="button" className={styles.link} onClick={() => void owner.retry()}>Try source again</button>}</div>}
    {(state.phase === "text" || state.phase === "held" && state.error === "unsupported-edition") && state.page && <button type="button" className={styles.link} onClick={() => owner.back()}>Back to editions</button>}
    {state.phase === "editions" && state.page && <>
      <h6 className={styles.editionHeading}>Choose an edition</h6>
      {!state.page.entries.length && <p>No editions are listed for this source.</p>}
      <ul className={styles.list} aria-label="Source editions">{state.page.entries.map(edition => <li key={JSON.stringify([edition.versionTitle, edition.language])}>
        <p className={styles.editionTitle}><bdi dir="auto">{edition.versionTitle}</bdi></p>
        <p className={styles.note}>{edition.actualLanguage === "he" ? "Hebrew" : edition.actualLanguage === "en" ? "English" : "Other or unspecified language"} · <bdi dir="auto">{edition.license ?? "Rights not recorded"}</bdi></p>
        {eligibleSourceEdition(edition) ? <button type="button" className={styles.link} onClick={() => void owner.choose({ editionCatalogHash: state.page!.editionCatalogHash, edition, language: edition.actualLanguage })}>Read {edition.actualLanguage === "he" ? "Hebrew" : "English"} edition</button> : <p className={styles.note}>This edition isn’t available to read here.</p>}
      </li>)}</ul>
      <div className={styles.actions}><span>{state.page.editionOffset + (state.page.entries.length ? 1 : 0)}–{state.page.editionOffset + state.page.entries.length} of {state.page.totalEntries} editions</span>
        {state.page.editionOffset > 0 && <button type="button" onClick={() => void owner.page({ editionOffset: state.page!.editionOffset - 10, editionCatalogHash: state.page!.editionCatalogHash })}>Previous editions</button>}
        <button type="button" disabled={state.page.nextEditionOffset === null} onClick={() => void owner.page({ editionOffset: state.page!.nextEditionOffset!, editionCatalogHash: state.page!.editionCatalogHash })}>Next editions</button></div>
      {(state.page.heldCount > 0 || state.page.duplicateCount > 0) && <p className={styles.note}>Some edition records could not be listed separately.</p>}
    </>}
    {state.phase === "text" && state.text && <>
      <p className={styles.editionTitle}><bdi dir="auto">{state.text.edition.versionTitle}</bdi></p>
      {state.text.schema === "study-source-text/v1" ? <div className={styles.sourceText} lang={state.text.edition.actualLanguage} dir={state.text.edition.actualLanguage === "he" ? "rtl" : "ltr"}>{state.text.text}</div> : <>
        {state.text.extent.kind === "parent" && <p className={styles.note}>Segments observed in this edition. Other segments may exist in other editions.</p>}
        {!state.text.segments.length && <p role="status">No segments were returned for this source in this edition.</p>}
        {state.text.segments.length > 0 && state.text.segments.every(segment => segment.status === "missing") && <p role="status">No text was returned for these segments in this edition.</p>}
        <ol className={styles.segmentList} aria-label="Source segments">{state.text.segments.map(segment => <li key={segment.ref}>
          <p className={styles.ref}><bdi dir="auto">{segment.ref}</bdi></p>
          {segment.status === "text" ? <div className={styles.sourceText} lang={state.text!.edition.actualLanguage} dir={state.text!.edition.actualLanguage === "he" ? "rtl" : "ltr"}>{segment.text}</div> : <p className={styles.note}>No text was returned for this segment in this edition.</p>}
        </li>)}</ol>
      </>}
      <p className={styles.credit}>Sefaria · <bdi dir="auto">{state.text.provenance.sourceRef}</bdi> · <bdi dir="auto">{state.text.provenance.editionTitle}</bdi> · <bdi dir="auto">{state.text.provenance.license}</bdi></p>
      <p className={styles.provenance}><bdi dir="auto">{state.text.provenance.versionSource}</bdi></p>
      <p className={styles.note}>Observed edition text, formatted as plain text by Sefaria.</p>
    </>}
  </section>;
}
