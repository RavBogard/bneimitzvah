"use client";
import { AccountRequestsLine } from "./accounts/workspace";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseReadingTab } from "../shell/tabs";
import Link from "next/link";
import { workspaceApi, type Student } from "./api";
import { ChildPracticeDisclosure } from "../practice-visibility/disclosure";
import { TutorCardLine } from "./staff/practice";
import { RequireRole, statusOf, useWorkspace, WorkspaceLink } from "./provider";
import { ceremonyCountdown, ReadingPanel } from "./reading";
import { reconcileSelectedStudent, sortStudentsByCeremony } from "./student-label";
import { HonorsCardLine, HonorsEntry, HonorsNote } from "./honors/sheet";
import { DocumentTitle } from "./document-title";
import { StudentToday } from "./today/today";

export function StudentWorkspace({ mode, studentId }: { mode: "student" | "parent" | "tutor"; studentId?: string }) {
  const { summary } = useWorkspace(), tab = useSearchParams().get("tab");
  // A student's page with no view named (the Today tab, and where signing in lands) is Today; ?tab=reading, service or lessons is the reading page (1.9 N11).
  if (mode === "student" && !studentId && parseReadingTab(tab) === null) return <RequireRole role="student"><StudentToday /></RequireRole>;
  // A tutor an admin chose to approve accounts sees waiting requests here, as admins do on Students.
  return <RequireRole role={mode}>{mode === "tutor" && !studentId && summary.approver && !summary.roles.includes("admin") && <AccountRequestsLine mode="tutor" />}
    <StudentSelection key={studentId ?? ""} mode={mode} routeStudentId={studentId} /></RequireRole>;
}

/** A student as a card: name first, then the date and how far away it is. */
function StudentCardBody({ row, practice = false, honors = false }: { row: Student; practice?: boolean; honors?: boolean }) {
  const countdown = ceremonyCountdown(row.ceremonyDate);
  return <><span className="student-card-name"><bdi dir="auto">{row.firstName} {row.lastName}</bdi></span>
    <span className="student-card-date"><time dateTime={row.ceremonyDate}>{countdown.label}</time>{countdown.phrase && <span className="student-card-days">{countdown.phrase}</span>}</span>
    {/* 1.9 N23 (TP-11): the assigned tutor's roster card line, behind the release gate. */}
    {practice && <TutorCardLine studentId={row.id} />}
    {/* A parent with several children sees each child's honors status under the date. */}
    {honors && <HonorsCardLine studentId={row.id} />}</>;
}

