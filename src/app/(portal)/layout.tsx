import type { ReactNode } from "react";
import { WorkspaceProvider } from "../../components/portal/workspace/provider";

/**
 * One provider for the signed-in site: My Readings (/mine) and the workspace (/workspace) are one group, so a practice entered from a child's card on the
 * shelf (or from the child's page) keeps its selection when it moves to /workspace/practice/<id>, and the notice after leaving it is still there on /mine.
 * (Readings for everyone E3; the group adds no segment to an address.)
 */
export default function PortalLayout({ children }: { children: ReactNode }) { return <WorkspaceProvider>{children}</WorkspaceProvider>; }
