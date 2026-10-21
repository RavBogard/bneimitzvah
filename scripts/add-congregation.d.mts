export type CongregationClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export type CongregationInput = { id: string; name: string; productName: string; host: string; origin: string;
  environment: "production" | "preview" | "local" | "test"; deployment: string; calendar: "diaspora" | "israel" };
export type CongregationCode = "invalid" | "owner-required" | "tenant-exists" | "host-exists" | "refused";
export type CongregationReport = { outcome: "dry-run" | "applied"; tenant: string; host: string; environment: string;
  rows: { tenant: number; tenantHost: number; tenantSettings: number }; settingsVersion: number | null };
export class CongregationError extends Error { readonly code: CongregationCode; constructor(code?: CongregationCode); }
export function parseArgs(argv: string[]): CongregationInput & { apply: boolean };
export function congregation(input: unknown): Readonly<CongregationInput>;
export function addCongregation(client: CongregationClient, input: CongregationInput, options?: { apply?: boolean }): Promise<CongregationReport>;
