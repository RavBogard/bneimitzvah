"use client";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseCompareVerse } from "../../../../lib/readings/compare";
import { CompareView } from "./compare-view";
import { ShelfView } from "./shelf-view";
import { DiscussionListView, DiscussionPanelBody, DiscussionsSource, useDiscussionsView, useIsAnchor } from "./discussions";
import type { DiscussionPassage } from "./discussions-api";
import { DISCUSSION_LABELS } from "../../../../lib/discussions/labels";
import { WordPanelBody, type WordPanelHost } from "./word-panel";
import { focusKey, moveWord, requestPanel, type PanelOpen, type VersePanelKind } from "./verse-panel-state";
import { useStudyLens } from "../study-lens";
import { useReadingPrefs } from "../reading-prefs";
import { Button, Sheet } from "../../../ui";
import styles from "./commentary.module.css";

/**
 * The verse panel (1.3), now in the one Sheet (1.9 N4): one open at a time on a page, for one verse, in Study only. It rises from the
 * bottom at every width, is modal with focus trapped, and opens on its title. Esc, a tap outside, Close or a swipe down closes it and
 * puts focus back on what opened it (a word, an action, a list entry). The page behind it does not move: nothing scrolls on open, and
 * on close the word it was last on is scrolled into view only if Next word took it off screen.
 * Release 1.7 adds the "word" kind: in Study a tap on a word opens its card here (word-panel.tsx); Previous word and Next word move it,
 * and closing puts focus back on the word it was last on. The pure rules are in verse-panel-state.ts.
 * Release 1.7 M6b adds the "discussion" kind: a verse that anchors a curated discussion has one quiet marker, and a reading's list of
 * sources opens the same panel at the source's verse (discussions.tsx). "Back to this verse" then returns the reader to the verse.
 */
export type { VersePanelKind } from "./verse-panel-state";
type Open = PanelOpen;
type Scope = Readonly<{ open: Open | null; active: boolean; listOpen: boolean; openList(trigger: HTMLElement): void; toggle(verse: string, kind: VersePanelKind, trigger: HTMLElement): void;
  /** Changes the open panel to another kind for the same verse (Compare from "Everything on this verse"), keeping what focus returns to. */
  swap(verse: string, kind: VersePanelKind): void; close(): void; closeWord(): void;
  /** A source in a reading's list: the discussion panel at its verse, brought into view first. */
  openFromList(verse: string, trigger: HTMLElement): void; backToVerse(): void;
  /** Study's word tap: the word card for one word, in the sheet. Null when no text page has registered a host. */
  openWord: ((verse: string, word: number, trigger: HTMLElement | null) => void) | null; moveWord(verse: string, word: number, from?: "previous" | "next"): void;
  host: { current: WordPanelHost | null }; setHost(host: WordPanelHost | null): void }>;
const Context = createContext<Scope | null>(null);
const wordElement = (verse: string, word: number) => { try { return document.querySelector<HTMLElement>(`[data-verse-ref="${CSS.escape(verse)}"] [data-word-index="${word}"][role="button"]`); } catch { return null; } };
const inView = (element: HTMLElement) => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; };

/**
 * Holds the page's one open panel, in Study only: Lein closes it and offers none. `passage` (the reading's canonical ref and kind) asks for
 * that reading's curated discussions while Study is on; without it the scope uses whatever discussions an outer provider holds, or none.
 */
