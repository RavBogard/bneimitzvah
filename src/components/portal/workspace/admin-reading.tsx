"use client";
import { useCallback, useState } from "react";
import { RequireRole, WorkspaceLink } from "./provider";
import { ReadingPanel } from "./reading";
import { DocumentTitle } from "./document-title";
import type { Student } from "./api";

// The admin student page is the tutor's page (hero, tabs, verse sheet) with a way to the student's people.
// Its h1 is the reading's title block, the student's name (and so is the tab title) once the reading has said who that is; until then the panel's loading state is the h1.
export function AdminReadingWorkspace({ studentId }: { studentId: string }) {
  const [name, setName] = useState<string | null>(null);
  const known = useCallback((student: Student) => setName(`${student.firstName} ${student.lastName}`), []);
  return <RequireRole role="admin"><section className="role-workspace role-workspace-focused admin-workspace">{name && <DocumentTitle heading={name} />}
    <div className="admin-crumbs"><WorkspaceLink href="/workspace/admin/students?tab=students">All students</WorkspaceLink><WorkspaceLink className="admin-crumb-action" href={`/workspace/admin/students/${studentId}/access`}>People and access</WorkspaceLink></div>
    <ReadingPanel mode="admin" studentId={studentId} onStudentReload={known} /></section></RequireRole>;
}
