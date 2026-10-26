"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { connectionsApi, type Connection, type ConnectionAccess, type ConnectionsView } from "./api";
import { Button, EmptyState, PageHeader } from "../../../ui";

/** The portal's MCP address, as Claude's connector form takes it. */
export const connectorAddress = (origin: string) => `${origin}/api/mcp`;
/** G22 (TP-21), Daniel's approved line, with the address filled in. */
export const connectLine = (address: string) => `To connect, add this portal as a connector in Claude (Settings -> Connectors) using ${address}, then sign in here when Claude asks.`;

const accessNames: Record<ConnectionAccess, string> = { read: "Read", study: "Study guides", roster: "Roster" };
const when = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const day = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

/** A staff member's Claude connections (release 1.1). Tutors see their own; the rabbi or an admin sees every staff connection. */
export function ClaudeConnectionsWorkspace() {
  const { summary } = useWorkspace();
  if (!summary.roles.includes("admin") && !summary.roles.includes("tutor"))
    return <section className="workspace-state"><h1>Role unavailable</h1><p>Claude connections are for the rabbi, administrators and tutors.</p><a href="/workspace">Choose a role</a></section>;
  return <ConnectionsPage admin={summary.roles.includes("admin")} />;
}

function ConnectionsPage({ admin }: { admin: boolean }) {
  const { registerReload } = useWorkspace();
  const [view, setView] = useState<ConnectionsView | null>(null), [loading, setLoading] = useState(true), [failure, setFailure] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null), [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "status" | "alert"; signIn?: boolean } | null>(null);
  const request = useRef<AbortController | null>(null), alive = useRef(true), gate = useRef(false);
  // The address is this portal's own, so it is read in the browser (never a server-rendered guess at the host).
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => { setAddress(connectorAddress(window.location.origin)); }, []);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setFailure(false);
    try { const value = await connectionsApi.list(controller.signal); if (!controller.signal.aborted) setView(value); }
    catch { if (!controller.signal.aborted) { setView(null); setFailure(true); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => registerReload(async () => { setConfirming(null); await load(); }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current?.abort(); }; }, [load]);

  async function end(connection: Connection) {
    if (gate.current) return;
    gate.current = true; setPending(true); setMessage(null);
    try {
      const { ended } = await connectionsApi.revoke(connection.id);
      if (!alive.current) return;
      setConfirming(null);
      setMessage({ text: ended ? `Connection ended. ${connection.client} can no longer reach the portal through it.` : "That connection had already ended.", tone: "status" });
      await load();
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error);
      setConfirming(null);
      setMessage(status === 403 ? { text: "Ending a connection needs a recent sign-in. Sign out, sign in again, then end it within 15 minutes.", tone: "alert", signIn: true }
        : status === 401 ? { text: "You’re signed out. Sign in again, then end the connection.", tone: "alert", signIn: true }
        : status === 404 ? { text: "That connection isn’t available any more. The list has been reloaded.", tone: "alert" }
        : { text: "We couldn’t confirm whether the connection ended. Reload to check.", tone: "alert" });
      if (status === 404) await load();
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }

  const mine = view?.connections.filter(c => c.mine) ?? [], others = view?.connections.filter(c => !c.mine) ?? [];
  const row = (c: Connection) => {
    const label = c.mine ? c.client : `${c.client}, ${c.staffName}`;
    return <li key={c.id} className="people-row connection-row">
      <span className="people-avatar" aria-hidden="true">{c.client.trim().charAt(0).toLocaleUpperCase() || "C"}</span>
      <div className="people-body">
        <h3><bdi dir="auto">{c.client}</bdi>{!c.mine && <span className="connection-staff"> · <bdi dir="auto">{c.staffName}</bdi></span>}</h3>
        <p className="people-status">Approved <time dateTime={c.approvedAt}>{when(c.approvedAt)}</time> · ends <time dateTime={c.expiresAt}>{day(c.expiresAt)}</time></p>
        <p className="people-status connection-access">{c.access.map(a => <span key={a} className="roster-chip">{accessNames[a]}</span>)}{c.routine && <span className="roster-chip">Scheduled routine</span>}</p>
      </div>
      <div className="people-actions">
        {confirming === c.id ? <>
          <button type="button" className="roster-action roster-danger" aria-label={`End now: ${label}`} disabled={pending} onClick={() => void end(c)}>{pending ? "Ending…" : "End now"}</button>
          <button type="button" className="roster-action" aria-label={`Keep ${label}`} disabled={pending} onClick={() => setConfirming(null)}>Keep</button>
        </> : <button type="button" className="roster-action people-danger" aria-label={`End connection: ${label}`} disabled={pending || confirming !== null} onClick={() => { setMessage(null); setConfirming(c.id); }}>End connection</button>}
      </div>
    </li>;
  };

  return <section className="role-workspace admin-workspace connections-workspace">
    <PageHeader title="Claude connections" description="Claude reaches the portal as the person who connected it, with that person’s access. Ending a connection stops it at once; to use Claude again, connect it again from Claude." />
    {message && <p className={message.tone === "alert" ? "request-error roster-message" : "workspace-notice roster-message"} role={message.tone}>{message.text}</p>}
    {message?.signIn && <p><WorkspaceLink href="/">Check account and sign in again</WorkspaceLink></p>}
    {loading && !view ? <p role="status">Loading connections…</p>
      : failure || !view ? <div className="admin-state" role="alert"><p>Connections couldn’t be loaded.</p><Button onClick={() => void load()}>Reload</Button></div>
      : <>
        <section className="people-card" aria-labelledby="claude-mine"><div className="people-card-head"><h2 id="claude-mine">Your connections</h2>
          <p>{view.role === "admin" ? "Read sees every student; study guides lets Claude write guides; roster lets Claude add students from Maven and set up readings, tutors and sources." : "Read lets Claude see your own students and their readings."}</p></div>
          {mine.length ? <ul className="people-list">{mine.map(row)}</ul> : <div className="connections-empty" data-testid="connections-empty"><EmptyState level={3} title="No Claude connection is active" description={address ? connectLine(address) : undefined} /></div>}
        </section>
        {view.role === "admin" && <section className="people-card" aria-labelledby="claude-staff"><div className="people-card-head"><h2 id="claude-staff">Other staff</h2><p>Connections other staff members made. Ending one stops it for them too.</p></div>
          {others.length ? <ul className="people-list">{others.map(row)}</ul> : <p className="people-empty">No other staff member has Claude connected.</p>}
        </section>}
        {view.truncated && <p className="field-help">Only the 100 newest connections are shown.</p>}
      </>}
  </section>;
}
