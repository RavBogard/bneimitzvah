"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Assigned, ReadingMode } from "../api";
import { statusOf, useWorkspace, useWorkspaceModal } from "../provider";
import { icons } from "../study/lift";
import type { LessonLogEntry } from "../../../../lib/lesson-log/types";
import { LessonError, summaryBytes, summaryLimit, type LessonOperation, type LessonPage } from "./api";

export type LessonSummarySnapshot = { scope: string; baseline: Assigned | null; generation: number; lesson: { status: "loading" } | { status: "unavailable" } | { status: "ready"; latest: Pick<LessonLogEntry, "lessonDate" | "displayName" | "summary"> | null } };
export type LessonReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void>; snapshot?(publish: (value: LessonSummarySnapshot) => void): void };
/** An open note: a new lesson (no base) or an edit of the saved version it started from. */
type Draft = { entryId: string; base: LessonLogEntry | null; lessonDate: string; summary: string; changedElsewhere?: boolean; uncertain?: boolean };
type List = { scope: string; page?: LessonPage; loading?: boolean; more?: boolean; error?: number };

const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const validDate = (value: string) => /^\d{4}-\d\d-\d\d$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
/** "Thu, Oct 15", with the year when it isn't this year. */
export function lessonDay(date: string) {
  const year = Number(date.slice(0, 4));
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", ...(year !== new Date().getFullYear() ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
const authority = (status: number) => [401, 403, 404].includes(status);
const dirtyDraft = (draft: Draft | null) => Boolean(draft && (draft.base ? draft.summary !== draft.base.summary || draft.lessonDate !== draft.base.lessonDate : draft.summary.trim()));

export function LessonLog({ mode, studentId, register, tabbed }: { mode: ReadingMode; studentId: string; register(value: LessonReload): () => void; tabbed: boolean }) {
  const { summary, epoch, readLessons, registerWork, registerDeparture } = useWorkspace();
  const staff = mode === "tutor" || mode === "admin", id = useId();
  const scope = JSON.stringify([summary.sessionBinding, epoch, mode, studentId]), scopeRef = useRef(scope); scopeRef.current = scope;
  const [list, setList] = useState<List>({ scope });
  const snapshotTarget = useRef<((value: LessonSummarySnapshot) => void) | null>(null), savedSnapshot = useRef<LessonSummarySnapshot | null>(null);
  const snapshotBaseline = useRef<Assigned | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null), draftRef = useRef(draft);
  const setDraft = (next: Draft | null) => { draftRef.current = next; setDraftState(next); };
  const [pending, setPending] = useState<"save" | "delete" | null>(null), [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState(""), [listNotice, setListNotice] = useState(""), [paused, setPaused] = useState(false), [leaving, setLeaving] = useState(false);
  const read = useRef(readLessons); read.current = readLessons;
  const listGeneration = useRef(0), listRequest = useRef<AbortController | null>(null);
  const generation = useRef(0), writeRequest = useRef<AbortController | null>(null), task = useRef<Promise<void> | null>(null), departure = useRef<((leave: boolean) => void) | null>(null);
  const sheet = useRef<HTMLDialogElement>(null), prompt = useRef<HTMLDialogElement>(null), origin = useRef<HTMLElement | null>(null);
  const field = useRef<HTMLTextAreaElement>(null), keepIt = useRef<HTMLButtonElement>(null), deleteButton = useRef<HTMLButtonElement>(null), confirmWasOpen = useRef(false);

  const publish = useCallback((lesson: LessonSummarySnapshot["lesson"], turn = listGeneration.current) => {
    if (turn !== listGeneration.current) return;
    const value = { scope: scopeRef.current, baseline: snapshotBaseline.current, generation: turn, lesson };
    savedSnapshot.current = value; snapshotTarget.current?.(value);
  }, []);
  const observe = useCallback((receiver: (value: LessonSummarySnapshot) => void) => {
    snapshotTarget.current = receiver;
    const value = savedSnapshot.current;
    if (value && value.scope === scopeRef.current && value.generation === listGeneration.current) receiver(value);
  }, []);
  // The list follows the reading's reloads. A reload clears the list only: a note being written survives an access check.
  const clearList = useCallback(() => { listGeneration.current++; listRequest.current?.abort(); listRequest.current = null; publish({ status: "loading" }); setList({ scope: scopeRef.current, loading: true }); }, [publish]);
  const fetchFirst = useCallback(async (signal: AbortSignal) => {
    const turn = listGeneration.current, selectedScope = scopeRef.current;
    const page = await read.current(mode, studentId, { type: "page" }, signal) as LessonPage;
    if (signal.aborted || turn !== listGeneration.current || selectedScope !== scopeRef.current) return null;
    setList({ scope: selectedScope, page }); return page;
  }, [mode, studentId]);
  const reload = useCallback(async (baseline: Assigned, signal: AbortSignal) => {
    clearList(); snapshotBaseline.current = baseline; publish({ status: "loading" }); const turn = listGeneration.current, selectedScope = scopeRef.current;
    try { await fetchFirst(signal); }
    catch (error) {
      if (signal.aborted || turn !== listGeneration.current || selectedScope !== scopeRef.current) return;
      setList({ scope: selectedScope, error: statusOf(error) });
      // Other failures stay inside this panel. An authority failure must not leave old notes on screen.
      if (authority(statusOf(error))) throw error;
    }
  }, [clearList, fetchFirst, publish]);
  /** Re-reads the newest page after a write, its outcome or a conflict. */
  const refresh = useCallback(async () => {
    listGeneration.current++; listRequest.current?.abort(); const controller = new AbortController(); listRequest.current = controller;
    try { return await fetchFirst(controller.signal); }
    catch (error) { if (!controller.signal.aborted && listRequest.current === controller && !authority(statusOf(error))) setList({ scope: scopeRef.current, error: statusOf(error) }); return null; }
  }, [fetchFirst]);
  const discardAll = useCallback(() => {
    generation.current++; writeRequest.current?.abort(); writeRequest.current = null; setDraft(null); setPending(null); setConfirmDelete(false); setNotice(""); setListNotice("");
    // Cleanup cannot grant the navigation that was waiting for a user decision.
    departure.current?.(false); departure.current = null; setLeaving(false); clearList();
  }, [clearList]);
  useLayoutEffect(() => register({ clear: clearList, reload, snapshot: observe }), [register, clearList, reload, observe]);
  useLayoutEffect(() => registerWork({
    pause() { listRequest.current?.abort(); publish({ status: "loading" }); setPaused(true); },
    clear: discardAll,
    async settle() { await task.current?.catch(() => undefined); },
    hasUnsaved: () => dirtyDraft(draftRef.current),
    reveal() { setPaused(false); },
  }), [registerWork, discardAll, publish]);
  useLayoutEffect(() => registerDeparture(async () => {
    if (!dirtyDraft(draftRef.current)) return true;
    if (departure.current) return false;
    setLeaving(true); return new Promise<boolean>(resolve => { departure.current = resolve; });
  }), [registerDeparture]);
  useLayoutEffect(() => { discardAll(); return discardAll; }, [scope, discardAll]);
  useEffect(() => {
    if (!dirtyDraft(draft)) return;
    const unload = (event: BeforeUnloadEvent) => { if (dirtyDraft(draftRef.current)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [draft]);

  // The note sheet gives way to the "keep this note?" prompt, and both leave the top layer during access checks.
  const sheetShown = useWorkspaceModal(sheet, Boolean(draft) && !leaving), promptShown = useWorkspaceModal(prompt, leaving);
  const shown = useRef({ sheetShown, promptShown, leaving, pending }); shown.current = { sheetShown, promptShown, leaving, pending };
  // showModal would focus the close button; the note is what the tutor came to write, so focus it once it can be typed in.
  const ready = sheetShown && !pending && !paused;
  useLayoutEffect(() => { if (ready) field.current?.focus(); }, [ready]);
  useLayoutEffect(() => {
    if (confirmDelete) keepIt.current?.focus();
    else if (confirmWasOpen.current && !pending) deleteButton.current?.focus();
    confirmWasOpen.current = confirmDelete;
  }, [confirmDelete, pending]);
  // closedby is not in every browser: while a save is in flight, Escape must not close the sheet.
  useLayoutEffect(() => {
    if (!pending) return;
    const block = (event: KeyboardEvent) => { if (event.key === "Escape" && sheet.current?.open) event.preventDefault(); };
    document.addEventListener("keydown", block, true); return () => document.removeEventListener("keydown", block, true);
  }, [pending]);
  // A second Escape can close a dialog without a cancel event. Bring state back in line instead of leaving a hidden note.
  function sheetClosed() {
    const now = shown.current; if (!now.sheetShown || !draftRef.current || now.leaving) return;
    if (now.pending) { sheet.current?.showModal(); return; }
    void close();
  }
  function promptClosed() { const now = shown.current; if (now.leaving && now.promptShown) finishDeparture(false); }
  useEffect(() => {
    if (draft || !origin.current) return;
    const opener = origin.current; origin.current = null;
    (opener.isConnected ? opener : document.querySelector<HTMLElement>(`#${CSS.escape(id)}-add`))?.focus();
  }, [draft, id]);
  function finishDeparture(leave: boolean) {
    if (leave) { setDraft(null); setNotice(""); setConfirmDelete(false); }
    const resolve = departure.current; departure.current = null; setLeaving(false); resolve?.(leave);
  }
  function open(base: LessonLogEntry | null, event: { currentTarget: HTMLElement }) {
    if (paused || draftRef.current) return;
    origin.current = event.currentTarget; setNotice(""); setListNotice(""); setConfirmDelete(false);
    setDraft(base ? { entryId: base.entryId, base, lessonDate: base.lessonDate, summary: base.summary } : { entryId: crypto.randomUUID(), base: null, lessonDate: today(), summary: "" });
  }
  async function close() {
    if (pending || !draftRef.current) return;
    if (!dirtyDraft(draftRef.current)) { setDraft(null); return; }
    if (departure.current) return;
    setLeaving(true); await new Promise<boolean>(resolve => { departure.current = resolve; });
  }
  function edit(change: Partial<Pick<Draft, "lessonDate" | "summary">>) { const current = draftRef.current; if (current) setDraft({ ...current, ...change }); setConfirmDelete(false); }

  async function run(operation: LessonOperation, settle: (outcome: { saved: boolean; status: number; conflict: boolean }) => Promise<void>) {
    if (pending || paused) return;
    const turn = ++generation.current, controller = new AbortController(); writeRequest.current = controller;
    setPending(operation.type === "delete" ? "delete" : "save"); setNotice("");
    const work = (async () => {
      let outcome = { saved: true, status: 200, conflict: false };
      try { await read.current(mode, studentId, operation, controller.signal); }
      catch (error) { outcome = { saved: false, status: statusOf(error), conflict: error instanceof LessonError && error.conflict }; }
      if (turn !== generation.current) return;
      if (authority(outcome.status)) { setPending(null); return; }
      try { await settle(outcome); } finally { if (turn === generation.current) setPending(null); }
    })();
    task.current = work; await work; if (task.current === work) task.current = null;
  }
  async function save() {
    const current = draftRef.current; if (!current) return;
    const text = current.summary.replace(/\r\n?|[\x0b\x0c]/g, "\n");
    if (!validDate(current.lessonDate)) { setNotice("Choose the date of the lesson."); return; }
    if (!text.trim()) { setNotice("Write a few words about the lesson first."); return; }
    if (/[\x00-\x08\x0e-\x1f\x7f-\x9f]/.test(text)) { setNotice("This note has a hidden character that can’t be saved. Retype the part you pasted."); return; }
    if (summaryBytes(text) > summaryLimit) { setNotice("This note is too long. Shorten it a little, then save."); return; }
    const operation: LessonOperation = current.base
      ? { type: "edit", entryId: current.entryId, expectedVersion: current.base.version, lessonDate: current.lessonDate, summary: text }
      : { type: "create", entryId: current.entryId, lessonDate: current.lessonDate, summary: text };
    await run(operation, async ({ saved, status, conflict }) => {
      const done = (message: string) => { setDraft(null); setListNotice(message); };
      if (saved) { done(current.base ? "Lesson updated." : "Lesson added."); await refresh(); return; }
      if (status === 429) { setNotice("Too many changes at once. Wait a moment, then try again."); return; }
      if (status === 400) { setNotice("This note couldn’t be saved. Check the date and text, then try again."); return; }
      // A conflict or an unknown outcome: never resend; read the list and show what is really saved.
      const page = await refresh(), found = page?.entries.find(entry => entry.entryId === current.entryId);
      if (!page) { setNotice(conflict ? "This lesson changed somewhere else, and the latest version couldn’t be loaded. Try again in a moment." : "Couldn’t check whether that saved. Try again in a moment."); return; }
      const latest = draftRef.current; if (!latest || latest.entryId !== current.entryId) return;
      if (found && found.summary === text && found.lessonDate === current.lessonDate && (!current.base || found.version > current.base.version)) { done(current.base ? "Lesson updated." : "Lesson added."); return; }
      if (found && current.base && found.version === current.base.version && !conflict) { setNotice("That change may not have saved. Try saving again."); return; }
      if (found) { setDraft({ ...latest, base: found, changedElsewhere: true, uncertain: false }); setNotice(latest.uncertain ? "Your earlier save went through. That version is shown below. Save to replace it with your text." : "This lesson was changed somewhere else. Its latest version is shown below. Save to replace it with your text."); return; }
      // Only the newest page was read; a lesson with an older date may be further down, so its id is kept.
      if (page.nextCursor) { setNotice("Couldn’t find this lesson to check it. Close this and look in the list."); return; }
      if (current.base) { setDraft({ ...latest, entryId: crypto.randomUUID(), base: null }); setNotice("This lesson was deleted somewhere else. Save to add your text as a new lesson."); return; }
      // A new lesson that isn't listed: retrying the same note can't add it twice.
      // A conflict with the whole list read means the id belongs to a lesson that no longer exists; only then is a new id safe.
      setDraft(conflict ? { ...latest, entryId: crypto.randomUUID(), uncertain: false } : { ...latest, uncertain: true });
      setNotice("That lesson may not have saved. Save again; it won’t be added twice.");
    });
  }
  async function remove() {
    const current = draftRef.current; if (!current?.base) return;
    const base = current.base;
    await run({ type: "delete", entryId: base.entryId, expectedVersion: base.version }, async ({ saved, status, conflict }) => {
      setConfirmDelete(false);
      if (saved) { setDraft(null); setListNotice("Lesson deleted."); await refresh(); return; }
      if (status === 429) { setNotice("Too many changes at once. Wait a moment, then try again."); return; }
      const page = await refresh(), found = page?.entries.find(entry => entry.entryId === base.entryId);
      if (!page) { setNotice("Couldn’t check whether the lesson was deleted. Try again in a moment."); return; }
      const latest = draftRef.current; if (!latest || latest.entryId !== base.entryId) return;
      if (!found && !page.nextCursor) { setDraft(null); setListNotice("Lesson deleted."); return; }
      if (found && found.version === base.version && !conflict) { setNotice("That delete may not have gone through. Try again."); return; }
      if (found) { setDraft({ ...latest, base: found, changedElsewhere: true }); setNotice("This lesson was changed somewhere else. Check its latest version before deleting it."); return; }
      setNotice("Couldn’t find this lesson to check it. Close this and look in the list.");
    });
  }
  async function more() {
    const page = list.page; if (!page?.nextCursor || list.more) return;
    listRequest.current?.abort(); const controller = new AbortController(), turn = ++listGeneration.current, selectedScope = scopeRef.current; listRequest.current = controller;
    setList({ scope: selectedScope, page, more: true }); setListNotice("");
    try {
      const next = await read.current(mode, studentId, { type: "page", before: page.nextCursor }, controller.signal) as LessonPage;
      if (controller.signal.aborted || turn !== listGeneration.current || selectedScope !== scopeRef.current) return;
      setList({ scope: selectedScope, page: { entries: [...page.entries, ...next.entries], nextCursor: next.nextCursor } });
    } catch (error) {
      if (controller.signal.aborted || turn !== listGeneration.current || selectedScope !== scopeRef.current || authority(statusOf(error))) return;
      setList({ scope: selectedScope, page }); setListNotice("Couldn’t load earlier lessons. Try again.");
    }
  }
  async function retry() { clearList(); const controller = new AbortController(); listRequest.current = controller; try { await fetchFirst(controller.signal); } catch (error) { if (!controller.signal.aborted && !authority(statusOf(error))) setList({ scope: scopeRef.current, error: statusOf(error) }); } }

  const current = list.scope === scope ? list : null, entries = current?.page?.entries ?? [], busy = Boolean(pending) || paused;
  const projectionTurn = listGeneration.current;
  useLayoutEffect(() => {
    if (scope !== scopeRef.current) return;
    const latest = current?.page?.entries[0];
    publish(paused || !current || current.loading ? { status: "loading" } : current.error ? { status: "unavailable" }
      : { status: "ready", latest: latest ? { lessonDate: latest.lessonDate, displayName: latest.displayName, summary: latest.summary } : null }, projectionTurn);
  }, [current, paused, scope, publish, projectionTurn]);
  const bytes = draft ? summaryBytes(draft.summary) : 0, title = staff ? "Lessons" : "Lesson notes";
  return <section className={`lesson-log${tabbed ? " lesson-log-tabbed" : ""}`} aria-labelledby={`${id}-heading`} aria-busy={current?.loading || undefined}>
    <div className="lesson-log-head"><h2 id={`${id}-heading`}>{title}</h2>
      {staff && tabbed && <p className="lesson-log-lede">Notes after each lesson. The student and their family can read them.</p>}
      {staff && <button type="button" id={`${id}-add`} className="button-primary lesson-add" disabled={busy || !current?.page} onClick={event => open(null, event)}>Add lesson note</button>}</div>
    <p className="lesson-log-notice" role="status">{listNotice}</p>
    {!current || current.loading ? <p className="field-help">Loading lessons…</p>
      : current.error ? <div className="lesson-log-empty"><p>{title} couldn’t be loaded.</p><button type="button" className="button-secondary" onClick={() => void retry()}>Try again</button></div>
      : !entries.length ? <div className="lesson-log-empty"><p className="lesson-log-empty-title">No lessons yet</p>
        <p>{staff ? "After each lesson, write a few lines about what you worked on. The student and their family can read them here." : mode === "student" ? "After each lesson, your tutor’s notes show up here." : "After each lesson, the tutor’s notes show up here."}</p></div>
      : <ol className="lesson-entries">{entries.map(entry => { const day = lessonDay(entry.lessonDate); return <li key={entry.entryId} className="lesson-entry">
        <div className="lesson-entry-head"><h3><time dateTime={entry.lessonDate}>{day}</time></h3>
          {entry.canEdit && <button type="button" className="lesson-edit" aria-label={`Edit lesson from ${day}: ${Array.from(entry.summary.trim().split("\n")[0]).slice(0, 40).join("")}`} disabled={busy || Boolean(draft)} onClick={event => open(entry, event)}>Edit</button>}</div>
        <p className="lesson-summary" dir="auto">{entry.summary}</p>
        <p className="lesson-by"><bdi dir="auto">{entry.displayName}</bdi></p>
      </li>; })}</ol>}
    {current?.page?.nextCursor && <button type="button" className="button-secondary lesson-more" disabled={current.more} onClick={() => void more()}>{current.more ? "Loading…" : "Show earlier lessons"}</button>}

    {staff && <dialog ref={sheet} className="lesson-sheet" aria-labelledby={`${id}-sheet-title`} closedby={pending ? "none" : "closerequest"} onCancel={event => { event.preventDefault(); void close(); }} onClose={sheetClosed}>
      <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close lesson note" disabled={Boolean(pending)} onClick={() => void close()}>{icons.close}</button></div>
      {draft && <form className="lesson-form" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2 id={`${id}-sheet-title`}>{draft.base ? "Edit lesson note" : "Add lesson note"}</h2>
        <p className="lesson-form-help">The student and their family can read this.</p>
        <div className="lesson-field"><label htmlFor={`${id}-date`}>Lesson date</label><input id={`${id}-date`} type="date" required value={draft.lessonDate} disabled={busy} onChange={event => edit({ lessonDate: event.target.value })} /></div>
        <div className="lesson-field"><label htmlFor={`${id}-summary`}>What you worked on</label><textarea ref={field} id={`${id}-summary`} rows={8} required dir="auto" value={draft.summary} disabled={busy} onChange={event => edit({ summary: event.target.value })} /></div>
        {bytes > summaryLimit * 0.9 && <p className={bytes > summaryLimit ? "request-error" : "field-help"} aria-live="polite">{bytes > summaryLimit ? "Too long to save. Shorten this note a little." : "Nearly at the length limit."}</p>}
        <p className="lesson-form-notice request-error" role="status">{notice}</p>
        {draft.changedElsewhere && draft.base && <div className="lesson-latest"><p className="lesson-latest-title">Latest saved version · <time dateTime={draft.base.lessonDate}>{lessonDay(draft.base.lessonDate)}</time></p><p className="lesson-summary" dir="auto">{draft.base.summary}</p></div>}
        {confirmDelete ? <div className="lesson-delete-confirm" role="group" aria-labelledby={`${id}-delete-question`}>
          <p id={`${id}-delete-question`}>Delete this lesson note? It can’t be brought back.</p>
          <div className="lesson-form-actions"><button type="button" className="button-primary lesson-delete-go" disabled={busy} onClick={() => void remove()}>{pending === "delete" ? "Deleting…" : "Delete"}</button>
            <button ref={keepIt} type="button" className="button-secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</button></div></div>
        : <div className="lesson-form-actions"><button type="submit" className="button-primary" disabled={busy}>{pending === "save" ? "Saving…" : "Save lesson"}</button>
          {draft.base?.canDelete && <button ref={deleteButton} type="button" className="button-text lesson-delete" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete lesson</button>}</div>}
      </form>}
    </dialog>}
    {staff && <dialog ref={prompt} className="work-departure" aria-labelledby={`${id}-leave-title`} onCancel={event => { event.preventDefault(); finishDeparture(false); }} onClose={promptClosed}>
      <h2 id={`${id}-leave-title`}>Keep this lesson note?</h2><p>It hasn’t been saved.</p>
      <div className="form-actions"><button type="button" autoFocus className="button-secondary" onClick={() => finishDeparture(false)}>Keep writing</button><button type="button" className="button-text" onClick={() => finishDeparture(true)}>Discard note</button></div>
    </dialog>}
  </section>;
}
