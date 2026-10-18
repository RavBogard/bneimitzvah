import { PortalRequestError } from "../../api";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import type { StudyWordAids } from "../../../../lib/hebrew/word-aids";
import type { StudyWordDetails } from "../../../../lib/hebrew/word-details";
import type { StudyVerse } from "./api";

export type ToolResult<T> = Readonly<{ status: "idle" | "loading" | "error" }> | Readonly<{ status: "ready"; value: T }>;
export type WordToolsSelection = Readonly<{ verse: number; index: number }>;
export type WordToolsState = Readonly<{ open: boolean; selection: WordToolsSelection | null; aids: ToolResult<StudyWordAids>; details: ToolResult<StudyWordDetails> }>;
/** One mounted authority/page owner. Only explicit actions enter this helper. */
export function createWordToolsSelection(input: {
  verses: readonly StudyVerse[]; readAids(verse: number, signal: AbortSignal): Promise<StudyWordAids>;
  readDetails(verse: number, index: number, signal: AbortSignal): Promise<StudyWordDetails>; onState(state: WordToolsState): void;
}) {
  const counts = input.verses.map(verse => { const projected = projectStudyVerse(verse.ref, verse.hebrew); return projected.status === "ready" ? projected.projection.words.length : 0; });
  let state: WordToolsState = Object.freeze({ open: false, selection: null, aids: Object.freeze({ status: "idle" }), details: Object.freeze({ status: "idle" }) });
  let last: WordToolsSelection | null = null, generation = 0, abort: AbortController | undefined, disposed = false;
  const valid = (verse: number, index: number) => Number.isSafeInteger(verse) && Number.isSafeInteger(index) && verse >= 0 && verse < counts.length && index >= 0 && index < counts[verse];
  const publish = (next: WordToolsState) => { if (!disposed) { state = Object.freeze(next); input.onState(state); } };
  function close() { if (disposed) return; generation++; abort?.abort(); publish({ open: false, selection: null, aids: Object.freeze({ status: "idle" }), details: Object.freeze({ status: "idle" }) }); }
  function request(selection: WordToolsSelection) {
    abort?.abort(); const request = new AbortController(), mine = ++generation; abort = request;
    publish({ open: true, selection, aids: Object.freeze({ status: "loading" }), details: Object.freeze({ status: "loading" }) });
    const live = () => !disposed && mine === generation && !request.signal.aborted;
    const failed = (field: "aids" | "details", error: unknown) => {
      if (!live()) return;
      if (error instanceof PortalRequestError && [401,403,404,409].includes(error.status)) { close(); return; }
      publish({ ...state, [field]: Object.freeze({ status: "error" }) });
    };
    // Independent requests keep a useful partial result when one source fails.
    void Promise.resolve().then(() => { if (!live()) return; return input.readAids(selection.verse, request.signal); }).then(value => { if (live() && value) publish({ ...state, aids: Object.freeze({ status: "ready", value }) }); }, error => failed("aids", error));
    void Promise.resolve().then(() => { if (!live()) return; return input.readDetails(selection.verse, selection.index, request.signal); }).then(value => { if (live() && value) publish({ ...state, details: Object.freeze({ status: "ready", value }) }); }, error => failed("details", error));
  }
  function select(verse: number, index: number) {
    if (disposed || !valid(verse, index)) return;
    const next = Object.freeze({ verse, index }); last = next;
    if (state.open && (state.selection?.verse !== verse || state.selection.index !== index)) request(next);
  }
  return Object.freeze({
    get state() { return state; },
    open() { if (disposed || state.open) return; const first = counts.findIndex(count => count > 0); if (first < 0) { publish({ ...state, open: true }); return; } request(last ?? Object.freeze({ verse: first, index: 0 })); },
    select, selectVerse(verse: number) { select(verse, 0); },
    navigate(direction: -1 | 1) {
      if (disposed || !state.open || !state.selection || (direction !== -1 && direction !== 1)) return;
      let { verse, index } = state.selection; index += direction;
      while (verse >= 0 && verse < counts.length) {
        if (index >= 0 && index < counts[verse]) { select(verse, index); return; }
        verse += direction; index = direction === 1 ? 0 : (counts[verse] ?? 0) - 1;
      }
    },
    retry() { if (!disposed && state.open && state.selection) request(state.selection); }, close,
    dispose() { if (disposed) return; close(); disposed = true; generation++; abort?.abort(); last = null; },
  });
}
