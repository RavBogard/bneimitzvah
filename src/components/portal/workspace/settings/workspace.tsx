"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RequireRole, statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { validateSettings, SETTINGS_LIMITS, type CongregationSettings, type NotificationSettings, type ServiceSetting } from "../../../../server/settings/validation";
import { settingsApi, type SettingsView } from "./api";
import { resetCongregationRead } from "./links";
import { Button, Chip, PageHeader } from "../../../ui";

type Draft = { rabbiDisplayName: string; preferredSources: string; morningLabel: string; morningStart: string; havdalahLabel: string; havdalahStart: string;
  siddurUrl: string; musicUrl: string; rosterSheetId: string; consentNotice: string; digestWeekday: string };
type Field = keyof Draft;
type Switches = Required<Pick<NotificationSettings, "tutorDraft" | "weeklyDigest" | "studentReminder">>;
type Switch = keyof Switches;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const fieldFor: Record<string, Field[]> = {
  rabbiDisplayName: ["rabbiDisplayName"], preferredSources: ["preferredSources"], "services.morning": ["morningLabel", "morningStart"], "services.havdalah": ["havdalahLabel", "havdalahStart"],
  siddurUrl: ["siddurUrl"], musicUrl: ["musicUrl"], rosterSheetId: ["rosterSheetId"], consentNotice: ["consentNotice"], notifications: ["digestWeekday"],
};
const messages: Record<string, string> = {
  rabbiDisplayName: `Use one line of up to ${SETTINGS_LIMITS.rabbiDisplayName} characters, without < or >.`,
  preferredSources: `List up to ${SETTINGS_LIMITS.preferredSources} different works, one per line.`,
  "services.morning": "Use a name of up to 40 characters and a start time such as 10:00.",
  "services.havdalah": "Use a name of up to 40 characters and a start time such as 16:00.",
  siddurUrl: "Use a full https:// link on centralreform.org or centralreform.live.",
  musicUrl: "Use a full https:// link on centralreform.org or centralreform.live.",
  rosterSheetId: "Paste the code from the sheet’s address, between /d/ and /edit.",
  consentNotice: `Keep the notice to ${SETTINGS_LIMITS.consentNotice} characters, without < or >.`,
  notifications: "Choose a day of the week for weekly updates.",
};

function draftOf(settings: CongregationSettings): Draft {
  const s = settings.services ?? {};
  return { rabbiDisplayName: settings.rabbiDisplayName ?? "", preferredSources: (settings.preferredSources ?? []).join("\n"),
    morningLabel: s.morning?.label ?? "", morningStart: s.morning?.start ?? "", havdalahLabel: s.havdalah?.label ?? "", havdalahStart: s.havdalah?.start ?? "",
    siddurUrl: settings.siddurUrl ?? "", musicUrl: settings.musicUrl ?? "", rosterSheetId: settings.rosterSheetId ?? "", consentNotice: settings.consentNotice ?? "",
    digestWeekday: String(settings.notifications?.digestWeekday ?? 0) };
}
const switchesOf = (settings: CongregationSettings): Switches => ({ tutorDraft: settings.notifications?.tutorDraft === true,
  weeklyDigest: settings.notifications?.weeklyDigest === true, studentReminder: settings.notifications?.studentReminder === true });