export function VersePanelScope({ children, passage }: { children: ReactNode; passage?: DiscussionPassage | null }) {
  const lens = useStudyLens(), active = lens.available && lens.lens === "study";
  const [open, setOpen] = useState<Open | null>(null), [listOpen, setListOpen] = useState(false), base = useId(), listTrigger = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null), lastWord = useRef<{ verse: string; word: number } | null>(null), toVerse = useRef<string | null>(null);
  const current = useRef(open); current.current = open;
  const request = useCallback((verse: string, kind: VersePanelKind, element: HTMLElement | null, word?: number, from?: "list") => {
    const next = requestPanel(current.current, { verse, kind, word, from }, `${base}-panel`);
    if (!next.restoreFocus) { trigger.current = element; if (kind !== "word") lastWord.current = null; }
    setOpen(next.open);
  }, [base]);
  const toggle = useCallback((verse: string, kind: VersePanelKind, element: HTMLElement) => request(verse, kind, element), [request]);
  const host = useRef<WordPanelHost | null>(null), [hasWords, setHasWords] = useState(false);
  const setHost = useCallback((value: WordPanelHost | null) => { host.current = value; setHasWords(Boolean(value)); }, []);
  const openWord = useCallback((verse: string, word: number, element: HTMLElement | null) => {
    request(verse, "word", element, word); host.current?.onVisit?.(verse);
  }, [request]);
  // Previous or Next word: the card follows to the next word, which may be in another verse; focus stays on the button pressed.
  const stepWord = useCallback((verse: string, word: number) => {
    const shown = current.current, next = moveWord(shown, verse, word); if (!shown || next === shown) return;
    trigger.current = null; setOpen(next); host.current?.onVisit?.(verse);
  }, []);
  const swap = useCallback((verse: string, kind: VersePanelKind) => { setOpen(Object.freeze({ verse, kind, id: `${base}-panel` })); }, [base]);
  const close = useCallback(() => { setOpen(null); }, []);
  const openList = useCallback((element: HTMLElement) => { listTrigger.current = element; setListOpen(true); }, []);
  const closeList = useCallback(() => { setListOpen(false); }, []);
  const closeWord = useCallback(() => { if (current.current?.kind === "word") close(); }, [close]);
  // A list entry takes the reader to the verse (the text page that holds it is loaded first), then opens its sources there.
  const openFromList = useCallback((verse: string, element: HTMLElement) => { host.current?.reveal?.(verse); request(verse, "discussion", element, undefined, "list"); }, [request]);
  // Back to this verse: the sheet closes and the verse itself, not the list entry that opened it, takes focus.
  const backToVerse = useCallback(() => {
    const shown = current.current; if (!shown) return;
    host.current?.reveal?.(shown.verse); trigger.current = null; toVerse.current = shown.verse; setOpen(null);
  }, []);
  useLayoutEffect(() => { if (open?.kind === "word" && open.word !== undefined) lastWord.current = { verse: open.verse, word: open.word }; }, [open]);
  /** Where focus goes when the sheet closes: the verse (Back to this verse), else the word the card was last on, else what opened it. */
  const returnTarget = useCallback((): HTMLElement | null => {
    const back = toVerse.current; toVerse.current = null;
    let target: HTMLElement | null = null;
    if (back) { try { target = document.querySelector<HTMLElement>(`[data-study-rows] [data-verse-ref="${CSS.escape(back)}"]`); } catch { target = null; } if (target) target.tabIndex = -1; }
    else if (trigger.current?.isConnected) target = trigger.current;
    else if (lastWord.current) target = wordElement(lastWord.current.verse, lastWord.current.word);
    // Next word may have taken the card off screen: bring the word back, no further than it takes.
    if (target && !inView(target)) { try { target.scrollIntoView({ block: "center" }); } catch { /* Stay where the page is. */ } }
    return target;
  }, []);
  useEffect(() => { if (!active) { setOpen(null); setListOpen(false); } }, [active]);
  // A source chosen in the phone's Sources sheet: that sheet gives way to the verse's own in the same render, and the Sources button is where focus comes back to.
  const openFromSheet = useCallback((verse: string, element: HTMLElement) => { setListOpen(false); openFromList(verse, listTrigger.current?.isConnected ? listTrigger.current : element); }, [openFromList]);
  const value = useMemo<Scope>(() => ({ open: active ? open : null, active, listOpen, openList, toggle, swap, close, closeWord, openFromList, backToVerse, openWord: hasWords ? openWord : null, moveWord: stepWord, host, setHost }),
    [active, open, listOpen, openList, toggle, swap, close, closeWord, openFromList, backToVerse, hasWords, openWord, stepWord, setHost]);
  const scope = <Context.Provider value={value}>{children}{active && open && <VersePanelSheet open={open} onClose={close} returnTarget={returnTarget} />}{active && listOpen && !open && <SourcesSheet onClose={closeList} onOpen={openFromSheet} />}</Context.Provider>;
  return passage === undefined ? scope : <DiscussionsSource passage={passage} active={active}>{scope}</DiscussionsSource>;
}
const usePanel = () => useContext(Context);
/** Opens a verse's panel (More on this verse, a curated discussion) from a note or an action in Study; null outside a VersePanelScope. */
export const useVersePanelOpener = (): ((verse: string, kind: VersePanelKind, trigger: HTMLElement) => void) | null => usePanel()?.toggle ?? null;
/** The verse the open panel is on, if one is open. */
export const useOpenPanelVerse = (): string | null => usePanel()?.open?.verse ?? null;
/** Study's word tap: the card opener, or null when there is no card here (Lein, the proposed portion, a page not yet loaded). */
export const useWordCardOpener = () => usePanel()?.openWord ?? null;
/**
 * The reading's "Sources" column (1.9 N7), a child of the reading's own grid so that on a laptop it stands to the right of the verses (globals.css);
 * below that width it is not drawn, and `SourcesButton` is the way to the same list. Nothing without discussions or outside Study.
 */
