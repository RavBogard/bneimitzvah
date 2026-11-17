"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Context } from "./api";
import { PracticeCoordinator } from "./practice";

type Router = { push(href: string): void; replace(href: string): void };
/** Said when a parent's practice access ends; the notice also carries its kind, for a test or a style. */
export const PRACTICE_ACCESS_CHANGED = "Practice access changed. Choose an available child again.";
export const isParentPath = (path: string) => path === "/mine" || path.startsWith("/mine/child/") || path.startsWith("/workspace/practice/");
export const practicePath = (studentId: string) => `/workspace/practice/${studentId}`;

/**
 * A parent's "Practice with your child" sitting (the server's timed practice context, src/server/practice). The handle lives
 * only in this tab's PracticeCoordinator, in memory: it is sent with child-practice reads of that child (workspace-reads.ts)
 * and with the sitting's own enter, switch and exit calls, and nowhere else. A sitting ends when the parent chooses Done,
 * leaves its page, loses the parent role, signs out, when it expires (60 minutes), or when the server refuses it.
 *
 * `bump` is the provider's view version: every change of sitting bumps it, so answers for the old sitting are discarded.
 */
export function usePracticeMode({ router, pathname, currentPath, clearWork, bump, guardDeparture }: {
  router: Router; pathname: string; currentPath: RefObject<string | null>; clearWork(): void; bump(): void; guardDeparture(): Promise<boolean>;
}) {
  const coordinator = useRef<PracticeCoordinator | null>(null);
  if (!coordinator.current) coordinator.current = new PracticeCoordinator();
  const practice = coordinator.current;
  const [context, setContext] = useState<Context | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const leaving = useRef<string | null>(null);

  /** Close the sitting on the server (best effort) and forget its handle. */
  const close = useCallback(() => { practice.invalidate(); setContext(null); if (!practice.pending) void practice.exit().catch(() => undefined); }, [practice]);
  /** The sitting ended without the parent asking (refused or expired): drop it and its view, say so, and go to the shelf. */
  const ended = useCallback((text: string) => { clearWork(); practice.invalidate(); setContext(null); bump(); setNotice(text); router.replace("/mine"); }, [practice, clearWork, bump, router]);
  /** A child-practice read refused on the sitting's own page ends the sitting. */
  const practiceRefused = useCallback((studentId: string) => {
    if (currentPath.current !== practicePath(studentId)) return false;
    ended(PRACTICE_ACCESS_CHANGED); return true;
  }, [currentPath, ended]);

  // Leaving the sitting's page closes the sitting; a notice belongs to the parent's pages only.
  useEffect(() => {
    if (!isParentPath(pathname)) setNotice("");
    const active = practice.selection;
    if (active && pathname !== practicePath(active.context.studentId)) close();
    if (leaving.current && pathname !== leaving.current) { leaving.current = null; setBusy(false); }
  }, [pathname, practice, close]);
  // The tab's workspace going away (sign-out, another page outside the workspace) closes the sitting too.
  useEffect(() => () => { practice.invalidate(); if (!practice.pending) void practice.exit().catch(() => undefined); }, [practice]);
  // Expiry: the server ends the context after its lifetime; this tab ends the sitting at the same moment.
  useEffect(() => {
    if (!context) return;
    const remaining = Math.max(0, Date.parse(context.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      if (practice.selection?.context.id !== context.id) return;
      if (currentPath.current === practicePath(context.studentId)) ended("This practice session ended. Choose Practice with your child to start again.");
      else { clearWork(); practice.invalidate(); setContext(null); bump(); }
    }, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [context, practice, currentPath, clearWork, bump, ended]);

  async function selectChild(id: string) {
    if (practice.pending) return;
    if (!await guardDeparture()) return;
    clearWork();
    const from = currentPath.current;
    setBusy(true); setContext(null); setNotice(""); bump();
    try {
      const next = await practice.select(id);
      if (next && currentPath.current === from) { bump(); setContext(next); router.push(practicePath(next.studentId)); }
    } catch {
      if (currentPath.current === from) {
        setNotice("Practice selection couldn’t be confirmed. Open your child’s reading again; no previous practice view has been restored.");
        router.replace("/mine");
      }
    } finally { setBusy(false); }
  }
  /** Done: back to the child's own page, where This week shows the sitting's marks, with a plain word that it ended (parent walk 2026-10-28, finding 6). */
  async function exitPractice(child?: { id: string; firstName: string }) {
    if (practice.pending) return;
    if (!await guardDeparture()) return;
    clearWork();
    const from = currentPath.current;
    setBusy(true); setContext(null); bump();
    let closed = false;
    try { await practice.exit(); closed = true; if (currentPath.current === from) setNotice(child ? `You’ve finished practicing with ${child.firstName}.` : ""); }
    catch { if (currentPath.current === from) setNotice("This tab no longer has an active practice view. Its server closure could not be confirmed; choose a child again if needed."); }
    finally {
      const target = closed && child ? `/mine/child/${encodeURIComponent(child.id)}` : "/mine";
      // The sitting's page would send a closed sitting to the shelf as soon as it is no longer busy; it stays busy until the child's page is reached.
      if (currentPath.current === from && target !== "/mine") { leaving.current = from; setTimeout(() => { if (leaving.current) { leaving.current = null; setBusy(false); } }, 10_000); }
      else setBusy(false);
      if (currentPath.current === from) router.replace(target);
    }
  }
  return { practice, context, busy, notice, selectChild, exitPractice, close, practiceRefused };
}
