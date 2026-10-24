"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { Assigned,ReadingMode } from "../api";
import { useWorkspace } from "../provider";
import { ServiceUnitView } from "../../service-learning/unit-view";
import type { ServiceUnitMaterial } from "../../../../lib/service-learning/types";
import { type ConnectedService, type MyService } from "./ecosystem-api";
import styles from "./my-service.module.css";
import { serviceApi, type Catalog } from "./api";
import { PortalRequestError } from "../../api";
import { serviceSlotLine } from "../service-slot";
import { useCongregation } from "../settings/links";
import { siddurPageLink } from "../../../../lib/siddur/link";

type Draft = Record<string, string>;
export function MyServicePanel({ mode, studentId, baseline,onConnected }: { mode:ReadingMode; studentId: string; baseline: Assigned | null;onConnected?(connected:boolean):void }) {
  const { summary, epoch,context,registerWork,readMyService,readMyServiceMaterial,requestMyService } = useWorkspace(), id = useId();
  const scope = JSON.stringify([summary.sessionBinding, epoch, mode, studentId,context?.id]), scopeRef = useRef(scope); scopeRef.current = scope;
  const [state, setState] = useState<{ scope: string; view?: MyService; error?: string; busy?: boolean; material?: ServiceUnitMaterial; selected?: string;resourceLink?:{url:string;expiresAt:string} }>({ scope });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}), dirty = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null), region = useRef<HTMLDivElement>(null);
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const staff = mode === "admin" || mode === "tutor";
  const congregation = useCongregation(Boolean(baseline));
  const clear = useCallback(() => { generation.current++; controller.current?.abort(); setState({ scope: scopeRef.current });setCatalog(null); }, []);
  const reload = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(), turn = ++generation.current, currentScope = scopeRef.current; controller.current = abort;
    setState(current => ({ ...current, scope: currentScope, busy: true, error: undefined, material: undefined, selected: undefined }));
    try { const view = await readMyService(mode, studentId, abort.signal); if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current) setState({ scope: currentScope, view }); }
    catch { if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current) setState({ scope: currentScope, error: "Your service is unavailable. Try again, or ask your tutor." }); }
  }, [mode, studentId,readMyService]);
  useLayoutEffect(() => registerWork({ pause: clear, clear: () => { clear(); dirty.current = false; setDrafts({}); }, settle: async () => {}, hasUnsaved: () => dirty.current, reveal: () => region.current?.scrollIntoView({ block: "start" }) }), [registerWork, clear]);
  useLayoutEffect(() => { clear(); setDrafts({}); dirty.current = false; if (baseline) void reload(); return clear; }, [scope, baseline, clear, reload]);
  const current = state.scope === scope ? state : undefined, view = current?.view, linked = view && "parts" in view ? view : undefined;
  const connected=Boolean(view&&"ceremony"in view);useLayoutEffect(()=>{onConnected?.(connected);},[onConnected,connected]);
  function draft(key: string, field: string, value: string) { dirty.current = true; setDrafts(current => ({ ...current, [key]: { ...current[key], [field]: value } })); }
  function fail(error:unknown,message:string){
    if(error instanceof PortalRequestError && [401,403,404].includes(error.status)){dirty.current=false;setDrafts({});setState({scope:scopeRef.current,error:"This service is no longer available in this view."});}
    else setState(current=>({...current,busy:false,error:message}));
  }
  async function mutate(action: "synchronize" | "assign" | "progress" | "request" | "respond"|"separate"|"resolve-original", body: Record<string, unknown>, draftKey?: string) {
    const currentScope = scopeRef.current; setState(current => ({ ...current, busy: true, error: undefined }));
    try {
      await requestMyService(mode,studentId,action,body,new AbortController().signal);
      if (currentScope !== scopeRef.current) return;
      if (draftKey) setDrafts(current => { const next = { ...current }; delete next[draftKey]; dirty.current = Boolean(Object.keys(next).length); return next; });
      await reload();
    } catch(error) { if (currentScope === scopeRef.current)fail(error,action === "respond" ? "The request is still pending. Make and approve the change in Music, then refresh before accepting." : "That change could not be saved. Your draft is here; refresh and try again."); }
  }
  async function openMaterial(rowId: string) {
    controller.current?.abort(); const abort = new AbortController(), turn = ++generation.current, currentScope = scopeRef.current; controller.current = abort;
    setState(current => ({ ...current, selected: rowId, material: undefined, busy: true, error: undefined }));
    try { const material = await readMyServiceMaterial(mode, studentId, rowId, abort.signal); if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current) setState(current => ({ ...current, material, busy: false })); }
    catch(error) { if (!abort.signal.aborted && turn === generation.current && currentScope === scopeRef.current)fail(error,"This part’s approved text is unavailable. Ask your tutor to check its source."); }
  }
  async function openResource(rowId: string, resourceId: string) {
    // Open during the user's gesture so phone browsers do not block an authorized score after the async check.
    const popup=window.open("about:blank","_blank");if(popup)popup.opener=null;
    const currentScope = scopeRef.current; setState(current => ({ ...current, busy: true, error: undefined }));
    try {
      const result = await requestMyService(mode,studentId,"resource",{rowId,resourceId},new AbortController().signal);
      if (currentScope !== scopeRef.current){popup?.close();return;}
      if (!result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string" || !("expiresAt"in result) || typeof result.expiresAt!=="string")throw new Error("Unavailable resource");
      const url = new URL(result.url); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Unavailable resource");
      if(popup)popup.location.replace(url.href);setState(current=>({...current,busy:false,...(!popup?{resourceLink:{url:url.href,expiresAt:result.expiresAt as string}}:{})}));
    } catch(error) {popup?.close();if (currentScope === scopeRef.current)fail(error,"This resource is no longer available. Ask your tutor to review it."); }
  }
  function part(row: ConnectedService["rows"][number], full = false) {
    const assigned = linked?.parts.find(part => part.rowId === row.rowId), siddurLink = row.liturgyRef ? siddurPageLink(congregation.links.siddurUrl, row.liturgyRef.book, row.liturgyRef.folio, row.liturgyRef.serviceViewId) : null, key = `part-${row.rowId}`, requestKey = `request-${row.rowId}`;
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
        {siddurLink && <a className="button-text" href={siddurLink} target="_blank" rel="noreferrer">Open in Siddur</a>}
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
  return <div className={styles.service} ref={region} aria-labelledby={`${id}-heading`} data-my-service="">
    <h3 id={`${id}-heading`}>My service</h3>
    {view && "ceremony" in view && <p className={styles.ceremony}>{new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${view.ceremony.date}T12:00:00Z`))} · {serviceSlotLine(view.ceremony.type, congregation.services) ?? "Service time to be confirmed"}</p>}
    {view && "ceremony" in view && view.ceremony.needsReconciliation && <p className="reading-review">Your ceremony schedule changed. Your tutor will reconcile the connected service; your practice progress is saved.</p>}
    {view && "ceremony" in view && view.ceremony.scheduleConflict && <p className="reading-review">Students sharing this ceremony have different schedules. Staff need to reconcile the joint ceremony before its setlist schedule can change.</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.resourceLink&&Date.parse(current.resourceLink.expiresAt)>Date.now()&&<p><a className="button-secondary" href={current.resourceLink.url} target="_blank" rel="noreferrer">Open authorized resource</a></p>}
    {current?.busy && <p role="status">Updating your service…</p>}
    {!view && !current?.busy && <button type="button" className="button-secondary" onClick={() => void reload()}>Load my service</button>}
    {view && view.state !== "linked" && <p>{view.state === "ambiguous" ? "More than one service matches. Your tutor will connect the right one." : view.state === "review_required" ? "Your service is connected. Your tutor is reviewing the parts and resources." : "Your service connection is queued and retries automatically. The daily fallback may take until tomorrow; your roster and practice work are saved."}</p>}
    {linked && <>
      <h3>Parts I lead</h3>
      {linked.parts.some(p => p.leads && !p.unresolved) ? <ol className={styles.parts}>{linked.rows.filter(row => linked.parts.some(p => p.rowId === row.rowId && p.leads)).map(row => part(row))}</ol> : <p>Your tutor will help you choose the parts you lead.</p>}
      {linked.parts.filter(p => p.unresolved).map(p => <p key={p.rowId} className="reading-review">An assigned part was removed from the service. Your progress is saved; ask your tutor about its replacement.</p>)}
      <details className={styles.order}><summary>Full order of service</summary><ol className={styles.parts}>{linked.rows.map(row => part(row, true))}</ol></details>
      {linked.requests.length > 0 && <details className={styles.order}><summary>Part requests ({linked.requests.filter(r => r.state === "pending").length} pending)</summary><ul className={styles.parts}>{linked.requests.map(request => { const key = `response-${request.id}`; return <li key={request.id} className={styles.part}><strong>{linked.rows.find(row => row.rowId === request.rowId)?.title ?? "Removed service part"}</strong><p>{request.message}</p><p>{request.state === "pending" ? "Waiting for staff" : request.state === "accepted" ? "Accepted" : "Declined"}{request.response ? ` · ${request.response}` : ""}</p>{staff && request.state === "pending" && <form onSubmit={event => { event.preventDefault(); void mutate("respond", { requestId: request.id, expectedRevision: request.revision, state: "accepted", response: drafts[key]?.response ?? "" }, key); }}><label>Response<textarea maxLength={2000} value={drafts[key]?.response ?? ""} onChange={event => draft(key, "response", event.target.value)} /></label><p className={styles.note}>Make and approve musical changes in Music first. Refresh here, then accept.</p><div className={styles.actions}><button className="button-primary" disabled={current?.busy}>Verify change and accept</button><button type="button" className="button-secondary" disabled={current?.busy} onClick={() => void mutate("respond", { requestId: request.id, expectedRevision: request.revision, state: "declined", response: drafts[key]?.response ?? "" }, key)}>Decline with response</button></div></form>}</li>; })}</ul></details>}
    </>}
    {view&&"previousWork"in view&&view.previousWork.length>0&&<details><summary>Previous service work · needs review</summary><p>These parts are no longer current. Your saved work is here to review with your tutor.</p><ul>{view.previousWork.map(work=><li key={work.id}>Previous service part · {work.progress==="ready"?"Ready":work.progress==="practicing"?"Practicing":"Not started"}{work.directions&&<p className={styles.directions}>{work.directions}</p>}{work.privateFeedback&&<p className={styles.directions}>Private feedback: {work.privateFeedback}</p>}</li>)}</ul></details>}
    {staff && view && "ceremony" in view && <div className={styles.staff}>
      <div className={styles.actions}><button type="button" className="button-secondary" disabled={current?.busy} onClick={() => void mutate("synchronize", {})}>{view.state === "linked" ? "Refresh from Music" : "Retry service connection"}</button>{"operatorLinks" in view && view.operatorLinks && <><a className="button-text" href={view.operatorLinks.music} target="_blank" rel="noreferrer">Open in Music</a>{view.operatorLinks.review && <a className="button-text" href={view.operatorLinks.review} target="_blank" rel="noreferrer">Review shared parts and permissions</a>}</>}</div>
      {view.ceremony.scheduleConflict&&<details><summary>Resolve the joint ceremony schedule</summary><p>If the students are moving together, align their dates and service times in the roster. If this student is moving alone, move only this student to a separate service; the other students and their setlist stay in place.</p><div className={styles.actions}><a className="button-text" href="/workspace/admin/students">Edit roster schedules</a>{"setlistId"in view&&view.setlistId?<button type="button" className="button-secondary" disabled={current?.busy} onClick={()=>void mutate("separate",{expectedCeremonyRevision:view.ceremony.revision})}>Move to a separate service</button>:<><p>Finish connecting the originally scheduled service before separating students. This keeps its source identity intact.</p><button type="button" className="button-secondary" disabled={current?.busy} onClick={()=>void mutate("resolve-original",{expectedCeremonyRevision:view.ceremony.revision})}>Connect the original shared service</button></>}</div></details>}
      {"candidates" in view && view.candidates && view.candidates.length > 0 && <form onSubmit={event => { event.preventDefault(); void mutate("synchronize", { explicitSetlistId: drafts.connection?.setlistId ?? view.candidates![0] }, "connection"); }}><label>Choose the ceremony’s setlist<select value={drafts.connection?.setlistId ?? view.candidates[0]} onChange={event => draft("connection", "setlistId", event.target.value)}>{view.candidates.map(candidate => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label><button className="button-primary" disabled={current?.busy}>Connect this setlist</button></form>}
      {"setlistId" in view&&view.setlistId&&<p><a className="button-text" href={`https://overlays.centralreform.org/services?${new URLSearchParams({setlistId:view.setlistId})}`} target="_blank" rel="noreferrer">Prepare or refresh overlays</a></p>}
      <p className={styles.note}>Review the overlay import’s changes, keep operator edits, and use explicit display names before preparing the display.</p>
    </div>}
  </div>;
}
