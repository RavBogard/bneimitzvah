"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { workspaceApi, type RosterStudent, type StudentInput } from "./api";
import { RequireRole, statusOf, useWorkspace } from "./provider";
import Link from "next/link";

const empty: StudentInput = { firstName: "", lastName: "", ceremonyDate: "", parentEmail: "", ownEmail: null };
function draft(row: RosterStudent): StudentInput { return { firstName: row.firstName, lastName: row.lastName, ceremonyDate: row.ceremonyDate, parentEmail: row.parentEmail, ownEmail: row.ownEmail }; }
export function AdminWorkspace() { return <RequireRole role="admin"><Roster /></RequireRole>; }
function Roster() {
  const { registerReload } = useWorkspace();
  const [rows, setRows] = useState<RosterStudent[]>([]), [loading, setLoading] = useState(true), [unavailable, setUnavailable] = useState(false);
  const [current, setCurrent] = useState<RosterStudent | null>(null), [form, setForm] = useState<StudentInput>(empty), [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""), [conflict, setConflict] = useState(false), [confirmDisable, setConfirmDisable] = useState(false), [page, setPage] = useState(0);
  const gate = useRef(false), turn = useRef(0), abort = useRef<AbortController | null>(null), formHeading = useRef<HTMLHeadingElement>(null);
  const lifetime = useRef(0), currentRef = useRef(current); currentRef.current = current;
  const load = useCallback(async (preserve = false) => {
    const generation = ++turn.current; abort.current?.abort(); const request = new AbortController(); abort.current = request;
    setUnavailable(false);
    if (!preserve) { setLoading(true); setRows([]); setCurrent(null); setEditing(false); setForm(empty); setConflict(false); setConfirmDisable(false); setMessage(""); }
    try {
      const values = await workspaceApi.roster(request.signal);
      if (generation === turn.current && !request.signal.aborted) {
        setRows(values); if (!preserve) setPage(0);
        const selected = currentRef.current;
        if (preserve && selected) {
          const next = values.find(row => row.id === selected.id);
          if (!next) { setCurrent(null); setEditing(false); setForm(empty); }
          else if (next.disabledAt) { setCurrent(next); setForm(empty); }
          else if (next.revision !== selected.revision) { setConflict(true); setMessage("This student changed while you were away. Your draft is retained but cannot be submitted. Reload the roster to use the current record."); }
        }
      }
    }
    catch (error) { if (generation === turn.current && !request.signal.aborted) { setUnavailable(true); throw error; } }
    finally { if (generation === turn.current && !request.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => registerReload(() => load(true)), [registerReload, load]);
  useEffect(() => { void load().catch(() => undefined); return () => { lifetime.current++; turn.current++; abort.current?.abort(); }; }, [load]);
  function choose(row: RosterStudent | null) {
    setCurrent(row); setForm(row ? draft(row) : empty); setEditing(true); setMessage(""); setConflict(false); setConfirmDisable(false);
    queueMicrotask(() => formHeading.current?.focus());
  }
  async function mutate(disable: boolean) {
    if (gate.current || conflict) return;
    if (!disable && form.ownEmail?.trim().toLowerCase() === form.parentEmail.trim().toLowerCase()) { setMessage("The student’s own email must be different from their parent’s email."); return; }
    gate.current = true; setPending(true); setMessage(""); const generation = lifetime.current;
    try {
      const result = disable && current ? await workspaceApi.disable(current) : await workspaceApi.save(form, current ?? undefined);
      if (generation !== lifetime.current) return;
      const review = "readingNeedsReview" in result && result.readingNeedsReview;
      const saved = disable ? "Student disabled. Their record remains in the roster." : review ? "Student saved. The changed ceremony date means the reading needs review with the tutor or rabbi." : "Student saved. Creating or editing a record does not send an invitation or grant account access.";
      let refreshed = true; try { await load(); } catch { refreshed = false; }
      if (generation === lifetime.current) setMessage(saved + (refreshed ? "" : " The roster could not be refreshed. Reload it to check the current record."));
    } catch (error) {
      if (generation !== lifetime.current) return;
      const status = statusOf(error);
      if (status === 409) { setConflict(true); setMessage("This student changed since you opened the form. Reload the roster before trying again; your draft has not overwritten their record."); }
      else setMessage(status === 401 || status === 403 || status === 404 ? "This change is no longer permitted. Reload the roster to check current access."
        : "The change could not be confirmed. Reload the roster before trying again; do not assume it failed or submit it automatically again.");
      setConflict(true);
    } finally { gate.current = false; setPending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate(false); }
  const pageRows = rows.slice(page * 25, page * 25 + 25);
  return <section className="role-workspace">
    <div className="workspace-heading-row"><h1>Student roster</h1><button className="button-primary" disabled={pending || loading || unavailable} onClick={() => choose(null)}>Add student</button></div>
    <p>Congregation student records and contact details. Account access is managed separately through explicit invitations.</p>
    {message && <p className={conflict ? "request-error" : "workspace-notice"} role={conflict ? "alert" : "status"}>{message}</p>}
    {loading ? <p role="status">Loading the roster…</p> : unavailable ? <div role="alert"><h2>Roster unavailable</h2><p>The complete roster could not be loaded. It may exceed the supported response size, or access may be unavailable. No partial roster is shown.</p><button className="button-secondary" onClick={() => void load().catch(() => undefined)}>Reload roster</button></div>
      : <><div className="roster-scroll"><table className="roster-table"><caption>{rows.length} student records. Showing page {page + 1} of {Math.max(1, Math.ceil(rows.length / 25))}.</caption><thead><tr><th scope="col">Student</th><th scope="col">Ceremony date</th><th scope="col">Status</th></tr></thead>
        <tbody>{pageRows.map(row => <tr key={row.id}><th scope="row"><button className="button-text" disabled={pending} onClick={() => choose(row)}><bdi dir="auto">{row.firstName} {row.lastName}</bdi></button>{!row.disabledAt && <Link className="roster-reading-link" aria-label={`Review reading for ${row.firstName} ${row.lastName}`} href={`/workspace/admin/students/${row.id}/reading`}>Review reading</Link>}</th><td><time dateTime={row.ceremonyDate}>{row.ceremonyDate}</time></td><td>{row.disabledAt ? "Disabled" : "Active"}</td></tr>)}</tbody></table></div>
        {!rows.length && <p>No students have been created yet.</p>}
        {rows.length > 25 && <nav className="roster-pages" aria-label="Roster pages"><button className="button-secondary" disabled={pending || page === 0} onClick={() => setPage(value => value - 1)}>Previous page</button><button className="button-secondary" disabled={pending || (page + 1) * 25 >= rows.length} onClick={() => setPage(value => value + 1)}>Next page</button></nav>}
        <button className="button-text" disabled={pending} onClick={() => void load().catch(() => undefined)}>Reload roster</button>
      </>}
    {editing && !loading && !unavailable && <section className="roster-editor" aria-labelledby="roster-editor-title"><h2 id="roster-editor-title" tabIndex={-1} ref={formHeading}>{current ? "Edit student" : "Add a student"}</h2>
      {current?.disabledAt ? <><p>This student is disabled. Their record is kept for reference; editing and reactivation are not offered here.</p><dl className="invitation-details"><div><dt>Parent contact</dt><dd><bdi dir="auto">{current.parentEmail}</bdi></dd></div>{current.ownEmail && <div><dt>Student contact</dt><dd><bdi dir="auto">{current.ownEmail}</bdi></dd></div>}</dl></>
        : <form onSubmit={submit}><div className="roster-form-grid">{(["firstName", "lastName", "ceremonyDate", "parentEmail", "ownEmail"] as const).map(field => <div key={field}>
          <label htmlFor={`roster-${field}`}>{field === "firstName" ? "First name" : field === "lastName" ? "Last name" : field === "ceremonyDate" ? "Ceremony date" : field === "parentEmail" ? "Parent email" : "Student email (optional)"}</label>
          <input id={`roster-${field}`} name={field} type={field === "ceremonyDate" ? "date" : field.endsWith("Email") ? "email" : "text"} maxLength={field.endsWith("Email") ? 254 : 100} required={field !== "ownEmail"} disabled={pending || conflict}
            value={form[field] ?? ""} onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))} autoComplete="off" />
        </div>)}</div><p className="field-help">A student’s own email must be different from their parent’s. Saving a record does not send an invitation.</p>
          <div className="form-actions"><button className="button-primary" disabled={pending || conflict}>{pending ? "Saving…" : "Save student"}</button><button type="button" className="button-secondary" disabled={pending} onClick={() => { setEditing(false); setCurrent(null); setForm(empty); }}>Cancel edit</button></div>
        </form>}
      {current && !current.disabledAt && <div className="disable-student"><h3>Disable this student</h3><p>Stop access to this student’s practice while retaining their record. This does not delete their history.</p>
        {!confirmDisable ? <button className="button-secondary" disabled={pending || conflict} onClick={() => setConfirmDisable(true)}>Disable student</button>
          : <><p role="status">Confirm that this student should no longer be active.</p><button className="button-primary" disabled={pending || conflict} onClick={() => void mutate(true)}>{pending ? "Disabling…" : "Confirm disable"}</button><button className="button-text" disabled={pending} onClick={() => setConfirmDisable(false)}>Keep student active</button></>}
      </div>}
    </section>}
  </section>;
}
