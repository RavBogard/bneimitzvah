"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { Assigned, BaseMode } from "../api";
import { useWorkspace } from "../provider";
import { ServiceUnitView } from "../../service-learning/unit-view";
import type { ServiceUnitMaterial } from "../../../../lib/service-learning/types";
import { readMyService, readServiceMaterial, serviceRequest, type ConnectedService, type MyService } from "./ecosystem-api";
import styles from "./my-service.module.css";
import { serviceApi, type Catalog } from "./api";

type Draft = Record<string, string>;
export function MyServicePanel({ mode, studentId, baseline }: { mode: BaseMode; studentId: string; baseline: Assigned | null }) {
  const { summary, epoch, registerWork } = useWorkspace(), id = useId();
  const scope = JSON.stringify([summary.sessionBinding, epoch, mode, studentId]), scopeRef = useRef(scope); scopeRef.current = scope;
  const [state, setState] = useState<{ scope: string; view?: MyService; error?: string; busy?: boolean; material?: ServiceUnitMaterial; selected?: string }>({ scope });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}), dirty = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null), region = useRef<HTMLDivElement>(null);
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const staff = mode === "admin" || mode === "tutor";
  const clear = useCallback(() => { generation.current++; controller.current?.abort(); setState({ scope: scopeRef.current });setCatalog(null); }, []);
  const reload = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(), turn = ++generation.current, currentScope = scopeRef.current; controller.current = abort;
    setState(current => ({ ...current, scope: currentScope, busy: true, error: undefined, material: undefined, selected: undefined }));
    try { const view = await readMyService(mode, studentId, abort.signal); if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current) setState({ scope: currentScope, view }); }
    catch { if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current) setState({ scope: currentScope, error: "Your service is unavailable. Try again, or ask your tutor." }); }
  }, [mode, studentId]);
  useLayoutEffect(() => registerWork({ pause: clear, clear: () => { clear(); dirty.current = false; setDrafts({}); }, settle: async () => {}, hasUnsaved: () => dirty.current, reveal: () => region.current?.scrollIntoView({ block: "start" }) }), [registerWork, clear]);
  useLayoutEffect(() => { clear(); setDrafts({}); dirty.current = false; if (baseline) void reload(); return clear; }, [scope, baseline, clear, reload]);
  const current = state.scope === scope ? state : undefined, view = current?.view, linked = view && "parts" in view ? view : undefined;
  function draft(key: string, field: string, value: string) { dirty.current = true; setDrafts(current => ({ ...current, [key]: { ...current[key], [field]: value } })); }
  async function mutate(action: "synchronize" | "assign" | "progress" | "request" | "respond"|"separate", body: Record<string, unknown>, draftKey?: string) {
    const currentScope = scopeRef.current; setState(current => ({ ...current, busy: true, error: undefined }));
    try {
      await serviceRequest(mode, studentId, action, body);
      if (currentScope !== scopeRef.current) return;
      if (draftKey) setDrafts(current => { const next = { ...current }; delete next[draftKey]; dirty.current = Boolean(Object.keys(next).length); return next; });
      await reload();
    } catch { if (currentScope === scopeRef.current) setState(current => ({ ...current, busy: false, error: action === "respond" ? "The request is still pending. Make and approve the change in Music, then refresh before accepting." : "That change could not be saved. Your draft is here; refresh and try again." })); }
  }
  async function openMaterial(rowId: string) {
    controller.current?.abort(); const abort = new AbortController(), turn = ++generation.current, currentScope = scopeRef.current; controller.current = abort;
    setState(current => ({ ...current, selected: rowId, material: undefined, busy: true, error: undefined }));
    try { const material = await readServiceMaterial(mode, studentId, rowId, abort.signal); if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current) setState(current => ({ ...current, material, busy: false })); }
    catch { if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current) setState(current => ({ ...current, busy: false, error: "This part’s approved text is unavailable. Ask your tutor to check its source." })); }
  }
  async function openResource(rowId: string, resourceId: string) {
    const currentScope = scopeRef.current; setState(current => ({ ...current, busy: true, error: undefined }));
    try {
      const result = await serviceRequest(mode, studentId, "resource", { rowId, resourceId });
      if (currentScope !== scopeRef.current || !result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string") return;
      const url = new URL(result.url); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Unavailable resource");
      window.open(url.href, "_blank", "noopener,noreferrer"); setState(current => ({ ...current, busy: false }));
    } catch { if (currentScope === scopeRef.current) setState(current => ({ ...current, busy: false, error: "This resource is no longer available. Ask your tutor to review it." })); }
  }
  function part(row: ConnectedService["rows"][number], full = false) {
    const assigned = linked?.parts.find(part => part.rowId === row.rowId), key = `part-${row.rowId}`, requestKey = `request-${row.rowId}`;
    const selectedUnit=drafts[key]?.catalogUnitId??assigned?.catalogUnitId??"";
    return <li key={row.rowId} className={styles.part}>
      <div className={styles.partHeading}><h4>{row.title}</h4>{assigned?.leads && full && <span>You lead</span>}</div>
      {row.biblicalRef && <p>{row.biblicalRef}{row.edition ? ` · ${row.edition}` : ""}</p>}
      {!row.arrangementResolved && <p className={styles.note}>Your tutor will confirm the melody.</p>}
      {row.sharedDirections && <p className={styles.directions}>{row.sharedDirections}</p>}
      {assigned?.directions && <p className={styles.directions}>{assigned.directions}</p>}
      {assigned?.privateFeedback && <p className={styles.directions}><strong>Feedback for you:</strong> {assigned.privateFeedback}</p>}
      {assigned?.resourceNeedsReview && <p className="reading-review">This part changed. Your tutor needs to review the practice resources.</p>}
      <div className={styles.actions}>
        {row.catalogUnitId && <button type="button" className="button-secondary" disabled={current?.busy} onClick={() => void openMaterial(row.rowId)}>Read {row.title}</button>}
        {!assigned?.resourceNeedsReview && row.resources.map(resource => <button key={resource.resourceId} type="button" className="button-secondary" disabled={current?.busy} onClick={() => void openResource(row.rowId, resource.resourceId)}>{resource.kind === "score" ? "Score" : "Listen"}: {resource.label}</button>)}
        {row.liturgyRef && <a className="button-text" href={`https://siddur.centralreform.org/?${new URLSearchParams({book:row.liturgyRef.book,p:String(row.liturgyRef.folio),...(row.liturgyRef.serviceViewId?{service:row.liturgyRef.serviceViewId}:{})})}`} target="_blank" rel="noreferrer">Open in Siddur</a>}
      </div>
      {mode === "student" && assigned?.leads && <label className={styles.progress}>My progress<select aria-label={`Progress for ${row.title}`} value={assigned.progress} disabled={current?.busy} onChange={event => void mutate("progress", { rowId: row.rowId, expectedRevision: assigned.revision, progress: event.target.value })}><option value="not-started">Not started</option><option value="practicing">Practicing</option><option value="ready">Ready</option></select></label>}
      {!staff && <details><summary>Ask about this part</summary><form onSubmit={event => { event.preventDefault(); void mutate("request", { rowId: row.rowId, message: drafts[requestKey]?.message ?? "" }, requestKey); }}><label>What would you like to change?<textarea maxLength={2000} required value={drafts[requestKey]?.message ?? ""} onChange={event => draft(requestKey, "message", event.target.value)} /></label><button className="button-primary" disabled={current?.busy}>Send request</button></form></details>}
      {staff && <details onToggle={event=>{if(event.currentTarget.open && !catalog){const selectedScope=scopeRef.current;void serviceApi.catalog(mode as "admin"|"tutor",studentId,new AbortController().signal).then(value=>{if(selectedScope===scopeRef.current)setCatalog(value);}).catch(()=>undefined);}}}><summary>{assigned?.leads ? "Edit this student’s part" : "Assign this part"}</summary><form onSubmit={event => { event.preventDefault(); void mutate("assign", { rowId: row.rowId, expectedRevision: assigned?.revision ?? 0, expectedStudentRevision:baseline?.student.revision,sourceRevision:linked?.sourceRevision,
        leads: drafts[key]?.leads === undefined ? assigned?.leads ?? true : drafts[key].leads === "true", directions: drafts[key]?.directions ?? assigned?.directions ?? "", privateFeedback: drafts[key]?.privateFeedback ?? assigned?.privateFeedback ?? "",
        ...(selectedUnit && catalog?.state==="available"?{material:{catalogId:catalog.catalogId,catalogIdentity:catalog.catalogIdentity,unitId:selectedUnit}}:selectedUnit?{}:{material:null}) }, key); }}>
        <label className={styles.checkbox}><input type="checkbox" checked={drafts[key]?.leads === undefined ? assigned?.leads ?? true : drafts[key].leads === "true"} onChange={event => draft(key, "leads", String(event.target.checked))} />This student leads</label>
        <label>Approved prayer text<select value={selectedUnit} onChange={event=>draft(key,"catalogUnitId",event.target.value)} disabled={catalog?.state!=="available"}><option value="">Text not yet assigned</option>{catalog?.state==="available"&&catalog.units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        {catalog && catalog.state!=="available"&&<p>The approved text catalog is unavailable. Directions can still be saved.</p>}
        <label>Directions for this student<textarea maxLength={4000} value={drafts[key]?.directions ?? assigned?.directions ?? ""} onChange={event => draft(key, "directions", event.target.value)} /></label>
        <label>Private feedback for the student<textarea maxLength={4000} value={drafts[key]?.privateFeedback ?? assigned?.privateFeedback ?? ""} onChange={event => draft(key, "privateFeedback", event.target.value)} /></label>
        <button className="button-primary" disabled={current?.busy}>Save student’s part</button>
      </form></details>}
      {current?.selected === row.rowId && current.material && <ServiceUnitView material={current.material} />}
    </li>;
  }
  if (view?.state === "unscheduled") return null;
  return <div className={styles.service} ref={region} aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>My service</h3>
    {view && "ceremony" in view && <p className={styles.ceremony}>{new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${view.ceremony.date}T12:00:00Z`))} · {view.ceremony.type === "morning" ? "Morning service" : view.ceremony.type === "havdalah" ? "Havdalah service" : "Service time to be confirmed"}</p>}
    {view && "ceremony" in view && view.ceremony.needsReconciliation && <p className="reading-review">Your ceremony schedule changed. Your tutor will reconcile the connected service; your practice progress is saved.</p>}
    {view && "ceremony" in view && view.ceremony.scheduleConflict && <p className="reading-review">Students sharing this ceremony have different schedules. Staff need to reconcile the joint ceremony before its setlist schedule can change.</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.busy && <p role="status">Updating your service…</p>}
    {!view && !current?.busy && <button type="button" className="button-secondary" onClick={() => void reload()}>Load my service</button>}
    {view && view.state !== "linked" && <p>{view.state === "ambiguous" ? "More than one service matches. Your tutor will connect the right one." : view.state === "review_required" ? "Your service is connected. Your tutor is reviewing the parts and resources." : "Your service connection is queued and retries automatically. The daily fallback may take until tomorrow; your roster and practice work are saved."}</p>}
    {linked && <>
      <h3>Parts I lead</h3>
      {linked.parts.some(p => p.leads && !p.unresolved) ? <ol className={styles.parts}>{linked.rows.filter(row => linked.parts.some(p => p.rowId === row.rowId && p.leads)).map(row => part(row))}</ol> : <p>Your tutor will help you choose the parts you lead.</p>}
      {linked.parts.filter(p => p.unresolved).map(p => <p key={p.rowId} className="reading-review">An assigned part was removed from the service. Your progress is saved; ask your tutor about its replacement.</p>)}
      {linked.previousWork.length>0&&<details><summary>Previous service work · needs review</summary><p>Assignments and progress from the previous service are saved for review with your tutor.</p><ul>{linked.previousWork.map(work=><li key={work.id}>Previous part · {work.progress==="ready"?"Ready":work.progress==="practicing"?"Practicing":"Not started"}</li>)}</ul></details>}
      <details className={styles.order}><summary>Full order of service</summary><ol className={styles.parts}>{linked.rows.map(row => part(row, true))}</ol></details>
      {linked.requests.length > 0 && <details className={styles.order}><summary>Part requests ({linked.requests.filter(r => r.state === "pending").length} pending)</summary><ul className={styles.parts}>{linked.requests.map(request => { const key = `response-${request.id}`; return <li key={request.id} className={styles.part}><strong>{linked.rows.find(row => row.rowId === request.rowId)?.title ?? "Removed service part"}</strong><p>{request.message}</p><p>{request.state === "pending" ? "Waiting for staff" : request.state === "accepted" ? "Accepted" : "Declined"}{request.response ? ` · ${request.response}` : ""}</p>{staff && request.state === "pending" && <form onSubmit={event => { event.preventDefault(); void mutate("respond", { requestId: request.id, expectedRevision: request.revision, state: "accepted", response: drafts[key]?.response ?? "" }, key); }}><label>Response<textarea maxLength={2000} value={drafts[key]?.response ?? ""} onChange={event => draft(key, "response", event.target.value)} /></label><p className={styles.note}>Make and approve musical changes in Music first. Refresh here, then accept.</p><div className={styles.actions}><button className="button-primary" disabled={current?.busy}>Verify change and accept</button><button type="button" className="button-secondary" disabled={current?.busy} onClick={() => void mutate("respond", { requestId: request.id, expectedRevision: request.revision, state: "declined", response: drafts[key]?.response ?? "" }, key)}>Decline with response</button></div></form>}</li>; })}</ul></details>}
    </>}
    {staff && view && "ceremony" in view && <div className={styles.staff}>
      <div className={styles.actions}><button type="button" className="button-secondary" disabled={current?.busy} onClick={() => void mutate("synchronize", {})}>{view.state === "linked" ? "Refresh from Music" : "Retry service connection"}</button>{"operatorLinks" in view && view.operatorLinks && <><a className="button-text" href={view.operatorLinks.music} target="_blank" rel="noreferrer">Open in Music</a>{view.operatorLinks.review && <a className="button-text" href={view.operatorLinks.review} target="_blank" rel="noreferrer">Review shared parts and permissions</a>}</>}</div>
      {view.ceremony.scheduleConflict&&<details><summary>Resolve the joint ceremony schedule</summary><p>If the students are moving together, align their dates and service times in the roster. If this student is moving alone, move only this student to a separate service; the other students and their setlist stay in place.</p><div className={styles.actions}><a className="button-text" href="/workspace/admin/students">Edit roster schedules</a><button type="button" className="button-secondary" disabled={current?.busy} onClick={()=>void mutate("separate",{expectedCeremonyRevision:view.ceremony.revision})}>Move to a separate service</button></div></details>}
      {"candidates" in view && view.candidates && view.candidates.length > 0 && <form onSubmit={event => { event.preventDefault(); void mutate("synchronize", { explicitSetlistId: drafts.connection?.setlistId ?? view.candidates![0] }, "connection"); }}><label>Choose the ceremony’s setlist<select value={drafts.connection?.setlistId ?? view.candidates[0]} onChange={event => draft("connection", "setlistId", event.target.value)}>{view.candidates.map(candidate => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label><button className="button-primary" disabled={current?.busy}>Connect this setlist</button></form>}
      {"setlistId" in view&&view.setlistId&&<p><a className="button-text" href={`https://overlays.centralreform.org/services?${new URLSearchParams({setlistId:view.setlistId})}`} target="_blank" rel="noreferrer">Prepare or refresh overlays</a></p>}
      <p className={styles.note}>Review the overlay import’s changes, keep operator edits, and use explicit display names before preparing the display.</p>
    </div>}
  </div>;
}
