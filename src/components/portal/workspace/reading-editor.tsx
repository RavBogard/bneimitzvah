"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { workspaceApi, type Assigned } from "./api";
import { customReadingRanges, readingBaseline, fallbackLabels, type ReadingKind, type PreparedReading, type NeedsSelection, type StaffMode } from "./reading-proposal";
import { ReadingPreview } from "./reading-preview";
import { statusOf, useWorkspace } from "./provider";
import { currentReadingDraft,draftCuts,emptyReadingDraft,type ReadingDraft } from "./reading-draft";
import { aliyahStarts } from "../../../lib/readings/aliyah-starts";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { ReadingPassageSelect } from "./reading-passage-select";
import { ReadingDivisions } from "./reading-divisions";
import styles from "./reading-selection.module.css";
import { serviceSlotName, serviceSlotTime } from "./service-slot";
import { useCongregation } from "./settings/links";
import type { ServiceSettings } from "./settings/api";

export function ReadingEditor({ mode, baseline, reload, onBusy, active: open }: { mode: StaffMode; baseline: Assigned | null; reload(): Promise<Assigned>; onBusy?(busy: boolean): void; active: boolean }) {
  const { guardDeparture, summary, epoch, concealed } = useWorkspace(), active = open && !concealed;
  const congregation = useCongregation(active);
  const [kind, setKind] = useState<ReadingKind>("torah"), [drafts,setDrafts]=useState<Record<ReadingKind,ReadingDraft>>(()=>({torah:emptyReadingDraft(),haftarah:emptyReadingDraft()}));
  const draft=drafts[kind],{method,custom}=draft,currentAssignment=baseline?.readings.find(row=>row.kind===kind);
  const currentDraftStale = method === "custom" && draft.current !== null && (draft.current.id !== currentAssignment?.id || draft.current.revision !== currentAssignment?.revision);
  const [review, setReview] = useState<{ proposal: PreparedReading; baseline: string; expiresAt: number } | null>(null);
  const [pending, setPending] = useState<"prepare" | "confirm" | "reload" | null>(null), [message, setMessage] = useState(""), [blocked, setBlocked] = useState(false);
  const gate = useRef(false), generation = useRef(0), alive = useRef(true), heading = useRef<HTMLHeadingElement>(null);
  const key = baseline && !concealed ? JSON.stringify([summary.sessionBinding, epoch, readingBaseline(baseline, kind)]) : null, keyRef = useRef(key); keyRef.current = key;
  const lastKey = useRef<string | null>(null);
  const seeded = useRef(new Set<ReadingKind>());
  const [calendar, setCalendar] = useState<{ key: string; proposal: NeedsSelection | null; loading: boolean; failed: boolean }>({ key: "", proposal: null, loading: false, failed: false });
  const [calendarRetry, setCalendarRetry] = useState(0);
  const suggestionGeneration = useRef(0);
  const visible = useRef(active); visible.current = active;
  // Opening the editor reads suggestions only. It never stages a helper or exposes
  // a confirmation binding; stale requests can only update their matching identity.
  useEffect(() => {
    const turn = ++suggestionGeneration.current;
    if (!active || !baseline || !key) { setCalendar({ key: "", proposal: null, loading: false, failed: false }); return; }
    let cancelled = false;
    setCalendar({ key, proposal: null, loading: true, failed: false });
    void workspaceApi.prepareReading(mode, baseline, kind, {}).then(proposal => {
      if (cancelled || turn !== suggestionGeneration.current || !visible.current || keyRef.current !== key) return;
      setCalendar({ key, proposal: proposal.status === "needs-selection" ? proposal : null, loading: false, failed: proposal.status !== "needs-selection" });
    }).catch(() => {
      if (!cancelled && turn === suggestionGeneration.current && visible.current && keyRef.current === key) setCalendar({ key, proposal: null, loading: false, failed: true });
    });
    return () => { cancelled = true; };
  }, [active, key, mode, calendarRetry]);
  useEffect(() => {
    if (!baseline || seeded.current.has(kind)) return;
    seeded.current.add(kind);
    const assignment = baseline.readings.find(row => row.kind === kind);
    if (assignment) setDrafts(previous => previous[kind].custom || previous[kind].calendarPick ? previous : { ...previous, [kind]: currentReadingDraft(assignment) });
  }, [baseline, kind]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  // Publish the close guard before paint/keyboard interaction, including the
  // first Escape immediately after prepare, confirm or reload starts.
  useLayoutEffect(() => { onBusy?.(pending !== null); }, [pending, onBusy]);
  useEffect(() => {
    generation.current++; setReview(null);
    if (review && lastKey.current !== null && key !== lastKey.current) setMessage("The saved reading is being checked or has changed. Your choices are kept; review the assignment again before saving.");
    if (key !== null) lastKey.current = key;
  }, [key]);
  useEffect(() => {
    if (!review || review.proposal.status !== "prepared") return;
    const timer = setTimeout(() => { setReview(null); setMessage("This review is more than five minutes old. Review the assignment again before saving."); }, Math.max(0, review.expiresAt - Date.now()));
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
    if (gate.current || !active || !baseline || !key || blocked || currentDraftStale) return;
    gate.current = true; const turn = ++generation.current, selectedKey = key, startedAt = Date.now();
    setPending("prepare"); setReview(null); setMessage("");
    try {
      const starts=kind==="torah"?draftCuts(draft):undefined;
      const input = draft.current && !pick ? {preparationMode:"current-assignment" as const,expectedAssignmentRevision:draft.current.revision,...(starts===undefined?{}:{aliyahStarts:starts})}
        : {...(pick ? {pick} : method==="custom"?{ranges:customReadingRanges(custom)}:{}),...(starts===undefined?{}:{aliyahStarts:starts})};
      const proposal = await workspaceApi.prepareReading(mode, baseline, kind, input);
      if (!alive.current || turn !== generation.current || keyRef.current !== selectedKey) return;
      if (proposal.status === "needs-selection") {
        setCalendar({ key: selectedKey, proposal, loading: false, failed: false });
        setMessage("The suggestions for this date changed. Choose a passage again, then review it.");
        return;
      }
      setReview({ proposal, baseline: selectedKey, expiresAt: startedAt + 5 * 60_000 });
      queueMicrotask(() => heading.current?.focus());
    } catch (error) {
      if (alive.current && turn === generation.current) {
        if (statusOf(error) === 409) { setBlocked(true); setMessage("The student or reading changed while this review was being prepared. Check what is saved now before reviewing again."); }
        else setMessage([400, 403].includes(statusOf(error))
          ? "This passage could not be reviewed. Check the verses and aliyah divisions, then try again. Nothing was saved."
          : "The review could not be prepared right now. Nothing was saved. Try again, or choose the verses yourself.");
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
      if (turn !== generation.current || keyRef.current !== key) { setBlocked(true); setMessage("We could not confirm whether this saved. Check what saved before trying again."); return; }
      let current: Assigned;
      try { current = await reload(); } catch { setBlocked(true); setMessage("Saved, but the updated reading could not be shown. Check what saved before continuing."); return; }
      if (!alive.current) return;
      const assignment = current.readings.find(row => row.kind === prepared.kind);
      if (!assignment || assignment.id !== saved.assignmentId || assignment.revision !== saved.revision) {
        setBlocked(true); setMessage("Saved, but the reading now differs from what you reviewed. Check what saved before making another change.");
      } else {setDrafts(previous=>({...previous,[prepared.kind]:currentReadingDraft(assignment)}));setMessage("Saved. The current reading above shows what the student will see.");}
    } catch (error) {
      if (!alive.current) return;
      setBlocked(true);
      setMessage(statusOf(error) === 409 ? "The student or reading changed after this review, so it was not saved. Check what is saved now, then review again."
        : [400, 401, 403, 404].includes(statusOf(error)) ? "This review can no longer be saved. Check what is saved now and your access, then review again."
        : "We could not confirm whether this saved. It may have saved. Check what saved before trying again; nothing will be sent twice automatically.");
    } finally { gate.current = false; if (alive.current) setPending(null); }
  }
  async function reloadCurrent() {
    if (gate.current) return; gate.current = true; setPending("reload"); setReview(null); setMessage("");
    try { await reload(); if (alive.current) { setBlocked(false); setMessage("Showing what is saved now. Review the assignment again to make a change."); } }
    catch { if (alive.current) setMessage("The saved reading could not be loaded. Your choices are kept; try again when you are back online."); }
    finally { gate.current = false; if (alive.current) setPending(null); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void prepare(method === "calendar" ? draft.calendarPick || undefined : undefined); }
  const proposal = review?.baseline === key ? review.proposal : null;
  const suggestions = active && calendar.key === key ? calendar.proposal : null;
  const calendarChoices = suggestions ? kind === "torah" ? suggestions.choices : suggestions.manualFallback === null && suggestions.haftarah ? [{ pick: "calendar-haftarah", label: "Calendar haftarah", ref: suggestions.haftarah }] : [] : [];
  const label = kind === "torah" ? "Torah" : "Haftarah", ceremony = baseline?.student.ceremonyDate;
  let divisionStarts: string[] | null = null; try { divisionStarts = draftCuts(draft) ?? currentAssignment?.aliyahStarts ?? null; } catch { divisionStarts = null; }
  return <section className="reading-editor" aria-labelledby="reading-editor-title">
    <h2 id="reading-editor-title" data-testid="reading-editor-title">Set the assigned reading</h2>
    <p>Choose the verses, review them, then save the assignment.</p>
    <div className={styles.context} aria-live="polite">
      <p><strong>Ceremony: {ceremony ? longDate(ceremony) : "Checking date…"}</strong>{suggestions && <> · {slotLabel(suggestions.serviceSlot, congregation.services)}</>}</p>
      {active && calendar.key === key && calendar.loading && <p role="status" className="field-help">Looking up the reading for this date…</p>}
      {suggestions && <>
        {suggestions.parashah && !suggestions.manualFallback ? <p>Suggested for this service: <strong>{suggestions.parashah}</strong>{kind === "haftarah" && suggestions.haftarah && <> · haftarah {suggestions.haftarah}</>}. <span className="field-help">Based on the saved ceremony date{suggestions.readingDate && suggestions.readingDate !== ceremony ? <> and the reading for {longDate(suggestions.readingDate)}</> : null}.</span></p>
          : suggestions.parashah ? <p>Calendar portion for this date: <strong>{suggestions.parashah}</strong>.</p> : null}
        {suggestions.manualFallback && <p className="field-help">{fallbackLabels[suggestions.manualFallback]}{suggestions.manualFallback === "unknown-slot" && " Set the service slot in student details to get date suggestions."}</p>}
        <p className="field-help">Calendar: <a href="https://www.hebcal.com/" target="_blank" rel="noopener noreferrer">Hebcal</a>.</p>
      </>}
      {active && calendar.key === key && calendar.failed && <p role="status" className="field-help">Calendar suggestions are unavailable. Choose the verses yourself or <button type="button" className="button-text" onClick={() => setCalendarRetry(value => value + 1)}>Retry calendar suggestions</button>.</p>}
    </div>
    {currentAssignment?.needsReview && <div className={styles.attention} role="note"><p><strong>Check this {label} reading.</strong> The ceremony date or service changed after it was saved. The saved verses have not been changed; compare them with the suggestion above and choose new verses only if the reading should change.</p></div>}
    <p className={styles.summary}><strong>Current {label}:</strong> {currentAssignment ? `${currentAssignment.ranges.join("; ")} (${currentAssignment.verses.length} verses)` : "No reading assigned"}.</p>
    <form onSubmit={submit}>
      <div className="reading-editor-fields">
        <div><label htmlFor="reading-kind">Reading</label><select id="reading-kind" value={kind} disabled={pending !== null} onChange={event => change(() => setKind(event.target.value as ReadingKind))}><option value="torah">Torah</option><option value="haftarah">Haftarah</option></select></div>
        <div><label htmlFor="reading-passage">Passage</label><select id="reading-passage" value={method === "custom" ? "custom" : draft.calendarPick} disabled={pending !== null} onChange={event => updateDraft(event.target.value === "custom" ? {method:"custom"} : {method:"calendar",calendarPick:event.target.value})}>
          <option value="custom">Choose my own verses</option>
          {calendarChoices.length > 0 && <optgroup label={`${suggestions?.parashah ?? "Calendar suggestions"}${suggestions?.readingDate ? ` · ${suggestions.readingDate}` : ""}`}>{calendarChoices.map(choice => <option value={choice.pick} key={choice.pick}>{choice.label}{choice.ref ? `: ${choice.ref}` : ""}</option>)}</optgroup>}
          {method === "calendar" && !calendarChoices.some(choice => choice.pick === draft.calendarPick) && <option value={draft.calendarPick} disabled>Previous calendar choice unavailable</option>}
        </select></div>
      </div>
      {method === "custom" && <ReadingPassageSelect custom={custom} kind={kind} disabled={pending !== null} onChange={ref => updateDraft({custom:ref,current:null})} />}
      {suggestions && !calendarChoices.length && <p className="field-help">No calendar selections are available. Choose your own verses.</p>}
      <p className={styles.summary}><strong>Your selection:</strong> {method === "custom" ? custom.trim() ? `${custom.split(/\r?\n/).filter(Boolean).join("; ")}${draftVerses.length ? ` (${draftVerses.length} verses)` : ""}` : "Choose the first and last verse." : calendarChoices.find(choice => choice.pick === draft.calendarPick)?.label ?? "Choose a calendar selection."}</p>
      {method === "custom" && draft.current && <p className="field-help">This is the saved reading. Change the verses above, or adjust only its aliyah divisions.</p>}
      {currentDraftStale && <p className="request-error" role="status">The saved reading changed after you started. Your choices are kept. Choose Use current assignment under Advanced to start from the latest reading, or change the verses to replace it.</p>}
      {kind === "torah" && method === "custom" && <ReadingDivisions verses={draftVerses} starts={divisionStarts} edited={draft.cutsEdited} issue={cutIssue} disabled={pending !== null}
        onChange={next => updateDraft({cuts:next.join("\n"),cutsEdited:true})} />}
      <details className={styles.disclosure}><summary>Advanced references and aliyah boundaries</summary>
      <button type="button" className="button-text" disabled={!currentAssignment || pending!==null || blocked} onClick={useCurrent}>Use current assignment</button>
      {method === "custom" && <div className="reading-custom"><label htmlFor="reading-ranges">Custom verse ranges</label><textarea id="reading-ranges" value={custom} maxLength={3232} rows={4} disabled={pending !== null} aria-describedby="reading-ranges-help" onChange={event => updateDraft({custom:event.target.value,current:null})} /><p id="reading-ranges-help" className="field-help">One reference per line, up to 32 ranges and 1,000 verses. For example: {kind === "torah" ? "Genesis 1:1-3" : "Isaiah 1:1-2"}. Multiple ranges stay intact until you edit them.</p></div>}
      {kind==="torah" && <fieldset className="reading-cuts"><legend>Student Torah aliyah starts</legend>
        <p className="field-help">The first assigned verse starts aliyah 1 when boundaries are recorded. Enter the first verse of each subsequent aliyah in selection order, one per line. Calendar boundaries are only a guide.</p>
        <label htmlFor="reading-cuts">Subsequent aliyah starts</label><textarea id="reading-cuts" rows={3} maxLength={100899} value={draft.cuts} disabled={pending!==null} onChange={event=>updateDraft({cuts:event.target.value,cutsEdited:true})} aria-describedby="reading-cuts-help" />
        <p id="reading-cuts-help" className="field-help">{draft.cutsEdited?draft.cuts.trim()?"These draft boundaries will be included in the review.":"This draft explicitly records one aliyah.":"No boundary changes entered. Existing boundaries are preserved only if valid for these references; an unrecorded assignment stays unrecorded."}</p>
        <button type="button" className="button-text" disabled={pending!==null} onClick={()=>updateDraft({cuts:"",cutsEdited:true})}>Record one aliyah</button>
      </fieldset>}
      </details>
      <button className="button-primary" disabled={!baseline || pending !== null || blocked || currentDraftStale || method === "calendar" && !calendarChoices.some(choice => choice.pick === draft.calendarPick)}>{pending === "prepare" ? "Preparing review…" : "Review assignment"}</button>
    </form>
    <details className={styles.disclosure}><summary>Hebrew preview and verse selection (optional)</summary>
    <ReadingPreview mode={mode} baseline={active ? baseline : null} kind={kind} custom={method==="custom"?custom:""} disabled={blocked || pending!==null}
      onUseSelection={range=>{updateDraft({method:"custom",custom:range,current:null});setMessage("Those verses are now your selection. Review the assignment before saving.");}}
      draftVerses={draftVerses} cutStarts={cuts} onToggleCut={toggleCut} cutIssue={cutIssue} />
    </details>
    {pending === "confirm" && <p role="status">Saving the assignment…</p>}
    {message && <p className={blocked ? "request-error" : "field-help"} role={blocked ? "alert" : "status"}>{message}</p>}
    {blocked && <button className="button-secondary" disabled={pending !== null} onClick={() => void reloadCurrent()}>{pending === "reload" ? "Checking what saved…" : "Check what saved"}</button>}
    {proposal && <section className={`reading-proposal ${styles.review}`} aria-labelledby="reading-review-title">
      <h3 id="reading-review-title" tabIndex={-1} ref={heading}>{`Review ${label} assignment`}</h3>
      {proposal.manualFallback && <p className="field-help">{fallbackLabels[proposal.manualFallback]}</p>}
      <dl>
        <dt>Ceremony</dt><dd>{longDate(proposal.ceremonyDate)} · {slotLabel(proposal.serviceSlot, congregation.services)}</dd>
        <dt>Verses</dt><dd><span className="reading-reference">{proposal.ranges.join("; ")}</span><br />{proposal.verseCount} verses · {basisLabels[proposal.basis]}</dd>
        {proposal.kind === "torah" && <><dt>Aliyot</dt><dd>{proposal.aliyahStarts === null ? "Not divided into aliyot yet." : proposal.aliyahStarts.length === 0 ? "One aliyah." : <>{proposal.aliyahStarts.length + 1} aliyot. Aliyah 1 starts at <bdi dir="ltr">{draftVerses[0] ?? proposal.ranges[0].split("-")[0]}</bdi>.<ol start={2}>{proposal.aliyahStarts.map(ref => <li key={ref}>Starts at <bdi dir="ltr">{ref}</bdi></li>)}</ol></>}</dd></>}
        <dt>{proposal.preparationMode === "current-assignment" ? "Changes" : "Replaces"}</dt><dd>{proposal.preparationMode === "current-assignment" ? "Only the aliyah divisions. The verses and calendar source stay the same." : currentAssignment ? `The current ${label} reading, ${currentAssignment.ranges.join("; ")}.` : `Nothing. No ${label} reading is assigned yet.`}</dd>
      </dl>
      {proposal.preparationMode === "current-assignment" && proposal.preserved && <div className="reading-preserved-context">
        <p>References unchanged. Existing confirmation date: {proposal.preserved.confirmationDate ?? "not recorded"}. {proposal.preserved.needsReview ? "The reading still needs review with the tutor or rabbi." : "The existing reading-review status is preserved."}</p>
      </div>}
      {proposal.maftir && <p>Calendar maftir, shown separately: {proposal.maftir.ref}{proposal.maftir.reason ? ` (${proposal.maftir.reason})` : ""}. It is not added automatically; only the verses listed above will be saved.</p>}
      <p>{proposal.preparationMode === "current-assignment" ? `Saving changes only these ${label} aliyah divisions for the student named above.` : `Saving makes these verses the ${label} reading for the student named above.`}</p>
      <button className="button-primary" disabled={pending !== null || blocked || !baseline || Date.now() >= review!.expiresAt} onClick={() => void confirm()}>{pending === "confirm" ? "Saving assignment…" : "Save assignment"}</button>
      <details className={styles.disclosure}><summary>Calendar source details</summary>
      <p className="field-help">Calendar source: <a href="https://www.hebcal.com/" target="_blank" rel="noopener noreferrer">Hebcal</a>. {proposal.sourceStatus === "preserved" ? "Stored provenance preserved; no calendar source was queried for this cut-only review." : proposal.sourceStatus === "available" ? `Fetched ${new Date(proposal.sourceFetchedAt!).toLocaleString()}.` : proposal.sourceStatus === "not-requested" ? "Not queried: no reading date has been derived." : "Unavailable. Verify custom references independently."}</p>
      <p>Ceremony: {proposal.ceremonyDate} · {slotLabel(proposal.serviceSlot, congregation.services)}. Reading date: {proposal.readingDate ?? "not determined"}.</p>
        {proposal.preserved && <>
          <p className="field-help">Preserved calendar source: {proposal.preserved.source.status === "available" ? "available in the saved assignment" : proposal.preserved.source.status === "unavailable" ? "unavailable when the assignment was saved" : "not recorded"}.
            {proposal.preserved.source.date && <> Source date: {proposal.preserved.source.date}.</>}
            {proposal.preserved.source.calendar && <> {proposal.preserved.source.calendar === "diaspora" ? "Diaspora" : "Israel"} calendar.</>}
            {proposal.preserved.source.fetchedAt !== null && <> Previously fetched {new Date(proposal.preserved.source.fetchedAt).toLocaleString()}.</>}
            {" "}No calendar result was newly checked.</p>
        </>}
      </details>
    </section>}
  </section>;
}

const basisLabels = { full: "Full calendar portion", triennial: "Triennial portion", selection: "Calendar selection", custom: "Verses you chose" } as const;
// The congregation's own name and start time when its settings give either; otherwise the standard labels.
const slotLabel = (slot: "morning" | "havdalah" | "unknown", services: ServiceSettings = {}) => {
  if (slot === "unknown") return "Service not set";
  if (!services[slot]) return slot === "morning" ? "Morning service (10:00)" : "Havdalah / afternoon service (4:00)";
  const time = serviceSlotTime(slot, services); return `${serviceSlotName(slot, services)}${time ? ` (${time})` : ""}`;
};
/** "Saturday, January 2, 2027" from a calendar date, without shifting it through the local time zone. */
function longDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Number.isFinite(day) ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day)) : date;
}
