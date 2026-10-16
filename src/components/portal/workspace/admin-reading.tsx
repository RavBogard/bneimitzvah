"use client";
import Link from "next/link";
import { RequireRole } from "./provider";
import { ReadingPanel } from "./reading";

export function AdminReadingWorkspace({ studentId }: { studentId: string }) {
  return <RequireRole role="admin"><section className="role-workspace"><Link href="/workspace/admin/students">Back to student roster</Link><h1>Review the assigned reading</h1><ReadingPanel mode="admin" studentId={studentId} /></section></RequireRole>;
}
