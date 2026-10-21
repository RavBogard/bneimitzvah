"use client";
import { createContext, createElement, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

// Display preferences only: no student text, identity or progress is stored.
// Daniel (2026-10-16): phrase colors are on by default and the choice is
// remembered per student. Each student's choice lives under a key derived from
// a one-way hash of their id, so one sibling's setting never becomes another's
// and no raw identifier is written to browser storage.
export const textSizes = [
  { id: "small", label: "Small" },
  { id: "standard", label: "Standard" },
  { id: "large", label: "Large" },
  { id: "huge", label: "Huge" },
] as const;
export type TextSize = typeof textSizes[number]["id"];
export type ReadingPrefs = { colors: boolean; translation: boolean; size: TextSize; tikkun: boolean };
const PREFIX = "crc-bm-reading-prefs-v2:";
const defaults: ReadingPrefs = { colors: true, translation: false, size: "standard", tikkun: false };
const cache = new Map<string, ReadingPrefs>();
const wideDefault = () => typeof matchMedia === "function" ? matchMedia("(min-width: 1001px)").matches : defaults.translation;
const listeners = new Set<() => void>();

/** FNV-1a 64-bit, hex. Not a security boundary; it only keeps raw ids out of storage keys. */
export function scopeKey(studentId: string | null) {
  if (!studentId) return `${PREFIX}shared`;
  let hash = 0xcbf29ce484222325n;
  for (const char of studentId) { hash ^= BigInt(char.codePointAt(0)!); hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn; }
  return PREFIX + hash.toString(16).padStart(16, "0");
}
function parse(raw: string | null, englishOnWide = false): ReadingPrefs {
  try {
    const value = raw ? JSON.parse(raw) as Partial<ReadingPrefs> : {};
    return {
      colors: typeof value.colors === "boolean" ? value.colors : defaults.colors,
      // English starts on in the wide two-column layout and off on phones, until the reader chooses (spec §5).
      translation: typeof value.translation === "boolean" ? value.translation : englishOnWide && wideDefault(),
      size: textSizes.some(size => size.id === value.size) ? value.size as TextSize : defaults.size,
      // The tikkun (scroll lettering) is off until the reader turns it on; it applies to Torah text only.
      tikkun: typeof value.tikkun === "boolean" ? value.tikkun : defaults.tikkun,
    };
  } catch { return defaults; }
}
// Learners and parents start with English on in the wide layout; staff keep it off until they choose.
const cacheKey = (key: string, englishOnWide: boolean) => `${key}|${englishOnWide ? "wide" : "plain"}`;
function read(key: string, englishOnWide = false): ReadingPrefs {
  const known = cache.get(cacheKey(key, englishOnWide)); if (known) return known;
  let value = defaults; try { value = parse(window.localStorage.getItem(key), englishOnWide); } catch { /* Private mode: defaults. */ }
  cache.set(cacheKey(key, englishOnWide), value); return value;
}
function stored(key: string): Partial<ReadingPrefs> {
  try { const raw = window.localStorage.getItem(key), value = raw ? JSON.parse(raw) : {}; return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
function write(key: string, change: Partial<ReadingPrefs>, englishOnWide = false) {
  const chosen = { ...stored(key), ...change }, value = { ...read(key, englishOnWide), ...change };
  for (const flag of [true, false]) cache.delete(cacheKey(key, flag));
  cache.set(cacheKey(key, englishOnWide), value);
  try { window.localStorage.setItem(key, JSON.stringify(chosen)); } catch { /* Preference still applies in this tab. */ }
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key?.startsWith(PREFIX)) { for (const flag of [true, false]) cache.delete(cacheKey(event.key, flag)); listener(); } };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", storage); };
}

const Scope = createContext<{ key: string; englishOnWide: boolean }>({ key: scopeKey(null), englishOnWide: false });
/** Scopes every reading preference below it to one student; englishOnWide sets the unset English default. */
export function ReadingPrefsScope({ studentId, englishOnWide = false, children }: { studentId: string; englishOnWide?: boolean; children: ReactNode }) {
  return createElement(Scope.Provider, { value: { key: scopeKey(studentId), englishOnWide } }, children);
}
export function useReadingPrefs(): ReadingPrefs {
  const { key, englishOnWide } = useContext(Scope);
  return useSyncExternalStore(subscribe, () => read(key, englishOnWide), () => defaults);
}
export function useSetReadingPrefs() {
  const { key, englishOnWide } = useContext(Scope);
  return useCallback((change: Partial<ReadingPrefs>) => write(key, change, englishOnWide), [key, englishOnWide]);
}
