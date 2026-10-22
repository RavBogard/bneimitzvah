"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { emailApi, type EmailKind, type EmailOption } from "./api";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const copy: Record<EmailKind, { title: string; choice: string }> = {
  "tutor-draft": { title: "Draft notices", choice: "Email me when a student I teach saves a translation draft" },
  "weekly-digest": { title: "Weekly update", choice: "Send me the weekly update" },
  "practice-reminder": { title: "Practice reminder", choice: "Remind me to practice every week" },
};
function describe(option: EmailOption) {
  if (option.kind === "tutor-draft") return "One short email with a link to sign in. At most one a day for each student.";
  const day = WEEKDAYS[option.weekday ?? 0];
  if (option.kind === "weekly-digest") return option.audience === "self" ? `Each ${day} morning: your days practiced, new lesson notes and upcoming dates.`
    : `Each ${day} morning: your child’s days practiced, new lesson notes and upcoming dates.${option.audience === "both" ? " Turn it on to include your own as well." : ""}`;
  return "A short reminder on the day you choose. Only you get it, at the email you sign in with.";
}

export function EmailSettingsWorkspace() {
  const { registerReload } = useWorkspace();
  const [options, setOptions] = useState<EmailOption[] | null>(null), [failure, setFailure] = useState(false), [pending, setPending] = useState<EmailKind | null>(null);
  const [days, setDays] = useState<Partial<Record<EmailKind, number>>>({}), [message, setMessage] = useState<{ text: string; tone: "status" | "alert" } | null>(null);
  const request = useRef<AbortController | null>(null), alive = useRef(true);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setFailure(false);
    try { const value = await emailApi.read(controller.signal); if (!controller.signal.aborted) setOptions(value); }
    catch { if (!controller.signal.aborted) { setOptions(null); setFailure(true); } }
  }, []);
  useEffect(() => registerReload(async () => { await load(); }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current?.abort(); }; }, [load]);

  async function save(option: EmailOption, enabled: boolean, weekday?: number) {
    if (pending) return;
    setPending(option.kind); setMessage(null);
    try {
      const next = await emailApi.save({ kind: option.kind, enabled, ...(option.kind === "practice-reminder" && weekday !== undefined ? { weekday } : {}) });
      if (!alive.current) return;
      setOptions(next); setMessage({ text: "Saved.", tone: "status" });
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error);
      setMessage({ text: status === 401 || status === 403 ? "This isn’t allowed right now. You may need to sign in again." : "We couldn’t save that. Please try again.", tone: "alert" });
    } finally { if (alive.current) setPending(null); }
  }

  return <section className="role-workspace email-workspace">
    <div className="admin-head"><h1>Email settings</h1></div>
    <p>Choose which emails the portal sends you. Every email also has a link to stop it.</p>
    {failure ? <div className="admin-state" role="alert"><p>Your email settings couldn’t be loaded.</p><button type="button" className="button-secondary admin-pill" onClick={() => void load()}>Reload</button></div>
      : !options ? <p role="status">Loading email settings…</p>
      : !options.length ? <p>There are no portal emails for your account.</p>
      : options.map(option => {
        const day = days[option.kind] ?? option.weekday ?? 0, busy = pending !== null;
        return <section className="people-card" key={option.kind} aria-labelledby={`email-${option.kind}`}>
          <div className="people-card-head"><h2 id={`email-${option.kind}`}>{copy[option.kind].title}</h2><p>{describe(option)}</p></div>
          <label className="email-choice"><input type="checkbox" checked={option.enabled} disabled={busy}
            onChange={event => void save(option, event.target.checked, option.kind === "practice-reminder" ? day : undefined)} />{copy[option.kind].choice}</label>
          {option.kind === "practice-reminder" && <div className="roster-field"><label htmlFor="email-reminder-day">Reminder day</label>
            <select id="email-reminder-day" value={String(day)} disabled={busy} onChange={event => {
              const value = Number(event.target.value); setDays(current => ({ ...current, [option.kind]: value }));
              if (option.enabled) void save(option, true, value);
            }}>{WEEKDAYS.map((name, index) => <option key={name} value={String(index)}>{name}</option>)}</select></div>}
          {!option.offered && <p className="field-help">Your congregation hasn’t turned these emails on yet. Your choice is kept for when it does.</p>}
        </section>;
      })}
    {message && <p className={message.tone === "alert" ? "request-error roster-message" : "workspace-notice roster-message"} role={message.tone}>{message.text}</p>}
    <p><WorkspaceLink href="/account">Back to your account</WorkspaceLink></p>
  </section>;
}
