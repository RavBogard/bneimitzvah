"use client";
import { useEffect, useState } from "react";
import { requestPortal } from "../api";
import { workspaceApi } from "../workspace/api";

type Subject = { type: "own" } | { type: "learner"; membershipId: string } | { type: "student"; studentId: string; mode: "student" | "parent" | "tutor" | "admin" };
type Profile = { pronouns: string; revision: number };
function profile(value: unknown): Profile {
  if (!value || typeof value !== "object") throw new Error("Profile unavailable");
  const row = value as Record<string, unknown>;
  if (row.ok !== true || typeof row.pronouns !== "string" || row.pronouns.length > 160 || !Number.isSafeInteger(row.revision)) throw new Error("Profile unavailable");
  return { pronouns: row.pronouns, revision: row.revision as number };
}
const address = (subject: Subject): `/api/profile/pronouns?${string}` => `/api/profile/pronouns?${new URLSearchParams(subject)}`;

/** Mounted only on authenticated account/family/staff surfaces; never in a public or shared reader. */
export function PronounsEditor({ subject, name }: { subject: Subject; name?: string }) {
  const key = JSON.stringify(subject), [loaded, setLoaded] = useState<Profile | null>(null), [value, setValue] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController(); setLoaded(null); setValue(""); setNotice("");
    requestPortal(address(subject), undefined, request.signal).then(data => { if (!request.signal.aborted) { const row = profile(data); setLoaded(row); setValue(row.pronouns); } }).catch(() => { if (!request.signal.aborted) setNotice("Pronouns couldn’t be loaded. Try again."); });
    return () => request.abort();
  }, [key, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!loaded || busy) return; setBusy(true); setNotice("");
    try { const saved = profile(await requestPortal("/api/profile/pronouns", { subject, pronouns: value, expectedRevision: loaded.revision })); setLoaded(saved); setValue(saved.pronouns); setNotice("Saved."); }
    catch { setLoaded(null); setNotice("We couldn’t confirm what saved. Reload before trying again."); }
    finally { setBusy(false); }
  };
  return <section className="profile-pronouns" aria-label={name ? `Pronouns for ${name}` : "Your pronouns"} data-testid="pronouns-editor">
    <h2>{name ? <><bdi dir="auto">{name}</bdi>’s pronouns</> : "Your pronouns"}</h2>
    <p className="field-help">Optional. Shown to the assigned tutors and authorized congregation staff. This does not appear in Practice or public readings.</p>
    <label>Pronouns (optional)<input autoComplete="off" maxLength={80} value={value} disabled={!loaded || busy} onChange={event => setValue(event.target.value)} placeholder="For example, they/them" /></label>
    <button type="button" className="button-secondary" disabled={!loaded || busy || value === loaded.pronouns} onClick={() => void save()}>{busy ? "Saving…" : "Save pronouns"}</button>
    {notice && <p role="status">{notice}</p>}
    {!loaded && notice && <button type="button" className="button-text" onClick={() => setRetry(value => value + 1)}>Reload pronouns</button>}
  </section>;
}

export function PrivatePronouns({ subject }: { subject: Subject }) {
  const key = JSON.stringify(subject), [loaded, setLoaded] = useState<{ key: string; value: string } | null>(null);
  useEffect(() => {
    const request = new AbortController();
    requestPortal(address(subject), undefined, request.signal).then(value => { if (!request.signal.aborted) setLoaded({ key, value: profile(value).pronouns }); }).catch(() => { if (!request.signal.aborted) setLoaded(null); });
    return () => request.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return loaded?.key === key && loaded.value ? <p data-testid="private-pronouns">Pronouns: <bdi dir="auto">{loaded.value}</bdi></p> : null;
}

/** Linked learners use the student record that a guardian can also edit; standalone learners use their own membership profile. */
export function OwnPronounsSettings({ student }: { student: boolean }) {
  const [children, setChildren] = useState<readonly { id: string; firstName: string }[] | null>(student ? null : []);
  useEffect(() => {
    if (!student) return; const request = new AbortController();
    workspaceApi.students("student", undefined, request.signal).then(rows => { if (!request.signal.aborted) setChildren(rows); }, () => undefined);
    return () => request.abort();
  }, [student]);
  return children === null ? null : children.length ? children.map(child => <PronounsEditor key={child.id} subject={{ type: "student", mode: "student", studentId: child.id }} name={child.firstName} />) : <PronounsEditor subject={{ type: "own" }} />;
}
