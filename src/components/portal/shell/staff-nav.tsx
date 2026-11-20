"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { SessionSummary } from "../api";
import { fetchLearners } from "../mine/api";
import { studentRows, type StudentRow } from "../mine/student-rows";
import { workspaceApi } from "../workspace/api";
import { byCeremony } from "../workspace/staff/model";
import { rememberedRole } from "./role-memory";
import { staffNavigationRole, STUDENTS_HREF, type StaffNavigationRole } from "./tabs";
import styles from "./staff-nav.module.css";

type GuardedLink = ComponentType<{ href: string; children: ReactNode; "aria-current"?: "page"; prefetch?: boolean; onAccepted?: () => void; fullDocument?: boolean }>;
type NavRow = Pick<StudentRow, "key" | "name" | "href">;

async function rosterRows(role: StaffNavigationRole, signal: AbortSignal): Promise<NavRow[]> {
  if (role === "admin") {
    const roster = await workspaceApi.roster(signal);
    return byCeremony(roster.filter(student => !student.disabledAt && !student.ceremonyDoneAt)).map(student => ({
      key: student.id,
      name: `${student.firstName} ${student.lastName}`,
      href: `/workspace/admin/students/${encodeURIComponent(student.id)}/reading`,
    }));
  }
  const [students, learners] = await Promise.all([workspaceApi.students("tutor", undefined, signal), fetchLearners("", signal)]);
  return studentRows(students, learners);
}

/** The held staff workspace mounts the disclosure. Its role, session and epoch determine which roster it may hold. */
export function StaffNav({ summary, epoch, Link }: { summary: SessionSummary; epoch: number; Link: GuardedLink }) {
  const pathname = usePathname();
  const role = staffNavigationRole(pathname, summary.roles, rememberedRole());
  return role ? <StaffStudents key={`${summary.sessionBinding}:${epoch}:${role}`} role={role} pathname={pathname} Link={Link} /> : null;
}

function StaffStudents({ role, pathname, Link }: { role: StaffNavigationRole; pathname: string; Link: GuardedLink }) {
  const [rows, setRows] = useState<readonly NavRow[] | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const summary = useRef<HTMLElement>(null);
  const close = () => {
    summary.current?.focus({ preventScroll: true });
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setRows(null); setFailed(false);
    void rosterRows(role, request.signal)
      .then(values => { if (!request.signal.aborted) setRows(values); })
      .catch(() => { if (!request.signal.aborted) setFailed(true); });
    return () => request.abort();
  }, [role, retry, open]);
  return <nav className={styles.nav} aria-label="Staff navigation" data-staff-nav>
    <div className={styles.actions}><Link href="/read?lens=study">Study Torah</Link>{role === "admin" && <Link href="/preview" fullDocument>View as</Link>}</div>
    <details className={styles.students} open={open} onToggle={event => {
      const expanded = event.currentTarget.open;
      setOpen(expanded);
      if (expanded) { setRows(null); setFailed(false); setRetry(value => value + 1); }
    }} onKeyDown={event => {
      if (event.key !== "Escape" || !open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }}>
      <summary ref={summary}>My Students</summary>
      {open && <>
        {rows === null && !failed && <p role="status">Loading students…</p>}
        {failed && <><p role="status">The student list didn’t load.</p><button type="button" className="button-text" onClick={() => setRetry(value => value + 1)}>Try again</button></>}
        {rows?.length === 0 && <p>No students yet.</p>}
        {rows && rows.length > 0 && <ul>{rows.map(row => <li key={row.key}><Link href={row.href} aria-current={pathname === row.href ? "page" : undefined} prefetch={false} onAccepted={close}><bdi dir="auto">{row.name}</bdi></Link></li>)}</ul>}
        <Link href={role === "admin" ? STUDENTS_HREF : "/mine#your-students"} onAccepted={close}>See all students</Link>
      </>}
    </details>
  </nav>;
}