/** Blank fields are left out, so they keep the portal's current behaviour. */
function settingsOf(draft: Draft, switches: Switches): CongregationSettings {
  const text = (value: string) => value.trim() || undefined;
  const slot = (label: string, start: string): ServiceSetting | undefined => { const value = { ...(text(label) ? { label: text(label) } : {}), ...(text(start) ? { start: text(start) } : {}) }; return Object.keys(value).length ? value : undefined; };
  const morning = slot(draft.morningLabel, draft.morningStart), havdalah = slot(draft.havdalahLabel, draft.havdalahStart);
  const sources = draft.preferredSources.split("\n").map(line => line.trim()).filter(Boolean);
  const result: CongregationSettings = {
    rabbiDisplayName: text(draft.rabbiDisplayName), preferredSources: sources.length ? sources : undefined,
    services: morning || havdalah ? { ...(morning ? { morning } : {}), ...(havdalah ? { havdalah } : {}) } : undefined,
    siddurUrl: text(draft.siddurUrl), musicUrl: text(draft.musicUrl), rosterSheetId: text(draft.rosterSheetId), consentNotice: text(draft.consentNotice.replace(/\r\n?/g, "\n")),
    notifications: notificationsOf(draft, switches),
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as CongregationSettings;
}

/** Left out entirely while every kind is off on the standard day, so an untouched page saves what it did before. */
function notificationsOf(draft: Draft, switches: Switches): NotificationSettings | undefined {
  const weekday = Number(draft.digestWeekday), on = (Object.keys(switches) as Switch[]).filter(key => switches[key]);
  if (!on.length && weekday === 0) return undefined;
  return { ...Object.fromEntries(on.map(key => [key, true])), ...(weekday !== 0 ? { digestWeekday: weekday } : {}) };
}

export function CongregationSettingsWorkspace() { return <RequireRole role="admin"><CongregationSettingsPage /></RequireRole>; }
function CongregationSettingsPage() {
  const { registerReload } = useWorkspace();
  const [switches, setSwitches] = useState<Switches>({ tutorDraft: false, weeklyDigest: false, studentReminder: false });
  const [view, setView] = useState<SettingsView | null>(null), [draft, setDraft] = useState<Draft | null>(null), [loading, setLoading] = useState(true), [failure, setFailure] = useState(false);
  const [pending, setPending] = useState(false), [problems, setProblems] = useState<string[]>([]), [message, setMessage] = useState<{ text: string; tone: "status" | "alert" } | null>(null);
  const [conflict, setConflict] = useState(false), [accessError, setAccessError] = useState(false);
  const request = useRef<AbortController | null>(null), alive = useRef(true), mutation = useRef<{ key: string; id: string } | null>(null);
  // G21 (AD-13): after a refused save, focus moves to the first field that needs a change.
  const form = useRef<HTMLFormElement>(null), [focusTurn, setFocusTurn] = useState(0);
  useEffect(() => { if (focusTurn) form.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(); }, [focusTurn]);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setFailure(false);
    try { const value = await settingsApi.read(controller.signal); if (controller.signal.aborted) return; setView(value); setDraft(draftOf(value.settings)); setSwitches(switchesOf(value.settings)); setProblems([]); setConflict(false); }
    catch { if (!controller.signal.aborted) { setView(null); setFailure(true); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => registerReload(async () => { await load(); }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; request.current?.abort(); }; }, [load]);

  function change(field: Field, value: string) { setDraft(current => current && { ...current, [field]: value }); if (message?.tone === "status") setMessage(null); }
  function toggle(key: Switch, value: boolean) { setSwitches(current => ({ ...current, [key]: value })); if (message?.tone === "status") setMessage(null); }
  async function reload() { setMessage(null); setAccessError(false); await load(); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || !draft || pending || conflict) return;
    const settings = settingsOf(draft, switches), checked = validateSettings(settings);
    if (!checked.ok) { setProblems(checked.problems); setFocusTurn(turn => turn + 1); setMessage({ text: "Some settings need a change before they can be saved.", tone: "alert" }); return; }
    // One mutation id per exact request, so a retry after a lost reply is recognised rather than saved twice.
    const key = JSON.stringify([view.version, settings]);
    if (mutation.current?.key !== key) mutation.current = { key, id: crypto.randomUUID() };
    setPending(true); setProblems([]); setMessage(null); setAccessError(false);
    try {
      const outcome = await settingsApi.save({ expectedVersion: view.version, settings, mutationId: mutation.current.id });
      if (!alive.current) return;
      if (outcome.ok) { mutation.current = null; resetCongregationRead(); setMessage({ text: "Settings saved.", tone: "status" }); await load(); return; }
      mutation.current = null;
      if (outcome.code === "no-change") setMessage({ text: "Nothing changed, so nothing was saved.", tone: "status" });
      else if (outcome.code === "invalid") { setProblems(outcome.problems); setFocusTurn(turn => turn + 1); setMessage({ text: "Some settings need a change before they can be saved.", tone: "alert" }); }
      else { setConflict(true); setMessage({ text: "Someone saved these settings after you opened this page, so your changes weren’t saved. Reload to see the latest, then make your changes again.", tone: "alert" }); }
    } catch (error) {
      if (!alive.current) return;
      const status = statusOf(error);
      setAccessError(status === 401 || status === 403);
      setMessage({ text: status === 401 || status === 403 ? "This isn’t allowed right now. You may need to sign in again." : "We couldn’t confirm the save. Reload to see what was kept.", tone: "alert" });
    } finally { if (alive.current) setPending(false); }
  }

  const invalid = new Set(problems.flatMap(problem => fieldFor[problem] ?? []));
  const problemFor = (field: Field) => problems.find(problem => fieldFor[problem]?.includes(field));
  // A service's name and time share one message, shown under the name.
  const errorId = (field: Field) => { const problem = problemFor(field); return problem ? `settings-${fieldFor[problem][0]}-error` : undefined; };
  const locked = pending || conflict || loading;
  const field = (name: Field, label: string, input: ReactNode, help?: ReactNode) => <div className="roster-field">
    <label htmlFor={`settings-${name}`}>{label}</label>{input}
    {problemFor(name) && fieldFor[problemFor(name)!][0] === name && <p className="field-error" id={`settings-${name}-error`}>{messages[problemFor(name)!]}</p>}
    {help && <p className="field-help">{help}</p>}</div>;
  const textInput = (name: Field, extra: { type?: string; maxLength?: number; placeholder?: string; inputMode?: "url" | "text"; autoComplete?: string } = {}) => draft && <input id={`settings-${name}`} type={extra.type ?? "text"} value={draft[name]} maxLength={extra.maxLength} placeholder={extra.placeholder} inputMode={extra.inputMode} autoComplete={extra.autoComplete ?? "off"} spellCheck={false}
    aria-invalid={invalid.has(name) || undefined} aria-describedby={errorId(name)} disabled={locked} onChange={event => change(name, event.target.value)} />;
  const textArea = (name: Field, rows: number, maxLength: number) => draft && <textarea id={`settings-${name}`} rows={rows} value={draft[name]} maxLength={maxLength}
    aria-invalid={invalid.has(name) || undefined} aria-describedby={errorId(name)} disabled={locked} onChange={event => change(name, event.target.value)} />;

  return <section className="role-workspace admin-workspace settings-workspace">
    <PageHeader title="Congregation settings" />
    {loading && !view ? <p role="status">Loading settings…</p>
      : failure || !view || !draft ? <div className="admin-state" role="alert"><p>The settings couldn’t be loaded.</p><Button onClick={() => void reload()}>Reload</Button></div>
      : <form ref={form} onSubmit={event => void save(event)} noValidate>
        <section className="people-card" aria-labelledby="settings-rabbi"><div className="people-card-head"><h2 id="settings-rabbi">Rabbi</h2></div>
          {field("rabbiDisplayName", "Name on study guides", textInput("rabbiDisplayName", { maxLength: SETTINGS_LIMITS.rabbiDisplayName, placeholder: view.defaults.rabbiDisplayName, autoComplete: "name" }),
            <>Students see it as “Reviewed by {draft.rabbiDisplayName.trim() || view.defaults.rabbiDisplayName}”. Left blank, guides use “{view.defaults.rabbiDisplayName}”.</>)}
        </section>
        <section className="people-card" aria-labelledby="settings-sources"><div className="people-card-head"><h2 id="settings-sources">Sources</h2></div>
          {field("preferredSources", "Works to show first", textArea("preferredSources", 5, 2400),
            "One per line, in order, such as Rashi or Ramban on Genesis. When a student looks up sources for a verse, these come first.")}
        </section>
        <section className="people-card" aria-labelledby="settings-services"><div className="people-card-head"><h2 id="settings-services">Services</h2><p>Families, students and staff see these names wherever a student’s service is named, such as the reading page and the honors form, with the start time when you set one. Left blank, pages say “Morning service” or “Havdalah service” and show no time.</p></div>
          <div className="roster-form-grid settings-grid">
            {field("morningLabel", "Morning service name", textInput("morningLabel", { maxLength: SETTINGS_LIMITS.serviceLabel, placeholder: "Morning service" }))}
            {field("morningStart", "Morning start time", textInput("morningStart", { type: "time" }))}
            {field("havdalahLabel", "Havdalah service name", textInput("havdalahLabel", { maxLength: SETTINGS_LIMITS.serviceLabel, placeholder: "Havdalah service" }))}
            {field("havdalahStart", "Havdalah start time", textInput("havdalahStart", { type: "time" }))}
          </div>
        </section>
        <section className="people-card" aria-labelledby="settings-links"><div className="people-card-head"><h2 id="settings-links">Links</h2><p>Shown with each student’s service parts.</p></div>
          {field("siddurUrl", "Siddur link", textInput("siddurUrl", { type: "url", inputMode: "url", placeholder: view.defaults.siddurUrl }), <>Left blank, the link stays {view.defaults.siddurUrl}</>)}
          {field("musicUrl", "Music link", textInput("musicUrl", { type: "url", inputMode: "url" }), "Left blank, no music link is shown.")}
        </section>
        <section className="people-card" aria-labelledby="settings-records"><div className="people-card-head"><h2 id="settings-records">Roster and families</h2></div>
          {view.portal.rosterSheetId && field("rosterSheetId", "Roster sheet ID", textInput("rosterSheetId", { maxLength: 100 }), "Kept for a future congregation’s roster sheet. The CRC roster sheet is set by the portal’s operator, not here.")}
          {field("consentNotice", "Consent notice", textArea("consentNotice", 4, SETTINGS_LIMITS.consentNotice),
            "Parents see it in their child’s preparation summary. Say what is stored, who hears it and when it is deleted. Left blank, no notice is shown.")}
        </section>
        <section className="people-card" aria-labelledby="settings-email"><div className="people-card-head"><h2 id="settings-email">Email</h2><p>Each kind is off until you turn it on here. Nothing is sent until the portal’s operator has turned email on as well. Every email has a one-click unsubscribe, and people can turn each kind off in their own email settings.</p>
            {view.portal.email !== null && <p className="settings-email-status" data-testid="settings-email-status"><Chip tone={view.portal.email ? "done" : "neutral"}>{view.portal.email ? "Email is on for this portal" : "Email is off for this portal"}</Chip></p>}</div>
          {([["tutorDraft", "Draft notices for tutors", "When a student saves a translation draft, their tutor gets one short email with a link to sign in. At most one a day for each student."],
            ["weeklyDigest", "Weekly updates for parents", "Once a week, each parent gets their own child’s days practiced, new lesson notes and upcoming dates. Adult students can turn this on for themselves."],
            ["studentReminder", "Practice reminders for students", "Students who sign in with their own email can ask for a weekly reminder on a day they choose. No student gets one unless they turn it on."]] as const).map(([key, label, help]) =>
            <div className="roster-field" key={key}><label className="email-choice"><input type="checkbox" checked={switches[key]} disabled={locked} onChange={event => toggle(key, event.target.checked)} aria-describedby={`settings-${key}-help`} />{label}</label>
              <p className="field-help" id={`settings-${key}-help`}>{help}</p></div>)}
          {field("digestWeekday", "Day for weekly updates", draft && <select id="settings-digestWeekday" value={draft.digestWeekday} disabled={locked} aria-invalid={invalid.has("digestWeekday") || undefined} aria-describedby={errorId("digestWeekday")} onChange={event => change("digestWeekday", event.target.value)}>
            {WEEKDAYS.map((day, index) => <option key={day} value={String(index)}>{day}</option>)}</select>, "Updates go out that morning, Central time.")}
        </section>
        {message && <p className={message.tone === "alert" ? "request-error roster-message" : "workspace-notice roster-message"} role={message.tone}>{message.text}</p>}
        {accessError && <p><WorkspaceLink href="/">Check account and sign in again</WorkspaceLink></p>}
        <div className="form-actions settings-actions">
          {conflict ? <Button variant="primary" disabled={loading} onClick={() => void reload()}>Reload settings</Button>
            : <Button type="submit" variant="primary" disabled={locked}>{pending ? "Saving…" : "Save settings"}</Button>}
        </div>
      </form>}
  </section>;
}
