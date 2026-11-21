"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../ui";
import { PortalRequestError, requestPortal } from "../api";
import styles from "./display-name.module.css";

type Target = { membershipId: string } | { tutorGrantId: string };
type Profile = { name: string; revision: number };
type Problem = "load" | "conflict" | "invalid" | "access" | "save";
const NAME_LIMIT = 80;
const endpoint = "/api/profile/name";

const messages: Record<Problem, string> = {
  load: "The name couldn’t be loaded. Try again.",
  conflict: "The name changed while you were editing. Check the current name before saving.",
  invalid: "Enter a name with 1 to 80 characters, including a letter, without an email address.",
  access: "This account name is no longer available here. Check your access and try again.",
  save: "The change couldn’t be confirmed. Check the current name before trying again.",
};

function validName(name: string) {
  return name.isWellFormed() && /\p{L}/u.test(name) && !/[@<>\x00-\x1f\x7f-\x9f\u061c\u2028-\u202e\u2066-\u2069]/u.test(name) && Array.from(name).length <= NAME_LIMIT;
}

function profile(value: unknown): Profile {
  const row = value as Record<string, unknown> | null;
  if (!row || Object.keys(row).length !== 3 || row.ok !== true || typeof row.name !== "string"
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0
    || (row.name === "" ? row.revision !== 0 : !validName(row.name))) throw new PortalRequestError(503);
  return { name: row.name, revision: row.revision };
}

async function readName(target: Target | undefined, signal: AbortSignal, sessionBinding: string) {
  return profile(await requestPortal(target ? `${endpoint}?${new URLSearchParams(target)}` : endpoint, undefined, signal, sessionBinding));
}

/** Each list opens one editor, identified by the row's stable ID. Its trigger remains available for focus restoration. */
export function useInlineNameEdit() {
  const [id, setId] = useState<string | null>(null);
  const origin = useRef<HTMLButtonElement | null>(null);
  function open(id: string, trigger: HTMLButtonElement) { origin.current = trigger; setId(id); }
  const close = useCallback(() => { setId(null); origin.current?.focus(); origin.current = null; }, []);
  return { id, open, close };
}

export function EditNameButton({ name, expanded, disabled, onOpen }: { name: string; expanded: boolean; disabled?: boolean; onOpen: (trigger: HTMLButtonElement) => void }) {
  return <button type="button" className={`roster-action ${styles.trigger}`} aria-label={`Edit name for ${name}`} aria-expanded={expanded} aria-disabled={expanded || undefined}
    disabled={disabled} onClick={event => { if (!expanded) onOpen(event.currentTarget); }}>Edit name</button>;
}

