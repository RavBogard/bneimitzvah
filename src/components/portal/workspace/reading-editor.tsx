"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { workspaceApi, type Assigned } from "./api";
import { customReadingRanges, readingBaseline, fallbackLabels, type ReadingKind, type ReadingProposal, type StaffMode } from "./reading-proposal";
import { ReadingPreview } from "./reading-preview";
import { statusOf, useWorkspace } from "./provider";
import { currentReadingDraft,draftCuts,emptyReadingDraft,type ReadingDraft } from "./reading-draft";
import { aliyahStarts } from "../../../lib/readings/aliyah-starts";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";

export function ReadingEditor({ mode, baseline, reload, onBusy }: { mode: StaffMode; baseline: Assigned | null; reload(): Promise<Assigned>; onBusy?(busy: boolean): void }) {
  const { guardDeparture } = useWorkspace();
  const [kind, setKind] = useState<ReadingKind>("torah"), [drafts,setDrafts]=useState<Record<ReadingKind,ReadingDraft>>(()=>({torah:emptyReadingDraft(),haftarah:emptyReadingDraft()}));
  const draft=drafts[kind],{method,custom}=draft,currentAssignment=baseline?.readings.find(row=>row.kind===kind);
  const currentDraftStale = draft.current !== null && (draft.current.id !== currentAssignment?.id || draft.current.revision !== currentAssignment?.revision);
  const [review, setReview] = useState<{ proposal: ReadingProposal; baseline: string; expiresAt: number } | null>(null);
  const [pending, setPending] = useState<"prepare" | "confirm" | "reload" | null>(null), [message, setMessage] = useState(""), [blocked, setBlocked] = useState(false);
  const gate = useRef(false), generation = useRef(0), alive = useRef(true), heading = useRef<HTMLHeadingElement>(null);
  const key = baseline ? readingBaseline(baseline, kind) : null, keyRef = useRef(key); keyRef.current = key;
  const lastKey = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { onBusy?.(pending !== null); }, [pending, onBusy]);
  useEffect(() => {
    generation.current++; setReview(null);
    if (review && lastKey.current !== null && key !== lastKey.current) setMessage("The current reading is being checked or has changed. Your draft is retained; prepare a new review before confirming.");
    if (key !== null) lastKey.current = key;
  }, [key]);
  useEffect(() => {
    if (!review || review.proposal.status !== "prepared") return;
    const timer = setTimeout(() => { setReview(null); setMessage("This review expired. Prepare the reading again before confirming."); }, Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  function change(apply: () => void) { generation.current++; setReview(null); setMessage(""); apply(); }
  function updateDraft(patch:Partial<ReadingDraft>){change(()=>setDrafts(previous=>({...previous,[kind]:{...previous[kind],...patch}})));}
  function useCurrent(){if(currentAssignment)change(()=>setDrafts(previous=>({...previous,[kind]:currentReadingDraft(currentAssignment)})));}
  let draftVerses:string[]=[],cuts:string[]|null=null,cutIssue=false;
  try{if(method==="custom" && custom.trim())draftVerses=expandReadingRanges(customReadingRanges(custom),kind,TANAKH_VERSE_COUNTS);
    if(kind==="torah"){cuts=draftCuts(draft)??currentAssignment?.aliyahStarts??null;if(draftVerses.length)aliyahStarts(kind,cuts,draftVerses);}
  }catch{cutIssue=kind==="torah" && draftVerses.length>0;}
  function toggleCut(ref:string){
    if(kind!=="torah" || draftVerses.indexOf(ref)<=0 || cutIssue)return;
    const starts=cuts??[],next=starts.includes(ref)?starts.filter(value=>value!==ref):[...starts,ref].sort((a,b)=>draftVerses.indexOf(a)-draftVerses.indexOf(b));
    updateDraft({cuts:next.join("\n"),cutsEdited:true});
  }
  async function prepare(pick?: string) {
    if (gate.current || !baseline || !key || blocked || currentDraftStale) return;
    gate.current = true; const turn = ++generation.current, selectedKey = key, startedAt = Date.now();
    setPending("prepare"); setReview(null); setMessage("");
    try {
      const starts=kind==="torah"?draftCuts(draft):undefined;
      const input = draft.current && !pick ? {preparationMode:"current-assignment" as const,expectedAssignmentRevision:draft.current.revision,...(starts===undefined?{}:{aliyahStarts:starts})}
        : {...(pick ? {pick} : method==="custom"?{ranges:customReadingRanges(custom)}:{}),...(starts===undefined?{}:{aliyahStarts:starts})};
      const proposal = await workspaceApi.prepareReading(mode, baseline, kind, input);
      if (!alive.current || turn !== generation.current || keyRef.current !== selectedKey) return;
      setReview({ proposal, baseline: selectedKey, expiresAt: startedAt + 5 * 60_000 });
      queueMicrotask(() => heading.current?.focus());
    } catch (error) {
      if (alive.current && turn === generation.current) {
        if (statusOf(error) === 409) { setBlocked(true); setMessage("The student or assignment changed while this proposal was being prepared. Reload the current reading before reviewing it."); }
        else setMessage([400, 403].includes(statusOf(error))
          ? "The reading could not be prepared. Check the references, aliyah starts and current access, then try a new review."
          : "The calendar proposal is unavailable. You can retry explicitly or prepare custom references; no assignment was changed.");
      }
    } finally { gate.current = false; if (alive.current) setPending(null); }
  }
  async function confirm() {
    if (gate.current || !review || review.proposal.status !== "prepared" || !baseline || review.baseline !== key || Date.now() >= review.expiresAt || blocked) return;
    if (!await guardDeparture()) return;
    if (gate.current || !alive.current || review.baseline !== keyRef.current || Date.now() >= review.expiresAt) return;
    gate.current = true; const turn = ++generation.current; setPending("confirm"); setMessage("");
    const prepared = review.proposal; setReview(null);
    try {
      const saved = await workspaceApi.confirmReading(mode, baseline.student.id, prepared.binding);
      if (!alive.current) return;
      if (turn !== generation.current || keyRef.current !== key) { setBlocked(true); setMessage("The confirmation outcome changed while access was being checked. Reload the current reading before preparing again; do not submit automatically."); return; }
      let current: Assigned;
      try { current = await reload(); } catch { setBlocked(true); setMessage("The server confirmed the reading was saved, but its current assignment could not be reloaded. Reload the reading before continuing."); return; }
      if (!alive.current) return;
      const assignment = current.readings.find(row => row.kind === prepared.kind);
      if (!assignment || assignment.id !== saved.assignmentId || assignment.revision !== saved.revision) {
        setBlocked(true); setMessage("The server confirmed this change, but the latest reading differs. Reload and review the current assignment before making another change.");
      } else {setDrafts(previous=>({...previous,[prepared.kind]:currentReadingDraft(assignment)}));setMessage("Reading confirmed and reloaded from the server. The assignment above is current.");}
    } catch (error) {
      if (!alive.current) return;
      setBlocked(true);
      setMessage(statusOf(error) === 409 ? "The student or assignment changed after this review. Reload the current reading, then prepare a new review."
        : [400, 401, 403, 404].includes(statusOf(error)) ? "This review is no longer valid or permitted. Reload the current reading and check access before preparing again."
        : "The confirmation outcome could not be established. It may have saved. Reload the current reading before preparing again; no automatic retry will occur.");
    } finally { gate.current = false; if (alive.current) setPending(null); }
  }
  async function reloadCurrent() {
    if (gate.current) return; gate.current = true; setPending("reload"); setReview(null); setMessage("");
    try { await reload(); if (alive.current) { setBlocked(false); setMessage("Current reading reloaded. Prepare a new review to make a change."); } }
    catch { if (alive.current) setMessage("The current reading could not be reloaded. Your draft is retained; try reloading again when access is available."); }
    finally { gate.current = false; if (alive.current) setPending(null); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void prepare(); }
  const proposal = review?.baseline === key ? review.proposal : null;
  return <section className="reading-editor" aria-labelledby="reading-editor-title">
    <h2 id="reading-editor-title">Set the assigned reading</h2>
    <p>The confirmed assignment above stays in place until you review and explicitly confirm your changes.</p>
    <button type="button" className="button-secondary" disabled={!currentAssignment || pending!==null || blocked} onClick={useCurrent}>Use current assignment</button>
    <form onSubmit={submit}>
      <div className="reading-editor-fields">
        <div><label htmlFor="reading-kind">Reading</label><select id="reading-kind" value={kind} disabled={pending !== null} onChange={event => change(() => setKind(event.target.value as ReadingKind))}><option value="torah">Torah</option><option value="haftarah">Haftarah</option></select></div>
        <div><label htmlFor="reading-method">Selection method</label><select id="reading-method" value={method} disabled={pending !== null} onChange={event => updateDraft({method:event.target.value as ReadingDraft["method"],current:null})}><option value="custom">Custom references</option><option value="calendar">Calendar helpers (optional)</option></select></div>
      </div>
      {method === "custom" && <div className="reading-custom"><label htmlFor="reading-ranges">Custom verse ranges</label><textarea id="reading-ranges" value={custom} maxLength={3232} rows={4} disabled={pending !== null} aria-describedby="reading-ranges-help" required onChange={event => updateDraft({custom:event.target.value,current:null})} /><p id="reading-ranges-help" className="field-help">One reference per line, up to 32 ranges and 1,000 verses. For example: {kind === "torah" ? "Genesis 1:1-3" : "Isaiah 1:1-2"}. The server checks book, order and verse boundaries.</p></div>}
      {draft.current && <p className="field-help">References unchanged. This draft changes only Torah aliyah boundaries; the existing calendar source and any reading-review requirement stay in place. Editing references switches to a custom replacement.</p>}
      {currentDraftStale && <p className="request-error" role="status">The assignment used for this draft has changed. Your draft is retained. Choose Use current assignment again to start a cut-only review of the latest assignment, or edit references to prepare a custom replacement.</p>}
      {kind==="torah" && <fieldset className="reading-cuts"><legend>Student Torah aliyah starts</legend>
        <p className="field-help">The first assigned verse starts aliyah 1 when boundaries are recorded. Enter the first verse of each subsequent aliyah in selection order, one per line. Calendar boundaries are only a guide.</p>
        <label htmlFor="reading-cuts">Subsequent aliyah starts</label><textarea id="reading-cuts" rows={3} maxLength={100899} value={draft.cuts} disabled={pending!==null} onChange={event=>updateDraft({cuts:event.target.value,cutsEdited:true})} aria-describedby="reading-cuts-help" />
        <p id="reading-cuts-help" className="field-help">{draft.cutsEdited?draft.cuts.trim()?"These draft boundaries will be included in the review.":"This draft explicitly records one aliyah.":"No boundary changes entered. Existing boundaries are preserved only if valid for these references; an unrecorded assignment stays unrecorded."}</p>
        <button type="button" className="button-text" disabled={pending!==null} onClick={()=>updateDraft({cuts:"",cutsEdited:true})}>Record one aliyah</button>
        {cutIssue && <p className="request-error" role="status">Adjust the aliyah starts for these references, or explicitly record one aliyah. No boundary will be removed automatically.</p>}
      </fieldset>}
      <button className="button-secondary" disabled={!baseline || pending !== null || blocked || currentDraftStale}>{pending === "prepare" ? "Preparing review…" : "Prepare reading review"}</button>
    </form>
    <ReadingPreview mode={mode} baseline={baseline} kind={kind} custom={method==="custom"?custom:""} disabled={blocked || pending!==null}
      onUseSelection={range=>{updateDraft({method:"custom",custom:range,current:null});setMessage("Selected verses staged below the current assignment. Review the references and boundaries before confirming.");}}
      draftVerses={draftVerses} cutStarts={cuts} onToggleCut={toggleCut} cutIssue={cutIssue} />
    {pending === "confirm" && <p role="status">Saving the reviewed assignment and checking its confirmed references…</p>}
    {message && <p className={blocked ? "request-error" : "field-help"} role={blocked ? "alert" : "status"}>{message}</p>}
    {blocked && <button className="button-secondary" disabled={pending !== null} onClick={() => void reloadCurrent()}>{pending === "reload" ? "Reloading current reading…" : "Reload current reading"}</button>}
    {proposal && <section className="reading-proposal" aria-labelledby="reading-review-title">
      <h3 id="reading-review-title" tabIndex={-1} ref={heading}>{proposal.status === "prepared" ? `Review ${kind === "torah" ? "Torah" : "Haftarah"} assignment` : "Choose a reading explicitly"}</h3>
      <p className="field-help">Calendar source: <a href="https://www.hebcal.com/" target="_blank" rel="noopener noreferrer">Hebcal</a>. {proposal.sourceStatus === "preserved" ? "Stored provenance preserved; no calendar source was queried for this cut-only review." : proposal.sourceStatus === "available" ? `Fetched ${new Date(proposal.sourceFetchedAt!).toLocaleString()}.` : proposal.sourceStatus === "not-requested" ? "Not queried: no reading date has been derived." : "Unavailable. Verify custom references independently."}</p>
      <p>Ceremony: {proposal.ceremonyDate} · {proposal.serviceSlot === "morning" ? "Morning (10:00)" : proposal.serviceSlot === "havdalah" ? "Havdalah / afternoon (4:00)" : "Not yet set"}. Reading date: {proposal.readingDate ?? "not determined"}.</p>
      {proposal.manualFallback && <p className="field-help">{fallbackLabels[proposal.manualFallback]}</p>}
      {proposal.status === "needs-selection" ? <>
        <p>{proposal.parashah ? `${proposal.parashah} · ` : "No Torah calendar reading was returned · "}{proposal.date} · {proposal.calendar === "diaspora" ? "Diaspora" : "Israel"} calendar.</p>
        <p>No assignment has been prepared or changed. Choose an available selection below, or enter custom references.</p>
        {kind === "torah" && proposal.choices.length > 0 && <ul className="reading-calendar-choices">{proposal.choices.map(choice => <li key={choice.pick}><button className="button-secondary" disabled={pending !== null || blocked} onClick={() => void prepare(choice.pick)}>{choice.label}{choice.ref ? `: ${choice.ref}` : ""}</button></li>)}</ul>}
        {kind === "torah" && !proposal.choices.length && <p>No calendar selections are available for this date.</p>}
        {kind === "haftarah" && proposal.manualFallback===null && proposal.haftarah && <button className="button-secondary" disabled={pending!==null || blocked} onClick={()=>void prepare("calendar-haftarah")}>Use calendar haftarah: {proposal.haftarah}</button>}
        {kind === "haftarah" && <p>{proposal.haftarah ? `Calendar reference: ${proposal.haftarah}. Prepare again to check its current availability.` : "No haftarah was returned for this date. Use custom references if appropriate."}</p>}
      </> : <>
        <p className="reading-reference">{proposal.ranges.join("; ")}</p><p>{proposal.verseCount} verses · Selection: {proposal.basis}.</p>
        {proposal.kind==="torah" && <p>{proposal.aliyahStarts===null?"Aliyah boundaries remain unrecorded.":`${proposal.aliyahStarts.length+1} aliyah${proposal.aliyahStarts.length?"s":""}. Aliyah 1 starts at ${draftVerses[0]??proposal.ranges[0].split("-")[0]}.`}</p>}
        {proposal.kind==="torah" && proposal.aliyahStarts && proposal.aliyahStarts.length>0 && <ol start={2}>{proposal.aliyahStarts.map(ref=><li key={ref}>Starts at <bdi dir="ltr">{ref}</bdi></li>)}</ol>}
        {proposal.preparationMode === "current-assignment" && proposal.preserved && <div className="reading-preserved-context">
          <p>References unchanged. Existing confirmation date: {proposal.preserved.confirmationDate ?? "not recorded"}. {proposal.preserved.needsReview ? "The reading still needs review with the tutor or rabbi." : "The existing reading-review status is preserved."}</p>
          <p className="field-help">Preserved calendar source: {proposal.preserved.source.status === "available" ? "available in the saved assignment" : proposal.preserved.source.status === "unavailable" ? "unavailable when the assignment was saved" : "not recorded"}.
            {proposal.preserved.source.date && <> Source date: {proposal.preserved.source.date}.</>}
            {proposal.preserved.source.calendar && <> {proposal.preserved.source.calendar === "diaspora" ? "Diaspora" : "Israel"} calendar.</>}
            {proposal.preserved.source.fetchedAt !== null && <> Previously fetched {new Date(proposal.preserved.source.fetchedAt).toLocaleString()}.</>}
            {" "}No calendar result was newly checked.</p>
        </div>}
        {proposal.maftir && <p>Calendar maftir, shown separately: {proposal.maftir.ref}{proposal.maftir.reason ? ` (${proposal.maftir.reason})` : ""}. It is not added automatically; only the listed assignment ranges will be saved.</p>}
        <p>{proposal.preparationMode==="current-assignment"?"Confirm only these Torah aliyah boundaries for the student named above. References and calendar provenance stay unchanged.":`Confirm these exact references${kind==="torah"?" and aliyah boundaries":""} for the student named above. Any existing ${kind==="torah"?"Torah":"Haftarah"} assignment will be replaced.`}</p>
        <button className="button-primary" disabled={pending !== null || blocked || !baseline || Date.now() >= review!.expiresAt} onClick={() => void confirm()}>{pending === "confirm" ? "Confirming reading…" : "Confirm assigned reading"}</button>
      </>}
    </section>}
  </section>;
}
