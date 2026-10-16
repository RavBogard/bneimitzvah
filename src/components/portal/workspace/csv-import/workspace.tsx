"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RequireRole, statusOf, useWorkspace } from "../provider";
import { workspaceApi, type RosterStudent } from "../api";
import { checkCsvSize, CSV_HEADER, csvApi, REVIEW_TTL, type Preview } from "./api";

type Review = { csv: string; allowDuplicates: boolean; value: Preview; expiresAt: number };
type RosterRow = Pick<RosterStudent, "id" | "firstName" | "lastName" | "ceremonyDate" | "disabledAt">;
export function AdminImportWorkspace() { return <RequireRole role="admin"><Import /></RequireRole>; }
function Import() {
  const { registerReload } = useWorkspace();
  const [csv, setCsv] = useState(""), [duplicates, setDuplicates] = useState(false), [review, setReview] = useState<Review | null>(null);
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(true), [roster, setRoster] = useState<RosterRow[] | null>(null), [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState<"unknown" | "conflict" | "denied" | null>(null), [checkedRoster, setCheckedRoster] = useState(false), [receipt, setReceipt] = useState<number | null>(null);
  const alive = useRef(true), gate = useRef(false), generation = useRef(0), draftTurn = useRef(0), request = useRef<AbortController | null>(null), mutation = useRef<Promise<void> | null>(null), heading = useRef<HTMLHeadingElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(), turn = ++generation.current; request.current = controller; setLoading(true);
    try {
      const rows = await workspaceApi.roster(controller.signal); if (!alive.current || controller.signal.aborted || turn !== generation.current) throw new Error("Import roster replaced");
      setRoster(rows.map(({ id, firstName, lastName, ceremonyDate, disabledAt }) => ({ id, firstName, lastName, ceremonyDate, disabledAt })));
    } catch (error) { if (alive.current && !controller.signal.aborted && turn === generation.current) setRoster(null); throw error; }
    finally { if (alive.current && !controller.signal.aborted && turn === generation.current) setLoading(false); }
  }, []);
  useEffect(() => registerReload(async () => {
    draftTurn.current++; setReview(null); setCheckedRoster(false);
    if (mutation.current) await mutation.current; await load();
  }), [registerReload, load]);
  useEffect(() => { alive.current = true; void load().catch(() => undefined); return () => { alive.current = false; draftTurn.current++; generation.current++; request.current?.abort(); }; }, [load]);
  useEffect(() => {
    if (!review?.value.binding) return;
    const timer = setTimeout(() => { draftTurn.current++; setReview(null); setMessage("The import review expired. Preview the current draft again before importing."); }, Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  function changeCsv(value: string) { if (pending || blocked === "unknown") return; draftTurn.current++; setCsv(value); setReview(null); setReceipt(null); }
  async function readFile(file?: File) {
    if (!file || pending || blocked === "unknown") return; const turn = ++draftTurn.current; setReview(null); setMessage("");
    try {
      if (file.size > 1024 * 1024) throw new Error("Size");
      const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); checkCsvSize(value, duplicates);
      if (!alive.current || turn !== draftTurn.current) return; setCsv(value); setReceipt(null);
    } catch { if (alive.current && turn === draftTurn.current) setMessage("Choose a UTF-8 CSV within the 1 MiB file and 2 MiB request limits. The previous draft is retained."); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  }
  async function preview() {
    if (gate.current || blocked || loading || !roster) return;
    gate.current = true; setPending(true); setMessage(""); setReview(null); setReceipt(null);
    const started = Date.now(), turn = ++draftTurn.current, draft = csv, allowDuplicates = duplicates;
    try {
      const value = await csvApi.preview(draft, allowDuplicates);
      if (!alive.current || turn !== draftTurn.current) return;
      if (Date.now() >= started + REVIEW_TTL) { setMessage("The import review expired. Preview the draft again."); return; }
      setReview({ csv: draft, allowDuplicates, value, expiresAt: started + REVIEW_TTL }); queueMicrotask(() => heading.current?.focus());
    } catch (error) {
      if (!alive.current || turn !== draftTurn.current) return;
      const status = statusOf(error);
      if ([401, 403, 404].includes(status)) { setRoster(null); setBlocked("denied"); setMessage("The preview is unavailable or no longer permitted. Check the exact CSV header and your current account access, then reload the roster."); }
      else setMessage(status === 413 ? "The CSV exceeds the 1 MiB file or 2 MiB request limit." : "The CSV could not be reviewed. Check its exact header, quoting, dates and five-column rows, then preview again.");
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }
  function commit() {
    if (gate.current || blocked || !review?.value.canConfirm || !review.value.binding || csv !== review.csv || duplicates !== review.allowDuplicates) return;
    if (Date.now() >= review.expiresAt) { setReview(null); setMessage("The import review expired. Preview the draft again."); return; }
    gate.current = true; setPending(true); setMessage(""); const checked = review; draftTurn.current++;
    const operation = (async () => {
      try {
        const ids = await csvApi.confirm(checked.csv, checked.allowDuplicates, checked.value); if (!alive.current) return;
        setReview(null); setReceipt(ids.length); setCsv(""); setDuplicates(false);
        try { await load(); if (alive.current) setMessage("Import saved. The current student roster has been refreshed."); }
        catch { if (alive.current) { setBlocked("conflict"); setMessage("Import saved. The roster could not be refreshed. Reload it before another import."); } }
      } catch (error) {
        if (!alive.current) return; setReview(null); setCheckedRoster(false);
        const status = statusOf(error);
        if ([401, 403, 404].includes(status)) { setBlocked("denied"); setRoster(null); setMessage("The import review or account access is no longer valid. Reload the roster and prepare a new preview after checking your account."); }
        else if (status === 409 || status === 400 || status === 413) { setBlocked("conflict"); setMessage("This import could not use the reviewed roster or input. Reload the roster and prepare a new preview."); }
        else { setBlocked("unknown"); setMessage("The import outcome is unknown. Do not assume it failed. Reload and inspect the roster before starting another import. No automatic retry will occur."); }
      } finally { gate.current = false; if (alive.current) setPending(false); }
    })(); mutation.current = operation; void operation.finally(() => { if (mutation.current === operation) mutation.current = null; });
  }
  async function reload() {
    if (pending) return; draftTurn.current++; setReview(null); setCheckedRoster(false);
    try { await load(); if (!alive.current) return; if (blocked === "unknown") setCheckedRoster(true); else setBlocked(null); }
    catch { if (alive.current) setMessage("The roster could not be checked. Try reloading it or check account access."); }
  }
  const locked = pending || loading || Boolean(blocked) || !roster;
  return <section className="role-workspace csv-workspace"><h1>Import students</h1><p><Link href="/workspace/admin/students">Student roster</Link> · <Link href="/workspace/admin/invitations">Manage invitations</Link></p>
    <p>Create student records from a CSV. Invitations and assigned-reading confirmation are separate tasks.</p>
    {message && <p className={blocked || !receipt ? "request-error" : "workspace-notice"} role={blocked ? "alert" : "status"}>{message}</p>}
    {receipt !== null && <p role="status">{receipt} student {receipt === 1 ? "record created" : "records created"}. No invitations were sent.</p>}
    <details className="csv-format"><summary>CSV format and limits</summary><p>Use this exact five-column header in this order:</p><code>{CSV_HEADER}</code><p>Every row needs first and last names, a real YYYY-MM-DD ceremony date and parent email. The student email cell may be empty; a supplied student email must differ from the parent email.</p><p>Use UTF-8, up to 500 data rows and 1 MiB. The encoded request must also fit 2 MiB. Quoted commas, doubled quotes and CRLF are supported. No extra columns or automatic header corrections.</p><p>Duplicates compare all five normalized values against existing records, including disabled students, and earlier input rows. Allowing duplicates creates additional records; it does not update, merge or skip them.</p></details>
    <div className="csv-draft"><label htmlFor="csv-file">Choose a CSV file</label><input id="csv-file" type="file" accept=".csv,text/csv" ref={fileInput} disabled={pending || blocked === "unknown"} onChange={event => void readFile(event.target.files?.[0])} />
      <label htmlFor="csv-draft">CSV draft to review</label><textarea id="csv-draft" spellCheck={false} autoComplete="off" disabled={pending} readOnly={blocked === "unknown"} value={csv} onChange={event => changeCsv(event.target.value)} />
      <label className="csv-duplicate-choice"><input type="checkbox" checked={duplicates} disabled={pending || Boolean(blocked)} onChange={event => { draftTurn.current++; setDuplicates(event.target.checked); setReview(null); }} />Allow additional records for exact duplicates</label>
      <button className="button-secondary" disabled={locked || !csv} onClick={() => void preview()}>{pending ? "Checking import…" : "Preview import"}</button>
    </div>
    {review && <section className="csv-review" aria-labelledby="csv-review-heading"><h2 id="csv-review-heading" ref={heading} tabIndex={-1}>Review student import</h2><p>{review.value.validRows} valid {review.value.validRows === 1 ? "row" : "rows"}. {review.value.issues.length} invalid. {review.value.duplicateRows.length} exact duplicates.</p>
      <p>Row numbers count CSV records, including the header; quoted line breaks do not start another record.</p>
      {review.value.issues.length > 0 && <><h3>Fix these rows before importing</h3><ul>{review.value.issues.map(issue => <li key={issue.row}>Row {issue.row}: {issue.code === "invalid-columns" ? "expected five columns" : "invalid name, date or email"}.</li>)}</ul></>}
      {review.value.duplicateRows.length > 0 && <p className="csv-duplicates">Exact duplicate rows: {review.value.duplicateRows.join(", ")}. {review.allowDuplicates ? "You chose to create additional records for these rows." : "Choose the duplicate option only if additional records are intended, then preview again."}</p>}
      {review.value.canConfirm ? <><p>Confirm creation of {review.value.validRows} student records from the exact draft above. This review expires within five minutes; any draft or duplicate-choice change requires another preview.</p><div className="form-actions"><button className="button-primary" disabled={locked} onClick={commit}>Import reviewed students</button><button className="button-secondary" disabled={pending} onClick={() => setReview(null)}>Cancel import review</button></div></> : <p>No rows will be imported until the whole file can be confirmed.</p>}
    </section>}
    <button className="button-text" disabled={pending || loading} onClick={() => void reload()}>Reload roster for import</button>
    {loading ? <p role="status">Checking the current roster…</p> : !roster ? <p role="alert">The roster is unavailable. Check account access or reload.</p> : blocked === "unknown" && checkedRoster && <section className="csv-recovery"><h2>Inspect the current roster</h2><p>Check these records against your CSV before starting a new preview. A new import may create additional records. This list cannot prove which request created a record.</p><ul className="access-records">{roster.map(row => <li key={row.id}><Link href={`/workspace/admin/students/${row.id}/access`}><bdi dir="auto">{row.firstName} {row.lastName}</bdi></Link> · <time>{row.ceremonyDate}</time> · {row.disabledAt ? "Disabled" : "Active"}</li>)}</ul>{!roster.length && <p>The current roster has no student records.</p>}<button className="button-secondary" onClick={() => { setBlocked(null); setCheckedRoster(false); setDuplicates(false); setMessage("Roster inspection acknowledged. A new preview is required; confirm only if another import is intended."); }}>I checked the roster; allow a new preview</button></section>}
    <p className="field-help"><Link href="/">Check account and sign in again</Link></p>
  </section>;
}
