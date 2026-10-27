"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RequireRole, statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { workspaceApi, type RosterStudent } from "../api";
import { checkCsvSize, CSV_HEADER, CSV_ADULT_HEADER, CSV_FULL_HEADER, CSV_FULL_ADULT_HEADER, csvApi, REVIEW_TTL, type Preview } from "./api";
import { CSV_TEMPLATE, dataRowNumbers, draftProblem, rowHints, rowList, sameNameAndDateRows, splitDraft } from "./hints";
import { PortalRequestError } from "../../api";
import { Button, PageHeader } from "../../../ui";

type Review = { csv: string; allowDuplicates: boolean; value: Preview; expiresAt: number };
type RosterRow = Pick<RosterStudent, "id" | "firstName" | "lastName" | "ceremonyDate" | "disabledAt">;
/** The rows a review found ready to import: every data row that is neither refused nor, unless allowed, a duplicate. Null when the
 *  draft and the server's counts disagree, so nothing partial is offered on a mismatch. */
function readyRows(review: Review): Set<number> | null {
  const { issues, duplicateRows, validRows } = review.value, skip = new Set([...issues.map(issue => issue.row), ...(review.allowDuplicates ? [] : duplicateRows)]);
  const rows = new Set(dataRowNumbers(review.csv).filter(row => !skip.has(row)));
  return rows.size === validRows - (review.allowDuplicates ? 0 : duplicateRows.length) ? rows : null;
}
export function AdminImportWorkspace() { return <RequireRole role="admin"><Import /></RequireRole>; }
function Import() {
  const { registerReload } = useWorkspace();
  const [csv, setCsv] = useState(""), [duplicates, setDuplicates] = useState(false), [review, setReview] = useState<Review | null>(null);
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(true), [roster, setRoster] = useState<RosterRow[] | null>(null), [message, setMessageText] = useState(""), [messageKind, setMessageKind] = useState("");
  const setMessage = useCallback((text: string, kind = "") => { setMessageText(text); setMessageKind(kind); }, []);
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
    const timer = setTimeout(() => { draftTurn.current++; setReview(null); setMessage("The import review expired. Preview the current draft again before importing.", "expired"); }, Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  function changeCsv(value: string) { if (pending || blocked === "unknown") return; draftTurn.current++; setCsv(value); setReview(null); setReceipt(null); }
  async function readFile(file?: File) {
    if (!file || pending || blocked === "unknown") return; const turn = ++draftTurn.current; setReview(null); setMessage("");
    try {
      if (file.size > 1024 * 1024) throw new Error("Size");
      const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); checkCsvSize(value, duplicates);
      if (!alive.current || turn !== draftTurn.current) return; setCsv(value); setReceipt(null);
    } catch { if (alive.current && turn === draftTurn.current) setMessage("That file couldn’t be read. Save the spreadsheet as CSV (UTF-8) and choose it again. Your list here hasn’t changed."); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  }
  async function preview() {
    if (gate.current || blocked || loading || !roster) return;
    // A draft that can't be read at all is explained here; nothing is sent.
    const problem = draftProblem(csv); if (problem) { setReview(null); setReceipt(null); setMessage(problem); return; }
    gate.current = true; setPending(true); setMessage(""); setReview(null); setReceipt(null);
    const started = Date.now(), turn = ++draftTurn.current, draft = csv, allowDuplicates = duplicates;
    try {
      const value = await csvApi.preview(draft, allowDuplicates);
      if (!alive.current || turn !== draftTurn.current) return;
      if (Date.now() >= started + REVIEW_TTL) { setMessage("The import review expired. Preview the draft again.", "expired"); return; }
      setReview({ csv: draft, allowDuplicates, value, expiresAt: started + REVIEW_TTL }); queueMicrotask(() => heading.current?.focus());
    } catch (error) {
      if (!alive.current || turn !== draftTurn.current) return;
      const status = statusOf(error);
      if ([401, 403, 404].includes(status)) { setRoster(null); setBlocked("denied"); setMessage("The preview isn’t available to this account any more. Check your account, then reload the roster."); }
      else setMessage(status === 413 ? "This list is too large to import at once. Split it into files of up to 500 students and import each one." : "The list couldn’t be checked just now. Nothing was imported. Preview it again.");
    } finally { gate.current = false; if (alive.current) setPending(false); }
  }
  function commit() {
    if (gate.current || blocked || !review?.value.canConfirm || !review.value.binding || csv !== review.csv || duplicates !== review.allowDuplicates) return;
    if (Date.now() >= review.expiresAt) { setReview(null); setMessage("The import review expired. Preview the draft again.", "expired"); return; }
    const checked = review;
    run(async () => ({ ids: await csvApi.confirm(checked.csv, checked.allowDuplicates, checked.value), rest: "" }));
  }
  /** G21: imports only the ready rows of a review that has rows to fix. They are previewed again on their own, so the server checks
   *  exactly what is imported; the rows to fix stay in the draft. */
  function importReady() {
    if (gate.current || blocked || !review || review.value.canConfirm || csv !== review.csv || duplicates !== review.allowDuplicates) return;
    if (Date.now() >= review.expiresAt) { setReview(null); setMessage("The import review expired. Preview the draft again.", "expired"); return; }
    const rows = readyRows(review), parts = rows && rows.size ? splitDraft(review.csv, rows) : null, allowDuplicates = review.allowDuplicates;
    if (!parts || parts.readyCount !== rows?.size) return;
    run(async () => {
      let checked: Preview;
      // A failed check saves nothing, so it reads as a changed list rather than an unknown outcome.
      try { checked = await csvApi.preview(parts.ready, allowDuplicates); } catch (error) { throw [401, 403, 404].includes(statusOf(error)) ? error : new PortalRequestError(409); }
      if (!checked.canConfirm || checked.validRows !== parts.readyCount) throw new PortalRequestError(409);
      return { ids: await csvApi.confirm(parts.ready, allowDuplicates, checked), rest: parts.rest };
    });
  }
  function run(save: () => Promise<{ ids: string[]; rest: string }>) {
    gate.current = true; setPending(true); setMessage(""); draftTurn.current++;
    const operation = (async () => {
      try {
        const { ids, rest } = await save(); if (!alive.current) return;
        setReview(null); setReceipt(ids.length); setCsv(rest); setDuplicates(false);
        try { await load(); if (alive.current) setMessage(rest ? "Import saved. The rows still to fix are left in the list. Fix them, then preview again." : "Import saved. The student list is up to date."); }
        catch { if (alive.current) { setBlocked("conflict"); setMessage("Import saved, but the student list couldn’t be refreshed. Reload it before importing again."); } }
      } catch (error) {
        if (!alive.current) return; setReview(null); setCheckedRoster(false);
        const status = statusOf(error);
        if ([401, 403, 404].includes(status)) { setBlocked("denied"); setRoster(null); setMessage("The import review or account access is no longer valid. Reload the roster and prepare a new preview after checking your account."); }
        else if (status === 409 || status === 400 || status === 413) { setBlocked("conflict"); setMessage("The student list changed after this review, so nothing was imported. Reload the roster and preview again.", "changed"); }
        else { setBlocked("unknown"); setMessage("We couldn’t confirm whether this import saved, so the import outcome is unknown. It may have saved. Check what saved before importing again; nothing will be sent twice automatically.", "unknown"); }
      } finally { gate.current = false; if (alive.current) setPending(false); }
    })(); mutation.current = operation; void operation.finally(() => { if (mutation.current === operation) mutation.current = null; });
  }
  async function reload() {
    if (pending) return; draftTurn.current++; setReview(null); setCheckedRoster(false);
    try { await load(); if (!alive.current) return; if (blocked === "unknown") setCheckedRoster(true); else setBlocked(null); }
    catch { if (alive.current) setMessage("The roster could not be checked. Try reloading it or check account access."); }
  }
  const locked = pending || loading || Boolean(blocked) || !roster, hints = review ? rowHints(review.csv) : new Map<number, string>();
  const ready = review && !review.value.canConfirm ? readyRows(review) : null;
  const sameName = review && roster ? sameNameAndDateRows(review.csv, roster, new Set([...review.value.issues.map(issue => issue.row), ...review.value.duplicateRows])) : [];
  const issueText = (issue: Preview["issues"][number]) => { const text = hints.get(issue.row) ?? (issue.code === "invalid-columns" ? "the number of columns doesn’t match the column names. Check for a missing or extra comma." : "check this row against the template."); return text.charAt(0).toLocaleUpperCase() + text.slice(1); };
  return <section className="role-workspace csv-workspace admin-workspace"><div className="admin-crumbs"><WorkspaceLink href="/workspace/admin/students?tab=students">All students</WorkspaceLink></div>
    <PageHeader title="Import students" description="Add many students at once from a spreadsheet. Importing sends nothing: nobody is invited or given access, and no reading or tutor is assigned." />
    {message && <p data-testid="csv-message" data-message-kind={messageKind} className={blocked || !receipt ? "request-error" : "workspace-notice"} role={blocked ? "alert" : "status"}>{message}</p>}
    {blocked === "unknown" && !checkedRoster && <Button variant="primary" disabled={pending || loading} onClick={() => void reload()}>Check what saved</Button>}
    {receipt !== null && <p role="status" data-testid="csv-receipt" data-created={receipt}>{receipt} student {receipt === 1 ? "record created" : "records created"}. No invitations were sent.</p>}
    <div className="csv-draft people-card"><h2 className="csv-step"><span aria-hidden="true">1</span>Add your list</h2>
      <p>Start from the template: keep its first line and put one student on each line below it. Every student needs a kind (child or adult), first and last name and ceremony date (<span className="csv-nowrap">YYYY-MM-DD</span>). A child needs a parent email; an adult needs their own. Other columns can stay empty. Save it as CSV (UTF-8).</p>
      <a className="button-secondary csv-template" href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="students-template.csv">Download the template</a>
      <label htmlFor="csv-file">Choose a CSV file</label><input id="csv-file" type="file" accept=".csv,text/csv" ref={fileInput} disabled={pending || blocked === "unknown"} onChange={event => void readFile(event.target.files?.[0])} />
      <label htmlFor="csv-draft">CSV draft to review</label><p className="field-help">The file appears here. You can also paste the rows.</p><textarea id="csv-draft" spellCheck={false} autoComplete="off" disabled={pending} readOnly={blocked === "unknown"} value={csv} onChange={event => changeCsv(event.target.value)} />
      <label className="csv-duplicate-choice"><input type="checkbox" checked={duplicates} disabled={pending || Boolean(blocked)} onChange={event => { draftTurn.current++; setDuplicates(event.target.checked); setReview(null); }} />Allow additional records for exact duplicates</label>
      <Button variant="primary" disabled={locked || !csv} onClick={() => void preview()}>{pending ? "Checking import…" : "Preview import"}</Button>
    </div>
    <details className="csv-format"><summary>Advanced: other column layouts and limits</summary><p>The template above is the full layout. These shorter layouts also work.</p><p>Legacy format (v1) creates child records. Use this exact five-column header:</p><code>{CSV_HEADER}</code><p>Every row needs first and last names, a real YYYY-MM-DD ceremony date and parent email. The student email cell may be empty; a supplied student email must differ from either parent email.</p><p>Extended format (v2) supports child and adult records:</p><code>{CSV_ADULT_HEADER}</code><p>Set studentKind to child or adult explicitly. Children require parent email; adults require student email and may leave parent email empty. Supplied emails must be valid. Changing kind never changes linked account access.</p><p>Full intake format adds service slot, pending contacts and administrative details:</p><code>{CSV_FULL_HEADER}</code><p>For explicit child or adult kind, use:</p><code>{CSV_FULL_ADULT_HEADER}</code><p>Set service_slot to morning, havdalah or unknown. Tutor names match existing eligible tutors only; matches remain pending proposals. Parashah is a display label, not a reading assignment. Names, phone and notes stay in administrative intake.</p><p>Use UTF-8, up to 500 data rows and 1 MiB. The encoded request must also fit 2 MiB. Quoted commas, doubled quotes and line breaks in notes are supported. No extra columns or automatic header corrections.</p><p>Duplicates compare student kind and all five normalized values against existing records, including disabled students, and earlier input rows. Allowing duplicates creates additional records; it does not update, merge or skip them.</p></details>
    {review && <section className="csv-review people-card" aria-labelledby="csv-review-heading"><h2 id="csv-review-heading" className="csv-step" ref={heading} tabIndex={-1}><span aria-hidden="true">2</span>Review student import</h2><p>{review.value.validRows} {review.value.validRows === 1 ? "row" : "rows"} ready. {review.value.issues.length} to fix. {review.value.duplicateRows.length} already on the roster or repeated.</p>
      <p className="field-help">Row numbers match the spreadsheet: the column names are row 1.</p>
      {review.value.issues.length > 0 && <><h3 id="csv-issues-heading">Fix these rows before importing</h3><table className="csv-issues" aria-labelledby="csv-issues-heading" data-testid="csv-issues">
        <thead><tr><th scope="col">Row</th><th scope="col">What to check</th></tr></thead>
        <tbody>{review.value.issues.map(issue => <tr key={issue.row}><th scope="row">{issue.row}</th><td>{issueText(issue)}</td></tr>)}</tbody></table></>}
      {sameName.length > 0 && <p className="csv-same-name" data-testid="csv-same-name">{rowList(sameName)} {sameName.length === 1 ? "has" : "have"} the same name and ceremony date as a student already on the roster or earlier in this file. {sameName.length === 1 ? "Check that it is a different student" : "Check that they are different students"} before importing.</p>}
      {review.value.tutorMatches && <><h3>Pending tutor proposals</h3>{(["matched","unmatched","ambiguous"] as const).map(status=>{const rows=review.value.tutorMatches!.filter(match=>match.status===status).map(match=>match.row);return <p key={status}>{status==="matched"?"Matched existing tutors":status==="unmatched"?"Unmatched tutor names":"Ambiguous tutor names"}: {rows.length?`rows ${rows.join(", ")}`:"none"}.</p>;})}<p>These are proposals only. No tutor is assigned and no account access is created by this import.</p></>}
      {!!review.value.missingSecondParentRows?.length && <p>Second parent name or email is missing in rows {review.value.missingSecondParentRows.join(", ")}. Records can be imported; contact details alone grant no guardian access.</p>}
      {review.value.duplicateRows.length > 0 && <p className="csv-duplicates" data-testid="csv-duplicates" data-rows={review.value.duplicateRows.join(",")}>Already on the roster or earlier in this file: rows {review.value.duplicateRows.join(", ")}. Importing them creates a second record; nothing is merged or updated. {review.allowDuplicates ? "You chose to create these additional records." : "Remove them from the list, or choose “Allow additional records for exact duplicates” and preview again if a second record is intended."}</p>}
      {review.value.canConfirm ? <><p>This creates {review.value.validRows} student {review.value.validRows === 1 ? "record" : "records"} from the list above. Nothing is sent. Changing the list means previewing again, and this review lasts five minutes.</p><div className="form-actions"><Button variant="primary" disabled={locked} onClick={commit}>Import reviewed students</Button><Button disabled={pending} onClick={() => setReview(null)}>Cancel import review</Button></div></>
        : ready && ready.size > 0 ? <><p>Import the ready rows now and the rows to fix stay in the list, or fix every row and preview again. Nothing is sent, and this review lasts five minutes.</p>
          <div className="form-actions"><Button variant="primary" disabled={locked} onClick={importReady} data-testid="csv-import-ready">{`Import the ${ready.size} ready ${ready.size === 1 ? "row" : "rows"}`}</Button><Button disabled={pending} onClick={() => setReview(null)}>Cancel import review</Button></div></>
        : <p>Nothing is imported until every row is ready. Fix the rows above in your spreadsheet or here, then preview again.</p>}
    </section>}
    <Button variant="quiet" disabled={pending || loading} onClick={() => void reload()}>Reload roster for import</Button>
    {loading ? <p role="status" data-testid="csv-roster-loading">Checking the current roster…</p> : !roster ? <p role="alert">The roster is unavailable. Check account access or reload.</p> : blocked === "unknown" && checkedRoster && <section className="csv-recovery" data-testid="csv-recovery"><h2>Inspect the current roster</h2><p>Check these records against your CSV before starting a new preview. A new import may create additional records. This list cannot prove which request created a record.</p><ul className="access-records">{roster.map(row => <li key={row.id}><Link href={`/workspace/admin/students/${row.id}/access`}><bdi dir="auto">{row.firstName} {row.lastName}</bdi></Link> · <time>{row.ceremonyDate}</time> · {row.disabledAt ? "Disabled" : "Active"}</li>)}</ul>{!roster.length && <p>The current roster has no student records.</p>}<Button onClick={() => { setBlocked(null); setCheckedRoster(false); setDuplicates(false); setMessage("Roster inspection acknowledged. A new preview is required; confirm only if another import is intended."); }}>I checked the roster; allow a new preview</Button></section>}
    <p className="field-help"><Link href="/">Check account and sign in again</Link></p>
  </section>;
}
