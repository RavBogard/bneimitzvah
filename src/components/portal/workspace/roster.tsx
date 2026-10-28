"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { workspaceApi, type RosterStudent, type StudentInput } from "./api";
import { RequireRole, statusOf, useWorkspace, useWorkspaceModal, WorkspaceLink } from "./provider";
import { AccountRequestsLine } from "./accounts/workspace";
import { accountsApi } from "./accounts/api";
import { ceremonyCountdown } from "./reading";
import { icons } from "./study/lift";
import { HonorsSheet } from "./honors/sheet";
import { MavenLinkPanel } from "./maven-link";
import { useSearchParams } from "next/navigation";
import { staffApi } from "./staff/api";
import { Button, PageHeader } from "../../ui";
import { DocumentTitle } from "./document-title";
import { byCeremony, isSunday, statusChips, studentFacts, weekCards, type NeedsYouStudent, type StudentStatus } from "./staff/model";
import { ThisWeekCards } from "./staff/this-week";

const empty: StudentInput = { firstName: "", lastName: "", ceremonyDate: "", rehearsal1: null, rehearsal2: null, studentKind: "child", serviceSlot: "unknown", parentEmail: "", ownEmail: null };
function draft(row: RosterStudent): StudentInput { return { firstName: row.firstName, lastName: row.lastName, ceremonyDate: row.ceremonyDate, rehearsal1: row.rehearsal1 ?? null, rehearsal2: row.rehearsal2 ?? null, studentKind: row.studentKind, serviceSlot: row.serviceSlot, parentEmail: row.parentEmail, ownEmail: row.ownEmail }; }
/** Same rule as the server and database: in order, and on or before the ceremony. */
function rehearsalsFit(form: Pick<StudentInput, "ceremonyDate" | "rehearsal1" | "rehearsal2">) {
  const first = form.rehearsal1 || null, second = form.rehearsal2 || null, ceremony = form.ceremonyDate;
  return (!first || !ceremony || first <= ceremony) && (!second || !ceremony || second <= ceremony) && (!first || !second || first <= second);
}
const slotNames = { morning: "Morning", havdalah: "Havdalah", unknown: null } as const;
const fullName = (row: { firstName: string; lastName: string }) => `${row.firstName} ${row.lastName}`;
const searchable = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const PAGE = 25;
export function AdminWorkspace() { return <RequireRole role="admin"><Roster /></RequireRole>; }
function Roster() {
  const { registerReload, registerDeparture } = useWorkspace();
  const [rows, setRows] = useState<RosterStudent[]>([]), [loading, setLoading] = useState(true), [unavailable, setUnavailable] = useState(false);
  const [current, setCurrent] = useState<RosterStudent | null>(null), [form, setForm] = useState<StudentInput>(empty), [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessageText] = useState(""), [messageKind, setMessageKind] = useState(""), [conflict, setConflict] = useState(false), [confirmDisable, setConfirmDisable] = useState(false), [page, setPage] = useState(0);
  const setMessage = useCallback((text: string, kind = "") => { setMessageText(text); setMessageKind(kind); }, []);
  const [query, setQuery] = useState(""), [confirmDone, setConfirmDone] = useState(false);
  // 1.9 N14: each active student's setup facts (Needs you and the row chips), and the student just added (its three next steps).
  const [neededInvites, setNeededInvites] = useState<ReadonlySet<string>>(new Set()), [linkRequests, setLinkRequests] = useState(0);
  const [statuses, setStatuses] = useState<Map<string, StudentStatus> | null>(null), [added, setAdded] = useState<{ id: string; firstName: string } | null>(null);
  // This week (the admin's home) shows Needs you; Students (?tab=students) is the plain list. ?edit= opens one student's details.
  const params = useSearchParams(), thisWeek = params.get("tab") !== "students", editTarget = params.get("edit"), editOpened = useRef<string | null>(null);
  // Closing a changed form asks Keep editing / Discard changes, like lesson notes and honors.
  const [discarding, setDiscarding] = useState(false), departure = useRef<((leave: boolean) => void) | null>(null), keepEditing = useRef<HTMLButtonElement>(null);
  const [honorsStudent, setHonorsStudent] = useState<RosterStudent | null>(null), honorsOrigin = useRef<HTMLButtonElement | null>(null);
  const gate = useRef(false), turn = useRef(0), abort = useRef<AbortController | null>(null), formHeading = useRef<HTMLHeadingElement>(null);
  const sheet = useRef<HTMLDialogElement>(null), origin = useRef<HTMLElement | null>(null), addButton = useRef<HTMLButtonElement>(null);
  const lifetime = useRef(0), currentRef = useRef(current); currentRef.current = current;
  const load = useCallback(async (preserve = false) => {
    const generation = ++turn.current; abort.current?.abort(); const request = new AbortController(); abort.current = request;
    setUnavailable(false);
    if (!preserve) { setLoading(true); setRows([]); setCurrent(null); setEditing(false); setForm(empty); setConflict(false); setConfirmDisable(false); setConfirmDone(false); setMessage(""); setAdded(null); }
    try {
      // The setup facts are a second, separate read: if it fails the roster still shows, without Needs you or chips.
      // N22: the students the invitations service says need a parent invitation; without it, Needs you still asks for families with none.
      const [values, facts, needed, waiting] = await Promise.all([workspaceApi.roster(request.signal), staffApi.status(request.signal).catch(() => null), staffApi.needed(request.signal).catch(() => new Set<string>()),
        accountsApi.summary("admin", request.signal).catch(() => 0)]);
      if (generation === turn.current && !request.signal.aborted) {
        setRows(values); if (!preserve) setPage(0);
        setStatuses(facts ? new Map(facts.map(row => [row.id, row])) : null); setNeededInvites(needed); setLinkRequests(waiting);
        const selected = currentRef.current;
        if (preserve && selected) {
          const next = values.find(row => row.id === selected.id);
          if (!next) { setCurrent(null); setEditing(false); setForm(empty); }
          else if (next.ceremonyDoneAt && !next.disabledAt) { setCurrent(null); setEditing(false); setForm(empty); }
          else if (next.disabledAt) { setCurrent(next); setForm(empty); }
          else if (next.revision !== selected.revision) { setConflict(true); setMessage("This student changed while you were away. Your draft is kept here but can’t be saved. Reload the roster to use the current details."); }
        }
      }
    }
    catch (error) { if (generation === turn.current && !request.signal.aborted) { setUnavailable(true); throw error; } }
    finally { if (generation === turn.current && !request.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => registerReload(() => load(true)), [registerReload, load]);
  useEffect(() => { void load().catch(() => undefined); return () => { lifetime.current++; turn.current++; abort.current?.abort(); }; }, [load]);
  // Adding and editing happen in a sheet over the list. It leaves the top layer during access checks and comes back with the draft.
  const sheetOpen = editing && !loading && !unavailable, sheetShown = useWorkspaceModal(sheet, sheetOpen);
  // An attempted save with an unclear outcome is not an unsaved draft: its message stays on the list instead.
  const dirty = editing && !current?.disabledAt && !conflict && JSON.stringify(form) !== JSON.stringify(current ? draft(current) : empty);
  const shown = useRef({ sheetShown, pending, dirty }); shown.current = { sheetShown, pending, dirty };
  // Focus starts on the heading; after an access check hides and returns the sheet, it goes back to the field the admin was in.
  // showModal focuses the close button first, so only focus after the sheet has settled is remembered.
  const lastFocus = useRef<HTMLElement | null>(null), settled = useRef(false);
  useLayoutEffect(() => {
    settled.current = false; if (!sheetShown) return;
    const field = lastFocus.current; (field?.isConnected && sheet.current?.contains(field) ? field : formHeading.current)?.focus(); settled.current = true;
  }, [sheetShown, current?.id]);
  useEffect(() => {
    // Wait for a reload to finish so the opener (or Add) exists and is enabled again.
    if (sheetOpen || loading || !origin.current) return;
    const opener = origin.current; origin.current = null;
    (opener.isConnected ? opener : addButton.current)?.focus();
  }, [sheetOpen, loading]);
  // closedby is not in every browser: while a save is in flight, Escape must not close the sheet.
  useLayoutEffect(() => {
    if (!pending) return;
    const block = (event: KeyboardEvent) => { if (event.key === "Escape" && sheet.current?.open) event.preventDefault(); };
    document.addEventListener("keydown", block, true); return () => document.removeEventListener("keydown", block, true);
  }, [pending]);
  // An unresolved outcome (conflict or unclear save) stays on the list after the sheet closes, and blocks new edits until a reload.
  function closeEditor() { if (gate.current) return; setEditing(false); setCurrent(null); setForm(empty); setConfirmDisable(false); setConfirmDone(false); setDiscarding(false); departure.current?.(true); departure.current = null; }
  function requestClose() { if (gate.current) return; if (shown.current.dirty) setDiscarding(true); else closeEditor(); }
  function keep() { setDiscarding(false); departure.current?.(false); departure.current = null; }
  useLayoutEffect(() => { if (discarding) keepEditing.current?.focus(); }, [discarding]);
  // Controlled navigation away from a changed student form asks first.
  useLayoutEffect(() => registerDeparture(async () => {
    if (!shown.current.dirty) return true;
    if (departure.current) return false;
    setDiscarding(true); return new Promise<boolean>(resolve => { departure.current = resolve; });
  }), [registerDeparture]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { if (shown.current.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  // A second Escape can close a dialog without a cancel event. Bring state back in line.
  function sheetClosed() { const now = shown.current; if (!now.sheetShown) return; if (now.pending || gate.current) sheet.current?.showModal(); else if (now.dirty) { sheet.current?.showModal(); setDiscarding(true); } else closeEditor(); }
  function choose(row: RosterStudent | null, event: { currentTarget: HTMLElement }) {
    if (conflict) return;
    origin.current = event.currentTarget; lastFocus.current = null;
    setCurrent(row); setForm(row ? draft(row) : empty); setEditing(true); setMessage(""); setConflict(false); setConfirmDisable(false); setConfirmDone(false);
  }
  // N21 "Ceremony done": set from the student's sheet (after the approved confirmation), undone from the Ceremony done list.
  // Wording approved by Daniel (2026-10-26): the "Undo" label and the two status lines below, word for word.
  async function ceremony(row: RosterStudent, reverse: boolean) {
    if (gate.current || conflict) return;
    gate.current = true; setPending(true); setMessage(""); const generation = lifetime.current;
    try {
      await workspaceApi.ceremonyDone(row, reverse);
      if (generation !== lifetime.current) return;
      const done = reverse ? `${row.firstName} is back in the active list. Choose a tutor.` : `${row.firstName}: ceremony done.`;
      let refreshed = true; try { await load(); } catch { refreshed = false; }
      if (generation === lifetime.current) setMessage(done + (refreshed ? "" : " The list couldn’t be refreshed. Reload it to check the current record."));
    } catch (error) {
      if (generation !== lifetime.current) return;
      const status = statusOf(error);
      setMessage(status === 409 ? "Someone changed this student since you opened it. Nothing was overwritten. Reload the roster to see the current details."
        : status === 401 || status === 403 || status === 404 ? "This change isn’t allowed any more. Reload the roster to check current access."
        : "We couldn’t confirm whether this saved. Reload the roster to check before trying again.");
      setConflict(true);
    } finally { gate.current = false; setPending(false); }
  }
  async function mutate(disable: boolean) {
    if (gate.current || conflict) return;
    if (!disable && form.ownEmail?.trim() && form.parentEmail?.trim() && form.ownEmail.trim().toLowerCase() === form.parentEmail.trim().toLowerCase()) { setMessage("The student’s own email must be different from their parent’s email."); return; }
    if (!disable && !rehearsalsFit(form)) { setMessage("Rehearsal dates need to be in order and on or before the ceremony date."); return; }
    gate.current = true; setPending(true); setMessage(""); setAdded(null); const generation = lifetime.current;
    try {
      const result = disable && current ? await workspaceApi.disable(current) : await workspaceApi.save(form, current ?? undefined);
      if (generation !== lifetime.current) return;
      const review = "readingNeedsReview" in result && result.readingNeedsReview;
      const name = fullName(form), created = !disable && !current, saved = disable && current ? `${fullName(current)} is disabled and hidden from the list. Their record is kept.` : review ? `Saved ${name}. The date or service changed, so both readings need review.` : current ? `Saved ${name}.` : "";
      let refreshed = true; try { await load(); } catch { refreshed = false; }
      // A new student: "Added Noa. Next: choose a tutor, invite a parent, assign the reading", each step a link (1.9 N14, AD-02).
      if (generation === lifetime.current && created) setAdded({ id: result.id, firstName: form.firstName.trim() });
      if (generation === lifetime.current && (saved || !refreshed)) setMessage(saved + (refreshed ? "" : `${saved ? " " : ""}The list couldn’t be refreshed. Reload it to check the current record.`), !refreshed ? "stale" : review ? "saved-review" : disable ? "disabled" : "saved");
    } catch (error) {
      if (generation !== lifetime.current) return;
      const status = statusOf(error);
      if (status === 409) { setConflict(true); setMessage("Someone changed this student since you opened it. Nothing was overwritten. Reload the roster to see the current details."); }
      else setMessage(status === 401 || status === 403 || status === 404 ? "This change isn’t allowed any more. Reload the roster to check current access."
        : "We couldn’t confirm whether this saved. Reload the roster to check before trying again.");
      setConflict(true);
    } finally { gate.current = false; setPending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate(false); }
  // N21: a student whose ceremony is done leaves the active roster for the Ceremony done list (a disabled one is counted with the disabled).
  // 1.9 N14: the roster reads soonest ceremony first.
  // Daniel, 2026-10-26: a disabled student (a duplicate, or one who left) is hidden from the list; "Show disabled" brings them back to view.
  const [showDisabled, setShowDisabled] = useState(false);
  const roster = useMemo(() => byCeremony(rows.filter(row => !row.ceremonyDoneAt || row.disabledAt)), [rows]);
  const listed = useMemo(() => showDisabled ? roster : roster.filter(row => !row.disabledAt), [roster, showDisabled]);
  const needsYou = useMemo(() => weekCards(rows as NeedsYouStudent[], statuses, new Date(), neededInvites), [rows, statuses, neededInvites]);
  // ?edit=<id> (the reading page's "Edit details") opens that student's details once the roster has loaded.
  useEffect(() => {
    if (loading || unavailable || conflict || !editTarget || editOpened.current === editTarget) return;
    const row = rows.find(value => value.id === editTarget && !value.disabledAt && !value.ceremonyDoneAt); editOpened.current = editTarget;
    if (row) { origin.current = addButton.current; lastFocus.current = null; setCurrent(row); setForm(draft(row)); setEditing(true); setMessage(""); setConfirmDisable(false); setConfirmDone(false); }
  }, [loading, unavailable, conflict, editTarget, rows]);
  const doneRows = useMemo(() => rows.filter(row => row.ceremonyDoneAt && !row.disabledAt), [rows]);
  const matches = useMemo(() => { const words = searchable(query).split(/\s+/).filter(Boolean); return words.length ? listed.filter(row => { const name = searchable(fullName(row)); return words.every(word => name.includes(word)); }) : listed; }, [listed, query]);
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE)), pageRows = matches.slice(page * PAGE, page * PAGE + PAGE);
  const disabledCount = roster.filter(row => row.disabledAt).length, activeCount = roster.length - disabledCount;
  const label = (name: keyof StudentInput) => name === "firstName" ? "First name" : name === "lastName" ? "Last name" : name === "ceremonyDate" ? "Ceremony date" : name === "parentEmail" ? (form.studentKind === "child" ? "Parent email" : "Parent email (optional)") : (form.studentKind === "adult" ? "Student email" : "Student email (optional)");
  const input = (name: "firstName" | "lastName" | "ceremonyDate" | "parentEmail" | "ownEmail") => <div key={name} className="roster-field">
    <label htmlFor={`roster-${name}`}>{label(name)}</label>
    <input id={`roster-${name}`} name={name} type={name === "ceremonyDate" ? "date" : name.endsWith("Email") ? "email" : "text"} maxLength={name.endsWith("Email") ? 254 : 100} required={name === "parentEmail" ? form.studentKind === "child" : name === "ownEmail" ? form.studentKind === "adult" : true} disabled={pending || conflict}
      value={form[name] ?? ""} onChange={event => setForm(previous => ({ ...previous, [name]: event.target.value }))} autoComplete="off" aria-describedby={name === "ceremonyDate" && isSunday(form.ceremonyDate) ? "roster-sunday" : undefined} />
    {/* AD-12: a ceremony on a Sunday is usually a typo. A hint only; the date still saves. */}
    {name === "ceremonyDate" && isSunday(form.ceremonyDate) && <p id="roster-sunday" className="field-help" data-testid="sunday-hint">This is a Sunday. Is that right?</p>}
  </div>;
  // Optional; clearing the field clears the saved date. Usually about three weeks and one week before the ceremony.
  const rehearsal = (name: "rehearsal1" | "rehearsal2") => <div key={name} className="roster-field">
    <label htmlFor={`roster-${name}`}>{name === "rehearsal1" ? "First rehearsal (optional)" : "Second rehearsal (optional)"}</label>
    <input id={`roster-${name}`} name={name} type="date" disabled={pending || conflict} value={form[name] ?? ""} autoComplete="off"
      min={name === "rehearsal2" ? form.rehearsal1 || undefined : undefined} max={(name === "rehearsal1" ? form.rehearsal2 || form.ceremonyDate : form.ceremonyDate) || undefined}
      onChange={event => { const value = event.target.value || null; setForm(previous => ({ ...previous, [name]: value })); }} />
  </div>;
  const notice = message ? <p data-testid="roster-message" data-message-kind={messageKind} className={conflict ? "request-error roster-message" : "workspace-notice roster-message"} role={conflict ? "alert" : "status"}>{message}</p>
    : added && <p className="workspace-notice roster-message" role="status" data-testid="roster-added">Added <bdi dir="auto">{added.firstName}</bdi>. Next: <WorkspaceLink href={`/workspace/admin/students/${encodeURIComponent(added.id)}/access`}>choose a tutor</WorkspaceLink>, <WorkspaceLink href={`/workspace/admin/invitations?student=${encodeURIComponent(added.id)}&role=parent`}>invite a parent</WorkspaceLink>, <WorkspaceLink href={`/workspace/admin/students/${encodeURIComponent(added.id)}/reading`}>assign the reading</WorkspaceLink></p>;
  const openHonors = (student: NeedsYouStudent, event: { currentTarget: HTMLElement }) => { const row = rows.find(value => value.id === student.id); if (!row || pending || editing || honorsStudent) return; honorsOrigin.current = event.currentTarget as HTMLButtonElement; setHonorsStudent(row); };
  const openDetails = (student: NeedsYouStudent, event: { currentTarget: HTMLElement }) => { const row = rows.find(value => value.id === student.id); if (row) choose(row, event); };
  const reloadIcon = <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <section className="role-workspace admin-workspace">
    {!(thisWeek && statuses) && <AccountRequestsLine mode="admin" />}
    {/* The screen is titled by the tab that opened it: This week (the default) or Students (?tab=students). */}
    <PageHeader title={thisWeek ? "This week" : "Students"} actions={thisWeek ? undefined : <><WorkspaceLink className="button-secondary" href="/workspace/admin/students/import">Import</WorkspaceLink><Button ref={addButton} variant="primary" disabled={pending || loading || unavailable || conflict} onClick={event => choose(null, event)}>Add student</Button></>} />{!thisWeek && <DocumentTitle heading="Students" />}
    {!sheetOpen && notice}{!sheetOpen && conflict && <button type="button" className="button-secondary admin-pill roster-reload-inline" onClick={() => void load().catch(() => undefined)}>Reload roster</button>}
    {loading ? <p role="status">Loading students…</p> : unavailable ? <div className="admin-state" role="alert"><h2>Students unavailable</h2><p>The full list couldn’t be loaded, so none of it is shown. Access may have changed, or the list may be too large to load at once.</p><button className="button-secondary admin-pill" onClick={() => void load().catch(() => undefined)}>Reload roster</button></div>
      : <>
        {thisWeek && <>
          <ThisWeekCards cards={needsYou} statuses={statuses ?? new Map()} read={statuses !== null} linkRequests={linkRequests} disabled={pending || conflict || editing || !!honorsStudent} onEdit={openDetails} onHonors={openHonors} />
        </>}
        {!thisWeek && <>
        {roster.length > 0 && <div className="roster-tools">
          <label className="roster-search"><span className="sr-only">Find a student</span><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M16 16l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><input type="search" placeholder="Find a student" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} autoComplete="off" /></label>
          <p className="roster-count" aria-live="polite">{query.trim() ? `${matches.length} of ${listed.length} ${listed.length === 1 ? "student" : "students"}` : `${activeCount} ${activeCount === 1 ? "student" : "students"}`}{pageCount > 1 ? ` · page ${page + 1} of ${pageCount}` : ""}</p>
          {disabledCount > 0 && <button type="button" className="button-text roster-show-disabled" data-testid="roster-show-disabled" aria-pressed={showDisabled} onClick={() => { setShowDisabled(value => !value); setPage(0); }}>{showDisabled ? "Hide disabled" : `Show ${disabledCount} disabled`}</button>}
          <button type="button" className="hero-icon roster-reload" aria-label="Reload roster" disabled={pending} onClick={() => void load().catch(() => undefined)}>{reloadIcon}</button>
        </div>}
        {pageRows.length > 0 && <ul className="roster-list" aria-label="Students">{pageRows.map(row => {
          const when = ceremonyCountdown(row.ceremonyDate), slot = slotNames[row.serviceSlot], name = fullName(row);
          const chips = statusChips(row, statuses?.get(row.id)), facts = !row.disabledAt && !row.ceremonyDoneAt && statuses?.get(row.id) ? studentFacts(statuses.get(row.id)!) : [];
          const body = <><span className="roster-row-name"><bdi dir="auto">{name}</bdi>{row.disabledAt && <span className="roster-chip">Disabled</span>}{chips.map(chip => <span key={chip} className="roster-chip" data-status-chip="">{chip}</span>)}</span>
            <span className="roster-row-meta"><time dateTime={row.ceremonyDate}>{when.label}</time>{!row.disabledAt && when.phrase && <span className="roster-row-days">{when.days > 1 ? `${when.days} days` : when.phrase}</span>}<span>{row.studentKind === "adult" ? "Adult" : "Child"}</span>{slot && <span>{slot}</span>}</span>{facts.length > 0 && <span className="roster-row-meta" data-testid="student-facts">{facts.map(line => <span key={line}>{line}</span>)}</span>}</>;
          return <li key={row.id} className={`roster-row${row.disabledAt ? " roster-row-disabled" : ""}`}>
            {row.disabledAt ? <div className="roster-row-main">{body}</div> : <WorkspaceLink className="roster-row-main" href={`/workspace/admin/students/${row.id}/reading`}>{body}</WorkspaceLink>}
            <div className="roster-row-actions">{!row.disabledAt && <button type="button" className="roster-action" aria-label={`Honors for ${name}`} disabled={pending || editing || !!honorsStudent} onClick={event => { honorsOrigin.current = event.currentTarget; setHonorsStudent(row); }}>Honors</button>}<button type="button" className="roster-action" aria-label={`${row.disabledAt ? "Details" : "Edit details"} for ${name}`} disabled={pending || conflict} onClick={event => choose(row, event)}>{row.disabledAt ? "Details" : "Edit"}</button><WorkspaceLink className="roster-action" aria-label={`People for ${name}`} href={`/workspace/admin/students/${row.id}/access`}>People</WorkspaceLink></div>
          </li>;
        })}</ul>}
        {!roster.length ? <div className="admin-empty"><p className="admin-empty-title">No students yet</p><p>Add a student, or import a list from a spreadsheet.</p><button type="button" className="button-text" onClick={() => void load().catch(() => undefined)}>Reload roster</button></div>
          : !listed.length ? <div className="admin-empty"><p className="admin-empty-title">No active students</p><p>Every student here is disabled. Add a student, or show the disabled ones.</p></div>
          : !matches.length && <div className="admin-empty"><p className="admin-empty-title">No student matches “<bdi dir="auto">{query.trim()}</bdi>”</p><p>Check the spelling, or search by first or last name.</p></div>}
        {pageCount > 1 && <nav className="roster-pages" aria-label="Roster pages"><button className="button-secondary admin-pill" disabled={pending || page === 0} onClick={() => setPage(value => value - 1)}>Previous page</button><button className="button-secondary admin-pill" disabled={pending || page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>Next page</button></nav>}
        {doneRows.length > 0 && <section className="roster-ceremony-done" aria-labelledby="roster-ceremony-done-heading" data-testid="ceremony-done-list">
          <h2 id="roster-ceremony-done-heading">Ceremony done</h2>
          <ul className="roster-list">{doneRows.map(row => { const name = fullName(row), when = ceremonyCountdown(row.ceremonyDate);
            return <li key={row.id} className="roster-row"><div className="roster-row-main"><span className="roster-row-name"><bdi dir="auto">{name}</bdi></span><span className="roster-row-meta"><time dateTime={row.ceremonyDate}>{when.label}</time><span>{row.studentKind === "adult" ? "Adult" : "Child"}</span></span></div>
              <div className="roster-row-actions"><button type="button" className="roster-action" data-testid="ceremony-done-undo" aria-label={`Undo Ceremony done for ${name}`} disabled={pending || conflict || editing} onClick={() => void ceremony(row, true)}>Undo</button></div></li>; })}</ul>
        </section>}
        </>}
      </>}
    <dialog ref={sheet} className="roster-sheet" aria-labelledby="roster-editor-title" onFocus={event => { const node = event.target as HTMLElement; if (settled.current && node !== formHeading.current) lastFocus.current = node; }} closedby={pending ? "none" : "closerequest"} onCancel={event => { event.preventDefault(); if (!pending) requestClose(); }} onClose={sheetClosed}>
      <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close student details" disabled={pending} onClick={requestClose}>{icons.close}</button></div>
      {sheetOpen && <section className="roster-editor" aria-labelledby="roster-editor-title">
        <h2 id="roster-editor-title" tabIndex={-1} ref={formHeading}>{current ? <bdi dir="auto">{fullName(current)}</bdi> : "Add a student"}</h2>
        {discarding && <div className="roster-discard" role="group" aria-labelledby="roster-discard-question"><p id="roster-discard-question"><strong>Discard your changes?</strong> They haven’t been saved.</p>
          <div className="form-actions"><button ref={keepEditing} type="button" className="button-primary admin-pill" onClick={keep}>Keep editing</button><button type="button" className="button-secondary admin-pill" onClick={closeEditor}>Discard changes</button></div></div>}
        {notice}{conflict && <button type="button" className="button-secondary admin-pill roster-reload-inline" disabled={pending} onClick={() => void load().catch(() => undefined)}>Reload roster</button>}
        {current?.disabledAt ? <><p>This student is disabled. Their record is kept for reference; editing and reactivation aren’t offered here.</p><dl className="invitation-details"><div><dt>Parent contact</dt><dd><bdi dir="auto">{current.parentEmail ?? "Not supplied"}</bdi></dd></div>{current.ownEmail && <div><dt>Student contact</dt><dd><bdi dir="auto">{current.ownEmail}</bdi></dd></div>}</dl></>
          : <form onSubmit={submit} className="roster-form">
            <div className="roster-form-grid">{input("firstName")}{input("lastName")}</div>
            <fieldset className="roster-choice" disabled={pending || conflict}><legend>Student kind</legend>{(["child", "adult"] as const).map(kind => <label key={kind}><input type="radio" name="studentKind" value={kind} checked={form.studentKind === kind} onChange={() => setForm(previous => ({ ...previous, studentKind: kind }))} />{kind === "child" ? "Child" : "Adult"}</label>)}</fieldset>
            <div className="roster-form-grid">{input("ceremonyDate")}<div className="roster-field"><label htmlFor="roster-serviceSlot">Service (needed to suggest the reading)</label><select id="roster-serviceSlot" value={form.serviceSlot} disabled={pending || conflict} onChange={event => setForm(previous => ({ ...previous, serviceSlot: event.target.value as StudentInput["serviceSlot"] }))}><option value="unknown">Not set yet</option><option value="morning">Morning (10:00)</option><option value="havdalah">Havdalah / afternoon (4:00)</option></select></div></div>
            <div className="roster-form-grid">{rehearsal("rehearsal1")}{rehearsal("rehearsal2")}</div>
            <div className="roster-form-grid">{form.studentKind === "child" ? <>{input("parentEmail")}{input("ownEmail")}</> : <>{input("ownEmail")}{input("parentEmail")}</>}</div>
            <p className="field-help">{form.studentKind === "child" ? "Children need a parent email." : "Adults need their own email."} Saving doesn’t send an invitation or change who can sign in; use People for that.{current ? " Changing the date or service keeps the verses and marks both readings for review." : ""}</p>
            <div className="form-actions"><button className="button-primary admin-pill" disabled={pending || conflict}>{pending ? "Saving…" : "Save student"}</button><button type="button" className="button-secondary admin-pill" disabled={pending} onClick={requestClose}>Cancel</button></div>
          </form>}
        {current && <MavenLinkPanel key={current.id} studentId={current.id} name={fullName(current)} locked={pending || conflict} />}
        {current && !current.disabledAt && !current.ceremonyDoneAt && <div className="disable-student" data-testid="ceremony-done-action">
          {!confirmDone ? <button type="button" className="button-secondary admin-pill" disabled={pending || conflict} onClick={() => { setConfirmDisable(false); setConfirmDone(true); }}>Ceremony done</button>
            : <><p role="status" data-testid="ceremony-done-confirm">{`Mark ${current.firstName}'s ceremony done? ${current.firstName} keeps the account, Learn and Study. Tutors stop seeing ${current.firstName}. You can undo this.`}</p>
              <div className="form-actions"><button type="button" className="button-primary admin-pill" disabled={pending || conflict} onClick={() => void ceremony(current, false)}>Ceremony done</button><button type="button" className="button-secondary admin-pill" disabled={pending} onClick={() => setConfirmDone(false)}>Cancel</button></div></>}
        </div>}
        {current && !current.disabledAt && <div className="disable-student"><h3>Disable this student</h3><p>Stops access to their practice. Their record and history are kept.</p>
          {!confirmDisable ? <button className="button-secondary people-danger" disabled={pending || conflict} onClick={() => { setConfirmDone(false); setConfirmDisable(true); }}>Disable student</button>
            : <><p role="status">Disable <bdi dir="auto">{fullName(current)}</bdi>?</p><p className="field-help" data-testid="disable-warning">This can't be undone here.</p><div className="form-actions"><button className="button-primary admin-pill roster-danger" disabled={pending || conflict} onClick={() => void mutate(true)}>{pending ? "Disabling…" : "Confirm disable"}</button><button className="button-secondary admin-pill" disabled={pending} onClick={() => setConfirmDisable(false)}>Keep student active</button></div></>}
        </div>}
      </section>}
    </dialog>
    {honorsStudent && <HonorsSheet key={honorsStudent.id} studentId={honorsStudent.id} name={fullName(honorsStudent)} mode="admin" onClose={() => { setHonorsStudent(null); honorsOrigin.current?.focus(); }} />}
  </section>;
}
