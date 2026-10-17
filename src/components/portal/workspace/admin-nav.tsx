"use client";

import { usePathname } from "next/navigation";
import { WorkspaceLink } from "./provider";

// One place to move between the admin areas. A student's own pages belong to Students.
const areas = [["/workspace/admin/students", "Students"], ["/workspace/admin/invitations", "Invitations"], ["/workspace/admin/tutors", "Tutors"]] as const;

export function AdminNav() {
  const pathname = usePathname();
  return <nav className="admin-nav" aria-label="Admin">{areas.map(([href, label]) => <WorkspaceLink key={href} href={href} aria-current={pathname === href ? "page" : pathname.startsWith(`${href}/`) ? "location" : undefined}>{label}</WorkspaceLink>)}</nav>;
}
