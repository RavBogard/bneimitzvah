export type OwnerAdminClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export type OwnerAdminSelection = { operation: "grant" | "revoke"; tenantId: "crc"; bootstrapId: string; ownerUserId: string; targetUserId: string; targetGrantId: string | null };
type Person = { id: string; verified: boolean; updatedAt: string };
type Membership = { id: string; authorityRevision: number; disabledAt: string | null };
type Grant = { id: string; revision: number; createdAt: string; revokedAt: string | null };
export type OwnerAdminReview = { version: 1; selection: OwnerAdminSelection;
  snapshot: { owner: { user: Person; membership: Membership; grant: Grant }; target: { user: Person; membership: Membership | null; grants: Grant[] } };
  preparedAt: number; expiresAt: number };
export type PreparedOwnerAdmin = { review: OwnerAdminReview; digest: string };
export class OwnerAdminError extends Error { readonly code: "invalid" | "stale" | "denied"; constructor(code?: "invalid" | "stale" | "denied"); }
export function ownerAdminDigest(review: unknown): string;
export function prepareOwnerAdmin(client: OwnerAdminClient, input: OwnerAdminSelection, options?: { now?: () => number }): Promise<PreparedOwnerAdmin>;
export function applyOwnerAdmin(client: OwnerAdminClient, review: unknown, digest: string, options?: { now?: () => number }): Promise<{ status: "granted" | "revoked" }>;
export function writeOwnerAdminReview(path: string, prepared: PreparedOwnerAdmin): Promise<void>;
export function readOwnerAdminFile(path: string): Promise<unknown>;
