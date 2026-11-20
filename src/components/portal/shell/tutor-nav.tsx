"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { SessionSummary } from "../api";
import { usePathname } from "next/navigation";
import { workspaceApi } from "../workspace/api";
import { fetchLearners } from "../mine/api";
import { studentRows, type StudentRow } from "../mine/student-rows";
import { homeRole } from "./role-home";
import { rememberedRole } from "./role-memory";
import { roleOfPath } from "./tabs";
import styles from "./tutor-nav.module.css";

type GuardedLink = ComponentType<{ href: string; children: ReactNode; "aria-current"?: "page" }>;
type TutorNavProps = { summary: SessionSummary; epoch: number; Link: GuardedLink };

/** Only the held tutor workspace mounts the roster. Public reading pages never mount this component. */
export function TutorNav({ summary, epoch, Link }: TutorNavProps) {
  const pathname = usePathname();
  const role = roleOfPath(pathname) ?? homeRole(summary.roles, rememberedRole());
  return summary.roles.includes("tutor") && role === "tutor" ? <TutorStudents key={`${summary.sessionBinding}:${epoch}`} Link={Link} /> : null;
}

function TutorStudents({ Link }: { Link: GuardedLink }) {
  const [rows, setRows] = useState<readonly StudentRow[] | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setRows(null); setFailed(false);
    void Promise.all([workspaceApi.students("tutor", undefined, request.signal), fetchLearners("", request.signal)])
      .then(([students, learners]) => { if (!request.signal.aborted) setRows(studentRows(students, learners)); })
      .catch(() => { if (!request.signal.aborted) setFailed(true); });
    return () => request.abort();
  }, [retry, open]);
  return <nav className={styles.nav} aria-label="Tutor navigation" data-tutor-nav>
    <div className={styles.actions}><Link href="/mine">My readings</Link><Link href="/read?lens=study">Study Torah</Link><Link href="/learn">Learn to lein</Link></div>
    <details className={styles.students} open={open} onToggle={event => {
      const expanded = event.currentTarget.open;
      setOpen(expanded);
      if (expanded) { setRows(null); setFailed(false); setRetry(value => value + 1); }
    }}>
      <summary>My Students</summary>
      {open && <>
      {rows === null && !failed && <p role="status">Loading students…</p>}
      {failed && <><p role="status">The student list didn’t load.</p><button type="button" className="button-text" onClick={() => setRetry(value => value + 1)}>Try again</button></>}
      {rows?.length === 0 && <p>No students yet.</p>}
      {rows && rows.length > 0 && <ul>{rows.map(row => <li key={row.key}><Link href={row.href} aria-current={pathname === row.href ? "page" : undefined}><bdi dir="auto">{row.name}</bdi></Link></li>)}</ul>}
      <Link href="/mine#your-students">See all students</Link>
      </>}
    </details>
  </nav>;
}
