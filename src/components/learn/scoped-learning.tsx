"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { personalStudyHref, PERSONAL_STUDY_HEADER, PERSONAL_STUDY_PARAM } from "../../lib/learn/child-practice";
import { useChildLearning, useLearningSearch, type LearningTransport } from "./child-practice";

const Context = createContext<LearningTransport | null>(null);
export const usePersonalLearning = () => useContext(Context);
export function useLearningTransport() {
  const child = useChildLearning(), personal = usePersonalLearning();
  return child ?? personal;
}

const personalFetch: typeof fetch = (url, init) => {
  const headers = new Headers(init?.headers);
  headers.set(PERSONAL_STUDY_HEADER, "1");
  return fetch(url, { ...init, headers });
};

function personalTransport(): LearningTransport {
  const storageKey = (key: string) => `crc-torah:personal-study/v1:${key}`, actions = new Set<() => void>();
  const browserStorage = () => {
    try {
      return {
        getItem: (key: string) => window.localStorage.getItem(storageKey(key)),
        setItem: (key: string, value: string) => window.localStorage.setItem(storageKey(key), value),
        removeItem: (key: string) => window.localStorage.removeItem(storageKey(key)),
      };
    } catch { return null; }
  };
  return { fetch: personalFetch, storage: browserStorage, storageKey, onClose: action => { actions.add(action); }, close: () => { for (const action of actions) action(); } };
}

export function PersonalLearningBoundary({ children }: { children: ReactNode }) {
  const path = usePathname(), search = useLearningSearch(), router = useRouter(), child = useChildLearning();
  const [mounted, setMounted] = useState(false), [scope, setScope] = useState<LearningTransport | null>(null);
  useEffect(() => setMounted(true), []);
  const marked = !child && mounted && new URLSearchParams(search).get(PERSONAL_STUDY_PARAM) === "1";
  useEffect(() => {
    if (!marked) return;
    const transport = personalTransport();
    setScope(transport);
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute("download") || anchor.dataset.endPersonal !== undefined) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || (url.pathname !== "/learn" && !url.pathname.startsWith("/learn/")) || url.hash) return;
      event.preventDefault();
      router.push(personalStudyHref(`${url.pathname}${url.search}`));
    };
    document.addEventListener("click", navigate, true);
    return () => { transport.close?.(); document.removeEventListener("click", navigate, true); setScope(null); };
  }, [marked, router]);
  if (!marked) return children;
  if (!scope) return <main aria-busy="true"><p role="status">Opening personal study</p></main>;
  return <Context.Provider value={scope}>
    <nav className="workspace-notice" aria-label="Study context">Personal study · <a href={path} data-end-personal>Return to assigned study</a></nav>
    {children}
  </Context.Provider>;
}

/** This entry appears only to someone who already has progress in the separate personal account. */
export function PersonalStudyLink({ course, eligible }: { course: "learn" | "service"; eligible?: () => Promise<boolean> }) {
  const personal = usePersonalLearning();
  const [available, setAvailable] = useState(false);
  const path = course === "service" ? "/learn/service" : "/learn";
  useEffect(() => {
    if (personal) return;
    const controller = new AbortController();
    void (async () => {
      try {
        if (eligible && !await eligible()) return;
        const response = await personalFetch(`/api${path}/progress`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) return;
        const value = await response.json();
        if (!controller.signal.aborted) setAvailable(value.ok === true && value.version > 0);
      } catch { /* The entry can be checked again on the next visit. */ }
    })();
    return () => controller.abort();
  }, [path, eligible, personal]);
  return available && !personal ? <p><a href={personalStudyHref(path)}>Personal course progress</a></p> : null;
}
