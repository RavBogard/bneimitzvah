"use client";
import { useEffect, useState, type ReactNode } from "react";
import { PLAN } from "../../../lib/offline/copy";
import { pathRequest, readPathCopy, savePathCopy } from "../../../lib/offline/path-copy";
import { useOfflinePacks, useOfflineWording } from "../../portal/offline/status";
import { SiddurLink } from "../../portal/siddur-link";
import type { Account } from "./progress-sync";
import { loadPath, useServicePath, type PathView } from "./progress";

/**
 * The service course offline (2.0 SC6, A4 10 and 13), in the installed app on the torah or beitmitzvah origin. Everywhere else
 * `useOfflineWording` is false and nothing here changes what the course shows.
 */

/**
 * A siddur link, or, offline, the approved "Needs a connection" in its place (A7 st.needsConnection, copy.ts): the siddur reader is
 * another site, so the app never opens it, or asks for its book, without a connection.
 */
export function SiddurOrOffline({ href, page, className, children }: { href: string; page: number; className?: string; children: ReactNode }) {
  const offline = useOfflineWording();
  if (offline) return <p className={className} data-siddur-page={page} data-offline="">{PLAN.needsConnection}</p>;
  return <p className={className} data-siddur-page={page}><SiddurLink href={href}>{children}</SiddurLink></p>;
}

/**
 * A signed-in student's own parts: the live answer online; offline, with no live answer, the owner's last copy on the device
 * (path-copy.ts). `savedAt` is set only when the copy is what shows. The copy is saved from its own request, made only once this page's
 * owner check has named an owner and tied to that owner and the purge counter as they were before it began, never from the answer
 * shown on the page (which may have been asked for before the check, for another account).
 */
export function useCoursePath(account: Account): { view: PathView; savedAt: number | null } {
  const view = useServicePath(account), offline = useOfflineWording(), { ownerChecked, ownerKey } = useOfflinePacks();
  const [copy, setCopy] = useState<Awaited<ReturnType<typeof readPathCopy>>>(null);
  const synced = account.state === "synced";
  useEffect(() => {
    if (!synced || offline) return;
    const request = pathRequest();
    if (!request) return;
    let current = true;
    void loadPath().then(next => { if (current && next.status === "ready") void savePathCopy(next.path, request); });
    return () => { current = false; };
  }, [synced, offline, ownerChecked, ownerKey]);
  const live = view.status === "ready";
  useEffect(() => {
    if (!offline || live) { setCopy(null); return; }
    let current = true;
    void readPathCopy().then(value => { if (current) setCopy(value); });
    return () => { current = false; };
  }, [offline, live]);
  return copy && offline && !live ? { view: { status: "ready", path: copy.path }, savedAt: copy.savedAt } : { view, savedAt: null };
}
