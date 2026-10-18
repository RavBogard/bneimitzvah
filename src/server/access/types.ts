import "server-only";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "../db/index";

export type AccessDatabase<Q extends PgQueryResultHKT> = PgDatabase<Q, typeof schema>;
export type AccessTransaction<Q extends PgQueryResultHKT> = PgTransaction<Q, typeof schema, ExtractTablesWithRelations<typeof schema>>;
export type ActiveMode = "student" | "parent" | "tutor" | "admin";
export type LockIntent = "read" | "data-write" | "authority-write" | "honoree-link-write";
export type DeploymentScope = Readonly<{ environment: "production" | "preview" | "local" | "test"; deployment: string }>;
export type AccessRequest = Readonly<{ url: string; headers: Headers }>;
export type Actor = Readonly<{
  tenantId: string; origin: string; userId: string; authSessionId: string; membershipId: string;
  authSessionExpiresAt: number; roleGrantId: string; roleGrantRevision: number; mode: ActiveMode; authorityRevision: number;
}>;
export type VerifiedIdentity = Readonly<{
  tenantId: string; origin: string; userId: string; email: string; authSessionId: string; sessionExpiresAt: Date;
  membership: Readonly<{ id: string; authorityRevision: number }> | null;
}>;
export type StudentActor = Actor & Readonly<{ studentId: string; relationshipId: string | null; relationshipRevision: number | null }>;

// Mutation/revocation composition must choose authority-write before locking,
// then lock tenant -> user -> session -> membership -> grant -> student -> link.
// Ordinary reading writes only change assignment rows, so shared authority locks
// are sufficient; they must never upgrade these same locks to change authority.
export const lockStrength = (intent: LockIntent) => intent === "authority-write" ? "update" as const : "share" as const;