export function DisplayNameEditor({ target, sessionBinding, onCancel, onSave }: { target?: Target; sessionBinding: string; onCancel: () => void; onSave: (name: Profile) => void }) {
  const [current, setCurrent] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [activity, setActivity] = useState<"loading" | "saving" | null>("loading");
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null), request = useRef<AbortController | null>(null);
  const inputId = useId(), messageId = useId();
  const membershipId = target && "membershipId" in target ? target.membershipId : undefined;
  const tutorGrantId = target && "tutorGrantId" in target ? target.tutorGrantId : undefined;

  useLayoutEffect(() => { input.current?.focus(); return () => request.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    const subject = membershipId ? { membershipId } : tutorGrantId ? { tutorGrantId } : undefined;
    void readName(subject, controller.signal, sessionBinding).then(next => {
      if (!controller.signal.aborted) setCurrent(next);
    }).catch(error => {
      if (!controller.signal.aborted) setProblem(accessFailure(error) ? "access" : "load");
    }).finally(() => {
      if (!controller.signal.aborted) { request.current = null; setActivity(null); }
    });
    return () => controller.abort();
  }, [membershipId, tutorGrantId, retry, sessionBinding]);

  function checkCurrent() {
    setProblem(null); setActivity("loading"); setRetry(value => value + 1); input.current?.focus();
  }

  async function save() {
    if (!current || request.current || draft === null) return;
    const name = draft.trim();
    if (name === current.name) return;
    if (!validName(name)) { setProblem("invalid"); input.current?.focus(); return; }
    const controller = new AbortController(); request.current = controller;
    setActivity("saving"); setProblem(null);
    let next: Profile;
    try {
      next = profile(await requestPortal(endpoint, { ...target, name, expectedRevision: current.revision }, controller.signal, sessionBinding));
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = error instanceof PortalRequestError ? error.status : 0;
      if (status !== 400) setCurrent(null);
      setProblem(status === 400 ? "invalid" : status === 409 ? "conflict" : accessFailure(error) ? "access" : "save");
      input.current?.focus();
      return;
    } finally {
      if (!controller.signal.aborted) { request.current = null; setActivity(null); }
    }
    if (!controller.signal.aborted) onSave(next);
  }

  const value = draft ?? current?.name ?? "";
  return <form className={`${styles.editor}${target ? ` ${styles.rowEditor}` : ""}`} data-testid="display-name-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <label htmlFor={inputId} className={target ? undefined : "sr-only"}>Display name</label>
    <input id={inputId} ref={input} type="text" dir="auto" autoComplete={target ? "off" : "name"} value={value} readOnly={!current || activity !== null}
      aria-invalid={problem === "invalid" || undefined} aria-describedby={problem ? messageId : undefined}
      onChange={event => { setDraft(event.target.value); setProblem(null); }} />
    {activity === "loading" && <p className="field-help" role="status">Loading name…</p>}
    {problem && <p id={messageId} className="request-error" role="alert">{messages[problem]}</p>}
    <div className={styles.feedback} aria-live="polite">{retry > 0 && current && draft !== null && <p className="field-help">Current name: {current.name ? <bdi dir="auto">{current.name}</bdi> : "No name added"}</p>}</div>
    <div className={styles.actions}>
      {current || !problem ? <Button type="submit" variant="primary" disabled={!current || activity !== null || !value.trim() || value.trim() === current.name}>{activity === "saving" ? "Saving…" : "Save"}</Button>
        : problem !== "access" && <Button onClick={checkCurrent}>{problem === "load" ? "Try again" : "Check current name"}</Button>}
      <Button variant="quiet" disabled={activity === "saving"} onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
}

function accessFailure(error: unknown) {
  return error instanceof PortalRequestError && [401, 403, 404].includes(error.status);
}

export function AccountDisplayName({ sessionBinding }: { sessionBinding: string }) {
  const [current, setCurrent] = useState<Profile | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false), [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void readName(undefined, controller.signal, sessionBinding).then(value => { if (!controller.signal.aborted) setCurrent(value); }, () => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [retry, sessionBinding]);
  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus(); }
  }, [editing]);
  function close() { restoreFocus.current = true; setEditing(false); }

  return <section className={`account-section ${styles.accountName}`} aria-labelledby="account-display-name">
    <div className={styles.accountNameRow}>
      <div><h2 id="account-display-name">Display name</h2>
        {!editing && (current ? <p>{current.name ? <bdi dir="auto">{current.name}</bdi> : "No name added"}</p> : failed ? <p className="request-error" role="alert">{messages.load}</p> : <p role="status">Loading name…</p>)}</div>
      {current ? !editing && <Button ref={trigger} variant="quiet" onClick={() => { setEditing(true); setSaved(false); }}>{current.name ? "Edit name" : "Add name"}</Button>
        : failed && <Button variant="quiet" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>Try again</Button>}
    </div>
    {editing && current && <DisplayNameEditor sessionBinding={sessionBinding} onCancel={close} onSave={next => { setCurrent(next); close(); setSaved(true); }} />}
    <p className={styles.feedback} aria-live="polite">{saved ? "Name saved." : ""}</p>
  </section>;
}
