"use client";
import { createContext, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";

/**
 * One Tab stop for all the words of a passage (1.9 N4, F5). The words are a roving group: Tab lands on one of them (the word the reader
 * last used, else the first word of the passage), the arrow keys move among all the rest, and the next Tab leaves the passage. Without
 * this, a 40-verse aliyah is 40 Tab stops. A word names itself by key (its verse and its place in it); the group keeps only that key.
 */
export type WordGroupValue = Readonly<{ stop: string | null; first: string | null; setStop(key: string): void }>;
export const WordGroupContext = createContext<WordGroupValue | null>(null);
export const wordKey = (ref: string, index: number) => `${ref}#${index}`;

/**
 * The passage's container. `scope` names the page of verses (a new page forgets the reader's stop) and `first` is the first word of
 * the passage that has one. If the word that held the stop leaves the page (a view change drew it away), the group falls back to
 * its first word, so there is always exactly one stop and the words are never unreachable from the keyboard.
 */
export function WordGroup({ scope, first, children, ...rest }: { scope: string; first: string | null } & ComponentProps<"div">) {
  const [state, setState] = useState<{ scope: string; stop: string } | null>(null), root = useRef<HTMLDivElement>(null);
  const stop = state && state.scope === scope ? state.stop : null;
  const value = useMemo<WordGroupValue>(() => ({ stop, first, setStop: key => setState({ scope, stop: key }) }), [stop, first, scope]);
  useEffect(() => {
    if (stop === null || !root.current) return;
    if (!root.current.querySelector('[data-word-index][role="button"][tabindex="0"]')) setState(null);
  });
  return <WordGroupContext.Provider value={value}><div {...rest} ref={root} data-word-group="">{children}</div></WordGroupContext.Provider>;
}
