"use client";
import { useEffect, useState, type ReactNode } from "react";
import { PLAN } from "../../../lib/offline/copy";
import { readPathCopy, savePathCopy } from "../../../lib/offline/path-copy";
import { useOfflinePacks, useOfflineWording } from "../../portal/offline/status";
import { SiddurLink } from "../../portal/siddur-link";
import type { Account } from "./progress-sync";
import { useServicePath, type PathView } from "./progress";

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
 * A signed-in student's own parts: the live answer online, kept on the device as the owner's last copy (path-copy.ts); offline, with
 * no live answer, that copy. `savedAt` is set only when the copy is what shows.
 */
export function useCoursePath(account: Account): { view: PathView; savedAt: number | null } {
  const view = useServicePath(account), offline = useOfflineWording(), { ownerChecked } = useOfflinePacks();
  const [copy, setCopy] = useState<Awaited<ReturnType<typeof readPathCopy>>>(null);
  useEffect(() => { if (view.status === "ready" && ownerChecked) void savePathCopy(view.path); }, [view, ownerChecked]);
  const live = view.status === "ready";
  useEffect(() => {
    if (!offline || live) { setCopy(null); return; }
    let current = true;
    void readPathCopy().then(value => { if (current) setCopy(value); });
    return () => { current = false; };
  }, [offline, live]);
  return copy && offline && !live ? { view: { status: "ready", path: copy.path }, savedAt: copy.savedAt } : { view, savedAt: null };
}
