"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { type Assigned } from "../api";
import { statusOf, useWorkspace } from "../provider";
import { studyBinding, studyPlan, type StudyKind, type StudyPage, type StudyVerse } from "./api";
import { StudyCredits } from "./credits";

export type StudyReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void> };
function Hebrew({ verse }: { verse: StudyVerse }) {
  return <><p className="study-hebrew" lang="he" dir="rtl">{verse.hebrew.segments.map((segment, index) => segment.kind === "text" ? <span key={index}>{segment.text}</span>
    : segment.kind === "alternative" ? <span className="study-alternative" key={index}><span>{segment.written}</span><span className="study-read-alternative"> [<span lang="en" dir="ltr">read / qere:</span> {segment.read}]</span></span>
      : segment.kind === "inverted-nun" ? <span key={index} role="img" aria-label="Inverted nun, Masoretic sign">׆</span>
        : <span key={index} className="study-paragraph-gap"><span lang="en" dir="ltr">[{segment.break === "petuchah" ? "open paragraph" : "closed paragraph"}]</span></span>)}</p>
    {verse.hebrew.segments.some(segment => segment.kind === "alternative") && <p className="field-help">Written form (ketiv) is followed by the read alternative (qere); neither is silently substituted.</p>}
    {verse.hebrew.paragraphAfter && <p className="study-paragraph-note">{verse.hebrew.paragraphAfter === "petuchah" ? "Open paragraph (petuchah) after this verse." : "Closed paragraph (setumah) after this verse."}</p>}
  </>;
}
export function AssignedStudyText({ baseline, register, reloadMetadata, authorityFailed, onKindChange }: {
  baseline: Assigned | null; register(value: StudyReload): () => void; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; onKindChange(kind: StudyKind): void;
}) {
  const { readStudy } = useWorkspace();
  const metadata = useRef<Assigned | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0);
  const selection = useRef<{ kind: StudyKind; offset: number; assignmentKey: string } | null>(null);
  const [state, setState] = useState<{ binding: string; kind?: StudyKind; page?: StudyPage; error?: number; loading?: boolean }>({ binding: "" });
  const key = baseline ? studyBinding(baseline) : "";
  const clear = useCallback(() => { generation.current++; controller.current?.abort(); setState({ binding: "", loading: true }); }, []);
  const load = useCallback(async (value: Assigned, kind: StudyKind, offset: number, outer?: AbortSignal) => {
    controller.current?.abort(); const request = new AbortController(), turn = ++generation.current; controller.current = request;
    const abort = () => request.abort(); if (outer?.aborted) abort(); outer?.addEventListener("abort", abort, { once: true });
    const binding = studyBinding(value), assignment = value.readings.find(row => row.kind === kind)!;
    onKindChange(kind);
    selection.current = { kind, offset, assignmentKey: JSON.stringify([value.mode, value.student.id, value.context?.id, assignment.id, assignment.revision, assignment.verses]) };
    setState({ binding, kind, loading: true });
    try {
      const page = await readStudy(value, kind, offset, request.signal);
      if (request.signal.aborted || turn !== generation.current) return;
      setState({ binding, kind, page });
    } catch (error) {
      if (request.signal.aborted || turn !== generation.current) return;
      const status = statusOf(error); setState({ binding, kind, error: status });
      if ([401, 403, 404].includes(status)) { metadata.current = null; authorityFailed(status); throw error; }
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
    try { await load(value, kind, offset); } catch { /* Authority state has already cleared text and metadata. */ }
  }
  if (!baseline) return <section className="assigned-study" aria-label="Assigned text"><p role="status">Text is hidden while the assignment is checked.</p></section>;
  if (!baseline.readings.length) return null;
  const kind = current?.kind ?? selection.current?.kind ?? baseline.readings[0].kind, assignment = baseline.readings.find(row => row.kind === kind);
  const offsets = [0]; if (assignment && current?.page) { let next: number | null = 0; while (next !== null) { const page = studyPlan(baseline, kind, next); next = page.nextOffset; if (next !== null) offsets.push(next); } }
  const previous = current?.page ? offsets[offsets.indexOf(current.page.offset) - 1] : undefined;
  return <section className="assigned-study" aria-label="Assigned text">
    {baseline.readings.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">{baseline.readings.map(row => <button key={row.kind} className="button-secondary" aria-pressed={kind === row.kind} disabled={current?.loading} onClick={() => void explicitLoad(row.kind, 0)}>{row.kind === "torah" ? "Torah text" : "Haftarah text"}</button>)}</div>}
    {!current || current.loading ? <p role="status">Loading the assigned text…</p> : current.error ? <div role="status"><h4>{current.error === 409 ? "Assignment changed" : [401, 403, 404].includes(current.error) ? "Text access changed" : "Text unavailable"}</h4>
      <p>{current.error === 409 ? "Refresh the reading metadata before loading this assignment’s text again." : "No previous text is being shown. Confirmed references and the reading review form remain separate."}</p>
      <button className="button-secondary" onClick={() => { if (current.error === 409) void reloadMetadata().catch(() => undefined); else void explicitLoad(kind, selection.current?.offset ?? 0); }}>{current.error === 409 ? "Refresh reading and text" : "Reload assigned text"}</button>
    </div> : current.page && <>
      <ol className="study-verses" start={current.page.offset + 1}>{current.page.verses.map(verse => <li key={verse.ref}><article><h4><bdi dir="ltr">{verse.ref}</bdi></h4><Hebrew verse={verse} /><p className="study-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p></article></li>)}</ol>
      <p role="status">Verses {current.page.offset + 1}–{current.page.offset + current.page.verses.length} of {current.page.totalVerses}. {current.page.translation.status === "partial" ? "The selected English edition is missing for some verses." : current.page.translation.status === "unavailable" ? "The selected English edition is unavailable on this page." : "Selected English edition available."}</p>
      <p className="field-help">Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted.</p>
      <nav className="study-pages" aria-label="Text pages"><button className="button-secondary" disabled={previous === undefined} onClick={() => previous !== undefined && void explicitLoad(kind, previous)}>Previous text page</button><button className="button-secondary" disabled={current.page.nextOffset === null} onClick={() => current.page?.nextOffset !== null && void explicitLoad(kind, current.page!.nextOffset!)}>Next text page</button></nav>
      <StudyCredits chapters={current.page.chapters} />
    </>}
  </section>;
}
