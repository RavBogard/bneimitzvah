"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { WorkspaceLink } from "./provider";

// One place to move between the admin areas. A student's own pages belong to Students.
const areas = [["/workspace/admin/students", "Students"], ["/workspace/admin/invitations", "Invitations"], ["/workspace/admin/tutors", "Tutors"], ["/workspace/admin/reference-review", "Recording review"], ["/workspace/admin/settings", "Settings"]] as const;

export function AdminNav() {
  const pathname = usePathname();
  const nav = useRef<HTMLElement | null>(null);
  useEffect(() => { nav.current?.querySelector("a[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [pathname]);
  return <nav ref={nav} className="admin-nav" aria-label="Admin">{areas.map(([href, label]) => <WorkspaceLink key={href} href={href} aria-current={pathname === href ? "page" : pathname.startsWith(`${href}/`) ? "location" : undefined}>{label}</WorkspaceLink>)}</nav>;
}
