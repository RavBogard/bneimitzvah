"use client";

import { usePathname } from "next/navigation";
import { List, ListRow, PageHeader } from "../../ui";
import { UpdateStaffSheet } from "../workspace/roster-sheet/update-button";
import { useWorkspace } from "../workspace/provider";
import { rememberedRole } from "./role-memory";
import { shellRole } from "./tabs";
import styles from "./shell.module.css";

// The destinations that have no tab of their own. The words are the ones these pages already use.
const email = { href: "/workspace/email", title: "Email settings", meta: "choose which portal emails you get" };
const claude = { href: "/workspace/claude", title: "Claude connections", meta: "see and end Claude’s access to the portal" };
const adminRows = [{ href: "/workspace/admin/settings", title: "Settings" }, email, claude, { href: "/workspace/admin/reference-review", title: "Recording review" }];

/** More, for a tutor or a rabbi/admin: settings, email, Claude, recording review and the staff Sheet, all one tap from the tab bar. */
export function MoreWorkspace() {
  const { summary } = useWorkspace(), pathname = usePathname();
  const role = shellRole(pathname, summary.roles, rememberedRole());
  if (role !== "admin" && role !== "tutor") return <section className="workspace-state" data-testid="role-unavailable"><h1>Role unavailable</h1><p>This account doesn’t have that access. Choose one of your available roles.</p><a href="/workspace">Choose a role</a></section>;
  // 1.9 N14 (G7): a tutor's Settings are the account's own (Account), listed first as the admin's Settings are.
  const rows = role === "admin" ? adminRows : [{ href: "/account", title: "Settings" }, email, claude, ...(summary.approver ? [{ href: "/workspace/accounts", title: "Account requests", meta: "approve accounts for people who ask" }] : [])];
  return <section className="role-workspace">
    <PageHeader title="More" />
    <List label="More">{rows.map(row => <ListRow key={row.href} href={row.href} title={row.title} meta={"meta" in row ? row.meta : undefined} />)}</List>
    {role === "admin" && <p className={styles.moreAction}><UpdateStaffSheet /></p>}
  </section>;
}
