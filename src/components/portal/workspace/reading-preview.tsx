"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { type Assigned } from "./api";
import { customReadingRanges, fallbackLabels, readingBaseline, type ReadingKind, type StaffMode } from "./reading-proposal";
import { previewApi, type PreparedPreview, type PreviewPreparation } from "./preview-api";
import { statusOf, useWorkspace } from "./provider";
import { AnnotatedStudyVerse } from "./study/annotations";
import { StudyCredits } from "./study/credits";
import type { StudyPage } from "./study/api";
import { previewSelection } from "../../../lib/readings/aliyah-starts";

export function ReadingPreview({ mode, baseline, kind, custom, disabled,onUseSelection,draftVerses,cutStarts,onToggleCut,cutIssue }: { mode: StaffMode; baseline: Assigned | null; kind: ReadingKind; custom: string; disabled: boolean;
 onUseSelection(ref:string):void;draftVerses:readonly string[];cutStarts:readonly string[]|null;onToggleCut(ref:string):void;cutIssue:boolean }) {
  const { summary, epoch, registerWork, refresh } = useWorkspace();
  const id = useId(), key = baseline && !disabled ? JSON.stringify([summary.sessionBinding, epoch, readingBaseline(baseline, kind)]) : null;
  const keyRef = useRef(key); keyRef.current = key;
  const [state, setState] = useState<{ key: string; preparation: PreviewPreparation; page: StudyPage | null } | null>(null);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState(""), [openChapter, setOpenChapter] = useState<string | null>(null);
  const [selection,setSelection]=useState<{start:string;end:string}>({start:"",end:""});
  const manualInput=useRef<string|null>(null), currentDraft=useRef(custom);currentDraft.current=custom;
  const request = useRef<AbortController | null>(null), generation = useRef(0), gate = useRef(false);
  const clear = useCallback(() => { generation.current++; request.current?.abort(); request.current = null; gate.current = false; setState(null); setPending(false); setOpenChapter(null);setSelection({start:"",end:""});setNotice("");manualInput.current=null; }, []);
  useLayoutEffect(() => { clear(); return clear; }, [key, clear]);
  useLayoutEffect(() => registerWork({ pause: clear, clear, settle: async () => {}, hasUnsaved: () => false, reveal: () => {} }), [registerWork, clear]);
  const current = key && state?.key === key ? state : null;
  // A calendar preview stays beside the custom draft while it is edited. A
  // manual preview no longer describes that draft as soon as its text changes.
  useLayoutEffect(() => { if(manualInput.current!==null && manualInput.current!==custom)clear(); }, [custom,clear]);
  useEffect(() => {
    if (current?.preparation.status !== "prepared") return;
    const timer = setTimeout(() => { clear(); setNotice("The preview expired. Preview the current references again."); }, Math.max(0, current.preparation.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [current?.preparation, clear]);
  function failure(error: unknown) {
    clear();
    const status = statusOf(error);
    setNotice(status === 409 ? "The student or reading changed. Use Refresh reading above, then preview again."
      : [401, 403, 404].includes(status) ? "This preview is no longer available. Current access is being checked."
      : status === 400 ? "Check the custom references before previewing them."
      : "The preview is unavailable. Your custom draft and the assigned reading have not changed.");
    if ([401, 403, 404].includes(status)) refresh();
  }
  async function start(source: "calendar" | "manual") {
    if (!baseline || !key || gate.current) return;
    clear(); const selectedDraft=custom;manualInput.current=source==="manual"?selectedDraft:null;
    const turn = ++generation.current, selected = key, controller = new AbortController(); request.current = controller; gate.current = true;
    setPending(true); setNotice("");
    try {
      const preparation = await previewApi.prepare(mode, baseline, kind, source, source === "manual" ? customReadingRanges(custom) : undefined, controller.signal);
      if (controller.signal.aborted || turn !== generation.current || keyRef.current !== selected || source==="manual" && currentDraft.current!==selectedDraft) return;
      if (preparation.status === "manual-required") { setState({ key: selected, preparation, page: null }); return; }
      const page = await previewApi.page(preparation, 0, controller.signal);
      if (controller.signal.aborted || turn !== generation.current || keyRef.current !== selected || source==="manual" && currentDraft.current!==selectedDraft || Date.now() >= preparation.expiresAt) return;
      setState({ key: selected, preparation, page }); setOpenChapter(page.chapters[0]?.ref ?? null);
    } catch (error) { if (!controller.signal.aborted && turn === generation.current) failure(error); }
    finally { if (turn === generation.current) { gate.current = false; setPending(false); } }
  }
  async function load(preparation: PreparedPreview, offset: number, chapter?: string) {
    if (!key || gate.current || preparation.expiresAt <= Date.now()) return;
    request.current?.abort(); const turn = ++generation.current, selected = key, controller = new AbortController(); request.current = controller; gate.current = true;
    setPending(true); setNotice(""); setState({ key: selected, preparation, page: null });
    try {
      const page = await previewApi.page(preparation, offset, controller.signal);
      if (controller.signal.aborted || turn !== generation.current || keyRef.current !== selected || Date.now() >= preparation.expiresAt) return;
      setState({ key: selected, preparation, page }); setOpenChapter(chapter ?? page.chapters[0]?.ref ?? null);
    } catch (error) { if (!controller.signal.aborted && turn === generation.current) failure(error); }
    finally { if (turn === generation.current) { gate.current = false; setPending(false); } }
  }
  const prepared = current?.preparation.status === "prepared" ? current.preparation : null, page = current?.page;
  const pageIndex = prepared && page ? prepared.pages.findIndex(row => row.offset === page.offset) : -1;
  const chapters = prepared ? [...new Set(prepared.pages.flatMap(page => page.chapters))] : [];
  let selectedRange:string|null=null;
  if(prepared && selection.start && selection.end)try{selectedRange=previewSelection(prepared.ranges,kind,selection.start,selection.end);}catch{/* The explicit action stays disabled across gaps or reversed endpoints. */}
  return <section className="reading-preview" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Reading preview</h3>
    <p>For staff review. Previewing does not change the assigned reading. Keep your custom references in the editor above.</p>
    <div className="form-actions"><button type="button" className="button-secondary" disabled={!key || pending} onClick={() => void start("calendar")}>{kind === "torah" ? "Preview whole Torah portion" : "Preview calendar haftarah"}</button>
      <button type="button" className="button-secondary" disabled={!key || pending || !custom.trim()} onClick={() => void start("manual")}>Preview custom references</button>
      {current && <button type="button" className="button-text" onClick={clear}>Close preview</button>}</div>
    {pending && <p role="status">Loading the staff preview and checking current access…</p>}
    {notice && <p role="status" className="field-help">{notice}</p>}
    {current && <div className="preview-context">
      <p>Ceremony: {current.preparation.ceremonyDate}. Reading date: {current.preparation.readingDate ?? "not determined"} · {current.preparation.calendar === "diaspora" ? "Diaspora" : "Israel"} calendar.</p>
      {current.preparation.manualFallback && <p className="field-help">{fallbackLabels[current.preparation.manualFallback]}</p>}
      {prepared && <><p><strong>{prepared.source === "calendar" ? prepared.portion ?? "Calendar reading" : "Custom references"}</strong>: {prepared.ranges.join("; ")} · {prepared.verseCount} verses.</p>
        <p className="field-help">{prepared.sourceFetchedAt === null ? "No calendar reading was verified for these references." : <>Calendar metadata: <a href="https://www.hebcal.com/" target="_blank" rel="noopener noreferrer">Hebcal</a>, fetched {new Date(prepared.sourceFetchedAt).toLocaleString()}. Text fetch details appear with each page.</>}</p>
        {prepared.calendarAliyot.length > 0 && <details><summary>Calendar aliyah boundaries (orientation only)</summary><ol>{prepared.calendarAliyot.map(row => <li key={row.n}>Aliyah {row.n}: {row.ref}</li>)}</ol><p className="field-help">These are calendar boundaries. Student selections and aliyah cuts are not changed here.</p></details>}
        {prepared.maftir && <p className="field-help">Calendar maftir, shown separately: {prepared.maftir.ref}{prepared.maftir.reason ? ` (${prepared.maftir.reason})` : ""}. No extra maftir is appended to this preview.</p>}
        <div className="preview-controls"><label htmlFor={`${id}-chapter`}>Jump to chapter (opens its first preview page)</label><select id={`${id}-chapter`} value={openChapter ?? ""} disabled={pending} onChange={event => { const ref = event.target.value, target = prepared.pages.find(page => page.chapters.includes(ref)); if (target) void load(prepared, target.offset, ref); }}>
          <option value="" disabled>Choose a chapter</option>{chapters.map(ref => <option key={ref}>{ref}</option>)}</select></div>
        <nav className="study-pages" aria-label="Preview pages"><button type="button" className="button-secondary" disabled={pending || pageIndex <= 0} onClick={() => void load(prepared, prepared.pages[pageIndex - 1].offset)}>Previous preview page</button>
          <button type="button" className="button-secondary" disabled={pending || pageIndex < 0 || pageIndex >= prepared.pages.length - 1} onClick={() => void load(prepared, prepared.pages[pageIndex + 1].offset)}>Next preview page</button></nav>
        <fieldset className="preview-selection"><legend>Stage a verse selection</legend>
          <p>Choose Start and End beside the preview verses. Nothing changes in the draft until you use the selection.</p>
          <p>Start: <bdi dir="ltr">{selection.start||"not selected"}</bdi> · End: <bdi dir="ltr">{selection.end||"not selected"}</bdi></p>
          {selection.start && selection.end && !selectedRange && <p className="request-error" role="status">Choose Start before End without crossing a gap in the preview references.</p>}
          <button type="button" className="button-secondary" disabled={pending || !selectedRange} onClick={()=>{if(selectedRange)onUseSelection(selectedRange);}}>Use selected verses</button>
          {kind==="torah" && draftVerses.length>0 && <p className="field-help">New aliyah starts apply to the staged Torah draft above. Calendar markers remain orientation only.</p>}
        </fieldset>
      </>}
      {page && prepared && <><p role="status">Preview page {pageIndex + 1} of {prepared.pages.length}. Verses {page.offset + 1}–{page.offset + page.verses.length} of {prepared.verseCount}. Not assigned.</p>
        {page.chapters.map(chapter => <details className="preview-chapter" key={`${generation.current}:${page.offset}:${chapter.ref}`} open={openChapter === chapter.ref} onToggle={event => { const open=event.currentTarget.open;setOpenChapter(previous=>open?chapter.ref:previous===chapter.ref?null:previous); }}>
          <summary>{chapter.ref}</summary><ol className="study-verses" data-testid="study-verses">{page.verses.filter(verse => verse.ref.startsWith(`${chapter.ref}:`)).map(verse => <li key={verse.ref}>
            {prepared.calendarAliyot.filter(row => row.ref.split("-")[0] === verse.ref).map(row => <p className="preview-boundary" key={row.n}>Calendar aliyah {row.n} starts here · orientation only</p>)}
            <div className="preview-verse-actions" role="group" aria-label={`Selection at ${verse.ref}`}><button type="button" className="button-text" disabled={pending} aria-pressed={selection.start===verse.ref} onClick={()=>setSelection(previous=>({...previous,start:verse.ref}))}>Start at {verse.ref}</button><button type="button" className="button-text" disabled={pending} aria-pressed={selection.end===verse.ref} onClick={()=>setSelection(previous=>({...previous,end:verse.ref}))}>End at {verse.ref}</button></div>
            {kind==="torah" && draftVerses.includes(verse.ref) && (draftVerses[0]===verse.ref?cutStarts!==null && <p className="preview-boundary">Draft aliyah 1 starts here</p>:<label className="preview-cut"><input type="checkbox" checked={cutStarts?.includes(verse.ref)??false} disabled={pending || cutIssue} onChange={()=>onToggleCut(verse.ref)} />Start new aliyah at {verse.ref}</label>)}
            <AnnotatedStudyVerse key={`${generation.current}:${page.offset}:${verse.ref}`} verse={verse} assignment={{ kind, confirmed: false, verses: [] }} group={`${id}-aids`} />
          </li>)}</ol></details>)}
        <StudyCredits chapters={page.chapters} />
      </>}
    </div>}
  </section>;
}
