"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useChildLearning } from "./child-practice";
import { useProgress } from "./services";
import { useServiceProgress } from "./service/progress";

function Waiting() {
  return <main className="workspace-main" aria-busy="true"><p className="workspace-state" role="status">Loading saved progress</p></main>;
}

function LearnGate({ children }: { children: ReactNode }) {
  const { account } = useProgress();
  return account.state === "synced" ? children : <Waiting />;
}

function ServiceGate({ children }: { children: ReactNode }) {
  const { account } = useServiceProgress();
  return account.state === "synced" ? children : <Waiting />;
}

export function ChildProgressGate({ children }: { children: ReactNode }) {
  const child = useChildLearning(), path = usePathname();
  if (!child) return children;
  return path === "/learn/service" || path.startsWith("/learn/service/") ? <ServiceGate>{children}</ServiceGate> : <LearnGate>{children}</LearnGate>;
}
