"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { statusOf } from "./provider";
import { connectionsApi, type MavenLink } from "./connections/api";

const day = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

/**
 * A student's Maven link in the roster sheet, and the admin's undo of a wrong one (release 1.1). Shown only when the
 * student is linked. Unlinking keeps the student's record; the next Maven proposal through Claude offers the record again.
 */
export function MavenLinkPanel({ studentId, name, locked }: { studentId: string; name: string; locked: boolean }) {
  const [link, setLink] = useState<MavenLink | null>(null), [failed, setFailed] = useState(false), [confirming, setConfirming] = useState(false), [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "status" | "alert" } | null>(null);
  const request = useRef<AbortController | null>(null), alive = useRef(true), gate = useRef(false);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setFailed(false);
    try { const value = await connectionsApi.mavenLink(studentId, controller.signal); if (!controller.signal.aborted) setLink(value); }
    catch { if (!controller.signal.aborted) { setLink(null); setFailed(true); } }
  }, [studentId]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current?.abort(); }; }, [load]);

  async function unlink() {
    if (gate.current || !link) return;
    gate.current = true; setPending(true); setMessage(null);
    try {
      const ended = await connectionsApi.unlinkMaven(studentId, link.mavenContactId);
      if (!alive.current) return;
      setConfirming(false);
      setMessage(ended ? { text: "Unlinked from Maven. The record is unchanged; the next Maven proposal through Claude offers this Maven contact again.", tone: "status" }
        : { text: "This student’s Maven link had already changed. Showing the current link.", tone: "alert" });
      await load();
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error);
      setConfirming(false);
      setMessage({ text: status === 401 || status === 403 || status === 404 ? "This change isn’t allowed any more. You may need to sign in again." : "We couldn’t confirm the unlink. Close and reopen the student to check.", tone: "alert" });
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }

  if (!link && !message && !failed) return null;
  return <div className="disable-student maven-link">
    <h3>Maven record</h3>
    {message && <p className={message.tone === "alert" ? "request-error roster-message" : "workspace-notice roster-message"} role={message.tone}>{message.text}</p>}
    {failed ? <p>The Maven link couldn’t be checked. <button type="button" className="button-text" onClick={() => void load()}>Check again</button></p>
      : link && <>
        <p>Linked to Maven contact <code>{link.mavenContactId}</code> since <time dateTime={link.linkedAt}>{day(link.linkedAt)}</time>{link.linkKind === "created" ? ", when the Maven import added this student." : "."} If that is the wrong person, unlink it; the student’s record stays as it is.</p>
        {!confirming ? <button type="button" className="button-secondary admin-pill" disabled={pending || locked} onClick={() => { setMessage(null); setConfirming(true); }}>Unlink from Maven</button>
          : <><p role="status">Unlink <bdi dir="auto">{name}</bdi> from this Maven contact?</p><div className="form-actions">
            <button type="button" className="button-primary admin-pill roster-danger" disabled={pending || locked} onClick={() => void unlink()}>{pending ? "Unlinking…" : "Confirm unlink"}</button>
            <button type="button" className="button-secondary admin-pill" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button></div></>}
      </>}
  </div>;
}
