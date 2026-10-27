import type { ReactNode } from "react";
import { WorkspaceProvider } from "../../components/portal/workspace/provider";

export default function MineLayout({ children }: { children: ReactNode }) { return <WorkspaceProvider>{children}</WorkspaceProvider>; }
