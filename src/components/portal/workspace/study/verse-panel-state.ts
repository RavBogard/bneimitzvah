/**
 * The verse panel's decisions, kept free of React and the page so they can be tested: what a request opens or
 * closes and where a word step lands. verse-panel.tsx applies them; Esc, a tap outside and a swipe down belong to the Sheet.
 */
/** Compare translations, More on this verse (the shelf), one word's card, or a verse's curated discussion sources. */
export type VersePanelKind = "compare" | "shelf" | "word" | "discussion";
/** `from: "list"`: the panel was opened from a reading's list of sources, so the reader came to the verse rather than from it. */
export type PanelOpen = Readonly<{ verse: string; kind: VersePanelKind; id: string; word?: number; from?: "list" }>;
export type PanelRequest = Readonly<{ verse: string; kind: VersePanelKind; word?: number; from?: "list" }>;

/** Asking for what is already open closes it and hands focus back; anything else replaces it, one panel at a time. */
export function requestPanel(shown: PanelOpen | null, request: PanelRequest, id: string): { open: PanelOpen | null; restoreFocus: boolean } {
  if (shown && shown.verse === request.verse && shown.kind === request.kind && shown.word === request.word) return { open: null, restoreFocus: true };
  const opened = { verse: request.verse, kind: request.kind, id, ...(request.word === undefined ? {} : { word: request.word }), ...(request.from === undefined ? {} : { from: request.from }) };
  return { open: Object.freeze(opened), restoreFocus: false };
}

/** Previous or Next word moves the open word card; it never opens one, and never touches another kind of panel. */
export function moveWord(shown: PanelOpen | null, verse: string, word: number): PanelOpen | null {
  if (!shown || shown.kind !== "word" || !Number.isSafeInteger(word) || word < 0) return shown;
  if (shown.verse === verse && shown.word === word) return shown;
  return Object.freeze({ verse, kind: "word" as const, id: shown.id, word });
}

/** Where the open panel's sheet keeps its place: a new panel (or another verse's) starts over on the title, but a word card stepping on keeps the reader's place. */
export const focusKey = (open: Pick<PanelOpen, "verse" | "kind">): string => open.kind === "word" ? "word" : `${open.kind}:${open.verse}`;
