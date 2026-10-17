"use client";
import { RequireRole, WorkspaceLink } from "./provider";
import { ReadingPanel } from "./reading";
import { AdminNav } from "./admin-nav";

// The admin student page is the tutor's page (hero, tabs, verse sheet) with a way to the student's people.
export function AdminReadingWorkspace({ studentId }: { studentId: string }) {
  return <RequireRole role="admin"><section className="role-workspace role-workspace-focused admin-workspace"><AdminNav /><h1 className="sr-only">Student</h1>
    <div className="admin-crumbs"><WorkspaceLink href="/workspace/admin/students">All students</WorkspaceLink><WorkspaceLink className="admin-crumb-action" href={`/workspace/admin/students/${studentId}/access`}>People and access</WorkspaceLink></div>
    <ReadingPanel mode="admin" studentId={studentId} /></section></RequireRole>;
}
