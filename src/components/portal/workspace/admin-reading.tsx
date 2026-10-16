"use client";
import { RequireRole, WorkspaceLink } from "./provider";
import { ReadingPanel } from "./reading";

export function AdminReadingWorkspace({ studentId }: { studentId: string }) {
  return <RequireRole role="admin"><section className="role-workspace"><WorkspaceLink href="/workspace/admin/students">Back to student roster</WorkspaceLink><h1>Review the assigned reading</h1><ReadingPanel mode="admin" studentId={studentId} /></section></RequireRole>;
}
