"use client";
import { AccountRequestsLine } from "./accounts/workspace";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { parseReadingTab } from "../shell/tabs";
import Link from "next/link";
import { workspaceApi, type Student } from "./api";
import { RequireRole, rolePaths, statusOf, useWorkspace, WorkspaceLink } from "./provider";
import { ceremonyCountdown, ReadingPanel } from "./reading";
import { reconcileSelectedStudent, sortStudentsByCeremony } from "./student-label";
import { HonorsEntry, HonorsNote } from "./honors/sheet";
import { DocumentTitle } from "./document-title";

export function StudentWorkspace({ mode, studentId }: { mode: "student" | "parent" | "tutor"; studentId?: string }) {
  const { summary } = useWorkspace();
  // A tutor an admin chose to approve accounts sees waiting requests here, as admins do on Students.
  return <RequireRole role={mode}>{mode === "tutor" && !studentId && summary.approver && !summary.roles.includes("admin") && <AccountRequestsLine mode="tutor" />}
    <StudentSelection key={studentId ?? ""} mode={mode} routeStudentId={studentId} /></RequireRole>;
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
  useEffect(() => {
    if (!honorsView || loading || !selected) return;
    const heading = document.getElementById("family-honors");
    heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: "start" });
  }, [honorsView, loading, selected]);
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
      : <><ul className="student-selection-list">{ordered.map(row => <li key={row.id}><button className="button-secondary" disabled={busy || context?.studentId === row.id} onClick={() => void selectChild(row.id)}>Switch practice to <bdi dir="auto">{row.firstName} {row.lastName}</bdi></button></li>)}</ul>{more && <button className="button-text" disabled={busy || paging} onClick={() => void loadMore()}>{paging ? "Loading children…" : "Load more children"}</button>}</>}
  </section>;
  const heading = mode === "student" ? "Your assigned reading" : mode === "parent" ? "Your children’s readings" : "Your assigned students";
  const focused = Boolean(routeStudentId);
  // On a student's own page the h1 is the student's name (and so is the tab title), once the list has said who that is.
  const named = focused ? rows.find(row => row.id === selected) : undefined, studentName = named ? `${named.firstName} ${named.lastName}` : null;
  return <section className={`role-workspace${focused ? " role-workspace-focused" : ""}`}>{studentName ? <><h1 className="sr-only"><bdi dir="auto">{studentName}</bdi></h1><DocumentTitle heading={studentName} /></> : <h1 className="sr-only">{heading}</h1>}
    {mode !== "student" && !focused && <p className="selection-lede">{mode === "parent" ? "Choose a child to see their reading." : "Who are you teaching today?"}</p>}
    {loading ? <p role="status">Loading available students…</p> : error ? <div role="alert"><p>Students couldn’t be loaded. No previous selection is being shown.</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload students</button></div>
      : !rows.length ? <p>No student is currently linked to this role. Ask the congregation for help with your assignment.</p>
        : <>{(mode !== "student" || rows.length !== 1) && <><ul ref={strip} className={`student-cards${focused || selected ? " student-cards-compact" : ""}`} aria-label={mode === "parent" ? "Child" : "Student"}>{ordered.map(row => <li key={row.id}>
            {mode === "tutor" ? <WorkspaceLink href={`/workspace/tutor/${row.id}${viewTab ? `?tab=${viewTab}` : ""}`} className="student-card" data-student-id={row.id} aria-current={selected === row.id ? "page" : undefined}><StudentCardBody row={row} /></WorkspaceLink>
              : <button type="button" className="student-card" data-student-id={row.id} aria-pressed={selected === row.id} onClick={() => { void guardDeparture().then(leave => { if (leave) setSelected(row.id); }); }}><StudentCardBody row={row} /></button>}
          </li>)}</ul>{more && <button className="button-text" disabled={paging} onClick={() => void loadMore()}>{paging ? "Loading students…" : "Load more students"}</button>}</>}
          {focused && !selected && <div className="workspace-state"><h2>Student not found</h2><p>This student isn’t in your list. Choose one of your students above.</p></div>}
          {selected && !context && (mode === "parent" || mode === "student" && rows.find(row => row.id === selected)?.ownAdultHonors === true) && <HonorsEntry key={`${mode}:${selected}`} mode={mode === "student" ? "student" : "parent"} studentId={selected} name={`${rows.find(row => row.id === selected)?.firstName ?? ""} ${rows.find(row => row.id === selected)?.lastName ?? ""}`} />}
          {selected && <ReadingPanel mode={mode} studentId={selected} onStudentReload={reconcileStudent} />}
          {selected && mode === "student" && rows.find(row => row.id === selected)?.ownAdultHonors !== true && <HonorsNote />}</>}
  </section>;
}

export function PracticeWorkspace({ studentId }: { studentId: string }) {
  const { context, busy, exitPractice } = useWorkspace(), router = useRouter();
  useEffect(() => { if (!context && !busy) router.replace("/workspace/parent"); }, [context, busy, router]);
  if (!context || context.studentId !== studentId) return <section className="workspace-state"><h1>Choose a child to practice</h1><p>This tab does not have a matching practice selection. Reloading never restores a practice handle.</p><Link href="/workspace/parent">Choose a linked child</Link></section>;
  return <RequireRole role="parent"><section className="role-workspace"><div className="workspace-heading-row practice-bar"><h1>Child practice</h1><button className="button-hero-secondary" disabled={busy} onClick={() => void exitPractice()}>{busy ? "Closing practice…" : "Return to parent view"}</button></div>
    <p role="status" className="field-help practice-scope">This tab only. Other tabs keep their own selections.</p>
    <StudentSelection mode="parent" switching />
    <ReadingPanel mode="child-practice" studentId={studentId} />
  </section></RequireRole>;
}

export function RoleChoice() {
  const { summary } = useWorkspace(), router = useRouter();
  // One role leaves nothing to choose: go straight to that role's workspace (fixed paths, never a supplied address).
  useEffect(() => { if (summary.roles.length === 1) router.replace(rolePaths[summary.roles[0]]); }, [summary, router]);
  return <section className="role-workspace"><h1>Choose your workspace</h1><p>Use one role at a time. Your available roles are shown above.</p>{summary.roles.length === 0 && <p>No congregation role is linked to this account. Open your invitation email, or ask the congregation for an invitation.</p>}</section>;
}