export function DiscussionList() {
  const scope = usePanel(), view = useDiscussionsView();
  return scope?.active && view ? <div className="reading-sources-column" data-sources-column=""><DiscussionListView view={view} onOpen={scope.openFromList} /></div> : null;
}
/** The reading's curated sources at the end of Study's page (v6, 2026-10-28): each opens its verse's sources in the verse panel. */
export function RailSources() {
  const scope = usePanel(), view = useDiscussionsView();
  return scope?.active && view ? <div data-sources-rail=""><DiscussionListView view={view} onOpen={scope.openFromList} /></div> : null;
}
/** The Sources sheet: the column's list, titled by the sheet; a source opens its verse's sources in the same Sheet (this one gives way). */
function SourcesSheet({ onClose, onOpen }: { onClose(): void; onOpen(verse: string, trigger: HTMLElement): void }) {
  const view = useDiscussionsView();
  return <Sheet open onClose={onClose} title={DISCUSSION_LABELS.column} closeLabel="Close">{view && <DiscussionListView view={view} onOpen={onOpen} headed={false} />}</Sheet>;
}
/** The text page tells the panel what it needs for a word card (its verses and how to read word details); nothing renders. */
export function WordPanelSource({ host }: { host: WordPanelHost | null }) {
  const scope = usePanel(), setHost = scope?.setHost, closeWord = scope?.closeWord, key = host?.scopeKey ?? null;
  // Every render hands over fresh closures; the panel's own state changes only when a host appears or goes.
  useLayoutEffect(() => { setHost?.(host); });
  useLayoutEffect(() => () => { setHost?.(null); }, [setHost]);
  // A new text page (or a closed one) leaves no word card behind.
  useEffect(() => () => { closeWord?.(); }, [key, closeWord]);
  return null;
}

const ACTIONS: readonly { kind: VersePanelKind; label: string }[] = [{ kind: "compare", label: "Compare" }, { kind: "shelf", label: "More on this verse" }];
/** Not drawn in Study v6 (its notes column has three actions of its own, study-notes.tsx); kept, with its tests, until Daniel says where Compare goes.
 *  The verse's actions, under its row in Study: Compare, More on this verse, (on a verse that anchors a discussion) its sources, and where the page has verse tools, "Verse tools". Nothing outside a VersePanelScope. */
export function VerseActions({ verse, onTools }: { verse: string; onTools?(opener: HTMLElement): void }) {
  const scope = usePanel(), anchored = useIsAnchor(verse), comparable = parseCompareVerse(verse);
  if (!scope || (!comparable && !onTools)) return null;
  const actions = comparable ? anchored ? [...ACTIONS, { kind: "discussion" as const, label: DISCUSSION_LABELS.marker }] : ACTIONS : [];
  return <div className={styles.actions}>
    {actions.map(action => <button key={action.kind} type="button" className={styles.action} aria-haspopup="dialog"
      onClick={event => scope.toggle(verse, action.kind, event.currentTarget)}>{action.label}</button>)}
    {onTools && <button type="button" className={styles.action} aria-haspopup="dialog" onClick={event => onTools(event.currentTarget)}>Verse tools</button>}
  </div>;
}

const titleOf = (open: Open) => open.kind === "discussion" ? `${DISCUSSION_LABELS.marker} · ${open.verse}` : open.kind === "compare" ? `Compare ${open.verse}` : open.kind === "word" ? `Word in ${open.verse}` : `More on ${open.verse}`;

/** What the sheet holds for the open panel. After Previous word or Next word the button pressed may have become disabled: focus then goes to the sheet's title, never to the page. */
function PanelBody({ open }: { open: Open }) {
  const body = useRef<HTMLDivElement | null>(null), lens = useStudyLens(), scope = usePanel(), size = useReadingPrefs().size;
  useEffect(() => {
    if (open.kind !== "word") return;
    const at = document.activeElement;
    if ((at instanceof HTMLButtonElement && at.disabled) || at === document.body) body.current?.closest("dialog")?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  });
  const word = open.kind === "word" ? scope?.host.current : null;
  return <div id={open.id} ref={body} className={styles.versePanel} data-verse-panel={open.verse} data-size={size}>
    {open.kind === "compare" ? <CompareView verse={open.verse} />
      : open.kind === "discussion" ? <DiscussionPanelBody verse={open.verse} />
      : open.kind === "word" ? word && open.word !== undefined && scope ? <WordPanelBody key={word.scopeKey} host={word} verse={open.verse} word={open.word} onMove={scope.moveWord} onGone={scope.close} /> : null
        : <>{parseCompareVerse(open.verse) && scope && <p><button type="button" className="button-secondary" onClick={() => scope.swap(open.verse, "compare")}>Compare translations</button></p>}<ShelfView key={open.verse} verse={open.verse} inline={lens.works} /></>}
  </div>;
}
/** The one Sheet of the verse panel, mounted while a panel is open. `focusKey` keeps the same sheet (and the reader's place on its buttons) while a word card steps on. */
function VersePanelSheet({ open, onClose, returnTarget }: { open: Open; onClose(): void; returnTarget(): HTMLElement | null }) {
  const scope = usePanel();
  return <Sheet open onClose={onClose} title={titleOf(open)} closeLabel="Close" returnFocusTo={returnTarget}
    footer={open.kind === "discussion" && open.from === "list" && scope ? <Button variant="quiet" onClick={scope.backToVerse}>{DISCUSSION_LABELS.back}</Button> : undefined}>
    <PanelBody key={focusKey(open)} open={open} />
  </Sheet>;
}
