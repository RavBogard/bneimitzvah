"use client";

import { usePathname } from "next/navigation";
import { WorkspaceLink } from "../workspace/provider";
import styles from "./shell.module.css";

// People holds three lists, and this moves between them. The old seven-area admin bar is retired (1.9 N10).
const areas = [["/workspace/admin/invitations", "Invitations"], ["/workspace/admin/tutors", "Tutors"], ["/workspace/accounts", "Accounts"]] as const;

export function PeopleNav() {
  const pathname = usePathname();
  return <nav className={styles.subnav} aria-label="People">{areas.map(([href, label]) => <WorkspaceLink key={href} href={href} className={styles.sublink} aria-current={pathname === href ? "page" : undefined}>{label}</WorkspaceLink>)}</nav>;
}
