"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { workspaceDestination } from "../shell/role-home";
import { rememberedRole } from "../shell/role-memory";
import { useWorkspace } from "./provider";

/**
 * /workspace belongs to no role, so it leads on to one: the role the person was last in, else the highest. An account with no role
 * goes to Account, where it can ask for one. Fixed paths only, never a supplied address.
 */
export function WorkspaceHomeRedirect() {
  const { summary } = useWorkspace(), router = useRouter();
  useEffect(() => { router.replace(workspaceDestination(summary.roles, rememberedRole())); }, [summary, router]);
  return <section className="workspace-state" aria-busy="true"><p role="status">One moment while we check your access.</p></section>;
}
