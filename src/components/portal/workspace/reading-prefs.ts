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
export type ReadingPrefs = { colors: boolean; translation: boolean; size: TextSize };
const PREFIX = "crc-bm-reading-prefs-v2:";
const defaults: ReadingPrefs = { colors: true, translation: false, size: "standard" };
const cache = new Map<string, ReadingPrefs>();
const listeners = new Set<() => void>();

/** FNV-1a 64-bit, hex. Not a security boundary; it only keeps raw ids out of storage keys. */
export function scopeKey(studentId: string | null) {
  if (!studentId) return `${PREFIX}shared`;
  let hash = 0xcbf29ce484222325n;
  for (const char of studentId) { hash ^= BigInt(char.codePointAt(0)!); hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn; }
  return PREFIX + hash.toString(16).padStart(16, "0");
}
function parse(raw: string | null): ReadingPrefs {
  try {
    const value = raw ? JSON.parse(raw) as Partial<ReadingPrefs> : {};
    return {
      colors: typeof value.colors === "boolean" ? value.colors : defaults.colors,
      translation: typeof value.translation === "boolean" ? value.translation : defaults.translation,
      size: textSizes.some(size => size.id === value.size) ? value.size as TextSize : defaults.size,
    };
  } catch { return defaults; }
}
function read(key: string): ReadingPrefs {
  const known = cache.get(key); if (known) return known;
  let value = defaults; try { value = parse(window.localStorage.getItem(key)); } catch { /* Private mode: defaults. */ }
  cache.set(key, value); return value;
}
function write(key: string, change: Partial<ReadingPrefs>) {
  const value = { ...read(key), ...change }; cache.set(key, value);
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preference still applies in this tab. */ }
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key?.startsWith(PREFIX)) { cache.delete(event.key); listener(); } };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", storage); };
}

const Scope = createContext<string>(scopeKey(null));
/** Scopes every reading preference below it to one student. */
export function ReadingPrefsScope({ studentId, children }: { studentId: string; children: ReactNode }) {
  return createElement(Scope.Provider, { value: scopeKey(studentId) }, children);
}
export function useReadingPrefs(): ReadingPrefs {
  const key = useContext(Scope);
  return useSyncExternalStore(subscribe, () => read(key), () => defaults);
}
export function useSetReadingPrefs() {
  const key = useContext(Scope);
  return useCallback((change: Partial<ReadingPrefs>) => write(key, change), [key]);
}
