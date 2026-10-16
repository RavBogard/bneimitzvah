import "server-only";
import type { ActiveMode } from "../access/types";

export type AdminSelection = Readonly<{ mode: ActiveMode }>;
export type RelationshipConflict = Readonly<{ ok: false; code: "stale-state" }>;
export type RelationshipResult<T> = (Readonly<{ ok: true }> & T) | RelationshipConflict;
export type EligibleTutor = Readonly<{ id: string; displayName: string; revision: number; isCantor: boolean }>;
export type LinkSelection = AdminSelection & Readonly<{ studentId: string; linkId: string; expectedState: "active" }>;
export type FlagSelection = AdminSelection & Readonly<{ expectedRevision: number }>;
