"use client";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COMMENTARY_WORKS } from "../../../lib/readings/commentary";

/**
 * The reading's two lenses (spec 2026-10-22 §3.1): Lein, the continuous passage
 * for chanting, and Study, verse rows with commentary. The lens never changes
 * which verses are shown. Students, child practice and parents always open in
 * Lein; a remembering scope (staff, and this browser on the open weekly page)
 * opens in whatever it last used. `?lens=study` opens Study directly.
 * Display choices only: nothing about a person is stored.
 */
export type Lens = "lein" | "study";
export const LENSES: readonly { id: Lens; label: string }[] = Object.freeze([{ id: "lein", label: "Lein" }, { id: "study", label: "Study" }]);
/** Registry order; at most three works appear inline under a verse (§3.2). */
export const STUDY_WORKS = Object.freeze(Object.keys(COMMENTARY_WORKS));
export const MAX_INLINE_WORKS = 3;
/** On for every viewer (Daniel, 2026-10-23); a remembered choice, including turning one off, still replaces it. */
export const DEFAULT_WORKS: readonly string[] = Object.freeze(["rashi", "womens"]);
/** `english`: Study's own English choice, which starts on (spec decision 10.8) and leaves Lein's English as it was. */
export type LensChoice = Readonly<{ lens: Lens; works: readonly string[]; english: boolean }>;
const PREFIX = "crc-torah-lens-v1:";
export const LENS_STORAGE = Object.freeze({ weekly: `${PREFIX}weekly`, staff: `${PREFIX}staff` });

export function lensFromSearch(search: string): Lens | null {
  try { const value = new URLSearchParams(search).get("lens"); return value === "study" || value === "lein" ? value : null; } catch { return null; }
}
/** Registered works only, in registry order, without repeats, at most three. None is a choice too: verse rows alone. */
export function normalizeWorks(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULT_WORKS;
  return Object.freeze(STUDY_WORKS.filter(work => value.includes(work)).slice(0, MAX_INLINE_WORKS));
}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export function readRememberedLens(storage: Storage | null, key: string | null): Partial<LensChoice> {
  if (!storage || !key) return {};
  try {
    const raw = storage.getItem(key), value = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!value || typeof value !== "object") return {};
    return { ...value.lens === "study" || value.lens === "lein" ? { lens: value.lens } : {}, ...Array.isArray(value.works) ? { works: normalizeWorks(value.works) } : {},
      ...typeof value.english === "boolean" ? { english: value.english } : {} };
  } catch { return {}; }
}
export function rememberLens(storage: Storage | null, key: string | null, choice: LensChoice) {
  if (!storage || !key) return;
  try { storage.setItem(key, JSON.stringify({ lens: choice.lens, works: [...choice.works], english: choice.english })); } catch { /* The choice still applies on this page. */ }
}
/** The lens a reading opens in: the link's, else (only when remembering) the last one used, else Lein. */
export function initialLens(input: { query: Lens | null; remember: boolean; remembered: Lens | undefined }): Lens {
  return input.query ?? (input.remember ? input.remembered ?? "lein" : "lein");
}
function browserStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }

type LensContext = LensChoice & { available: boolean; setLens(lens: Lens): void; setWorks(works: readonly string[]): void; setEnglish(english: boolean): void };
const Context = createContext<LensContext>({ lens: "lein", works: DEFAULT_WORKS, english: true, available: false, setLens: () => {}, setWorks: () => {}, setEnglish: () => {} });
/**
 * One lens for a reading surface (its toolbar and its text). `storageKey` null:
 * nothing is remembered and the reading always opens in Lein (learners).
 * `query` is the lens named by the page's address, read once when it opens.
 */
export function StudyLensScope({ storageKey, query = null, children }: { storageKey: string | null; query?: Lens | null; children: ReactNode }) {
  const [choice, setChoice] = useState<LensChoice>(() => ({ lens: query ?? "lein", works: DEFAULT_WORKS, english: true }));
  // Browser storage is read after the first render, so the server's markup and the first client render agree.
  useEffect(() => {
    const remembered = readRememberedLens(browserStorage(), storageKey);
    setChoice({ lens: initialLens({ query, remember: storageKey !== null, remembered: remembered.lens }), works: remembered.works ?? DEFAULT_WORKS, english: remembered.english ?? true });
  }, [storageKey, query]);
  const update = useCallback((change: Partial<LensChoice>) => setChoice(current => {
    const next = { lens: change.lens ?? current.lens, works: change.works ? normalizeWorks(change.works) : current.works, english: change.english ?? current.english };
    rememberLens(browserStorage(), storageKey, next);
    return next;
  }), [storageKey]);
  const value = useMemo<LensContext>(() => ({ ...choice, available: true, setLens: lens => update({ lens }), setWorks: works => update({ works }), setEnglish: english => update({ english }) }), [choice, update]);
  return createElement(Context.Provider, { value }, children);
}
/** Outside a StudyLensScope the reading is Lein only, with no switch. */
export const useStudyLens = () => useContext(Context);
