"use client";

import { usePathname } from "next/navigation";
import { List, ListRow, PageHeader } from "../../ui";
import { UpdateStaffSheet } from "../workspace/roster-sheet/update-button";
import { useWorkspace } from "../workspace/provider";
import { rememberedRole } from "./role-memory";
import { RedirectTo } from "./redirect-to";
import { MINE_HREF } from "./role-home";
import { shellRole } from "./tabs";
import styles from "./shell.module.css";

// The destinations that have no tab of their own. The words are the ones these pages already use.
const email = { href: "/workspace/email", title: "Email settings", meta: "choose which portal emails you get" };
const claude = { href: "/workspace/claude", title: "Claude connections", meta: "see and end Claude’s access to the portal" };
const adminRows = [{ href: "/workspace/admin/settings", title: "Settings" }, email, claude, { href: "/workspace/admin/reference-review", title: "Recording review" }];

/** More, for the admin: settings, email, Claude, recording review and the staff Sheet, all one tap from the tab bar. Anyone else is sent to /mine. */
export function MoreWorkspace() {
  const { summary } = useWorkspace(), pathname = usePathname();
  const role = shellRole(pathname, summary.roles, rememberedRole());
  if (role !== "admin" || !summary.roles.includes("admin")) return <RedirectTo href={MINE_HREF} />;
  const rows = adminRows;
  return <section className="role-workspace">
    <PageHeader title="More" />
    <List label="More">{rows.map(row => <ListRow key={row.href} href={row.href} title={row.title} meta={"meta" in row ? row.meta : undefined} />)}</List>
    {/* There is no admin page for Discussions and insights; they are curated through Claude (admin walk 2026-10-28). */}
    <p className={styles.moreNote} data-testid="more-curation-note">Discussions and insights are curated through Claude connections.</p>
    <p className={styles.moreAction}><UpdateStaffSheet /></p>
  </section>;
}
