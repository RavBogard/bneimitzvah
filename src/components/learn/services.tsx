"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPhraseAudio, type PhraseAudio } from "../../lib/learn/phrase-audio";
import { browserProgressStore, emptyProgress, localDay, type Progress } from "../../lib/learn/progress";
import { createClipPlayer, type ClipPlayer, type PlayerState } from "./player";
import { createVerseLoader, type VerseLoader } from "./verses-api";

/** One loader, one phrase cache and one audio element per course page; stopped when the page hides. */
type Services = Readonly<{ loader: VerseLoader; audio: PhraseAudio; player: ClipPlayer }>;
const Context = createContext<Services | null>(null);

export function LearnServices({ children }: { children: ReactNode }) {
  const ref = useRef<Services | null>(null);
  if (!ref.current) {
    const loader = createVerseLoader(), audio = createPhraseAudio({ load: loader.load });
    ref.current = Object.freeze({ loader, audio, player: createClipPlayer(audio) });
  }
  const services = ref.current;
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") services.player.stop(); }, leave = () => services.player.stop();
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); services.player.stop(); };
  }, [services]);
  return <Context.Provider value={services}>{children}</Context.Provider>;
}
export function useLearnServices(): Services {
  const value = useContext(Context); if (!value) throw new Error("Learn services missing");
  return value;
}
const idle: PlayerState = Object.freeze({ id: null, status: "idle", seconds: 0, part: 0 });
export function usePlayerState(): PlayerState {
  const { player } = useLearnServices();
  return useSyncExternalStore(player.subscribe, () => player.state, () => idle);
}

/** Signed-out progress, in this browser: read after mount (so the server render is the fresh course), saved on every change. */
export function useProgress() {
  const store = useMemo(() => browserProgressStore(), []);
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => { setProgress(store.load()); }, [store]);
  const update = useCallback((change: (value: Progress) => Progress) => {
    setProgress(current => { const next = change(current ?? store.load()); store.save(next); return next; });
  }, [store]);
  return { progress, update, today: () => localDay(Date.now()), fresh: emptyProgress };
}
