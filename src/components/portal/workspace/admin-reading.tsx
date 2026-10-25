"use client";
import { useCallback, useState } from "react";
import { RequireRole, WorkspaceLink } from "./provider";
import { ReadingPanel } from "./reading";
import { AdminNav } from "./admin-nav";
import { DocumentTitle } from "./document-title";
import type { Student } from "./api";

// The admin student page is the tutor's page (hero, tabs, verse sheet) with a way to the student's people.
// Its h1 (and tab title) is the student's name once the reading has said who that is.
export function AdminReadingWorkspace({ studentId }: { studentId: string }) {
  const [name, setName] = useState<string | null>(null);
  const known = useCallback((student: Student) => setName(`${student.firstName} ${student.lastName}`), []);
  return <RequireRole role="admin"><section className="role-workspace role-workspace-focused admin-workspace"><AdminNav />{name ? <><h1 className="sr-only"><bdi dir="auto">{name}</bdi></h1><DocumentTitle heading={name} /></> : <h1 className="sr-only">Student</h1>}
    <div className="admin-crumbs"><WorkspaceLink href="/workspace/admin/students">All students</WorkspaceLink><WorkspaceLink className="admin-crumb-action" href={`/workspace/admin/students/${studentId}/access`}>People and access</WorkspaceLink></div>
    <ReadingPanel mode="admin" studentId={studentId} onStudentReload={known} /></section></RequireRole>;
}
