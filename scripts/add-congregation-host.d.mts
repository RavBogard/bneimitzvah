export type HostClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export function hostRow(origin: string): { host: string; origin: string };
export function addCongregationHost(client: HostClient, input: { origin: string; confirm: boolean }): Promise<{ status: "configured" | "already-configured" }>;