function StudentSelection({ mode, switching = false, routeStudentId }: { mode: "student" | "parent" | "tutor"; switching?: boolean; routeStudentId?: string }) {
  const { epoch, context, busy, selectChild, exitPractice, registerReload, guardDeparture } = useWorkspace();
  const [rows, setRows] = useState<Student[]>([]), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true), [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0), gate = useRef(false), sequence = useRef(0);
  const [paging, setPaging] = useState(false);
  // ?tab= is the view of a student's page (Reading, Service parts, Lessons); a tutor's student cards open that same view. "honors" brings a parent to Family honors.
  const tabParam = useSearchParams().get("tab"), viewTab = parseReadingTab(tabParam), honorsView = mode === "parent" && tabParam === "honors";
  const abort = useRef<AbortController | null>(null), rowsRef = useRef(rows), selectedRef = useRef(selected);
  rowsRef.current = rows; selectedRef.current = selected;
  const ordered = useMemo(() => sortStudentsByCeremony(rows), [rows]), strip = useRef<HTMLUListElement | null>(null);
  // On a phone the compact chip strip scrolls sideways: bring the chosen student's chip into it (the strip only; the page stays where it is).
  useEffect(() => {
    const list = strip.current, chip = list?.querySelector<HTMLElement>('[aria-current="page"], [aria-pressed="true"]');
    if (!list || !chip) return;
    const frame = list.getBoundingClientRect(), box = chip.getBoundingClientRect();
    if (box.left < frame.left) list.scrollLeft -= frame.left - box.left; else if (box.right > frame.right) list.scrollLeft += box.right - frame.right;
  }, [selected, ordered]);
  const reconcileStudent = useCallback((current: Student) => { setRows(previous => reconcileSelectedStudent(previous, selectedRef.current, current)); }, []);
  const load = useCallback(async (preserve = true) => {
    abort.current?.abort(); const request = new AbortController(), turn = ++sequence.current; abort.current = request;
    if (!preserve) { setLoading(true); setRows([]); setSelected(null); }
    setError(false);
    try {
      let values = await workspaceApi.students(mode, undefined, request.signal), page = values;
      if (request.signal.aborted || turn !== sequence.current) return;
      const count = preserve ? rowsRef.current.length : 100;
      // A focused route may name an authorized student beyond the first page.
      // Exhaust the authorized list before reporting that its target is absent.
      while (page.length === 100 && (values.length < count || routeStudentId && !values.some(row => row.id === routeStudentId))) {
        const cursor = page[page.length - 1].id;
        page = await workspaceApi.students(mode, cursor, request.signal);
        if (request.signal.aborted || turn !== sequence.current) return;
        if (page.some(row => row.id <= cursor || values.some(previous => previous.id === row.id))) throw new Error("Student page unavailable");
        values = [...values, ...page];
      }
      if (request.signal.aborted || turn !== sequence.current) return;
      setRows(previous => {
        const known = previous.find(row => row.id === selectedRef.current);
        return known ? reconcileSelectedStudent(values, selectedRef.current, known) : values;
      }); setMore(page.length === 100);
      // A route id is only honoured when it is in this account's authorized list.
      setSelected(previous => previous && values.some(row => row.id === previous) ? previous : routeStudentId && values.some(row => row.id === routeStudentId) ? routeStudentId : (mode === "student" || mode === "parent") && values.length === 1 ? values[0].id : null);
    } catch (error) { if (!request.signal.aborted && turn === sequence.current) { setError(true); throw error; } }
    finally { if (!request.signal.aborted && turn === sequence.current) setLoading(false); }
  }, [mode, routeStudentId]);
  useEffect(() => registerReload(() => load(true)), [registerReload, load]);
  useEffect(() => { void load(false).catch(() => undefined); return () => { sequence.current++; abort.current?.abort(); }; }, [load, epoch, retry]);
  async function loadMore() {
    if (gate.current || !rows.length) return;
    gate.current = true; setPaging(true); const turn = sequence.current;
    try {
      const values = await workspaceApi.students(mode, rows[rows.length - 1].id);
      if (turn !== sequence.current) return;
      if (values.some(row => rows.some(previous => previous.id === row.id))) throw new Error("Student page unavailable");
      setRows(previous => [...previous, ...values]); setMore(values.length === 100);
    } catch { if (turn === sequence.current) setError(true); }
    finally { gate.current = false; setPaging(false); }
  }
  // The one compact practice bar (1.9 N13, tier B "Practising with Noa · Switch to Eli · Done"): the child's first name, a switch for each
  // other linked child, Done, and the one coaching line. It uses names only: the app stores no pronouns.
  if (switching) {
    const child = rows.find(row => row.id === context?.studentId), others = ordered.filter(row => row.id !== context?.studentId);
    return <section className="practice-bar" aria-label="Practice">
      <div className="practice-bar-row">
        {child ? <h1 className="practice-bar-title">Practising with <bdi dir="auto">{child.firstName}</bdi></h1> : <h1 className="sr-only">Practice</h1>}
        {others.length > 0 && <ul className="practice-switches">{others.map(row => <li key={row.id}><button className="button-secondary" aria-label={`Switch to ${row.firstName} ${row.lastName}`} disabled={busy} onClick={() => void selectChild(row.id)}>Switch to <bdi dir="auto">{row.firstName}</bdi></button></li>)}</ul>}
        <button className="button-hero-secondary practice-done" disabled={busy} onClick={() => void exitPractice()}>{busy ? "Closing practice…" : "Done"}</button>
      </div>
      {loading ? <p role="status">Loading linked children…</p> : error ? <><p role="alert">Linked children couldn’t be loaded.</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload children</button></>
        : <>{more && <button className="button-text" disabled={busy || paging} onClick={() => void loadMore()}>{paging ? "Loading children…" : "Load more children"}</button>}
          {child && <p className="field-help practice-coach">Sit with <bdi dir="auto">{child.firstName}</bdi> for each verse. Tap Got it only when <bdi dir="auto">{child.firstName}</bdi> reads it without stopping.</p>}
          {/* 1.9 N23: a child who practises only with a parent is told here what the tutor sees, behind the same release gate. */}
          {child && <ChildPracticeDisclosure name={child.firstName} place="child-practice" />}</>}
    </section>;
  }
  const selectedRow = rows.find(row => row.id === selected), selectedName = `${selectedRow?.firstName ?? ""} ${selectedRow?.lastName ?? ""}`;
  // A parent's honors row follows the "This week" summary (focused when the Honors tab brought the parent here).
  const selectedHonors = selected && !context && mode === "parent" ? <HonorsEntry key={`parent:${selected}`} mode="parent" studentId={selected} name={selectedName} focusOnShow={honorsView} /> : undefined;
  const heading = mode === "student" ? "Your assigned reading" : mode === "parent" ? "Your children’s readings" : "Your assigned students";
  const focused = Boolean(routeStudentId);
  // On a student's own page the h1 is the student's name (and so is the tab title), once the list has said who that is.
  // A parent with one child has no list to choose from: the page is that child's summary, headed with the child's name.
  const onlyChild = mode === "parent" && !more && rows.length === 1;
  const named = focused || onlyChild ? rows.find(row => row.id === selected) : undefined, studentName = named ? `${named.firstName} ${named.lastName}` : null;
  return <section className={`role-workspace${focused ? " role-workspace-focused" : ""}`}>{studentName ? <><h1 className="sr-only"><bdi dir="auto">{studentName}</bdi></h1><DocumentTitle heading={studentName} /></> : <h1 className="sr-only">{heading}</h1>}
    {mode !== "student" && !focused && !selected && <p className="selection-lede">{mode === "parent" ? "Choose a child to see their reading." : "Who are you teaching today?"}</p>}
    {loading ? <p role="status">Loading available students…</p> : error ? <div role="alert"><p>Students couldn’t be loaded. No previous selection is being shown.</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload students</button></div>
      : !rows.length ? <p>No student is currently linked to this role. Ask the congregation for help with your assignment.</p>
        : <>{(mode !== "student" || rows.length !== 1) && <><ul ref={strip} className={`student-cards${focused || selected ? " student-cards-compact" : ""}`} aria-label={mode === "parent" ? "Child" : "Student"}>{ordered.map(row => <li key={row.id}>
            {mode === "tutor" ? <WorkspaceLink href={`/workspace/tutor/${row.id}${viewTab ? `?tab=${viewTab}` : ""}`} className="student-card" data-student-id={row.id} aria-current={selected === row.id ? "page" : undefined}><StudentCardBody row={row} practice={!focused && !selected} /></WorkspaceLink>
              : <button type="button" className="student-card" data-student-id={row.id} aria-pressed={selected === row.id} onClick={() => { void guardDeparture().then(leave => { if (leave) setSelected(row.id); }); }}><StudentCardBody row={row} honors={mode === "parent" && rows.length > 1 && !focused && !selected} /></button>}
          </li>)}</ul>{more && <button className="button-text" disabled={paging} onClick={() => void loadMore()}>{paging ? "Loading students…" : "Load more students"}</button>}</>}
          {focused && !selected && <div className="workspace-state"><h2>Student not found</h2><p>This student isn’t in your list. Choose one of your students above.</p></div>}
          {selected && <ReadingPanel mode={mode} studentId={selected} onStudentReload={reconcileStudent} afterSummary={selectedHonors} />}
          {/* An adult's own honors entry sits after the reading (G20). A parent's sits right after the summary, inside the panel (above). */}
          {selected && !context && mode === "student" && selectedRow?.ownAdultHonors === true && <HonorsEntry key={`student:${selected}`} mode="student" studentId={selected} name={selectedName} />}
          {selected && mode === "student" && rows.find(row => row.id === selected)?.ownAdultHonors !== true && <HonorsNote />}</>}
  </section>;
}

export function PracticeWorkspace({ studentId }: { studentId: string }) {
  const { context, busy } = useWorkspace(), router = useRouter();
  useEffect(() => { if (!context && !busy) router.replace("/workspace/parent"); }, [context, busy, router]);
  if (!context || context.studentId !== studentId) return <section className="workspace-state"><h1>Choose a child to practice</h1><p>This tab does not have a matching practice selection. Reloading never restores a practice handle.</p><Link href="/workspace/parent">Choose a linked child</Link></section>;
  return <RequireRole role="parent"><section className="role-workspace">
    <StudentSelection mode="parent" switching />
    <ReadingPanel mode="child-practice" studentId={studentId} />
  </section></RequireRole>;
}
