"use client";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { claudeTranslationCredit, DISCUSSION_LABELS } from "../../../../lib/discussions/labels";
import { discussionsView, type DiscussionSource, type DiscussionText, type DiscussionsView, type VerseDiscussion } from "../../../../lib/discussions/answer";
import { fetchDiscussions, type DiscussionPassage } from "./discussions-api";
import { MarkdownLite } from "./markdown-lite";
import { Runs } from "./commentary-view";
import styles from "./commentary.module.css";

/**
 * Curated discussions in the reader (1.7 M6b): a quiet marker on each anchor verse, the verse panel's "discussion" kind, and a reading's
 * list of sources. Source-only, as the spec says: a title, then original passages with their credits; nothing here writes, introduces or
 * summarises. The data is one public GET (discussions-api.ts), the same signed in or out; a failure or an empty answer shows nothing at all.
 */
const Context = createContext<DiscussionsView | null>(null);
export const DiscussionsProvider = Context.Provider;
/** What discussions the reading has, or null: no marker, no list and no panel kind without it. */
export const useDiscussionsView = (): DiscussionsView | null => useContext(Context);

/**
 * Fetches the passage's discussions while `active` (Study) and provides them to everything below. Without a passage it provides nothing:
 * a reading with no stated passage, a concealed text, or Lein. The answer is kept for the passage once it has come.
 */
export function DiscussionsSource({ passage, active, children }: { passage: DiscussionPassage | null; active: boolean; children: ReactNode }) {
  const ref = passage?.ref ?? null, kind = passage?.kind ?? null, key = ref && kind ? JSON.stringify([ref, kind]) : null;
  const [state, setState] = useState<{ key: string; view: DiscussionsView | null } | null>(null), kept = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !ref || !kind || !key || kept.current === key) return;
    const controller = new AbortController();
    fetchDiscussions({ ref, kind }, controller.signal).then(answer => { if (!controller.signal.aborted) { kept.current = key; setState({ key, view: discussionsView(answer) }); } },
      () => { if (!controller.signal.aborted) setState({ key, view: null }); });
    return () => controller.abort();
  }, [active, ref, kind, key]);
  return <Context.Provider value={active && state?.key === key ? state?.view ?? null : null}>{children}</Context.Provider>;
}

function Segments({ text, only }: { text: DiscussionText; only?: "hebrew" }) {
  return <>{text.segments.map((segment, index) => <div key={index} className={styles.discussionSegment}>
    {segment.hebrew && <p className={`${styles.compareText} ${styles.aramaic}`} lang="he" dir="rtl"><Runs runs={segment.hebrew} /></p>}
    {only !== "hebrew" && segment.english && <p className={styles.compareText} lang="en" dir="ltr"><Runs runs={segment.english} mixed /></p>}
  </div>)}</>;
}
const languageName = (language: "he" | "en") => language === "he" ? "Hebrew" : "English";

/**
 * One source, in full: its text where Sefaria gave it, then its credit and a link to Sefaria. An edition's credit is the line the route
 * returns; a Claude translation's is "Claude translation for {productName}" and it is shown only beside its original, so when the original
 * did not load the credit and the link stand alone. "Selected by {name}" is a detail under the credit, never in it.
 */
export function DiscussionSourceView({ source, productName }: { source: DiscussionSource; productName: string }) {
  const text = source.text, hebrew = text?.editions.find(edition => edition.language === "he") ?? null, english = text?.editions.find(edition => edition.language === "en") ?? null;
  return <div className={styles.discussionSource} data-discussion-source={source.position} data-source-kind={source.kind}>
    <p className={styles.compareTitle}><bdi dir="ltr">{source.ref}</bdi></p>
    {text && (source.kind === "edition" ? <Segments text={text} /> : <>
      <Segments text={text} only="hebrew" />
      <MarkdownLite className={styles.discussionTranslation} text={source.translation.body} heClass={styles.aramaic} />
    </>)}
    <p className={styles.compareCredit}>
      {source.kind === "translation" && <span className={styles.creditLine} data-discussion-credit="translation">{claudeTranslationCredit(productName)}</span>}
      {source.kind === "edition" && (source.credit !== null
        ? <span className={styles.creditLine} data-discussion-credit="edition">{english ? <a href={english.url} target="_blank" rel="noopener noreferrer">{source.credit}</a> : source.credit}</span>
        : <span className={styles.creditLine} data-discussion-credit="edition"><bdi>{source.edition}</bdi></span>)}
      {text && hebrew && <span className={styles.creditLine}>{languageName("he")}: <a href={hebrew.url} target="_blank" rel="noopener noreferrer">{hebrew.credit}</a></span>}
      <a className={styles.creditLine} href={source.sefariaUrl} target="_blank" rel="noopener noreferrer"><bdi dir="ltr">{source.ref}</bdi> on Sefaria</a>
    </p>
    <p className={styles.sourceDetail} data-source-detail="">{source.selectedBy}</p>
  </div>;
}

/** The verse panel's "discussion" kind: every discussion anchored on this verse, its title and then its sources on the verse in order. */
export function DiscussionPanelBody({ verse }: { verse: string }) {
  const view = useDiscussionsView(), rows: readonly VerseDiscussion[] = view?.forVerse(verse) ?? [];
  if (!view || !rows.length) return null;
  return <>{rows.map(row => <section key={row.discussion.slug} className={styles.discussion} data-discussion={row.discussion.slug}>
    <h4 className={styles.panelSubheading}><bdi>{row.discussion.title}</bdi></h4>
    <ol className={styles.compareList}>{row.sources.map(source => <li key={source.position} className={styles.compareItem}><DiscussionSourceView source={source} productName={view.productName} /></li>)}</ol>
  </section>)}</>;
}

/**
 * "Sources for this reading": under the reading's header, each discussion's title and its sources, each opening in the verse panel at its
 * anchor verse. Nothing at all (no heading either) when the reading has no discussion.
 */
export function DiscussionListView({ view, onOpen }: { view: DiscussionsView; onOpen(verse: string, trigger: HTMLElement): void }) {
  const id = useId();
  return <section className={styles.discussionList} aria-labelledby={`${id}-heading`} data-discussion-list="">
    <h3 id={`${id}-heading`} className={styles.discussionListHeading}>{DISCUSSION_LABELS.list}</h3>
    <ul className={styles.discussionItems}>{view.answer.discussions.map(discussion => <li key={discussion.slug} className={styles.discussionItem}>
      <p className={styles.discussionTitle}><bdi>{discussion.title}</bdi></p>
      <ul className={styles.shelfItems}>{discussion.sources.map(source => <li key={source.position}>
        <button type="button" className={styles.shelfItem} data-discussion-open={`${discussion.slug}:${source.position}`} onClick={event => onOpen(source.anchorRef, event.currentTarget)}>
          <bdi dir="ltr">{source.ref}</bdi></button>
      </li>)}</ul>
    </li>)}</ul>
  </section>;
}

/** Whether a verse is an anchor: the marker's whole condition. */
export const useIsAnchor = (verse: string): boolean => useDiscussionsView()?.anchors.has(verse) ?? false;
