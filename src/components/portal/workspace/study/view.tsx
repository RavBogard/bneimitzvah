"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { type Assigned } from "../api";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { studyBinding, studyPlan, type StudyKind, type StudyPage } from "./api";
import { StudyCredits } from "./credits";
import { AnnotatedStudyVerse } from "./annotations";
import { LiftedLine } from "./lift";
import { useReadingPrefs } from "../reading-prefs";
import { aliyahPosition } from "../../../../lib/readings/aliyah-starts";

export type StudyReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void> };
export function AssignedStudyText({ baseline, register, reloadMetadata, authorityFailed, onKindChange, guardDeparture, serviceHref, renderWork, renderActiveWork, onPage, learner = false, liftHandle, songSession = learner, onShown, renderMark, renderLiftControls }: {
  baseline: Assigned | null; register(value: StudyReload): () => void; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; onKindChange(kind: StudyKind): void;
  guardDeparture?(): Promise<boolean>; serviceHref?: string; renderWork?(kind: StudyKind, verseRef: string): ReactNode; renderActiveWork?(): ReactNode; onPage?(kind: StudyKind, offset: number, signal: AbortSignal): Promise<void>;
  /** Students and child practice see the reading without status or provenance prose. */
  learner?: boolean; liftHandle?: MutableRefObject<((index: number) => void) | null>;
  /** The Song session reading: English follows the remembered toolbar preference. */
  songSession?: boolean;
  /** Called once a text page is on screen, so verse marks can load for it. */
  onShown?(kind: StudyKind, offset: number, length: number): void;
  renderMark?(kind: StudyKind, verseRef: string): ReactNode; renderLiftControls?(kind: StudyKind, verseRef: string): ReactNode;
}) {
  const { readStudy, summary } = useWorkspace(), aidsGroup = useId(), prefs = useReadingPrefs();
  const [lift, setLift] = useState<{ page: StudyPage; index: number } | null>(null);
  const metadata = useRef<Assigned | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0);
  const selection = useRef<{ kind: StudyKind; offset: number; assignmentKey: string } | null>(null);
  const [state, setState] = useState<{ binding: string; kind?: StudyKind; page?: StudyPage; error?: number; loading?: boolean }>({ binding: "" });
  const key = baseline ? studyBinding(baseline) : "";
  const clear = useCallback(() => { generation.current++; controller.current?.abort(); setLift(null); setState({ binding: "", loading: true }); }, []);
  const load = useCallback(async (value: Assigned, kind: StudyKind, offset: number, outer?: AbortSignal) => {
    controller.current?.abort(); const request = new AbortController(), turn = ++generation.current; controller.current = request;
    const abort = () => request.abort(); if (outer?.aborted) abort(); outer?.addEventListener("abort", abort, { once: true });
    const binding = studyBinding(value), assignment = value.readings.find(row => row.kind === kind)!;
    onKindChange(kind); setLift(null);
    selection.current = { kind, offset, assignmentKey: JSON.stringify([value.mode, value.student.id, value.context?.id, assignment.id, assignment.revision, assignment.verses]) };
    setState({ binding, kind, loading: true });
    try {
      const page = await readStudy(value, kind, offset, request.signal);
      if (request.signal.aborted || turn !== generation.current) return false;
      setState({ binding, kind, page });
      return true;
    } catch (error) {
      if (request.signal.aborted || turn !== generation.current) return false;
      const status = statusOf(error); setState({ binding, kind, error: status });
      if ([401, 403, 404].includes(status)) { metadata.current = null; authorityFailed(status); throw error; }
      return false;
    } finally { outer?.removeEventListener("abort", abort); }
  }, [readStudy, authorityFailed, onKindChange]);
  const reload = useCallback(async (value: Assigned, signal: AbortSignal) => {
    metadata.current = value;
    if (!value.readings.length) { clear(); setState({ binding: studyBinding(value) }); selection.current = null; return; }
    const kind = value.readings.some(row => row.kind === selection.current?.kind) ? selection.current!.kind : value.readings.some(row => row.kind === "torah") ? "torah" : "haftarah";
    const assignment = value.readings.find(row => row.kind === kind)!;
    const assignmentKey = JSON.stringify([value.mode, value.student.id, value.context?.id, assignment.id, assignment.revision, assignment.verses]);
    const offset = selection.current?.assignmentKey === assignmentKey ? selection.current.offset : 0;
    await load(value, kind, offset, signal);
  }, [clear, load]);
  useLayoutEffect(() => register({ clear, reload }), [register, clear, reload]);
  useLayoutEffect(() => () => { generation.current++; controller.current?.abort(); metadata.current = null; }, []);
  const current = key && state.binding === key ? state : null;
  async function explicitLoad(kind: StudyKind, offset: number) {
    const value = metadata.current;
    if (!value || studyBinding(value) !== key) return;
    if (guardDeparture && !await guardDeparture()) return;
    if (metadata.current !== value || studyBinding(value) !== key) return;
    try {
      const pending = load(value, kind, offset), request = controller.current, turn = generation.current;
      const loaded = await pending;
      if (loaded && onPage && request && controller.current === request && turn === generation.current && !request.signal.aborted && metadata.current === value) await onPage(kind, offset, request.signal);
    } catch { /* Authority state has already cleared text and metadata. */ }
  }
  const livePage = key && state.binding === key && !state.loading ? state.page : undefined;
  const shown = livePage && state.kind ? [state.kind, livePage.offset, livePage.verses.length] as const : null;
  useEffect(() => { if (shown) onShown?.(...shown); }, [livePage]); // eslint-disable-line react-hooks/exhaustive-deps
  if (liftHandle) liftHandle.current = livePage ? (index: number) => setLift({ page: livePage, index: Math.min(Math.max(index, 0), livePage.verses.length - 1) }) : null;
  if (!baseline) return <section className="assigned-study" aria-label="Assigned text"><p role="status">Text is hidden while the assignment is checked.</p></section>;
  if (!baseline.readings.length) return null;
  const kind = current?.kind ?? selection.current?.kind ?? baseline.readings[0].kind, assignment = baseline.readings.find(row => row.kind === kind);
  const offsets = [0]; if (assignment && current?.page) { let next: number | null = 0; while (next !== null) { const page = studyPlan(baseline, kind, next); next = page.nextOffset; if (next !== null) offsets.push(next); } }
  const previous = current?.page ? offsets[offsets.indexOf(current.page.offset) - 1] : undefined;
  const single = current?.page ? previous === undefined && current.page.nextOffset === null : false;
  return <section className="assigned-study" aria-label="Assigned text" data-size={prefs.size}>
    {baseline.readings.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">{baseline.readings.map(row => <button key={row.kind} className="button-secondary" aria-label={row.kind === "torah" ? "Torah text" : "Haftarah text"} aria-pressed={kind === row.kind} disabled={current?.loading} onClick={() => void explicitLoad(row.kind, 0)}>{row.kind === "torah" ? "Torah" : "Haftarah"}</button>)}{serviceHref && <a className="button-secondary service-entry" href={serviceHref}>Service parts</a>}</div>}
    {!current || current.loading ? <p role="status">Loading the assigned text…</p> : current.error ? <div role="status"><h4>{current.error === 409 ? "Assignment changed" : [401, 403, 404].includes(current.error) ? "Text access changed" : "Text unavailable"}</h4>
      <p>{current.error === 409 ? learner ? "Your reading was just updated. Load the new version to keep going." : "Refresh the reading metadata before loading this assignment’s text again." : learner ? "The verses didn’t load. Check your connection and try again." : "No previous text is being shown. Confirmed references and the reading review form remain separate."}</p>
      <button className="button-secondary" onClick={() => { if (current.error === 409) void reloadMetadata().catch(() => undefined); else void explicitLoad(kind, selection.current?.offset ?? 0); }}>{current.error === 409 ? "Refresh reading and text" : "Reload assigned text"}</button>
      {renderActiveWork?.()}
    </div> : current.page && <>
      <ol className={`study-verses${renderWork ? " study-verses-with-work" : ""}`} start={current.page.offset + 1}>{current.page.verses.map((verse,index) => {const position=aliyahPosition(kind,assignment!.aliyahStarts,assignment!.verses,verse.ref);return <li key={verse.ref}>{position && (position.startsHere || index===0) && <p className="student-aliyah">Aliyah {position.number}{position.startsHere?" starts here":" · continued from the previous text page"}</p>}<AnnotatedStudyVerse key={JSON.stringify([summary.sessionBinding, key, kind, current.page!.offset, verse.ref])} verse={verse} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup}
        number={current.page!.offset + index + 1} learner={learner} showEnglish={songSession ? prefs.translation : true} onLift={() => setLift({ page: current.page!, index })} mark={renderMark?.(kind, verse.ref)} />{renderWork?.(kind, verse.ref)}</li>;})}</ol>
      {!learner && kind==="torah" && assignment!.aliyahStarts===null && <p className="field-help">Aliyah boundaries have not been recorded for this assignment.</p>}
      {learner ? !single && <p className="study-page-position">Verses {current.page.offset + 1}–{current.page.offset + current.page.verses.length} of {current.page.totalVerses}</p>
        : <p role="status">Verses {current.page.offset + 1}–{current.page.offset + current.page.verses.length} of {current.page.totalVerses}. {current.page.translation.status === "partial" ? "The selected English edition is missing for some verses." : current.page.translation.status === "unavailable" ? "The selected English edition is unavailable on this page." : "Selected English edition available."}</p>}
      {!learner && <p className="field-help">Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted.</p>}
      {!single && <nav className="study-pages" aria-label="Text pages"><button className="button-secondary" disabled={previous === undefined} onClick={() => previous !== undefined && void explicitLoad(kind, previous)}>Previous text page</button><button className="button-secondary" disabled={current.page.nextOffset === null} onClick={() => current.page?.nextOffset !== null && void explicitLoad(kind, current.page!.nextOffset!)}>Next text page</button></nav>}
      <div className="study-more"><StudyCredits chapters={current.page.chapters} summary={learner ? "About this text" : undefined} />{learner && <WorkspaceLink href="/trope-chart">Trope chart</WorkspaceLink>}</div>
      {lift && lift.page === current.page && <LiftedLine learner={learner} verses={current.page.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} index={lift.index} total={current.page.totalVerses} offset={current.page.offset}
        onIndex={index => setLift({ page: lift.page, index })} onClose={() => setLift(null)} controls={renderLiftControls && (ref => renderLiftControls(kind, ref))} />}
    </>}
  </section>;
}
