"use client";
import { useEffect, useMemo, useState } from "react";
import { commentaryChaptersOf } from "../../../../lib/readings/commentary";
import { createCommentaryChapterStore, type CommentaryChapterStore, type CommentaryVerseState } from "./commentary-api";

export type CommentaryLookup = Readonly<{ forVerse(ref: string): CommentaryVerseState }>;
const OFF: CommentaryLookup = Object.freeze({ forVerse: () => Object.freeze({ status: "none" as const }) });

/**
 * One commentary for the verses on screen, fetched after the text renders
 * (never before it, never in its way): once per distinct chapter, aborted when
 * the page of verses changes or the reader leaves. A failure is quiet: those
 * verses report "failed" and the reading is untouched. With `enabled` false
 * nothing is fetched and every verse reports "none". A shared `store` is used
 * only when it is for the same work. Not yet used by any reading surface: the
 * study UI that shows it is still being designed.
 */
export function useCommentaryChapters(work: string, verseRefs: readonly string[], enabled = true, store?: CommentaryChapterStore): CommentaryLookup {
  const key = enabled ? commentaryChaptersOf(work, verseRefs).join("\n") : "";
  const pick = () => store && store.work === work ? store : createCommentaryChapterStore(work);
  const [owned, setOwned] = useState(pick);
  const current = store && store.work === work ? store : owned;
  // A new work gets its own store; this converges, because a created store always matches.
  if (current.work !== work) setOwned(pick());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!key || current.work !== work) return;
    return current.load(key.split("\n"), () => setVersion(value => value + 1));
  }, [current, work, key]);
  return useMemo(() => enabled && current.work === work ? Object.freeze({ forVerse: (ref: string) => current.forVerse(ref), version }) : OFF,
    [enabled, current, work, version]);
}
