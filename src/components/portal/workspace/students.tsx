"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { workspaceApi, type Student } from "./api";
import { RequireRole, statusOf, useWorkspace, WorkspaceLink } from "./provider";
import { ceremonyCountdown, ReadingPanel } from "./reading";
import { reconcileSelectedStudent } from "./student-label";

export function StudentWorkspace({ mode, studentId }: { mode: "student" | "parent" | "tutor"; studentId?: string }) {
  return <RequireRole role={mode}><StudentSelection key={studentId ?? ""} mode={mode} routeStudentId={studentId} /></RequireRole>;
}

/** A student as a card: name first, then the date and how far away it is. */
function StudentCardBody({ row }: { row: Student }) {
  const countdown = ceremonyCountdown(row.ceremonyDate);
  return <><span className="student-card-name"><bdi dir="auto">{row.firstName} {row.lastName}</bdi></span>
    <span className="student-card-date"><time dateTime={row.ceremonyDate}>{countdown.label}</time>{countdown.phrase && <span className="student-card-days">{countdown.phrase}</span>}</span></>;
}

function StudentSelection({ mode, switching = false, routeStudentId }: { mode: "student" | "parent" | "tutor"; switching?: boolean; routeStudentId?: string }) {
  const { epoch, context, busy, selectChild, registerReload, guardDeparture } = useWorkspace();
  const [rows, setRows] = useState<Student[]>([]), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true), [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0), gate = useRef(false), sequence = useRef(0);
  const [paging, setPaging] = useState(false);
  const abort = useRef<AbortController | null>(null), rowsRef = useRef(rows), selectedRef = useRef(selected);
  rowsRef.current = rows; selectedRef.current = selected;
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
      setSelected(previous => previous && values.some(row => row.id === previous) ? previous : routeStudentId && values.some(row => row.id === routeStudentId) ? routeStudentId : mode === "student" && values.length === 1 ? values[0].id : null);
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
  if (switching) return <section className="sibling-selection" aria-label="Choose a child for practice"><h2>Practice with another child</h2>
    {loading ? <p role="status">Loading linked children…</p> : error ? <><p role="alert">Linked children couldn’t be loaded.</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload children</button></>
      : <><ul className="student-selection-list">{rows.map(row => <li key={row.id}><button className="button-secondary" disabled={busy || context?.studentId === row.id} onClick={() => void selectChild(row.id)}>Switch practice to <bdi dir="auto">{row.firstName} {row.lastName}</bdi></button></li>)}</ul>{more && <button className="button-text" disabled={busy || paging} onClick={() => void loadMore()}>{paging ? "Loading children…" : "Load more children"}</button>}</>}
  </section>;
  const heading = mode === "student" ? "Your assigned reading" : mode === "parent" ? "Your children’s readings" : "Your assigned students";
  const focused = Boolean(routeStudentId);
  return <section className={`role-workspace${focused ? " role-workspace-focused" : ""}`}><h1 className="sr-only">{heading}</h1>
    {mode !== "student" && !focused && <p className="selection-lede">{mode === "parent" ? "Choose a child to see their reading." : "Who are you teaching today?"}</p>}
    {loading ? <p role="status">Loading available students…</p> : error ? <div role="alert"><p>Students couldn’t be loaded. No previous selection is being shown.</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload students</button></div>
      : !rows.length ? <p>No student is currently linked to this role. Ask the congregation for help with your assignment.</p>
        : <>{(mode !== "student" || rows.length !== 1) && <><ul className={`student-cards${focused || selected ? " student-cards-compact" : ""}`} aria-label={mode === "parent" ? "Child" : "Student"}>{rows.map(row => <li key={row.id}>
            {mode === "tutor" ? <WorkspaceLink href={`/workspace/tutor/${row.id}`} className="student-card" data-student-id={row.id} aria-current={selected === row.id ? "page" : undefined}><StudentCardBody row={row} /></WorkspaceLink>
              : <button type="button" className="student-card" data-student-id={row.id} aria-pressed={selected === row.id} onClick={() => { void guardDeparture().then(leave => { if (leave) setSelected(row.id); }); }}><StudentCardBody row={row} /></button>}
          </li>)}</ul>{more && <button className="button-text" disabled={paging} onClick={() => void loadMore()}>{paging ? "Loading students…" : "Load more students"}</button>}</>}
          {focused && !selected && <div className="workspace-state"><h2>Student not found</h2><p>This student isn’t in your list. Choose one of your students above.</p></div>}
          {selected && <ReadingPanel mode={mode} studentId={selected} onStudentReload={reconcileStudent} />}</>}
  </section>;
}

export function PracticeWorkspace({ studentId }: { studentId: string }) {
  const { context, busy, exitPractice } = useWorkspace(), router = useRouter();
  useEffect(() => { if (!context && !busy) router.replace("/workspace/parent"); }, [context, busy, router]);
  if (!context || context.studentId !== studentId) return <section className="workspace-state"><h1>Choose a child to practice</h1><p>This tab does not have a matching practice selection. Reloading never restores a practice handle.</p><Link href="/workspace/parent">Choose a linked child</Link></section>;
  return <RequireRole role="parent"><section className="role-workspace"><div className="workspace-heading-row practice-bar"><h1>Child practice</h1><button className="button-hero-secondary" disabled={busy} onClick={() => void exitPractice()}>{busy ? "Closing practice…" : "Return to parent view"}</button></div>
    <p role="status" className="field-help practice-scope">This tab only. Other tabs keep their own selections.</p>
    <ReadingPanel mode="child-practice" studentId={studentId} /><StudentSelection mode="parent" switching />
  </section></RequireRole>;
}

export function RoleChoice() {
  const { summary } = useWorkspace(), router = useRouter();
  useEffect(() => { if (summary.roles.length === 1 && summary.roles[0] === "student") router.replace("/workspace/student"); }, [summary, router]);
  return <section className="role-workspace"><h1>Choose your workspace</h1><p>Use one role at a time. Your available roles are shown above.</p>{summary.roles.length === 0 && <p>No congregation role is linked to this account. Open your invitation email, or ask the congregation for an invitation.</p>}</section>;
}
