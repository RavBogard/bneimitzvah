import "server-only";
import type { StudentActor } from "../access/types";

export type PracticeMode = "student" | "child-practice";
// Internal service composition only. Future handlers choose a literal capability;
// request bodies must never select a callback or arbitrary data operation.
export type PracticeCapability = "read" | "practice-write";
export type PracticeContextView = Readonly<{
  id: string; authorityRevision: number; studentId: string; studentRevision: number; expiresAt: string;
}>;
export type PracticeActor = Omit<StudentActor, "mode"> & Readonly<{
  mode: PracticeMode; role: "student" | "parent"; context: PracticeContextView | null;
}>;
